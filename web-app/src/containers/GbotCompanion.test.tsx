import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import { useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import GbotCompanion from './GbotCompanion'
import GbotAvatars from '@/components/GbotAvatars'
import { useGbotCompanion } from '@/stores/gbot-companion-store'
import { useGbotPage } from '@/stores/gbot-page-store'
import type { AgentDefinition } from '@/types/agent'
import { useGeneralSetting } from '@/hooks/useGeneralSetting'
import type { BotState, Task } from '@/services/gbot'
import type { MediaSessionOptions } from '@/vendor/cua-media/mediaSession'

const mocks = vi.hoisted(() => ({
  call: vi.fn(),
  getTarget: vi.fn(),
  listen: vi.fn(),
  start: vi.fn(),
  stop: vi.fn(),
  resources: { ready: true as boolean | null, error: '' },
}))
vi.mock('@/hooks/useBundledResources', () => ({
  useBundledResources: () => mocks.resources,
}))
vi.mock('@tanstack/react-router', () => ({
  Link: ({
    children,
    to,
    onClick,
  }: {
    children: ReactNode
    to: string
    onClick?: () => void
  }) => (
    <a href={to} onClick={onClick}>
      {children}
    </a>
  ),
}))
vi.mock('@tauri-apps/api/event', () => ({ listen: mocks.listen }))
vi.mock('@/services/gbot', async (original) => ({
  ...(await original<object>()),
  gbot: mocks.call,
  getGbotServiceTarget: mocks.getTarget,
}))
vi.mock('@/vendor/cua-media/mediaSession', () => ({
  MediaSession: class {
    constructor(readonly options: MediaSessionOptions) {}
    start() {
      mocks.start(this.options)
      this.options.onStatus?.('streaming')
    }
    stop() {
      mocks.stop()
    }
  },
}))

let snapshot: BotState
let tasks: Task[]
const events = new Map<string, () => void>()
beforeEach(() => {
  vi.clearAllMocks()
  mocks.getTarget.mockResolvedValue({ kind: 'local' })
  mocks.resources.ready = true
  mocks.resources.error = ''
  useGbotCompanion.getState().reset()
  useGbotPage.setState({ page: null, sharing: null, requests: {} })
  useGeneralSetting.setState({ gbotEnabled: true })
  events.clear()
  snapshot = {
    workspaces: [
      { id: 'a', name: 'Atlas' },
      { id: 'b', name: 'Bramble' },
    ],
    live_sessions: [{ workspace_id: 'a', session_id: 'sa' }],
    controls: [],
    assignments: [
      {
        workspace_id: 'a',
        connection: { kind: 'endpoint', api_base: 'http://localhost:1337/v1' },
        model: 'test-model',
        context_tokens: 32768,
        credential_ref: null,
      },
    ],
  }
  tasks = []
  mocks.listen.mockImplementation(
    async (event: string, callback: () => void) => {
      events.set(event, callback)
      return () => events.delete(event)
    }
  )
  mocks.call.mockImplementation(async (path: string) => {
    if (path === 'state') return snapshot
    if (path === 'tasks') return tasks
    if (path === 'tasks/approvals') return []
    if (path === 'view/open')
      return {
        lease_id: 'lease',
        ws_url: 'ws://127.0.0.1/mock',
        media_session_id: 'media',
        interactive: false,
      }
    return {}
  })
})

async function mount() {
  function Workspace() {
    const [draft, setDraft] = useState('Main draft')
    const expanded = useGbotCompanion((s) => s.mode === 'expanded')
    return (
      <>
        <GbotAvatars />
        <main inert={expanded}>
          <input
            aria-label="Main work"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
          />
        </main>
        <GbotCompanion />
      </>
    )
  }
  const view = render(<Workspace />)
  await waitFor(() => expect(useGbotCompanion.getState().available).toBe(true))
  fireEvent.click(screen.getByRole('button', { name: /Open Atlas/ }))
  return view
}

it.each(['tasks', 'tasks/approvals'] as const)(
  'recovers a failed %s read without losing the draft or sending task actions',
  async (failedPath) => {
    const prompt = 'Read my saved notes'
    tasks = [
      {
        id: 'atlas-task',
        identity: snapshot.live_sessions[0],
        state: 'waiting_for_human',
        messages: [{ role: 'user', content: prompt }],
        help_requests: [],
      },
    ]
    const approvals = [
      {
        id: 'atlas-permission',
        task_id: 'atlas-task',
        request: { operation: { kind: 'desktop_input' } },
      },
    ]
    let rejectRetry!: (cause: Error) => void
    const read = vi
      .fn()
      .mockResolvedValueOnce(failedPath === 'tasks' ? tasks : approvals)
      .mockRejectedValueOnce(new Error('Task status unavailable'))
      .mockImplementationOnce(
        () =>
          new Promise<unknown>((_, reject) => {
            rejectRetry = reject
          })
      )
      .mockResolvedValue(failedPath === 'tasks' ? tasks : approvals)
    const fallback = mocks.call.getMockImplementation()!
    mocks.call.mockImplementation((path: string, body?: unknown) => {
      if (path === failedPath) return read()
      if (path === 'tasks/approvals') return Promise.resolve(approvals)
      return fallback(path, body)
    })
    await mount()
    const conversation = screen.getByRole('region', { name: 'Bot conversation' })
    expect(within(conversation).getByText(prompt)).toBeVisible()
    expect(
      within(conversation).getByRole('article', { name: 'Bot permission request' })
    ).toBeVisible()
    const draft = screen.getByRole('textbox', { name: 'Message bot' })
    fireEvent.change(draft, { target: { value: 'Keep this draft' } })
    expect(screen.getByRole('button', { name: 'Send', exact: true })).toBeEnabled()

    await act(async () => events.get('gbot-task-update')?.())
    const retry = await within(conversation).findByRole('button', {
      name: 'Retry loading tasks',
    })
    const alert = within(conversation).getByRole('alert')
    expect(alert).toHaveTextContent(
      'Could not load tasks and approval requests. Try again.'
    )
    expect(
      within(alert).getByText('Details').closest('details')
    ).not.toHaveAttribute('open')
    expect(
      within(alert).getByText('Error: Task status unavailable')
    ).not.toBeVisible()
    expect(draft).toHaveValue('Keep this draft')
    expect(screen.getByRole('button', { name: 'Send', exact: true })).toBeDisabled()
    expect(within(conversation).queryByText(prompt)).not.toBeInTheDocument()
    expect(
      within(conversation).queryByRole('article', { name: 'Bot permission request' })
    ).not.toBeInTheDocument()
    expect(
      screen.queryByText(/Connect this bot and save its model/)
    ).not.toBeInTheDocument()
    expect(screen.queryByText(/Give Atlas a task/)).not.toBeInTheDocument()

    mocks.call.mockClear()
    act(() => {
      fireEvent.click(retry)
      fireEvent.click(retry)
    })
    expect(
      within(conversation).getByRole('button', { name: 'Loading tasks…' })
    ).toBeDisabled()
    await waitFor(() => expect(rejectRetry).toBeTypeOf('function'))
    expect(mocks.call.mock.calls.map(([path]) => path)).toEqual([
      'state',
      'tasks',
      'tasks/approvals',
    ])
    expect(draft).toHaveValue('Keep this draft')
    expect(screen.getByRole('button', { name: 'Send', exact: true })).toBeDisabled()

    await act(async () => rejectRetry(new Error('Task status still unavailable')))
    expect(within(conversation).getByRole('alert')).toHaveTextContent(
      'Could not load tasks and approval requests. Try again.'
    )
    expect(
      within(conversation).getByText('Error: Task status still unavailable')
    ).not.toBeVisible()
    expect(
      within(conversation).getByRole('button', { name: 'Retry loading tasks' })
    ).toBeEnabled()
    expect(draft).toHaveValue('Keep this draft')
    expect(screen.getByRole('button', { name: 'Send', exact: true })).toBeDisabled()
    expect(
      screen.queryByText(/Connect this bot and save its model/)
    ).not.toBeInTheDocument()
    expect(screen.queryByText(/Give Atlas a task/)).not.toBeInTheDocument()

    fireEvent.click(
      within(conversation).getByRole('button', { name: 'Retry loading tasks' })
    )
    expect(await within(conversation).findByText(prompt)).toBeVisible()
    expect(
      within(conversation).getByRole('article', { name: 'Bot permission request' })
    ).toBeVisible()
    expect(within(conversation).queryByRole('alert')).not.toBeInTheDocument()
    expect(
      within(conversation).queryByRole('button', {
        name: /Retry loading tasks|Loading tasks…/,
      })
    ).not.toBeInTheDocument()
    expect(draft).toHaveValue('Keep this draft')
    expect(screen.getByRole('button', { name: 'Send', exact: true })).toBeEnabled()
    expect(mocks.call.mock.calls.map(([path]) => path)).toEqual([
      'state',
      'tasks',
      'tasks/approvals',
      'state',
      'tasks',
      'tasks/approvals',
    ])
  }
)

it.each(['Stop', 'Resume'] as const)(
  'clears an obsolete task-action %s error after confirmed service progress in the companion',
  async (action) => {
    const path = action === 'Stop' ? 'tasks/cancel' : 'tasks/resume'
    const outcome = action === 'Stop' ? 'cancelled' : 'running'
    const prompt = 'Continue my saved notes'
    tasks = [
      {
        id: 'atlas-task',
        identity: snapshot.live_sessions[0],
        state: 'paused',
        messages: [{ role: 'user', content: prompt }],
        help_requests: [],
      },
    ]
    let fail!: (cause: Error) => void
    const request = vi.fn().mockImplementation(
      () =>
        new Promise<void>((_, reject) => {
          fail = reject
        })
    )
    const fallback = mocks.call.getMockImplementation()!
    mocks.call.mockImplementation((calledPath: string, body?: unknown) =>
      calledPath === path ? request(body) : fallback(calledPath, body)
    )
    await mount()
    const conversation = screen.getByRole('region', { name: 'Bot conversation' })
    const card = (await within(conversation).findByText(prompt)).closest('article')!
    fireEvent.click(within(card).getByRole('button', { name: `${action} task` }))
    expect(request).toHaveBeenCalledExactlyOnceWith({ id: 'atlas-task' })
    expect(within(card).getByRole('status')).toHaveTextContent(
      action === 'Stop' ? 'Stopping this task…' : 'Resuming this task…'
    )

    // The service accepted the action, but its response was lost.
    tasks = [{ ...tasks[0], state: outcome }]
    await act(async () => fail(new Error('Task response unavailable')))
    expect(await within(card).findByText(outcome, { exact: true })).toBeVisible()
    await waitFor(() =>
      expect(within(card).queryByRole('status')).not.toBeInTheDocument()
    )
    expect(within(card).queryByRole('alert')).not.toBeInTheDocument()
    expect(
      within(card).queryByRole('button', { name: `${action} task` })
    ).not.toBeInTheDocument()
    expect(
      within(card).getByRole('button', {
        name: action === 'Stop' ? 'Resume task' : 'Stop task',
      })
    ).toBeEnabled()

    await act(async () => events.get('gbot-task-update')?.())
    expect(within(card).getByText(outcome, { exact: true })).toBeVisible()
    expect(within(card).queryByRole('alert')).not.toBeInTheDocument()
    tasks = [{ ...tasks[0], state: 'interrupted' }]
    await act(async () => events.get('gbot-task-update')?.())
    expect(
      await within(card).findByText('interrupted', { exact: true })
    ).toBeVisible()
    expect(within(card).getByRole('button', { name: 'Resume task' })).toBeEnabled()
    expect(within(card).getByRole('button', { name: 'Stop task' })).toBeEnabled()
    expect(within(card).queryByRole('alert')).not.toBeInTheDocument()
    expect(
      mocks.call.mock.calls.filter(
        ([calledPath]) =>
          calledPath.startsWith('tasks/') && calledPath !== 'tasks/approvals'
      )
    ).toEqual([[path, { id: 'atlas-task' }]])
  }
)

it.each(['Stop', 'Resume'] as const)(
  'keeps a failed task action %s inline through refresh and retries it in the companion',
  async (action) => {
    const path = action === 'Stop' ? 'tasks/cancel' : 'tasks/resume'
    const progress =
      action === 'Stop' ? 'Stopping this task…' : 'Resuming this task…'
    const message = `Could not ${action.toLowerCase()} this task. Try again.`
    const outcome = action === 'Stop' ? 'cancelled' : 'running'
    const prompt = 'Read my saved notes'
    tasks = [
      {
        id: 'atlas-task',
        identity: snapshot.live_sessions[0],
        state: 'paused',
        messages: [{ role: 'user', content: prompt }],
        help_requests: [],
      },
    ]
    let fail!: (cause: Error) => void
    let finish!: () => void
    const request = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<void>((_, reject) => {
            fail = reject
          })
      )
      .mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            finish = resolve
          })
      )
    const fallback = mocks.call.getMockImplementation()!
    mocks.call.mockImplementation((calledPath: string, body?: unknown) =>
      calledPath === path ? request(body) : fallback(calledPath, body)
    )
    await mount()
    const conversation = screen.getByRole('region', { name: 'Bot conversation' })
    const card = within(conversation).getByText(prompt).closest('article')!
    const submit = within(card).getByRole('button', { name: `${action} task` })
    const opposite = within(card).getByRole('button', {
      name: action === 'Stop' ? 'Resume task' : 'Stop task',
    })
    expect(submit).toBeEnabled()
    expect(opposite).toBeEnabled()
    act(() => {
      submit.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      submit.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      opposite.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    const payload = { id: 'atlas-task' }
    expect(request).toHaveBeenCalledExactlyOnceWith(payload)
    expect(within(card).getByRole('status')).toHaveTextContent(progress)
    for (const button of within(card).getAllByRole('button'))
      expect(button).toBeDisabled()

    await act(async () => fail(new Error('Task action unavailable')))
    const alert = await within(card).findByRole('alert')
    expect(within(alert).getByText(message)).toBeVisible()
    expect(
      within(alert).getByText('Details').closest('details')
    ).not.toHaveAttribute('open')
    expect(within(alert).getByText('Task action unavailable')).not.toBeVisible()
    expect(within(card).getByText(prompt)).toBeVisible()
    expect(within(card).getByText('paused', { exact: true })).toBeVisible()
    expect(within(card).queryByRole('status')).not.toBeInTheDocument()
    expect(within(card).getByRole('button', { name: 'Stop task' })).toBeEnabled()
    expect(within(card).getByRole('button', { name: 'Resume task' })).toBeEnabled()

    const reads = mocks.call.mock.calls.filter(
      ([calledPath]) => calledPath === 'tasks'
    ).length
    await act(async () => events.get('gbot-task-update')?.())
    expect(
      mocks.call.mock.calls.filter(([calledPath]) => calledPath === 'tasks')
    ).toHaveLength(reads + 1)
    expect(
      within(within(card).getByRole('alert')).getByText(message)
    ).toBeVisible()
    expect(within(card).getByText('paused', { exact: true })).toBeVisible()
    expect(request).toHaveBeenCalledTimes(1)

    fireEvent.click(within(card).getByRole('button', { name: `${action} task` }))
    expect(request.mock.calls).toEqual([[payload], [payload]])
    expect(within(card).getByRole('status')).toHaveTextContent(progress)
    for (const button of within(card).getAllByRole('button'))
      expect(button).toBeDisabled()
    tasks = [{ ...tasks[0], state: outcome }]
    await act(async () => finish())
    expect(await within(card).findByText(outcome, { exact: true })).toBeVisible()
    expect(within(card).getByText(prompt)).toBeVisible()
    expect(within(card).queryByRole('alert')).not.toBeInTheDocument()
    expect(within(card).queryByRole('status')).not.toBeInTheDocument()
    expect(
      within(card).getByRole('button', {
        name: action === 'Stop' ? 'Resume task' : 'Stop task',
      })
    ).toBeEnabled()
    expect(
      mocks.call.mock.calls.filter(
        ([calledPath]) =>
          calledPath.startsWith('tasks/') && calledPath !== 'tasks/approvals'
      )
    ).toEqual([
      [path, payload],
      [path, payload],
    ])
  }
)

it('shows the saved interruption cause beside Resume and clears it after completion', async () => {
  const reason = 'model returned no answer; resume the task to try again'
  tasks = [
    {
      id: 'interrupted-atlas',
      identity: snapshot.live_sessions[0],
      state: 'interrupted',
      messages: [{ role: 'user', content: 'Save my note' }],
      help_requests: [],
      history: [{ state: 'interrupted', reason, at: 42 }],
    },
  ]
  await mount()
  const cause = await screen.findByText(reason)
  const card = cause.closest('article')!
  expect(cause).toBeVisible()
  expect(within(card).getByText('Save my note')).toBeVisible()
  const resume = within(card).getByRole('button', { name: 'Resume task' })
  expect(resume).toBeEnabled()
  fireEvent.click(resume)
  await waitFor(() => expect(resume).toBeEnabled())
  expect(mocks.call).toHaveBeenCalledWith('tasks/resume', {
    id: 'interrupted-atlas',
  })
  tasks = [{ ...tasks[0], state: 'completed' }]
  await act(async () => events.get('gbot-task-update')?.())
  expect(await within(card).findByText('completed')).toBeVisible()
  expect(screen.queryByText(reason)).not.toBeInTheDocument()
  tasks = [{ ...tasks[0], state: 'interrupted', history: undefined }]
  await act(async () => events.get('gbot-task-update')?.())
  expect(within(card).getByText('Save my note')).toBeVisible()
  expect(within(card).getByRole('button', { name: 'Resume task' })).toBeEnabled()
  expect(screen.queryByText(reason)).not.toBeInTheDocument()
})

it.each([
  ['Send reply', 'Documents', 'Your reply: Documents'],
  ['Decline', null, 'Request declined'],
] as const)(
  'keeps a saved human-help %s failure visible until explicit resume without resending',
  async (action, response, outcome) => {
    const request = {
      id: 'atlas-help',
      question: 'Which folder?',
      status: 'pending' as const,
      response: null,
    }
    tasks = [
      {
        id: 'atlas-task',
        identity: snapshot.live_sessions[0],
        state: 'waiting_for_human',
        messages: [],
        help_requests: [request],
      },
    ]
    let fail!: (cause: Error) => void
    const reply = vi.fn().mockImplementation(
      () =>
        new Promise<void>((_, reject) => {
          fail = reject
        })
    )
    const fallback = mocks.call.getMockImplementation()!
    mocks.call.mockImplementation((path: string, body?: unknown) => {
      if (path === 'tasks/help') return reply(body)
      if (path === 'tasks/resume') {
        tasks = [{ ...tasks[0], state: 'running' }]
        return Promise.resolve({})
      }
      return fallback(path, body)
    })
    await mount()
    const card = (await screen.findByText(request.question)).closest('article')!
    fireEvent.change(within(card).getByLabelText('Your reply'), {
      target: { value: 'Documents' },
    })
    fireEvent.click(within(card).getByRole('button', { name: action }))
    const body = { id: 'atlas-task', request_id: 'atlas-help', response }
    expect(reply).toHaveBeenCalledExactlyOnceWith(body)
    tasks = [
      {
        ...tasks[0],
        state: 'interrupted',
        help_requests: [
          {
            ...request,
            status: response === null ? 'declined' : 'completed',
            response,
          },
        ],
      },
    ]
    await act(async () => fail(new Error('Model connection unavailable')))
    expect(await within(card).findByText(outcome)).toBeVisible()
    const guidance =
      'Your response was saved, but this task could not continue. Check the model and computer connections, then resume the task.'
    expect(within(card).getByRole('alert')).toHaveTextContent(guidance)
    expect(within(card).getByRole('alert')).toHaveTextContent(
      'Model connection unavailable'
    )
    expect(within(card).queryByLabelText('Your reply')).not.toBeInTheDocument()
    expect(
      within(card).queryByRole('button', { name: 'Send reply' })
    ).not.toBeInTheDocument()
    expect(
      within(card).queryByRole('button', { name: 'Decline' })
    ).not.toBeInTheDocument()

    await act(async () => events.get('gbot-task-update')?.())
    expect(within(card).getByText(outcome)).toBeVisible()
    expect(within(card).getByRole('alert')).toHaveTextContent(guidance)
    expect(reply).toHaveBeenCalledTimes(1)
    const resume = within(card).getByRole('button', { name: 'Resume task' })
    expect(resume).toBeEnabled()
    fireEvent.click(resume)
    expect(await within(card).findByText('running')).toBeVisible()
    await waitFor(() =>
      expect(within(card).queryByRole('alert')).not.toBeInTheDocument()
    )
    expect(within(card).getByText(outcome)).toBeVisible()
    tasks = [{ ...tasks[0], state: 'interrupted' }]
    await act(async () => events.get('gbot-task-update')?.())
    expect(within(card).getByRole('button', { name: 'Resume task' })).toBeEnabled()
    expect(within(card).queryByRole('alert')).not.toBeInTheDocument()
    expect(
      mocks.call.mock.calls.filter(
        ([path]) => path.startsWith('tasks/') && path !== 'tasks/approvals'
      )
    ).toEqual([
      ['tasks/help', body],
      ['tasks/resume', { id: 'atlas-task' }],
    ])
  }
)

it.each([
  ['Send reply', 'Sending reply…', 'Documents', 'Your reply: Documents'],
  ['Decline', 'Declining request…', null, 'Request declined'],
] as const)(
  'keeps a failed human-help %s inline through refresh and retries the same response',
  async (action, progress, response, outcome) => {
    const request = {
      id: 'atlas-help',
      question: 'Which folder?',
      status: 'pending' as const,
      response: null,
    }
    tasks = [
      {
        id: 'atlas-task',
        identity: snapshot.live_sessions[0],
        state: 'waiting_for_human',
        messages: [],
        help_requests: [request],
      },
    ]
    let fail!: (cause: Error) => void
    let finish!: () => void
    const reply = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<void>((_, reject) => {
            fail = reject
          })
      )
      .mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            finish = resolve
          })
      )
    const fallback = mocks.call.getMockImplementation()!
    mocks.call.mockImplementation((path: string, body?: unknown) =>
      path === 'tasks/help' ? reply(body) : fallback(path, body)
    )
    await mount()
    const card = (await screen.findByText(request.question)).closest('article')!
    const input = within(card).getByLabelText('Your reply')
    fireEvent.change(input, { target: { value: 'Documents' } })
    fireEvent.click(
      within(card).getByRole('button', { name: action, exact: true })
    )
    const body = {
      id: 'atlas-task',
      request_id: 'atlas-help',
      response,
    }
    expect(reply).toHaveBeenCalledExactlyOnceWith(body)
    expect(within(card).getByRole('status')).toHaveTextContent(progress)
    expect(input).toBeDisabled()
    await act(async () => fail(new Error('Help reply unavailable')))
    expect(await within(card).findByRole('alert')).toHaveTextContent(
      'Help reply unavailable'
    )
    expect(within(card).queryByRole('status')).not.toBeInTheDocument()
    expect(input).toHaveValue('Documents')
    expect(input).toBeEnabled()
    expect(within(card).getByRole('button', { name: 'Send reply' })).toBeEnabled()
    expect(within(card).getByRole('button', { name: 'Decline' })).toBeEnabled()
    expect(within(card).queryByText(outcome)).not.toBeInTheDocument()

    const refreshes = mocks.call.mock.calls.filter(
      ([path]) => path === 'tasks'
    ).length
    await act(async () => events.get('gbot-task-update')?.())
    expect(
      mocks.call.mock.calls.filter(([path]) => path === 'tasks')
    ).toHaveLength(refreshes + 1)
    expect(within(card).getByRole('alert')).toHaveTextContent(
      'Help reply unavailable'
    )
    expect(input).toHaveValue('Documents')

    fireEvent.click(
      within(card).getByRole('button', { name: action, exact: true })
    )
    expect(reply.mock.calls).toEqual([[body], [body]])
    expect(within(card).queryByRole('alert')).not.toBeInTheDocument()
    expect(within(card).getByRole('status')).toHaveTextContent(progress)
    tasks = [
      {
        ...tasks[0],
        state: 'interrupted',
        help_requests: [
          {
            ...request,
            status: response === null ? 'declined' : 'completed',
            response,
          },
        ],
      },
    ]
    await act(async () => finish())
    expect(await within(card).findByText(outcome)).toBeVisible()
    expect(within(card).queryByLabelText('Your reply')).not.toBeInTheDocument()
    expect(within(card).queryByRole('alert')).not.toBeInTheDocument()
    expect(mocks.call).not.toHaveBeenCalledWith(
      'tasks/approval',
      expect.anything()
    )
  }
)

it.each([
  [
    'Allow',
    true,
    'Allowing this action…',
    'Could not allow this action. Try again.',
  ],
  [
    'Deny',
    false,
    'Denying this action…',
    'Could not deny this action. Try again.',
  ],
] as const)(
  'keeps a failed permission %s inline through refresh and retries it in the companion',
  async (action, allow, progress, message) => {
    tasks = [
      {
        id: 'atlas-task',
        identity: snapshot.live_sessions[0],
        state: 'waiting_for_human',
        messages: [],
        help_requests: [],
      },
    ]
    let approvals = [
      {
        id: 'atlas-permission',
        task_id: 'atlas-task',
        request: { operation: { kind: 'read', path: '/home/bot/notes.txt' } },
      },
    ]
    let fail!: (cause: Error) => void
    let finish!: () => void
    const reply = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<void>((_, reject) => {
            fail = reject
          })
      )
      .mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            finish = resolve
          })
      )
    const fallback = mocks.call.getMockImplementation()!
    mocks.call.mockImplementation((path: string, body?: unknown) => {
      if (path === 'tasks/approvals') return Promise.resolve(approvals)
      if (path === 'tasks/approval') return reply(body)
      return fallback(path, body)
    })
    await mount()
    const card = screen.getByRole('article', { name: 'Bot permission request' })
    const submit = within(card).getByRole('button', { name: action, exact: true })
    act(() => {
      submit.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      submit.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    const payload = { id: 'atlas-permission', allow }
    expect(reply).toHaveBeenCalledExactlyOnceWith(payload)
    expect(within(card).getByRole('status')).toHaveTextContent(progress)
    expect(card).toHaveAttribute('aria-busy', 'true')
    for (const button of within(card).getAllByRole('button'))
      expect(button).toBeDisabled()

    await act(async () => fail(new Error('Permission decision unavailable')))
    const alert = await within(card).findByRole('alert')
    expect(within(alert).getByText(message)).toBeVisible()
    expect(
      within(alert).getByText('Details').closest('details')
    ).not.toHaveAttribute('open')
    expect(
      within(alert).getByText('Permission decision unavailable')
    ).not.toBeVisible()
    expect(within(card).getByText(/Allow permits this action once/)).toBeVisible()
    expect(within(card).getByText('/home/bot/notes.txt')).toBeVisible()
    expect(within(card).queryByRole('status')).not.toBeInTheDocument()
    expect(card).toHaveAttribute('aria-busy', 'false')
    expect(within(card).getByRole('button', { name: 'Allow' })).toBeEnabled()
    expect(within(card).getByRole('button', { name: 'Deny' })).toBeEnabled()

    const reads = mocks.call.mock.calls.filter(
      ([path]) => path === 'tasks'
    ).length
    await act(async () => events.get('gbot-task-update')?.())
    expect(
      mocks.call.mock.calls.filter(([path]) => path === 'tasks')
    ).toHaveLength(reads + 1)
    expect(
      within(within(card).getByRole('alert')).getByText(message)
    ).toBeVisible()
    expect(within(card).getByText(/Allow permits this action once/)).toBeVisible()
    expect(reply).toHaveBeenCalledTimes(1)

    fireEvent.click(
      within(card).getByRole('button', { name: action, exact: true })
    )
    expect(reply.mock.calls).toEqual([[payload], [payload]])
    expect(within(card).getByRole('status')).toHaveTextContent(progress)
    for (const button of within(card).getAllByRole('button'))
      expect(button).toBeDisabled()
    approvals = []
    await act(async () => finish())
    await waitFor(() => expect(card).not.toBeInTheDocument())
    expect(
      screen.queryByRole('article', { name: 'Bot permission request' })
    ).not.toBeInTheDocument()
    expect(
      mocks.call.mock.calls.filter(
        ([path]) => path.startsWith('tasks/') && path !== 'tasks/approvals'
      )
    ).toEqual([
      ['tasks/approval', payload],
      ['tasks/approval', payload],
    ])
  }
)

it('sends a permission decision for the selected bot and shows its pending state', async () => {
  tasks = [
    {
      id: 'atlas-task',
      identity: { workspace_id: 'a', session_id: 'sa' },
      state: 'waiting_for_human',
      messages: [],
      help_requests: [],
    },
  ]
  let approvals = [
    {
      id: 'atlas-permission',
      task_id: 'atlas-task',
      request: { operation: { kind: 'desktop_input' } },
    },
    {
      id: 'bramble-permission',
      task_id: 'bramble-task',
      request: { operation: { kind: 'file_remove' } },
    },
  ]
  const fallback = mocks.call.getMockImplementation()!
  let finish!: () => void
  mocks.call.mockImplementation((path: string, body?: unknown) => {
    if (path === 'tasks/approvals') return Promise.resolve(approvals)
    if (path === 'tasks/approval')
      return new Promise<void>((resolve) => {
        finish = resolve
      })
    return fallback(path, body)
  })
  await mount()
  const card = screen.getByRole('article', { name: 'Bot permission request' })
  fireEvent.click(within(card).getByText('Action details'))
  expect(within(card).getByText(/desktop_input/)).toBeVisible()
  expect(screen.queryByText(/file_remove/)).not.toBeInTheDocument()
  fireEvent.click(
    within(card).getByRole('button', { name: 'Deny', exact: true })
  )
  expect(mocks.call).toHaveBeenCalledWith('tasks/approval', {
    id: 'atlas-permission',
    allow: false,
  })
  expect(within(card).getByRole('status')).toHaveTextContent(
    'Denying this action…'
  )
  expect(
    within(card).getByRole('button', { name: 'Allow', exact: true })
  ).toBeDisabled()
  approvals = []
  await act(async () => finish())
  await waitFor(() =>
    expect(
      screen.queryByRole('article', { name: 'Bot permission request' })
    ).not.toBeInTheDocument()
  )
})

it('shows preparation and then service loading before deciding whether bots exist', async () => {
  mocks.resources.ready = false
  let finish!: (value: BotState) => void
  mocks.call.mockImplementation(async (path: string) =>
    path === 'state'
      ? new Promise<BotState>((resolve) => {
          finish = resolve
        })
      : []
  )
  const view = render(
    <>
      <GbotAvatars />
      <GbotCompanion />
    </>
  )
  fireEvent.click(screen.getByRole('button', { name: 'Open Gbot companion' }))
  await waitFor(() => expect(finish).toBeTypeOf('function'))
  expect(screen.getByRole('status')).toHaveTextContent(
    'Preparing and validating bundled resources'
  )
  expect(screen.getByRole('status')).toHaveTextContent('hide this pane')
  expect(screen.queryByText(/Add a bot computer/)).not.toBeInTheDocument()
  expect(
    screen.queryByRole('link', { name: 'Open Gbot settings' })
  ).not.toBeInTheDocument()
  expect(
    screen.queryByRole('button', { name: 'View bot’s desktop' })
  ).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Send' })).not.toBeInTheDocument()

  mocks.resources.ready = true
  view.rerender(
    <>
      <GbotAvatars />
      <GbotCompanion />
    </>
  )
  expect(screen.getByRole('status')).toHaveTextContent('Loading your bots')
  expect(screen.queryByText(/Add a bot computer/)).not.toBeInTheDocument()
  await act(async () => finish(snapshot))
  expect(screen.getByRole('heading', { name: 'Atlas' })).toBeInTheDocument()
  expect(screen.queryByText(/Add a bot computer/)).not.toBeInTheDocument()
  expect(screen.queryByText('Loading your bots…')).not.toBeInTheDocument()
})

it('offers setup guidance only after an authoritative empty service snapshot', async () => {
  let finish!: (value: BotState) => void
  mocks.call.mockImplementation(async (path: string) =>
    path === 'state'
      ? new Promise<BotState>((resolve) => {
          finish = resolve
        })
      : []
  )
  render(
    <>
      <GbotAvatars />
      <GbotCompanion />
    </>
  )
  fireEvent.click(screen.getByRole('button', { name: 'Open Gbot companion' }))
  await waitFor(() => expect(finish).toBeTypeOf('function'))
  expect(screen.getByRole('status')).toHaveTextContent('Loading your bots')
  expect(screen.queryByText(/Add a bot computer/)).not.toBeInTheDocument()
  await act(async () =>
    finish({ workspaces: [], live_sessions: [], controls: [], assignments: [] })
  )
  expect(screen.getByText(/Add a bot computer/)).toBeInTheDocument()
  expect(screen.queryByText('Loading your bots…')).not.toBeInTheDocument()
})

it('shows a preparation failure without treating unknown bots as missing configuration', async () => {
  mocks.resources.ready = false
  let fail!: (error: string) => void
  mocks.call.mockImplementation(async (path: string) =>
    path === 'state'
      ? new Promise<BotState>((_, reject) => {
          fail = reject
        })
      : []
  )
  const view = render(
    <>
      <GbotAvatars />
      <GbotCompanion />
    </>
  )
  fireEvent.click(screen.getByRole('button', { name: 'Open Gbot companion' }))
  await waitFor(() => expect(fail).toBeTypeOf('function'))
  mocks.resources.error = 'Bundled resources are corrupt'
  view.rerender(
    <>
      <GbotAvatars />
      <GbotCompanion />
    </>
  )
  await act(async () => fail(mocks.resources.error))
  expect(screen.getByRole('alert')).toHaveTextContent(mocks.resources.error)
  expect(
    screen.getByRole('heading', { name: 'Gbot unavailable' })
  ).toBeInTheDocument()
  expect(screen.queryByText(/Add a bot computer/)).not.toBeInTheDocument()
  expect(
    screen.queryByRole('link', { name: 'Open Gbot settings' })
  ).not.toBeInTheDocument()
})

it('preserves a known name and draft through pending preparation and failure', async () => {
  const view = render(
    <>
      <GbotAvatars />
      <GbotCompanion />
    </>
  )
  await waitFor(() => expect(useGbotCompanion.getState().available).toBe(true))
  fireEvent.click(screen.getByRole('button', { name: /Open Atlas/ }))
  fireEvent.change(screen.getByRole('textbox', { name: 'Message bot' }), {
    target: { value: 'Keep my task draft' },
  })
  mocks.resources.ready = false
  view.rerender(
    <>
      <GbotAvatars />
      <GbotCompanion />
    </>
  )
  expect(screen.getByRole('heading', { name: 'Atlas' })).toBeInTheDocument()
  expect(screen.getByRole('textbox', { name: 'Message bot' })).toHaveValue(
    'Keep my task draft'
  )
  expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled()
  expect(screen.getByRole('status')).toHaveTextContent('Preparing and validating')
  expect(
    screen.queryByText(/Connect this bot and save its model/)
  ).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Desktop', exact: true }))
  expect(
    screen.queryByRole('button', { name: 'View bot’s desktop' })
  ).not.toBeInTheDocument()
  mocks.resources.error = 'Bundled runtime digest mismatch'
  view.rerender(
    <>
      <GbotAvatars />
      <GbotCompanion />
    </>
  )
  expect(screen.getByRole('alert')).toHaveTextContent(mocks.resources.error)
  expect(screen.getByRole('alert')).toHaveTextContent('Restart GChat')
  expect(
    screen.queryByRole('button', { name: 'Retry connection' })
  ).not.toBeInTheDocument()
  expect(screen.getByRole('heading', { name: 'Atlas' })).toBeInTheDocument()
  expect(screen.queryByText(/Add a bot computer/)).not.toBeInTheDocument()
  expect(mocks.call).not.toHaveBeenCalledWith('tasks/start', expect.anything())
  expect(mocks.call).not.toHaveBeenCalledWith('view/open', expect.anything())
})

it('ends page sharing when switching bots or hiding the pane', async () => {
  await mount()
  act(() =>
    useGbotPage.getState().publish({
      id: 'studio',
      draft: {
        schemaVersion: 3,
        id: '',
        kind: 'standard',
        name: 'Agent',
        description: '',
        instructions: '',
        defaultGoal: '',
        skills: [],
        maxSteps: 25,
        outputContract: '',
        modelInstanceId: null,
        reasoningEffort: null,
        builtIn: false,
      } satisfies AgentDefinition,
      update: vi.fn(),
    })
  )
  fireEvent.click(screen.getByRole('button', { name: 'Help with this page' }))
  expect(useGbotPage.getState().sharing?.workspaceId).toBe('a')
  fireEvent.click(screen.getByRole('button', { name: /Open Bramble/ }))
  expect(useGbotPage.getState().sharing).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: /Open Atlas/ }))
  expect(
    screen.getByRole('button', { name: 'Help with this page' })
  ).toBeEnabled()
  fireEvent.click(screen.getByRole('button', { name: 'Help with this page' }))
  fireEvent.click(screen.getByRole('button', { name: 'Hide bot pane' }))
  expect(useGbotPage.getState().sharing).toBeNull()
})

it('keeps the underlying workspace and per-bot drafts through hidden, compact and expanded states', async () => {
  await mount()
  const main = screen.getByRole('textbox', { name: 'Main work' })
  fireEvent.change(main, { target: { value: 'Keep this Chat draft' } })
  fireEvent.change(screen.getByRole('textbox', { name: 'Message bot' }), {
    target: { value: 'Atlas draft' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Expand bot pane' }))
  expect(screen.getByRole('main')).toHaveAttribute('inert')
  expect(document.getElementById('gbot-companion')).toHaveAttribute(
    'data-mode',
    'expanded'
  )
  fireEvent.click(screen.getByRole('button', { name: 'Minimize bot pane' }))
  expect(screen.getByRole('main')).not.toHaveAttribute('inert')
  fireEvent.click(screen.getByRole('button', { name: /Open Bramble/ }))
  fireEvent.change(screen.getByRole('textbox', { name: 'Message bot' }), {
    target: { value: 'Bramble draft' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Agents', exact: true }))
  fireEvent.click(screen.getByRole('button', { name: 'Hide bot pane' }))
  expect(document.getElementById('gbot-companion')).toHaveAttribute('inert')
  expect(screen.getByRole('textbox', { name: 'Main work' })).toBe(main)
  expect(main).toHaveValue('Keep this Chat draft')
  fireEvent.click(screen.getByRole('button', { name: /Open Atlas/ }))
  expect(screen.getByRole('textbox', { name: 'Message bot' })).toHaveValue(
    'Atlas draft'
  )
  fireEvent.click(screen.getByRole('button', { name: /Open Bramble/ }))
  expect(
    screen.getByRole('button', { name: 'Agents', exact: true })
  ).toHaveAttribute('aria-pressed', 'true')
  fireEvent.click(
    screen.getByRole('button', { name: 'Conversation', exact: true })
  )
  expect(screen.getByRole('textbox', { name: 'Message bot' })).toHaveValue(
    'Bramble draft'
  )
})

it('submits a task to the chosen bot and keeps a newer draft typed during submission', async () => {
  await mount()
  let complete!: () => void
  mocks.call.mockImplementation(async (path: string) => {
    if (path === 'tasks/start')
      return new Promise<void>((resolve) => {
        complete = resolve
      })
    return path === 'state' ? snapshot : []
  })
  const input = screen.getByRole('textbox', { name: 'Message bot' })
  fireEvent.change(input, { target: { value: 'Read the project' } })
  fireEvent.click(screen.getByRole('button', { name: 'Send', exact: true }))
  expect(mocks.call).toHaveBeenCalledWith('tasks/start', {
    identity: snapshot.live_sessions[0],
    prompt: 'Read the project',
  })
  fireEvent.change(input, { target: { value: 'Follow-up draft' } })
  await act(async () => complete())
  expect(input).toHaveValue('Follow-up draft')
  expect(screen.getByRole('textbox', { name: 'Main work' })).toHaveValue(
    'Main draft'
  )
})

it.each(['', '   '])(
  'ignores forced empty companion tasks (%j)',
  async (draft) => {
    await mount()
    const input = screen.getByRole('textbox', { name: 'Message bot' })
    fireEvent.change(input, { target: { value: draft } })
    fireEvent.submit(input.closest('form')!)
    expect(mocks.call).not.toHaveBeenCalledWith(
      'tasks/start',
      expect.anything()
    )
    expect(
      screen.queryByText('Sending this task to the bot…')
    ).not.toBeInTheDocument()
  }
)

it('blocks same-tick duplicate companion tasks and keeps a failed draft for retry', async () => {
  await mount()
  let reject!: (error: Error) => void
  const submit = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise<void>((_, fail) => {
          reject = fail
        })
    )
    .mockResolvedValueOnce({ id: 'task' })
  mocks.call.mockImplementation(async (path: string, body: unknown) => {
    if (path === 'tasks/start') return submit(body)
    return path === 'state' ? snapshot : []
  })
  const input = screen.getByRole('textbox', { name: 'Message bot' })
  fireEvent.change(input, { target: { value: 'Send exactly once' } })
  const form = input.closest('form')!
  act(() => {
    fireEvent.submit(form)
    fireEvent.submit(form)
  })
  expect(submit).toHaveBeenCalledExactlyOnceWith({
    identity: snapshot.live_sessions[0],
    prompt: 'Send exactly once',
  })
  expect(form).toHaveAttribute('aria-busy', 'true')
  expect(screen.getByRole('button', { name: 'Sending…' })).toBeDisabled()
  expect(screen.getByText('Sending this task to the bot…')).toHaveAttribute(
    'role',
    'status'
  )
  fireEvent.submit(form)
  expect(submit).toHaveBeenCalledTimes(1)
  await act(async () => reject(new Error('Task admission refused')))
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'Send', exact: true })
    ).toBeEnabled()
  )
  expect(input).toHaveValue('Send exactly once')
  expect(form).toHaveAttribute('aria-busy', 'false')
  fireEvent.submit(form)
  await waitFor(() => expect(input).toHaveValue(''))
  expect(submit).toHaveBeenCalledTimes(2)
})

it('keeps a failed task submission inline through refresh and isolates its companion bot retry', async () => {
  snapshot.live_sessions.push({ workspace_id: 'b', session_id: 'sb' })
  snapshot.assignments.push({ ...snapshot.assignments[0], workspace_id: 'b' })
  let fail!: (cause: Error) => void
  let finish!: (value: { id: string }) => void
  const submit = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise<{ id: string }>((_, reject) => {
          fail = reject
        })
    )
    .mockImplementationOnce(
      () =>
        new Promise<{ id: string }>((resolve) => {
          finish = resolve
        })
    )
  const fallback = mocks.call.getMockImplementation()!
  mocks.call.mockImplementation((path: string, body?: unknown) =>
    path === 'tasks/start' ? submit(body) : fallback(path, body)
  )
  await mount()
  const input = screen.getByRole('textbox', { name: 'Message bot' })
  fireEvent.change(input, { target: { value: 'Read the Atlas notes' } })
  const form = input.closest('form')!
  const payload = {
    identity: snapshot.live_sessions[0],
    prompt: 'Read the Atlas notes',
  }
  act(() => {
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  })
  expect(submit).toHaveBeenCalledExactlyOnceWith(payload)
  expect(form).toHaveAttribute('aria-busy', 'true')
  expect(screen.getByRole('button', { name: 'Sending…' })).toBeDisabled()
  expect(screen.getByText('Sending this task to the bot…')).toHaveAttribute(
    'role',
    'status'
  )
  await act(async () => fail(new Error('Task admission unavailable')))
  const message = 'Could not send this task. Try again.'
  const alert = await screen.findByRole('alert')
  expect(within(alert).getByText(message)).toBeVisible()
  expect(
    within(alert).getByText('Details').closest('details')
  ).not.toHaveAttribute('open')
  expect(within(alert).getByText('Task admission unavailable')).not.toBeVisible()
  expect(input).toHaveValue(payload.prompt)
  expect(form).toHaveAttribute('aria-busy', 'false')
  expect(screen.getByRole('button', { name: 'Send', exact: true })).toBeEnabled()
  expect(useGbotCompanion.getState().tasks).toEqual([])

  const reads = mocks.call.mock.calls.filter(([path]) => path === 'tasks').length
  await act(async () => events.get('gbot-task-update')?.())
  await waitFor(() =>
    expect(
      mocks.call.mock.calls.filter(([path]) => path === 'tasks').length
    ).toBeGreaterThan(reads)
  )
  expect(screen.getByRole('button', { name: 'Companion bot' })).toHaveTextContent(
    'Atlas'
  )
  expect(screen.getByRole('alert')).toHaveTextContent(message)
  expect(input).toHaveValue(payload.prompt)
  expect(submit).toHaveBeenCalledTimes(1)

  fireEvent.click(screen.getByRole('button', { name: /Open Bramble/ }))
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  expect(input).toHaveValue('')
  fireEvent.change(input, { target: { value: 'Bramble draft' } })
  expect(screen.getByRole('button', { name: 'Send', exact: true })).toBeEnabled()
  fireEvent.click(screen.getByRole('button', { name: /Open Atlas/ }))
  expect(input).toHaveValue(payload.prompt)
  expect(screen.getByRole('alert')).toHaveTextContent(message)

  act(() => {
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  })
  expect(submit.mock.calls).toEqual([[payload], [payload]])
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Sending…' })).toBeDisabled()
  tasks = [
    {
      id: 'accepted-atlas-task',
      identity: payload.identity,
      state: 'running',
      messages: [{ role: 'user', content: payload.prompt }],
    },
  ]
  await act(async () => finish({ id: tasks[0].id }))
  await waitFor(() => expect(input).toHaveValue(''))
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  expect(form).toHaveAttribute('aria-busy', 'false')
  expect(
    within(screen.getByRole('region', { name: 'Bot conversation' })).getByText(
      payload.prompt
    )
  ).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: /Open Bramble/ }))
  expect(input).toHaveValue('Bramble draft')
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  expect(
    mocks.call.mock.calls.filter(
      ([path]) => path.startsWith('tasks/') && path !== 'tasks/approvals'
    )
  ).toEqual([
    ['tasks/start', payload],
    ['tasks/start', payload],
  ])
})

it('releases desktop input, audio and leases on hide, then reopens without restarting the bot', async () => {
  await mount()
  fireEvent.click(screen.getByRole('button', { name: 'Desktop', exact: true }))
  fireEvent.click(screen.getByRole('button', { name: 'View bot’s desktop' }))
  await waitFor(() => expect(mocks.start).toHaveBeenCalledTimes(1))
  expect(
    screen.queryByRole('button', { name: 'Return keyboard to GChat' })
  ).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Desktop', exact: true }))
  expect(mocks.stop).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Hide bot pane' }))
  await waitFor(() =>
    expect(mocks.call).toHaveBeenCalledWith(
      'view/close',
      expect.objectContaining({ lease_id: 'lease' })
    )
  )
  expect(mocks.stop).toHaveBeenCalled()
  expect(
    mocks.call.mock.calls.some(([path]) =>
      ['tasks/cancel', 'control/hand-back', 'disconnect'].includes(path)
    )
  ).toBe(false)
  fireEvent.click(screen.getByRole('button', { name: /Open Atlas/ }))
  expect(
    screen.getByRole('button', { name: 'Desktop', exact: true })
  ).toHaveAttribute('aria-pressed', 'true')
  await waitFor(() => expect(mocks.start).toHaveBeenCalledTimes(2))
})

it.each(['open', 'media'] as const)(
  'explains a desktop %s failure and reconnects only the view on explicit retry',
  async (failure) => {
    await mount()
    let opens = 0
    const diagnostic = 'RCDP handshake rejected: fixture transport unavailable'
    mocks.call.mockImplementation(async (path: string) => {
      if (path === 'state') return snapshot
      if (path === 'tasks') return tasks
      if (path === 'tasks/approvals') return []
      if (path === 'view/open') {
        ++opens
        if (failure === 'open' && opens === 1) throw new Error(diagnostic)
        return {
          lease_id: `lease-${opens}`,
          ws_url: 'ws://127.0.0.1/mock',
          media_session_id: `media-${opens}`,
          interactive: false,
        }
      }
      return {}
    })
    fireEvent.click(screen.getByRole('button', { name: 'Desktop', exact: true }))
    fireEvent.click(screen.getByRole('button', { name: 'View bot’s desktop' }))
    const desktop = within(screen.getByRole('region', { name: 'Bot desktop' }))
    if (failure === 'media') {
      await waitFor(() => expect(mocks.start).toHaveBeenCalledTimes(1))
      const options = mocks.start.mock.calls[0][0] as MediaSessionOptions
      act(() => options.onStatus?.('failed', diagnostic))
    }
    const alert = await desktop.findByRole('alert')
    expect(alert).toHaveTextContent(
      'Could not connect to the bot’s desktop. Choose Reconnect view to try again.'
    )
    expect(desktop.getByRole('status')).toHaveTextContent(
      /^Desktop view could not connect$/
    )
    const details = within(alert).getByText('Details').closest('details')!
    expect(details).not.toHaveAttribute('open')
    expect(within(details).getByText(diagnostic)).not.toBeVisible()
    fireEvent.click(within(details).getByText('Details'))
    expect(within(details).getByText(diagnostic)).toBeVisible()
    expect(opens).toBe(1)

    fireEvent.click(desktop.getByRole('button', { name: 'Reconnect view' }))
    await waitFor(() =>
      expect(desktop.getByRole('status')).toHaveTextContent(
        /^Desktop view connected$/
      )
    )
    expect(opens).toBe(2)
    expect(desktop.queryByRole('alert')).not.toBeInTheDocument()
    expect(
      mocks.call.mock.calls.filter(([path]) =>
        /^(tasks\/(submit|cancel|resume)|control\/|connect$|disconnect$)/.test(path)
      )
    ).toEqual([])
  }
)

it('explains an ended desktop view without automatically reopening it', async () => {
  await mount()
  fireEvent.click(screen.getByRole('button', { name: 'Desktop', exact: true }))
  fireEvent.click(screen.getByRole('button', { name: 'View bot’s desktop' }))
  await waitFor(() => expect(mocks.start).toHaveBeenCalledTimes(1))
  const desktop = within(screen.getByRole('region', { name: 'Bot desktop' }))
  const options = mocks.start.mock.calls[0][0] as MediaSessionOptions
  act(() => options.onStatus?.('ended'))
  expect(desktop.getByRole('status')).toHaveTextContent(/^Desktop view ended$/)
  expect(
    desktop.getByText('Choose Reconnect view to open the desktop again.')
  ).toBeVisible()
  expect(desktop.queryByRole('alert')).not.toBeInTheDocument()
  expect(
    mocks.call.mock.calls.filter(([path]) => path === 'view/open')
  ).toHaveLength(1)
  expect(desktop.getByRole('button', { name: 'Reconnect view' })).toBeEnabled()
})

it('returns keyboard focus from a human desktop without closing the view or handing control back', async () => {
  await mount()
  const identity = snapshot.live_sessions[0]
  snapshot = {
    ...snapshot,
    controls: [
      {
        identity,
        owner: sessionStorage.getItem('gbot-control-owner'),
        state: 'human',
      },
    ],
  }
  mocks.call.mockImplementation(async (path: string) => {
    if (path === 'state') return snapshot
    if (path === 'tasks') return tasks
    if (path === 'tasks/approvals') return []
    if (path === 'view/open')
      return {
        lease_id: 'human-lease',
        ws_url: 'ws://127.0.0.1/mock',
        media_session_id: 'human-media',
        interactive: true,
      }
    return {}
  })
  await act(async () => {
    await useGbotCompanion.getState().refresh()
  })
  fireEvent.click(screen.getByRole('button', { name: 'Desktop', exact: true }))
  fireEvent.click(screen.getByRole('button', { name: 'View bot’s desktop' }))
  await waitFor(() => expect(mocks.start).toHaveBeenCalledTimes(1))
  const desktop = within(screen.getByRole('region', { name: 'Bot desktop' }))
  const returnKeyboard = desktop.getByRole('button', {
    name: 'Return keyboard to GChat',
  })
  const canvas = desktop.getByLabelText('Bot computer desktop')
  expect(desktop.getByText('You have control')).toBeInTheDocument()
  expect(desktop.getByText(/Press Ctrl\+Alt\+Shift\+Esc/)).toBeInTheDocument()
  const options = mocks.start.mock.calls[0][0] as MediaSessionOptions
  expect(options.interactive).toBe(true)
  expect(options.onInputEscape).toBeTypeOf('function')
  canvas.focus()
  expect(document.activeElement).toBe(canvas)
  mocks.call.mockClear()

  act(() => options.onInputEscape?.())

  expect(document.activeElement).toBe(returnKeyboard)
  expect(desktop.getByRole('status')).toHaveTextContent(/^Desktop view connected$/)
  expect(desktop.getByRole('button', { name: 'Close view' })).toBeEnabled()
  expect(desktop.getByText('You have control')).toBeInTheDocument()
  expect(mocks.start).toHaveBeenCalledTimes(1)
  expect(mocks.stop).not.toHaveBeenCalled()
  expect(mocks.call).not.toHaveBeenCalled()

  canvas.focus()
  fireEvent.click(returnKeyboard)
  expect(document.activeElement).not.toBe(canvas)
  expect(mocks.stop).not.toHaveBeenCalled()
  expect(mocks.call).not.toHaveBeenCalled()
})

it('closes a late desktop ticket after hiding and never starts its media session', async () => {
  await mount()
  let ticket!: (value: unknown) => void
  mocks.call.mockImplementation(async (path) =>
    path === 'view/open'
      ? new Promise((resolve) => {
          ticket = resolve
        })
      : {}
  )
  fireEvent.click(screen.getByRole('button', { name: 'Desktop', exact: true }))
  fireEvent.click(screen.getByRole('button', { name: 'View bot’s desktop' }))
  fireEvent.click(screen.getByRole('button', { name: 'Hide bot pane' }))
  await act(async () =>
    ticket({
      lease_id: 'late',
      ws_url: 'ws://127.0.0.1/mock',
      media_session_id: 'late-media',
      interactive: false,
    })
  )
  expect(mocks.start).not.toHaveBeenCalled()
  expect(mocks.call).toHaveBeenCalledWith(
    'view/close',
    expect.objectContaining({ lease_id: 'late' })
  )
  expect(document.getElementById('gbot-companion')).toHaveAttribute('inert')
  expect(
    screen.queryByRole('region', { name: 'Bot desktop' })
  ).not.toBeInTheDocument()
  expect(screen.getByRole('textbox', { name: 'Main work' })).toHaveValue(
    'Main draft'
  )
})

it.each([
  ['Take over', 'control/take-over', 'Could not take over this desktop. Try again.'],
  ['Hand back', 'control/hand-back', 'Could not hand back control. Try again.'],
] as const)(
  'keeps a failed desktop control %s inline and retries its companion session',
  async (action, path, message) => {
    const errorToast = vi.spyOn(toast, 'error').mockImplementation(() => 0)
    try {
      const identity = snapshot.live_sessions[0]
      snapshot.live_sessions.push({ workspace_id: 'b', session_id: 'sb' })
      let human = action === 'Hand back'
      let fail!: (cause: Error) => void
      let finish!: () => void
      const change = vi
        .fn()
        .mockImplementationOnce(() => new Promise<void>((_, reject) => {
          fail = reject
        }))
        .mockImplementationOnce(() => new Promise<void>((resolve) => {
          finish = resolve
        }))
      const fallback = mocks.call.getMockImplementation()!
      mocks.call.mockImplementation((request: string, body?: unknown) => {
        if (request === 'state') return Promise.resolve({
          ...snapshot,
          controls: [{
            identity: snapshot.live_sessions[0],
            state: human ? 'human' : 'bot',
            owner: human ? sessionStorage.getItem('gbot-control-owner') : null,
          }],
        })
        if (request === path) {
          if (action === 'Hand back') expect(mocks.stop).toHaveBeenCalled()
          return change(body)
        }
        if (request === 'view/open') return Promise.resolve({
          lease_id: 'control-lease',
          ws_url: 'ws://127.0.0.1/mock',
          media_session_id: 'control-media',
          interactive: (body as { interactive: boolean }).interactive,
        })
        return fallback(request, body)
      })
      await mount()
      fireEvent.click(screen.getByRole('button', { name: 'Desktop', exact: true }))
      fireEvent.click(screen.getByRole('button', { name: 'View bot’s desktop' }))
      await waitFor(() => expect(mocks.start).toHaveBeenCalledTimes(1))
      const pane = () => within(screen.getByRole('region', { name: 'Bot desktop controls' }))
      const originalStatus = human ? 'Bot paused · human control' : 'Bot has control'
      const payload = { identity, owner: sessionStorage.getItem('gbot-control-owner') }
      const button = pane().getByRole('button', { name: action, exact: true })
      act(() => {
        button.dispatchEvent(new MouseEvent('click', { bubbles: true }))
        button.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      })
      expect(change).toHaveBeenCalledExactlyOnceWith(payload)
      expect(button).toBeDisabled()
      expect(pane().getByText(originalStatus, { exact: true })).toBeVisible()
      await act(async () => fail(new Error('Desktop control unavailable')))
      const alert = await pane().findByRole('alert')
      expect(within(alert).getByText(message)).toBeVisible()
      expect(within(alert).getByText('Details').closest('details')).not.toHaveAttribute('open')
      expect(within(alert).getByText('Desktop control unavailable')).not.toBeVisible()
      expect(button).toBeEnabled()
      expect(pane().getByText(originalStatus, { exact: true })).toBeVisible()
      expect(errorToast).not.toHaveBeenCalled()

      const reads = mocks.call.mock.calls.filter(([request]) => request === 'tasks').length
      await act(async () => events.get('gbot-task-update')?.())
      expect(mocks.call.mock.calls.filter(([request]) => request === 'tasks')).toHaveLength(reads + 1)
      expect(pane().getByRole('alert')).toHaveTextContent(message)
      expect(change).toHaveBeenCalledTimes(1)
      fireEvent.click(screen.getByRole('button', { name: /Open Bramble/ }))
      fireEvent.click(screen.getByRole('button', { name: 'Desktop', exact: true }))
      expect(pane().queryByRole('alert')).not.toBeInTheDocument()
      fireEvent.click(screen.getByRole('button', { name: /Open Atlas/ }))
      expect(pane().getByRole('alert')).toHaveTextContent(message)

      snapshot.live_sessions[0] = { ...identity, session_id: 'replacement' }
      await act(async () => events.get('gbot-task-update')?.())
      expect(pane().queryByRole('alert')).not.toBeInTheDocument()
      snapshot.live_sessions[0] = identity
      await act(async () => events.get('gbot-task-update')?.())
      expect(pane().getByRole('alert')).toHaveTextContent(message)
      mocks.getTarget.mockResolvedValue({ kind: 'paired_host', host_id: 'other-service' })
      await act(async () => events.get('gbot-task-update')?.())
      fireEvent.click(screen.getByRole('button', { name: /Open Atlas/ }))
      fireEvent.click(screen.getByRole('button', { name: 'Desktop', exact: true }))
      expect(pane().queryByRole('alert')).not.toBeInTheDocument()
      mocks.getTarget.mockResolvedValue({ kind: 'local' })
      await act(async () => events.get('gbot-task-update')?.())
      fireEvent.click(screen.getByRole('button', { name: /Open Atlas/ }))
      fireEvent.click(screen.getByRole('button', { name: 'Desktop', exact: true }))
      expect(pane().getByRole('alert')).toHaveTextContent(message)
      expect(change).toHaveBeenCalledTimes(1)

      if (action === 'Hand back') {
        fireEvent.click(pane().getByRole('button', { name: 'View bot’s desktop' }))
        await waitFor(() => expect(mocks.start).toHaveBeenLastCalledWith(
          expect.objectContaining({ interactive: true })
        ))
      }
      const retry = pane().getByRole('button', { name: action, exact: true })
      fireEvent.click(retry)
      expect(change.mock.calls).toEqual([[payload], [payload]])
      expect(pane().queryByRole('alert')).not.toBeInTheDocument()
      expect(retry).toBeDisabled()
      expect(pane().getByText(originalStatus, { exact: true })).toBeVisible()
      human = !human
      await act(async () => finish())
      expect(await pane().findByRole('button', {
        name: action === 'Take over' ? 'Hand back' : 'Take over', exact: true,
      })).toBeEnabled()
      expect(pane().getByText(human ? 'Bot paused · human control' : 'Bot has control', { exact: true })).toBeVisible()
      expect(pane().queryByRole('alert')).not.toBeInTheDocument()
      expect(mocks.call.mock.calls.filter(([request]) =>
        request.startsWith('control/') || (request.startsWith('tasks/') && request !== 'tasks/approvals')
      )).toEqual([[path, payload], [path, payload]])
      expect(errorToast).not.toHaveBeenCalled()
    } finally {
      errorToast.mockRestore()
    }
  }
)

it('updates actual tool activity from service events and stops input before hand back', async () => {
  await mount()
  tasks = [
    {
      id: 'ta',
      identity: snapshot.live_sessions[0],
      state: 'running',
      messages: [{ role: 'user', content: 'Inspect project' }],
      help_requests: [],
      calls: [
        { call_id: 'read', name: 'read_file', reply: null },
        {
          call_id: 'skipped',
          name: 'delete_file',
          reply: null,
          not_executed: true,
        },
        { call_id: 'listed', name: 'list_files', reply: { files: ['notes.txt'] } },
      ],
      connector_calls: [
        { call_id: 'send', name: 'send_email', reply: null },
        { call_id: 'searched', name: 'search_mail', reply: { messages: [] } },
      ],
    },
  ]
  await act(async () => events.get('gbot-task-update')?.())
  await screen.findByRole('button', {
    name: 'Open Atlas · Working through steps',
  })
  fireEvent.click(screen.getByRole('button', { name: 'Agents', exact: true }))
  const agents = within(screen.getByRole('region', { name: 'Bot agents' }))
  expect(agents.getByText('read_file · awaiting result')).toBeVisible()
  expect(agents.getByText('send_email · awaiting result')).toBeVisible()
  expect(agents.getByText('delete_file · not executed')).toBeVisible()
  expect(agents.getByText('list_files · result received')).toBeVisible()
  expect(agents.getByText('search_mail · result received')).toBeVisible()

  const requestsBeforeReview = mocks.call.mock.calls.length
  tasks = [
    {
      ...tasks[0],
      state: 'needs_review',
      history: [{ state: 'needs_review', reason: 'executor restarted', at: 1 }],
    },
  ]
  await act(async () => events.get('gbot-task-update')?.())
  expect(await agents.findByText('read_file · result unknown')).toBeVisible()
  expect(agents.getByText('send_email · result unknown')).toBeVisible()
  expect(
    agents.getByText(
      'This task stopped because a tool’s result is uncertain. Check whether the action happened before starting another task.'
    )
  ).toBeVisible()
  expect(agents.queryByText(/awaiting result/)).not.toBeInTheDocument()
  expect(agents.getByText('delete_file · not executed')).toBeVisible()
  expect(agents.getByText('list_files · result received')).toBeVisible()
  expect(agents.getByText('search_mail · result received')).toBeVisible()
  expect(
    mocks.call.mock.calls.slice(requestsBeforeReview).map(([path]) => path)
  ).toEqual(['state', 'tasks', 'tasks/approvals'])
  snapshot = {
    ...snapshot,
    controls: [
      {
        identity: snapshot.live_sessions[0],
        owner: sessionStorage.getItem('gbot-control-owner'),
        state: 'human',
      },
    ],
  }
  await act(async () => {
    await useGbotCompanion.getState().refresh()
  })
  fireEvent.click(screen.getByRole('button', { name: 'Desktop', exact: true }))
  fireEvent.click(screen.getByRole('button', { name: 'View bot’s desktop' }))
  await waitFor(() => expect(mocks.start).toHaveBeenCalled())
  mocks.call.mockImplementation(async (path) => {
    if (path === 'control/hand-back') {
      expect(mocks.stop).toHaveBeenCalled()
      throw new Error('Observation failed')
    }
    return path === 'state' ? snapshot : []
  })
  fireEvent.click(screen.getByRole('button', { name: 'Hand back' }))
  await waitFor(() =>
    expect(mocks.call).toHaveBeenCalledWith(
      'control/hand-back',
      expect.objectContaining({ identity: snapshot.live_sessions[0] })
    )
  )
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Hand back' })).toBeEnabled()
  )
  expect(mocks.call).not.toHaveBeenCalledWith('tasks/resume', expect.anything())
})

it('reconnects a paused view-only desktop after failed hand back without resuming the task', async () => {
  await mount()
  const identity = snapshot.live_sessions[0]
  snapshot = {
    ...snapshot,
    controls: [
      {
        identity,
        owner: sessionStorage.getItem('gbot-control-owner'),
        state: 'paused',
      },
    ],
  }
  tasks = [
    {
      id: 'ta',
      identity,
      state: 'paused',
      messages: [{ role: 'user', content: 'Inspect project' }],
      help_requests: [],
    },
  ]
  let leases = 0
  mocks.call.mockImplementation(async (path: string) => {
    if (path === 'state') return snapshot
    if (path === 'tasks') return tasks
    if (path === 'tasks/approvals') return []
    if (path === 'view/open') {
      leases += 1
      return {
        lease_id: `lease-${leases}`,
        ws_url: `ws://127.0.0.1/mock-${leases}`,
        media_session_id: `media-${leases}`,
        interactive: false,
      }
    }
    if (path === 'control/hand-back') {
      expect(mocks.stop).toHaveBeenCalledTimes(1)
      throw new Error('Fresh observation failed')
    }
    return {}
  })
  await act(async () => {
    await useGbotCompanion.getState().refresh()
  })
  fireEvent.click(screen.getByRole('button', { name: 'Desktop', exact: true }))
  fireEvent.click(screen.getByRole('button', { name: 'View bot’s desktop' }))
  const desktop = within(
    await screen.findByRole('region', { name: 'Bot desktop', exact: true })
  )
  await waitFor(() =>
    expect(desktop.getByRole('status')).toHaveTextContent(/^Desktop view connected$/)
  )
  expect(desktop.getByText('View only')).toBeInTheDocument()
  expect(desktop.queryByRole('button', { name: 'Reconnect view' })).toBeNull()
  expect(mocks.call).toHaveBeenCalledWith(
    'view/open',
    expect.objectContaining({ identity, interactive: false })
  )

  fireEvent.click(screen.getByRole('button', { name: 'Hand back' }))
  const reconnect = await desktop.findByRole('button', {
    name: 'Reconnect view',
  })
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Hand back' })).toBeEnabled()
  )
  expect(mocks.call).toHaveBeenCalledWith(
    'control/hand-back',
    expect.objectContaining({ identity })
  )
  expect(desktop.getByRole('status')).toHaveTextContent(/^Desktop view ended$/)
  expect(mocks.stop).toHaveBeenCalledTimes(1)
  expect(mocks.start).toHaveBeenCalledTimes(1)
  expect(leases).toBe(1)
  expect(useGbotCompanion.getState().snapshot.controls[0].state).toBe('paused')
  expect(useGbotCompanion.getState().tasks[0].state).toBe('paused')
  expect(screen.getByText('Bot paused', { exact: true })).toBeInTheDocument()

  const stopped = mocks.start.mock.calls[0][0] as MediaSessionOptions
  act(() => stopped.onStatus?.('streaming'))
  expect(desktop.getByRole('status')).toHaveTextContent(/^Desktop view ended$/)
  expect(desktop.getByRole('button', { name: 'Reconnect view' })).toBe(
    reconnect
  )
  expect(leases).toBe(1)

  fireEvent.click(reconnect)
  await waitFor(() => expect(mocks.start).toHaveBeenCalledTimes(2))
  expect(leases).toBe(2)
  expect(
    mocks.call.mock.calls
      .filter(([path]) => path === 'view/open')
      .map(([, body]) => body)
  ).toEqual([
    expect.objectContaining({ identity, interactive: false }),
    expect.objectContaining({ identity, interactive: false }),
  ])
  expect(mocks.call).toHaveBeenCalledWith(
    'view/close',
    expect.objectContaining({ identity, lease_id: 'lease-1' })
  )
  expect(mocks.start).toHaveBeenLastCalledWith(
    expect.objectContaining({
      ticket: {
        wsUrl: 'ws://127.0.0.1/mock-2',
        mediaSessionId: 'media-2',
      },
      interactive: false,
    })
  )
  await waitFor(() =>
    expect(desktop.getByRole('status')).toHaveTextContent(/^Desktop view connected$/)
  )
  expect(desktop.getByText('View only')).toBeInTheDocument()
  expect(desktop.queryByRole('button', { name: 'Reconnect view' })).toBeNull()
  expect(screen.getByRole('button', { name: 'Hand back' })).toBeEnabled()
  expect(useGbotCompanion.getState().tasks[0].state).toBe('paused')
  expect(mocks.call).not.toHaveBeenCalledWith('tasks/resume', expect.anything())
})

it('closes a desktop ticket arriving after failed hand back and waits for manual reconnect', async () => {
  await mount()
  const identity = snapshot.live_sessions[0]
  snapshot = {
    ...snapshot,
    controls: [
      {
        identity,
        owner: sessionStorage.getItem('gbot-control-owner'),
        state: 'paused',
      },
    ],
  }
  tasks = [
    {
      id: 'ta',
      identity,
      state: 'paused',
      messages: [{ role: 'user', content: 'Inspect project' }],
      help_requests: [],
    },
  ]
  let leases = 0
  let resolveTicket!: (ticket: unknown) => void
  mocks.call.mockImplementation(async (path: string) => {
    if (path === 'state') return snapshot
    if (path === 'tasks') return tasks
    if (path === 'tasks/approvals') return []
    if (path === 'view/open') {
      leases += 1
      if (leases === 1)
        return new Promise((resolve) => {
          resolveTicket = resolve
        })
      return {
        lease_id: 'fresh-lease',
        ws_url: 'ws://127.0.0.1/fresh',
        media_session_id: 'fresh-media',
        interactive: false,
      }
    }
    if (path === 'control/hand-back')
      throw new Error('Fresh observation failed')
    return {}
  })
  await act(async () => {
    await useGbotCompanion.getState().refresh()
  })
  fireEvent.click(screen.getByRole('button', { name: 'Desktop', exact: true }))
  fireEvent.click(screen.getByRole('button', { name: 'View bot’s desktop' }))
  const desktop = within(
    await screen.findByRole('region', { name: 'Bot desktop', exact: true })
  )
  await waitFor(() => expect(leases).toBe(1))
  expect(desktop.getByRole('status')).toHaveTextContent(/^Connecting to the desktop…$/)
  expect(mocks.start).not.toHaveBeenCalled()

  fireEvent.click(screen.getByRole('button', { name: 'Hand back' }))
  const reconnect = await desktop.findByRole('button', {
    name: 'Reconnect view',
  })
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Hand back' })).toBeEnabled()
  )
  expect(mocks.call).toHaveBeenCalledWith(
    'control/hand-back',
    expect.objectContaining({ identity })
  )
  expect(desktop.getByRole('status')).toHaveTextContent(/^Desktop view ended$/)
  expect(leases).toBe(1)
  expect(useGbotCompanion.getState().snapshot.controls[0].state).toBe('paused')
  expect(useGbotCompanion.getState().tasks[0].state).toBe('paused')

  await act(async () =>
    resolveTicket({
      lease_id: 'late-lease',
      ws_url: 'ws://127.0.0.1/late',
      media_session_id: 'late-media',
      interactive: false,
    })
  )
  await waitFor(() =>
    expect(mocks.call).toHaveBeenCalledWith(
      'view/close',
      expect.objectContaining({ identity, lease_id: 'late-lease' })
    )
  )
  expect(mocks.start).not.toHaveBeenCalled()
  expect(desktop.getByRole('status')).toHaveTextContent(/^Desktop view ended$/)
  expect(desktop.getByRole('button', { name: 'Reconnect view' })).toBe(
    reconnect
  )
  expect(leases).toBe(1)

  fireEvent.click(reconnect)
  await waitFor(() => expect(mocks.start).toHaveBeenCalledTimes(1))
  expect(leases).toBe(2)
  expect(
    mocks.call.mock.calls
      .filter(([path]) => path === 'view/open')
      .map(([, body]) => body)
  ).toEqual([
    expect.objectContaining({ identity, interactive: false }),
    expect.objectContaining({ identity, interactive: false }),
  ])
  expect(mocks.start).toHaveBeenLastCalledWith(
    expect.objectContaining({
      ticket: {
        wsUrl: 'ws://127.0.0.1/fresh',
        mediaSessionId: 'fresh-media',
      },
      interactive: false,
    })
  )
  await waitFor(() =>
    expect(desktop.getByRole('status')).toHaveTextContent(/^Desktop view connected$/)
  )
  expect(desktop.getByText('View only')).toBeInTheDocument()
  expect(desktop.queryByRole('button', { name: 'Reconnect view' })).toBeNull()
  expect(screen.getByRole('button', { name: 'Hand back' })).toBeEnabled()
  expect(useGbotCompanion.getState().snapshot.controls[0].state).toBe('paused')
  expect(useGbotCompanion.getState().tasks[0].state).toBe('paused')
  expect(mocks.call).not.toHaveBeenCalledWith('tasks/resume', expect.anything())
})

it('makes no service calls when disabled, including queued events after cleanup', async () => {
  useGeneralSetting.setState({ gbotEnabled: false })
  const view = render(<GbotCompanion />)
  expect(mocks.call).not.toHaveBeenCalled()
  expect(mocks.listen).not.toHaveBeenCalled()
  act(() => useGeneralSetting.setState({ gbotEnabled: true }))
  await waitFor(() => expect(events.size).toBe(2))
  await waitFor(() => expect(useGbotCompanion.getState().available).toBe(true))
  const queued = [...events.values()]
  act(() => useGeneralSetting.setState({ gbotEnabled: false }))
  await waitFor(() => expect(events.size).toBe(0))
  mocks.call.mockClear()
  await act(async () => queued.forEach((refresh) => refresh()))
  expect(mocks.call).not.toHaveBeenCalled()
  expect(useGbotCompanion.getState().mode).toBe('hidden')
  expect(useGbotCompanion.getState().snapshot.workspaces).toEqual([])
  expect(useGbotCompanion.getState().available).toBe(false)
  expect(useGbotCompanion.getState().loading).toBe(false)
  view.unmount()
})

it.each(['kvm', 'hyper_v'])(
  'holds task and desktop admission until the %s computer is ready and running',
  async (hypervisor) => {
    snapshot.workspaces[0].bot_pc = { kind: 'local_vm', hypervisor }
    let stage = 'installing'
    mocks.call.mockImplementation(async (path) =>
      path === 'state'
        ? snapshot
        : path === 'setup/local-vm/status'
          ? [{ id: 'a', name: 'Atlas', stage, issue: null }]
          : []
    )
    await mount()
    fireEvent.change(screen.getByRole('textbox', { name: 'Message bot' }), {
      target: { value: 'Do work' },
    })
    expect(
      screen.getByRole('button', { name: 'Send', exact: true })
    ).toBeDisabled()
    fireEvent.click(
      screen.getByRole('button', { name: 'Desktop', exact: true })
    )
    expect(
      screen.queryByRole('button', { name: 'View bot’s desktop' })
    ).not.toBeInTheDocument()
    stage = 'stopped'
    await act(async () => {
      await useGbotCompanion.getState().refresh()
    })
    expect(
      screen.getByText(
        'Start this bot’s computer in Gbot settings to view its desktop.'
      )
    ).toBeVisible()
    expect(
      screen.queryByRole('button', { name: 'View bot’s desktop' })
    ).not.toBeInTheDocument()
    stage = 'ready'
    await act(async () => {
      await useGbotCompanion.getState().refresh()
    })
    expect(
      screen.getByRole('button', { name: 'View bot’s desktop' })
    ).toBeInTheDocument()
    fireEvent.click(
      screen.getByRole('button', { name: 'Conversation', exact: true })
    )
    expect(
      screen.getByRole('button', { name: 'Send', exact: true })
    ).toBeEnabled()
  }
)

it('stops only the selected bot task and keeps progress through the state refresh', async () => {
  tasks = [
    {
      id: 'atlas-task',
      identity: snapshot.live_sessions[0],
      state: 'running',
      messages: [{ role: 'user', content: 'Atlas task' }],
      help_requests: [],
    },
    {
      id: 'bramble-task',
      identity: { workspace_id: 'b', session_id: 'sb' },
      state: 'running',
      messages: [{ role: 'user', content: 'Bramble task' }],
      help_requests: [],
    },
  ]
  await mount()
  const original = mocks.call.getMockImplementation()!
  let finish!: () => void
  let finishRefresh!: (value: BotState) => void
  mocks.call.mockImplementation((path: string, body?: unknown) => {
    if (path === 'tasks/cancel')
      return new Promise<void>((resolve) => {
        finish = resolve
      })
    if (path === 'state')
      return new Promise<BotState>((resolve) => {
        finishRefresh = resolve
      })
    return original(path, body)
  })
  const stop = screen.getByRole('button', { name: 'Stop task' })
  act(() => {
    fireEvent.click(stop)
    fireEvent.click(stop)
  })
  expect(
    mocks.call.mock.calls.filter(([path]) => path === 'tasks/cancel')
  ).toEqual([['tasks/cancel', { id: 'atlas-task' }]])
  expect(screen.getByRole('status')).toHaveTextContent('Stopping this task…')
  expect(screen.queryByText('Bramble task')).not.toBeInTheDocument()
  await act(async () => finish())
  await waitFor(() => expect(finishRefresh).toBeTypeOf('function'))
  expect(screen.getByRole('button', { name: 'Stopping…' })).toBeDisabled()
  tasks = [{ ...tasks[0], state: 'cancelled' }, tasks[1]]
  await act(async () => finishRefresh(snapshot))
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Resume task' })).toBeEnabled()
  )
  expect(screen.queryByText('Stopping this task…')).not.toBeInTheDocument()
  expect(mocks.call).not.toHaveBeenCalledWith('tasks/resume', expect.anything())
})

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
  getGbotServiceTarget: () => Promise.resolve({ kind: 'local' }),
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
  expect(desktop.getByRole('status')).toHaveTextContent(/^streaming$/)
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

it('updates actual tool activity from service events and stops input before hand back', async () => {
  await mount()
  tasks = [
    {
      id: 'ta',
      identity: snapshot.live_sessions[0],
      state: 'running',
      messages: [{ role: 'user', content: 'Inspect project' }],
      help_requests: [],
      calls: [{ call_id: 'read', name: 'read_file', reply: null }],
    },
  ]
  await act(async () => events.get('gbot-task-update')?.())
  await screen.findByRole('button', {
    name: 'Open Atlas · Working through steps',
  })
  fireEvent.click(screen.getByRole('button', { name: 'Agents', exact: true }))
  expect(screen.getByText('read_file · awaiting result')).toBeInTheDocument()
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
    expect(desktop.getByRole('status')).toHaveTextContent(/^streaming$/)
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
  expect(desktop.getByRole('status')).toHaveTextContent(/^ended$/)
  expect(mocks.stop).toHaveBeenCalledTimes(1)
  expect(mocks.start).toHaveBeenCalledTimes(1)
  expect(leases).toBe(1)
  expect(useGbotCompanion.getState().snapshot.controls[0].state).toBe('paused')
  expect(useGbotCompanion.getState().tasks[0].state).toBe('paused')
  expect(screen.getByText('Bot paused', { exact: true })).toBeInTheDocument()

  const stopped = mocks.start.mock.calls[0][0] as MediaSessionOptions
  act(() => stopped.onStatus?.('streaming'))
  expect(desktop.getByRole('status')).toHaveTextContent(/^ended$/)
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
    expect(desktop.getByRole('status')).toHaveTextContent(/^streaming$/)
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
  expect(desktop.getByRole('status')).toHaveTextContent(/^connecting$/)
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
  expect(desktop.getByRole('status')).toHaveTextContent(/^ended$/)
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
  expect(desktop.getByRole('status')).toHaveTextContent(/^ended$/)
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
    expect(desktop.getByRole('status')).toHaveTextContent(/^streaming$/)
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

it('holds task and desktop admission until the KVM setup becomes Ready', async () => {
  snapshot.workspaces[0].bot_pc = { kind: 'local_vm', hypervisor: 'kvm' }
  let stage = 'installing'
  mocks.call.mockImplementation(async (path) =>
    path === 'state'
      ? snapshot
      : path === 'setup/kvm/status'
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
  fireEvent.click(screen.getByRole('button', { name: 'Desktop', exact: true }))
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
})

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

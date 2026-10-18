import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { ComponentType } from 'react'
import { toast } from 'sonner'
import { ConfirmDialogHost } from '@/containers/dialogs/ConfirmDialogHost'
import { settleConfirm } from '@/lib/confirm'
import type { BotState, KvmSetupRecord } from '@/services/gbot'
import { connectorAccounts } from '@/services/workspace-connectors'

const mocks = vi.hoisted(() => ({
  call: vi.fn(),
  getTarget: vi.fn(),
  selectService: vi.fn(),
  grant: vi.fn(),
  quitService: vi.fn(),
  startService: vi.fn(),
  listen: vi.fn(),
  mediaStart: vi.fn(),
  mediaStop: vi.fn(),
}))
vi.mock('@/vendor/cua-media/mediaSession', () => ({
  MediaSession: class {
    constructor(readonly options: { interactive: boolean }) {}
    start() {
      mocks.mediaStart(this.options)
    }
    stop() {
      mocks.mediaStop()
    }
  },
}))
vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: unknown) => ({ options }),
}))
vi.mock('@tauri-apps/api/event', () => ({ listen: mocks.listen }))
vi.mock('@/services/workspace-connectors', () => ({
  connectorAccounts: vi.fn(),
  beginConnectorAuth: vi.fn(),
  connectorAuthStatus: vi.fn(),
  cancelConnectorAuth: vi.fn(),
}))
vi.mock('@/containers/HeaderPage', () => ({
  default: ({ children }: { children: React.ReactNode }) => (
    <header>{children}</header>
  ),
}))
vi.mock('@/services/gbot', async (original) => ({
  ...(await original<object>()),
  gbot: (path: string, body?: unknown) =>
    path === 'assignments/models'
      ? Promise.resolve([])
      : mocks.call(path, body),
  getGbotServiceTarget: mocks.getTarget,
  selectGbotService: mocks.selectService,
  gbotControlGrant: mocks.grant,
  quitGbotService: mocks.quitService,
  startGbotService: mocks.startService,
}))

import { Route } from './index'
import { useGeneralSetting } from '@/hooks/useGeneralSetting'
const Page = Route.options.component as ComponentType
beforeEach(() => {
  mocks.getTarget.mockResolvedValue({ kind: 'local' })
  mocks.selectService.mockResolvedValue(undefined)
  useGeneralSetting.setState({ gbotEnabled: true })
})
afterEach(() => {
  settleConfirm(false)
  cleanup()
  sessionStorage.clear()
  localStorage.removeItem('gbot-control-owner')
  vi.clearAllMocks()
})

function readyTaskBots(
  startTask?: (body: Record<string, unknown>) => Promise<unknown>,
  stateOverrides: Partial<BotState> = {}
) {
  const identities = [
    { workspace_id: 'one', session_id: 'writer-session' },
    { workspace_id: 'two', session_id: 'researcher-session' },
  ]
  mocks.listen.mockResolvedValue(() => {})
  mocks.call.mockImplementation(
    async (path: string, body: Record<string, unknown>) => {
      if (path === 'state')
        return {
          workspaces: [
            { id: 'one', name: 'Writer' },
            { id: 'two', name: 'Researcher' },
          ],
          live_sessions: identities,
          controls: [],
          assignments: identities.map((identity) => ({
            workspace_id: identity.workspace_id,
            connection: { kind: 'endpoint', api_base: 'http://host/v1' },
            model: 'qwen',
            context_tokens: 262144,
            credential_ref: null,
          })),
          ...stateOverrides,
        }
      if (path === 'connectors/get') return { account_ids: [], accounts: [] }
      if (path === 'schedules') return { schedules: [], stopped: null }
      if (path === 'tasks/start') return startTask ? startTask(body) : {}
      return []
    }
  )
  return identities
}

it.each(['kvm', 'hyper_v'])(
  'stops and starts a saved %s computer from settings, preserving failures and blocking desktop admission while stopped',
  async (hypervisor) => {
    readyTaskBots(undefined, {
      workspaces: [
        { id: 'one', name: 'Writer', bot_pc: { kind: 'local_vm', hypervisor } },
      ],
    })
    const original = mocks.call.getMockImplementation()!
    let saved: KvmSetupRecord = {
      id: 'one',
      name: 'Writer',
      stage: 'ready',
      issue: null,
    }
    let rejectStop!: (cause: Error) => void
    const pendingStop = new Promise<never>((_, reject) => {
      rejectStop = reject
    })
    let stops = 0
    let starts = 0
    mocks.call.mockImplementation(
      async (path: string, body: Record<string, unknown>) => {
        if (path === 'setup/local-vm/status') return [saved]
        if (path === 'setup/local-vm/stop') {
          if (++stops === 1) {
            saved = { ...saved, stage: 'stopping_computer' }
            return pendingStop
          }
          saved = { ...saved, stage: 'stopped' }
          return saved
        }
        if (path === 'setup/local-vm/start') {
          if (++starts === 1)
            throw new Error('The saved VM is temporarily unavailable.')
          saved = { ...saved, stage: 'ready' }
          return saved
        }
        return original(path, body)
      }
    )
    render(<Page />)
    const stop = await screen.findByRole('button', { name: 'Stop computer' })
    expect(
      screen.getByText(
        'Stopping this computer keeps its virtual disk and saved files.'
      )
    ).toBeVisible()
    act(() => {
      stop.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      stop.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(
      screen.getByRole('button', { name: 'Stopping computer…' })
    ).toBeDisabled()
    expect(stops).toBe(1)
    await act(async () =>
      rejectStop(new Error('The guest did not shut down.'))
    )
    expect(
      await screen.findByText('The guest did not shut down.')
    ).toBeVisible()
    expect(
      screen.getByText('Could not stop this computer. Try again.')
    ).toBeVisible()
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Stop computer' })
      ).toBeEnabled()
    )
    expect(
      screen.getByText('Computer is stopping', { exact: true })
    ).toBeVisible()
    expect(
      screen.getByRole('button', { name: 'Run', exact: true })
    ).toBeDisabled()
    expect(
      screen.queryByRole('button', { name: 'Start computer' })
    ).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Stop computer' }))
    const start = await screen.findByRole('button', { name: 'Start computer' })
    await waitFor(() => expect(start).toBeEnabled())
    expect(screen.getByText('Computer stopped', { exact: true })).toBeVisible()
    expect(
      screen.getByRole('button', { name: 'Run', exact: true })
    ).toBeDisabled()
    expect(
      screen.queryByRole('button', { name: 'View bot’s desktop' })
    ).not.toBeInTheDocument()
    expect(
      screen.queryByText('Could not stop this computer. Try again.')
    ).not.toBeInTheDocument()
    fireEvent.click(start)
    expect(
      await screen.findByText('The saved VM is temporarily unavailable.')
    ).toBeVisible()
    expect(
      screen.getByText('Could not start this computer. Try again.')
    ).toBeVisible()
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Start computer' })
      ).toBeEnabled()
    )
    expect(screen.getByText('Computer stopped', { exact: true })).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Start computer' }))
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Stop computer' })
      ).toBeEnabled()
    )
    expect(
      screen.getByRole('button', { name: 'View bot’s desktop' })
    ).toBeEnabled()
    expect(
      screen.queryByText('Could not start this computer. Try again.')
    ).not.toBeInTheDocument()
    expect(
      mocks.call.mock.calls.filter(([path]) =>
        /setup\/local-vm\/(start|stop|remove)$/.test(path)
      )
    ).toEqual([
      ['setup/local-vm/stop', { id: 'one' }],
      ['setup/local-vm/stop', { id: 'one' }],
      ['setup/local-vm/start', { id: 'one', name: 'Writer' }],
      ['setup/local-vm/start', { id: 'one', name: 'Writer' }],
    ])
  }
)

it('attributes saved task messages to you or the selected bot in conversation order', async () => {
  const [identity] = readyTaskBots()
  const call = mocks.call.getMockImplementation()!
  const longPath = `/Documents/${'saved-note-'.repeat(30)}.txt`
  mocks.call.mockImplementation(
    async (path: string, body: Record<string, unknown>) =>
      path === 'tasks'
        ? [
            {
              id: 'saved-conversation',
              identity,
              state: 'completed',
              messages: [
                { role: 'system', content: 'Internal task instructions' },
                { role: 'user', content: 'Write a note' },
                { role: 'assistant', content: 'What should the note say?' },
                { role: 'user', content: 'Save the meeting agenda' },
                { role: 'tool', content: 'Internal file operation' },
                { role: 'assistant', content: longPath },
              ],
            },
          ]
        : call(path, body)
  )

  const expectConversation = async () => {
    const reply = await screen.findByText(longPath)
    const history = reply.closest('article')!
    const speakers = within(history).getAllByText(/^(You|Writer)$/)
    expect(speakers.map((speaker) => speaker.textContent)).toEqual([
      'You',
      'Writer',
      'You',
      'Writer',
    ])
    const messages = [
      'Write a note',
      'What should the note say?',
      'Save the meeting agenda',
      longPath,
    ]
    speakers.forEach((speaker, index) => {
      expect(speaker).toBeVisible()
      expect(
        within(speaker.parentElement!).getByText(messages[index])
      ).toBeVisible()
    })
    expect(
      screen.queryByText('Internal task instructions')
    ).not.toBeInTheDocument()
    expect(screen.queryByText('Internal file operation')).not.toBeInTheDocument()
  }

  render(<Page />)
  await expectConversation()
  fireEvent.click(screen.getByRole('button', { name: 'Researcher' }))
  expect(screen.queryByText(longPath)).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Writer' }))
  await expectConversation()
  cleanup()
  render(<Page />)
  await expectConversation()
})

it.each(['Stop', 'Resume'] as const)(
  'keeps a failed task action %s inline through refresh and retries it in settings',
  async (action) => {
    const [identity] = readyTaskBots()
    const call = mocks.call.getMockImplementation()!
    const path = action === 'Stop' ? 'tasks/cancel' : 'tasks/resume'
    const progress =
      action === 'Stop' ? 'Stopping this task…' : 'Resuming this task…'
    const message = `Could not ${action.toLowerCase()} this task. Try again.`
    const outcome = action === 'Stop' ? 'cancelled' : 'running'
    const prompt = 'Read my saved notes'
    const task = {
      id: 'writer-task',
      identity,
      state: 'paused',
      messages: [{ role: 'user', content: prompt }],
      help_requests: [],
    }
    const updates = new Set<() => void>()
    mocks.listen.mockImplementation(async (event: string, update: () => void) => {
      if (event === 'gbot-task-update') updates.add(update)
      return () => updates.delete(update)
    })
    let fail!: (cause: string) => void
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
    mocks.call.mockImplementation(
      async (calledPath: string, body: Record<string, unknown>) => {
        if (calledPath === 'tasks') return [task]
        if (calledPath === path) return request(body)
        return call(calledPath, body)
      }
    )
    render(<Page />)
    const card = (await screen.findByText(prompt)).closest('article')!
    const submit = within(card).getByRole('button', { name: action, exact: true })
    const opposite = within(card).getByRole('button', {
      name: action === 'Stop' ? 'Resume' : 'Stop',
      exact: true,
    })
    expect(submit).toBeEnabled()
    expect(opposite).toBeEnabled()
    act(() => {
      submit.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      submit.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      opposite.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    const payload = { id: 'writer-task' }
    expect(request).toHaveBeenCalledExactlyOnceWith(payload)
    expect(within(card).getByRole('status')).toHaveTextContent(progress)
    for (const button of within(card).getAllByRole('button'))
      expect(button).toBeDisabled()

    await act(async () => fail('Task action unavailable'))
    const alert = await within(card).findByRole('alert')
    expect(within(alert).getByText(message)).toBeVisible()
    expect(
      within(alert).getByText('Details').closest('details')
    ).not.toHaveAttribute('open')
    expect(within(alert).getByText('Task action unavailable')).not.toBeVisible()
    expect(within(card).getByText(prompt)).toBeVisible()
    expect(within(card).getByText('paused', { exact: true })).toBeVisible()
    expect(within(card).queryByRole('status')).not.toBeInTheDocument()
    expect(
      within(card).getByRole('button', { name: 'Stop', exact: true })
    ).toBeEnabled()
    expect(
      within(card).getByRole('button', { name: 'Resume', exact: true })
    ).toBeEnabled()

    const reads = mocks.call.mock.calls.filter(
      ([calledPath]) => calledPath === 'tasks'
    ).length
    await act(async () => updates.forEach((update) => update()))
    await waitFor(() =>
      expect(
        mocks.call.mock.calls.filter(([calledPath]) => calledPath === 'tasks')
          .length
      ).toBeGreaterThan(reads)
    )
    expect(
      within(within(card).getByRole('alert')).getByText(message)
    ).toBeVisible()
    expect(within(card).getByText('paused', { exact: true })).toBeVisible()
    expect(request).toHaveBeenCalledTimes(1)

    fireEvent.click(
      within(card).getByRole('button', { name: action, exact: true })
    )
    expect(request.mock.calls).toEqual([[payload], [payload]])
    expect(within(card).getByRole('status')).toHaveTextContent(progress)
    for (const button of within(card).getAllByRole('button'))
      expect(button).toBeDisabled()
    task.state = outcome
    await act(async () => finish())
    expect(await within(card).findByText(outcome, { exact: true })).toBeVisible()
    expect(within(card).getByText(prompt)).toBeVisible()
    expect(within(card).queryByRole('alert')).not.toBeInTheDocument()
    expect(within(card).queryByRole('status')).not.toBeInTheDocument()
    expect(
      within(card).getByRole('button', {
        name: action === 'Stop' ? 'Resume' : 'Stop',
        exact: true,
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

it('shows the latest interruption reason after reopening and resumes that task', async () => {
  const [identity] = readyTaskBots()
  const call = mocks.call.getMockImplementation()!
  const reason = 'model returned no answer; resume the task to try again'
  const previousReason = 'previous connection failed'
  mocks.call.mockImplementation(
    async (path: string, body: Record<string, unknown>) =>
      path === 'tasks'
        ? [
            {
              id: 'interrupted-task',
              identity,
              state: 'interrupted',
              messages: [{ role: 'user', content: 'Write the saved note' }],
              history: [
                { state: 'interrupted', reason: previousReason, at: 42 },
                { state: 'running', reason: 'started', at: 42 },
                { state: 'interrupted', reason, at: 42 },
              ],
            },
          ]
        : call(path, body)
  )
  const expectInterruption = async () => {
    const message = await screen.findByText(reason)
    const card = message.closest('article')!
    expect(message).toBeVisible()
    expect(within(card).getByText('Write the saved note')).toBeVisible()
    expect(within(card).getByRole('button', { name: 'Resume' })).toBeEnabled()
    expect(screen.queryByText(previousReason)).not.toBeInTheDocument()
    return card
  }

  render(<Page />)
  await expectInterruption()
  fireEvent.click(screen.getByRole('button', { name: 'Researcher' }))
  expect(screen.queryByText(reason)).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Writer' }))
  await expectInterruption()
  cleanup()
  render(<Page />)
  const card = await expectInterruption()
  fireEvent.click(within(card).getByRole('button', { name: 'Resume' }))
  await waitFor(() =>
    expect(mocks.call).toHaveBeenCalledWith('tasks/resume', {
      id: 'interrupted-task',
    })
  )
})

it('does not show an old interruption reason after a task completes', async () => {
  const [identity] = readyTaskBots()
  const call = mocks.call.getMockImplementation()!
  const reason = 'model returned no answer; resume the task to try again'
  mocks.call.mockImplementation(
    async (path: string, body: Record<string, unknown>) =>
      path === 'tasks'
        ? [
            {
              id: 'completed-task',
              identity,
              state: 'completed',
              messages: [{ role: 'assistant', content: 'Saved the note' }],
              history: [
                { state: 'interrupted', reason, at: 42 },
                { state: 'running', reason: 'started', at: 43 },
                { state: 'completed', reason: 'completed', at: 44 },
              ],
            },
          ]
        : call(path, body)
  )
  render(<Page />)
  const reply = await screen.findByText('Saved the note')
  const card = reply.closest('article')!
  expect(reply).toBeVisible()
  expect(within(card).getByText('completed')).toBeVisible()
  expect(screen.queryByText(reason)).not.toBeInTheDocument()
  expect(
    within(card).queryByRole('button', { name: 'Resume' })
  ).not.toBeInTheDocument()
})

it('explains that a disconnected bot must connect before a task can run', async () => {
  readyTaskBots(undefined, { live_sessions: [] })
  render(<Page />)
  await screen.findByRole('heading', { name: 'Writer' })
  const guidance = 'Connect this bot’s computer before running a task.'
  const input = screen.getByLabelText('Bot task')
  fireEvent.change(input, { target: { value: 'Write a note' } })
  expect(screen.getByText(guidance)).toBeVisible()
  expect(input).toHaveAccessibleDescription(guidance)
  const run = screen.getByRole('button', { name: 'Run', exact: true })
  expect(run).toBeDisabled()
  expect(run).toHaveAccessibleDescription(guidance)
  expect(screen.getByRole('button', { name: 'Connect' })).toBeEnabled()
  fireEvent.click(run)
  expect(mocks.call).not.toHaveBeenCalledWith('tasks/start', expect.anything())
})

it.each(['missing', 'connection', 'model', 'context'])(
  'explains the %s saved brain prerequisite without admitting a task',
  async (invalid) => {
    readyTaskBots(undefined, {
      assignments:
        invalid === 'missing'
          ? []
          : [
              {
                workspace_id: 'one',
                connection: {
                  kind: 'endpoint',
                  api_base: invalid === 'connection' ? '' : 'http://host/v1',
                },
                model: invalid === 'model' ? ' ' : 'qwen',
                context_tokens: invalid === 'context' ? 0 : 262144,
                credential_ref: null,
              },
            ],
    })
    render(<Page />)
    await screen.findByRole('heading', { name: 'Writer' })
    fireEvent.change(screen.getByLabelText('Bot task'), {
      target: { value: 'Write a note' },
    })
    expect(
      screen.getByText(
        invalid === 'missing'
          ? 'Configure and save a brain above before running a task.'
          : 'The saved brain settings are incomplete or invalid. Edit the brain settings above and save a valid connection, model and context limit.'
      )
    ).toBeVisible()
    const run = screen.getByRole('button', { name: 'Run', exact: true })
    expect(run).toBeDisabled()
    fireEvent.click(run)
    expect(mocks.call).not.toHaveBeenCalledWith('tasks/start', expect.anything())
  }
)

it('explains unsaved brain changes while retaining the task draft', async () => {
  readyTaskBots()
  render(<Page />)
  await screen.findByRole('heading', { name: 'Writer' })
  fireEvent.change(screen.getByLabelText('Bot task'), {
    target: { value: 'Write a note' },
  })
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Run', exact: true })).toBeEnabled()
  )
  fireEvent.click(screen.getByRole('button', { name: 'Edit brain' }))
  fireEvent.change(screen.getByLabelText('Model ID'), {
    target: { value: 'muse' },
  })
  expect(
    screen.getByText('Save the brain settings above before running a task.')
  ).toBeVisible()
  expect(screen.getByLabelText('Bot task')).toHaveValue('Write a note')
  expect(screen.getByRole('button', { name: 'Run', exact: true })).toBeDisabled()
  expect(mocks.call).not.toHaveBeenCalledWith('tasks/start', expect.anything())
})

it.each([false, true])(
  'restores task readiness after Cancel edits (changed: %s)',
  async (changed) => {
    const [identity] = readyTaskBots()
    const call = mocks.call.getMockImplementation()!
    mocks.call.mockImplementation(
      async (path: string, body: Record<string, unknown>) =>
        path === 'tasks'
          ? [{ id: 'paused-task', identity, state: 'paused', messages: [] }]
          : call(path, body)
    )
    render(<Page />)
    await screen.findByRole('heading', { name: 'Writer' })
    fireEvent.change(screen.getByLabelText('Bot task'), {
      target: { value: 'Write a note' },
    })
    const run = screen.getByRole('button', { name: 'Run', exact: true })
    const resume = await screen.findByRole('button', {
      name: 'Resume',
      exact: true,
    })
    expect(run).toBeEnabled()
    expect(resume).toBeEnabled()

    fireEvent.click(screen.getByRole('button', { name: 'Edit brain' }))
    if (changed) {
      fireEvent.change(screen.getByLabelText('Model ID'), {
        target: { value: 'unsaved-model' },
      })
      expect(run).toBeDisabled()
      expect(resume).toBeDisabled()
    }
    fireEvent.click(screen.getByRole('button', { name: 'Cancel edits' }))
    expect(screen.getByText('Brain configured')).toBeVisible()
    expect(screen.getByLabelText('Bot task')).toHaveValue('Write a note')
    expect(run).toBeEnabled()
    expect(resume).toBeEnabled()
    expect(screen.getByText('Ready to run this task.')).toBeVisible()
    expect(mocks.call).not.toHaveBeenCalledWith(
      'assignments/save',
      expect.anything()
    )

    fireEvent.click(run)
    await waitFor(() =>
      expect(mocks.call).toHaveBeenCalledWith('tasks/start', {
        identity,
        prompt: 'Write a note',
      })
    )
  }
)

it.each([
  ['human', true],
  ['paused', true],
  ['human', false],
  ['paused', false],
] as const)(
  'explains %s control without offering another session’s hand-back (owned: %s)',
  async (state, owned) => {
    const owner = 'current-owner'
    localStorage.setItem('gbot-control-owner', owner)
    readyTaskBots(undefined, {
      controls: [
        {
          identity: { workspace_id: 'one', session_id: 'writer-session' },
          state,
          owner: owned ? owner : 'another-owner',
        },
      ],
    })
    render(<Page />)
    await screen.findByRole('heading', { name: 'Writer' })
    fireEvent.change(screen.getByLabelText('Bot task'), {
      target: { value: 'Write a note' },
    })
    const guidance = owned
      ? 'This bot is paused while you have control. Choose Hand back before running a task.'
      : 'This bot is paused under another session’s control. Its owner must hand back control before a task can run.'
    expect(screen.getByText(guidance)).toBeVisible()
    const handBack = screen.getByRole('button', { name: 'Hand back' })
    if (owned) expect(handBack).toBeEnabled()
    else {
      expect(handBack).toBeDisabled()
      expect(screen.queryByText(/Choose Hand back/)).not.toBeInTheDocument()
    }
    const run = screen.getByRole('button', { name: 'Run', exact: true })
    expect(run).toBeDisabled()
    fireEvent.click(run)
    expect(mocks.call).not.toHaveBeenCalledWith(
      'control/hand-back',
      expect.anything()
    )
    expect(mocks.call).not.toHaveBeenCalledWith('tasks/start', expect.anything())
  }
)

it('explains a task runner issue before suggesting brain or task changes', async () => {
  readyTaskBots(undefined, { assignments: [] })
  const call = mocks.call.getMockImplementation()!
  mocks.call.mockImplementation((path: string, body: Record<string, unknown>) =>
    path === 'tasks'
      ? Promise.reject(new Error('Task runner connection lost'))
      : call(path, body)
  )
  render(<Page />)
  await screen.findByText('Error: Task runner connection lost')
  expect(
    screen.getByText(
      'The task runner is unavailable. Resolve the task runner issue above before running a task.'
    )
  ).toBeVisible()
  expect(screen.getByRole('button', { name: 'Run', exact: true })).toBeDisabled()
  expect(mocks.call).not.toHaveBeenCalledWith('tasks/start', expect.anything())
})

it('explains empty, ready and busy task states without changing task submission', async () => {
  let finish!: () => void
  const pending = new Promise<void>((resolve) => {
    finish = resolve
  })
  const [identity] = readyTaskBots(() => pending)
  render(<Page />)
  await screen.findByRole('heading', { name: 'Writer' })
  expect(screen.getByText('Enter a task, then choose Run.')).toBeVisible()
  const run = screen.getByRole('button', { name: 'Run', exact: true })
  expect(run).toBeDisabled()
  fireEvent.change(screen.getByLabelText('Bot task'), {
    target: { value: 'Write a note' },
  })
  expect(screen.getByText('Ready to run this task.')).toBeVisible()
  expect(run).toBeEnabled()
  fireEvent.click(run)
  expect(screen.getByText('Sending this task to the bot…')).toHaveAttribute(
    'role',
    'status'
  )
  expect(
    screen.getByRole('button', { name: 'Sending…', exact: true })
  ).toBeVisible()
  expect(run).toBeDisabled()
  expect(mocks.call).toHaveBeenCalledWith('tasks/start', {
    identity,
    prompt: 'Write a note',
  })
  await act(async () => finish())
  await waitFor(() =>
    expect(screen.getByLabelText('Bot task')).toHaveValue('')
  )
  expect(await screen.findByText('Enter a task, then choose Run.')).toBeVisible()
})

it.each(['Error', 'native string'] as const)(
  'keeps a failed desktop recovery %s inline until its explicit retry succeeds',
  async (failureKind) => {
    const errorToast = vi.spyOn(toast, 'error').mockImplementation(() => 0)
    try {
      const owner = 'durable-current-owner'
      const previousOwner = 'previous-app-owner'
      localStorage.setItem('gbot-control-owner', owner)
      const [identity, other] = readyTaskBots()
      let session = identity
      let expectedOwner = previousOwner
      let recovered = false
      let accepted = false
      let fail!: (cause: unknown) => void
      let finish!: () => void
      let finishRefresh!: (state: BotState) => void
      const refreshedState = new Promise<BotState>((resolve) => { finishRefresh = resolve })
      const change = vi.fn()
        .mockImplementationOnce(() => new Promise<void>((_, reject) => { fail = reject }))
        .mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve }))
      const fallback = mocks.call.getMockImplementation()!
      const snapshot = async (): Promise<BotState> => {
        const control = { identity: session, owner: recovered ? owner : expectedOwner, state: 'paused' as const }
        return {
          ...await fallback('state', undefined) as BotState,
          live_sessions: [session, other],
          controls: [control],
          recoverable_controls: recovered ? [] : [control],
        }
      }
      mocks.call.mockImplementation(async (request: string, body: Record<string, unknown>) => {
        if (request === 'state') return accepted ? refreshedState : snapshot()
        if (request === 'control/recover') return change(body)
        return fallback(request, body)
      })
      const updates = new Set<() => void>()
      mocks.listen.mockImplementation(async (event: string, update: () => void) => {
        if (event === 'gbot-task-update') updates.add(update)
        return () => updates.delete(update)
      })
      render(<Page />)
      const recovery = await screen.findByRole('button', { name: 'Recover control' })
      expect(recovery.closest('fieldset')).toBeNull()
      fireEvent.click(recovery)
      fireEvent.click(screen.getByRole('button', { name: 'Cancel recovery' }))
      expect(change).not.toHaveBeenCalled()
      fireEvent.click(screen.getByRole('button', { name: 'Recover control' }))
      const confirm = screen.getByRole('button', { name: 'Confirm recovery' })
      const payload = { identity, expected_owner: previousOwner, owner }
      act(() => {
        confirm.dispatchEvent(new MouseEvent('click', { bubbles: true }))
        confirm.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      })
      expect(change).toHaveBeenCalledExactlyOnceWith(payload)
      expect(confirm).toBeDisabled()
      expect(screen.getByRole('button', { name: 'Cancel recovery' })).toBeDisabled()
      await act(async () => fail(failureKind === 'Error'
        ? new Error('Media close failed') : 'Media close failed'))
      const message = 'Could not recover control of this desktop. Try Confirm recovery again.'
      const alert = await screen.findByRole('alert')
      expect(within(alert).getByText(message)).toBeVisible()
      expect(within(alert).getByText('Details').closest('details')).not.toHaveAttribute('open')
      expect(within(alert).getByText('Media close failed')).not.toBeVisible()
      expect(confirm).toBeEnabled()
      expect(screen.getByText('Bot paused', { exact: true })).toBeVisible()
      expect(expectedOwner).toBe(previousOwner)
      expect(recovered).toBe(false)
      expect(errorToast).not.toHaveBeenCalled()

      const reads = mocks.call.mock.calls.filter(([request]) => request === 'tasks').length
      await act(async () => updates.forEach((update) => update()))
      expect(mocks.call.mock.calls.filter(([request]) => request === 'tasks').length).toBeGreaterThan(reads)
      expect(screen.getByRole('alert')).toHaveTextContent(message)
      expect(change).toHaveBeenCalledTimes(1)
      fireEvent.click(screen.getByRole('button', { name: 'Researcher' }))
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
      fireEvent.click(screen.getByRole('button', { name: 'Writer' }))
      expect(screen.getByRole('alert')).toHaveTextContent(message)
      session = { ...identity, session_id: 'replacement' }
      await act(async () => updates.forEach((update) => update()))
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
      session = identity
      await act(async () => updates.forEach((update) => update()))
      expect(screen.getByRole('alert')).toHaveTextContent(message)
      expectedOwner = 'another-previous-owner'
      await act(async () => updates.forEach((update) => update()))
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
      expectedOwner = previousOwner
      await act(async () => updates.forEach((update) => update()))
      expect(screen.getByRole('alert')).toHaveTextContent(message)
      mocks.getTarget.mockResolvedValue({ kind: 'paired_host', host_id: 'other-service' })
      await act(async () => updates.forEach((update) => update()))
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
      mocks.getTarget.mockResolvedValue({ kind: 'local' })
      await act(async () => updates.forEach((update) => update()))
      expect(screen.getByRole('alert')).toHaveTextContent(message)
      expect(change).toHaveBeenCalledTimes(1)

      const retry = screen.getByRole('button', { name: 'Confirm recovery' })
      fireEvent.click(retry)
      expect(change.mock.calls).toEqual([[payload], [payload]])
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
      expect(retry).toBeDisabled()
      expect(screen.getByText('Bot paused', { exact: true })).toBeVisible()
      recovered = true
      accepted = true
      await act(async () => finish())
      const pendingRefresh = screen.getByRole('button', { name: 'Recover control' })
      expect(pendingRefresh).toBeDisabled()
      fireEvent.click(pendingRefresh)
      expect(change).toHaveBeenCalledTimes(2)
      expect(screen.getByText('Bot paused', { exact: true })).toBeVisible()
      await act(async () => finishRefresh(await snapshot()))
      await waitFor(() => expect(screen.queryByRole('button', { name: 'Recover control' })).not.toBeInTheDocument())
      expect(screen.getByRole('button', { name: 'Hand back' })).toBeEnabled()
      expect(screen.getByText('Bot paused', { exact: true })).toBeVisible()
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
      expect(mocks.call.mock.calls.filter(([request]) =>
        request.startsWith('control/') || request.startsWith('view/') || request === 'connect' || request === 'disconnect' ||
        request === 'setup/local-vm/start' || (request.startsWith('tasks/') && request !== 'tasks/approvals')
      )).toEqual([['control/recover', payload], ['control/recover', payload]])
      expect(errorToast).not.toHaveBeenCalled()
    } finally {
      errorToast.mockRestore()
    }
  }
)

it('explicitly recovers an orphaned paused owner while keeping hand-back and setup resume separate', async () => {
  const identity = { workspace_id: 'orphaned-kvm', session_id: 'saved-session' }
  const owner = 'durable-current-owner'
  const previousOwner = 'previous-app-owner'
  localStorage.setItem('gbot-control-owner', owner)
  let control = {
    identity,
    owner: previousOwner as string | null,
    state: 'paused',
  }
  let recoverable = true
  let recoveries = 0
  let handBacks = 0
  const record: KvmSetupRecord = {
    id: identity.workspace_id,
    name: 'Writer',
    identity,
    stage: 'testing_desktop',
    issue: {
      code: 'guest_not_ready',
      message: 'Bot dispatch is paused for human control',
      next_action: 'Hand back control before resuming setup.',
    },
  }
  mocks.listen.mockResolvedValue(() => {})
  mocks.call.mockImplementation(async (path: string, body: unknown) => {
    if (path === 'state')
      return {
        workspaces: [
          {
            id: identity.workspace_id,
            name: 'Writer',
            bot_pc: { kind: 'local_vm', hypervisor: 'kvm' },
          },
        ],
        live_sessions: [identity],
        controls: [control],
        recoverable_controls: recoverable ? [control] : [],
        assignments: [],
      }
    if (path === 'setup/local-vm/status') return [record]
    if (path === 'setup/local-vm/preflight') return { ready: true, issues: [] }
    if (path === 'setup/local-vm/start') return record
    if (path === 'connectors/get') return { account_ids: [], accounts: [] }
    if (path === 'control/recover') {
      expect(body).toEqual({ identity, expected_owner: previousOwner, owner })
      if (++recoveries === 1) throw new Error('Media close failed')
      control = { identity, owner, state: 'paused' }
      recoverable = false
      return control
    }
    if (path === 'control/hand-back') {
      expect(body).toEqual({ identity, owner })
      if (++handBacks === 1) throw new Error('Fresh observation failed')
      control = { identity, owner: null, state: 'bot' }
      return control
    }
    return []
  })
  render(<Page />)
  const recover = await screen.findByRole('button', { name: 'Recover control' })
  expect(recover.closest('fieldset')).toBeNull()
  expect(screen.getByRole('button', { name: 'Disconnect' })).toBeDisabled()
  fireEvent.click(recover)
  fireEvent.click(screen.getByRole('button', { name: 'Cancel recovery' }))
  expect(recoveries).toBe(0)
  fireEvent.click(screen.getByRole('button', { name: 'Recover control' }))
  fireEvent.click(screen.getByRole('button', { name: 'Confirm recovery' }))
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'Confirm recovery' })
    ).toBeEnabled()
  )
  expect(control.owner).toBe(previousOwner)
  expect(control.state).toBe('paused')
  fireEvent.click(screen.getByRole('button', { name: 'Confirm recovery' }))
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Hand back' })).toBeEnabled()
  )
  expect(control.owner).toBe(owner)
  expect(control.state).toBe('paused')
  expect(
    screen.queryByRole('button', { name: 'Recover control' })
  ).not.toBeInTheDocument()
  expect(handBacks).toBe(0)
  expect(mocks.call).not.toHaveBeenCalledWith(
    'setup/local-vm/start',
    expect.anything()
  )
  fireEvent.click(screen.getByRole('button', { name: 'Hand back' }))
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Hand back' })).toBeEnabled()
  )
  expect(control.state).toBe('paused')
  fireEvent.click(screen.getByRole('button', { name: 'Hand back' }))
  await waitFor(() =>
    expect(
      screen.queryByRole('button', { name: 'Hand back' })
    ).not.toBeInTheDocument()
  )
  expect(control.state).toBe('bot')
  expect(screen.getByText('Setup incomplete')).toBeInTheDocument()
  expect(mocks.call).not.toHaveBeenCalledWith(
    'setup/local-vm/start',
    expect.anything()
  )
  for (const path of [
    'tasks/start',
    'tasks/resume',
    'connect',
    'disconnect',
    'view/open',
  ])
    expect(mocks.call).not.toHaveBeenCalledWith(path, expect.anything())
  fireEvent.click(screen.getByRole('button', { name: 'Resume setup' }))
  const wizard = await screen.findByRole('form', { name: 'Set up Gbot' })
  await waitFor(() =>
    expect(
      within(wizard).getByRole('button', { name: 'Resume setup' })
    ).toBeEnabled()
  )
  fireEvent.click(within(wizard).getByRole('button', { name: 'Resume setup' }))
  await waitFor(() =>
    expect(mocks.call).toHaveBeenCalledWith('setup/local-vm/start', {
      id: record.id,
      name: record.name,
    })
  )
})

it.each([
  'remote',
  'human',
  'current pause',
  'stale owner',
  'stale session',
  'same owner',
])('hides local-admin recovery for %s control', async (scenario) => {
  const identity = { workspace_id: 'writer', session_id: 'saved-session' }
  const owner = 'durable-owner'
  localStorage.setItem('gbot-control-owner', owner)
  if (scenario === 'remote')
    mocks.getTarget.mockResolvedValue({ kind: 'paired_host', host_id: 'host' })
  const control = {
    identity,
    owner: scenario === 'same owner' ? owner : 'previous-owner',
    state: scenario === 'human' ? 'human' : 'paused',
  }
  const candidate = {
    ...control,
    owner: scenario === 'stale owner' ? 'stale-owner' : control.owner,
    identity:
      scenario === 'stale session'
        ? { ...identity, session_id: 'stale-session' }
        : identity,
  }
  mocks.listen.mockResolvedValue(() => {})
  mocks.call.mockImplementation(async (path: string) => {
    if (path === 'connectors/get') return { account_ids: [], accounts: [] }
    return path === 'state'
      ? {
          workspaces: [{ id: identity.workspace_id, name: 'Writer' }],
          live_sessions: [identity],
          controls: [control],
          assignments: [],
          recoverable_controls: scenario === 'current pause' ? [] : [candidate],
        }
      : []
  })
  render(<Page />)
  await screen.findByRole('heading', { name: 'Writer' })
  await waitFor(() =>
    expect(mocks.call).toHaveBeenCalledWith('setup/local-vm/status', {})
  )
  expect(
    screen.queryByRole('button', { name: 'Recover control' })
  ).not.toBeInTheDocument()
  expect(mocks.call).not.toHaveBeenCalledWith(
    'control/recover',
    expect.anything()
  )
})

it('opens first-bot setup after opt-in and makes no service calls while disabled', async () => {
  useGeneralSetting.setState({ gbotEnabled: false })
  mocks.listen.mockResolvedValue(() => {})
  mocks.call.mockImplementation(async (path: string) =>
    path === 'state'
      ? { workspaces: [], live_sessions: [], assignments: [], controls: [] }
      : []
  )
  render(<Page />)
  expect(mocks.call).not.toHaveBeenCalled()
  expect(mocks.listen).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Enable Gbot' }))
  await screen.findByRole('form', { name: 'Set up Gbot' })
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
  expect(
    screen.queryByRole('form', { name: 'Set up Gbot' })
  ).not.toBeInTheDocument()
})

it('discovers a saved KVM setup without a workspace after remount and resumes only its identity', async () => {
  const record: KvmSetupRecord = {
    id: 'saved-local-computer',
    name: 'Saved researcher',
    stage: 'connecting',
    issue: {
      code: 'guest_not_ready',
      message: 'Guest setup is still connecting.',
      next_action: 'Repair the guest connection and resume this setup.',
    },
  }
  let prerequisitesReady = false
  mocks.listen.mockResolvedValue(() => {})
  mocks.call.mockImplementation(async (path: string) => {
    if (path === 'state')
      return {
        workspaces: [],
        live_sessions: [],
        assignments: [],
        controls: [],
      }
    if (path === 'setup/local-vm/status') return [record]
    if (path === 'setup/local-vm/preflight')
      return {
        ready: prerequisitesReady,
        issues: prerequisitesReady
          ? []
          : [
              {
                code: 'kvm_unavailable',
                message: 'KVM access is not ready.',
                next_action:
                  'Restore KVM access and check prerequisites again.',
              },
            ],
      }
    if (path === 'setup/local-vm/start') return record
    return []
  })
  const first = render(<Page />)
  await screen.findByRole('region', { name: 'Local setup Saved researcher' })
  expect(
    screen.queryByRole('form', { name: 'Set up Gbot' })
  ).not.toBeInTheDocument()
  first.unmount()

  render(<Page />)
  const card = await screen.findByRole('region', {
    name: 'Local setup Saved researcher',
  })
  expect(within(card).getByText('Computer connecting')).toBeInTheDocument()
  expect(within(card).getByText(record.issue!.message)).toBeInTheDocument()
  expect(within(card).getByText(record.issue!.next_action)).toBeInTheDocument()
  expect(screen.queryByLabelText('Bot name')).not.toBeInTheDocument()
  expect(mocks.call).not.toHaveBeenCalledWith(
    'setup/local-vm/start',
    expect.anything()
  )

  fireEvent.click(within(card).getByRole('button', { name: 'Resume setup' }))
  const wizard = await screen.findByRole('form', { name: 'Set up Gbot' })
  expect(within(wizard).queryByLabelText('Bot name')).not.toBeInTheDocument()
  expect(
    within(wizard).queryByRole('button', { name: /Create .*computer/ })
  ).not.toBeInTheDocument()
  await screen.findByText('KVM access is not ready.')
  expect(
    within(wizard).getByRole('button', { name: 'Resume setup' })
  ).toBeDisabled()
  fireEvent.click(within(wizard).getByRole('button', { name: 'Resume setup' }))
  expect(mocks.call).not.toHaveBeenCalledWith(
    'setup/local-vm/start',
    expect.anything()
  )

  prerequisitesReady = true
  fireEvent.click(
    within(wizard).getByRole('button', { name: 'Check prerequisites again' })
  )
  await waitFor(() =>
    expect(
      within(wizard).getByRole('button', { name: 'Resume setup' })
    ).toBeEnabled()
  )
  expect(mocks.call).not.toHaveBeenCalledWith(
    'setup/local-vm/start',
    expect.anything()
  )
  fireEvent.click(within(wizard).getByRole('button', { name: 'Resume setup' }))
  await waitFor(() =>
    expect(mocks.call).toHaveBeenCalledWith('setup/local-vm/start', {
      id: record.id,
      name: record.name,
    })
  )
  expect(
    mocks.call.mock.calls.filter(([path]) => path === 'setup/local-vm/start')
  ).toHaveLength(1)
  expect(
    within(wizard).queryByRole('button', { name: 'Use this computer' })
  ).not.toBeInTheDocument()
  for (const path of [
    'workspaces',
    'workspaces/ssh',
    'connect',
    'tasks/start',
    'tasks/resume',
    'view/open',
  ])
    expect(mocks.call).not.toHaveBeenCalledWith(path, expect.anything())
})

it('does not offer removed KVM setups and permits first-bot setup', async () => {
  mocks.listen.mockResolvedValue(() => {})
  mocks.call.mockImplementation(async (path: string) => {
    if (path === 'state')
      return {
        workspaces: [],
        live_sessions: [],
        assignments: [],
        controls: [],
      }
    if (path === 'setup/local-vm/status')
      return [
        {
          id: 'removed-local',
          name: 'Removed researcher',
          stage: 'removed',
          issue: null,
        },
      ]
    return []
  })
  render(<Page />)
  await screen.findByLabelText('Bot name')
  expect(
    screen.queryByRole('region', { name: 'Local setup Removed researcher' })
  ).not.toBeInTheDocument()
  expect(
    screen.queryByRole('button', { name: 'Resume setup' })
  ).not.toBeInTheDocument()
  expect(mocks.call).not.toHaveBeenCalledWith(
    'setup/local-vm/start',
    expect.anything()
  )
})

it('retains a KVM status error instead of assuming no saved setup and discovers it on retry', async () => {
  let unavailable = true
  mocks.listen.mockResolvedValue(() => {})
  mocks.call.mockImplementation(async (path: string) => {
    if (path === 'state')
      return {
        workspaces: [],
        live_sessions: [],
        assignments: [],
        controls: [],
      }
    if (path === 'setup/local-vm/status') {
      if (unavailable) throw new Error('Saved setup status could not be read')
      return [
        {
          id: 'saved-local',
          name: 'Recovered researcher',
          stage: 'connecting',
          issue: null,
        },
      ]
    }
    return []
  })
  render(<Page />)
  await screen.findByText('Error: Saved setup status could not be read')
  expect(
    screen.queryByRole('form', { name: 'Set up Gbot' })
  ).not.toBeInTheDocument()
  unavailable = false
  fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
  await screen.findByRole('region', {
    name: 'Local setup Recovered researcher',
  })
  expect(
    screen.queryByRole('form', { name: 'Set up Gbot' })
  ).not.toBeInTheDocument()
  expect(
    screen.queryByText('Error: Saved setup status could not be read')
  ).not.toBeInTheDocument()
})

it('resumes a saved cloud price review without creating a workspace or offering first setup', async () => {
  mocks.listen.mockResolvedValue(() => {})
  const now = Math.floor(Date.now() / 1000)
  mocks.call.mockImplementation(async (path: string) => {
    if (path === 'state')
      return {
        workspaces: [],
        live_sessions: [],
        assignments: [],
        controls: [],
      }
    if (path === 'setup/cloud/status')
      return [
        {
          id: 'saved-review',
          name: 'Cloud researcher',
          provider: 'hetzner',
          fetched_at: now,
          expires_at: now + 900,
          confirmed: false,
          quote: null,
          catalog: { currency: 'EUR', tax: 'VAT', regions: [], plans: [] },
        },
      ]
    return []
  })
  render(<Page />)
  await screen.findByRole('region', { name: 'Cloud setup Cloud researcher' })
  expect(
    screen.queryByRole('form', { name: 'Set up Gbot' })
  ).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Resume setup' }))
  expect(
    await screen.findByRole('region', { name: 'Cloud cost review' })
  ).toBeInTheDocument()
  expect(screen.getByLabelText('Provider API token (access key)')).toHaveValue('')
  expect(
    mocks.call.mock.calls.some(
      ([path]) => path === 'workspaces/ssh' || path === 'workspaces'
    )
  ).toBe(false)
})

function savedCloudSetup(remove: () => Promise<void> = async () => {}) {
  let saved = true
  mocks.listen.mockResolvedValue(() => {})
  mocks.call.mockImplementation(async (path: string) => {
    if (path === 'state')
      return { workspaces: [], live_sessions: [], assignments: [], controls: [] }
    if (path === 'setup/cloud/status')
      return saved
        ? [
            {
              id: 'saved-review',
              name: 'Cloud researcher',
              provider: 'hetzner',
              fetched_at: 1,
              expires_at: 2,
              confirmed: false,
              quote: null,
              catalog: { currency: 'EUR', tax: 'VAT', regions: [], plans: [] },
            },
          ]
        : []
    if (path === 'setup/cloud/remove') {
      await remove()
      saved = false
    }
    return []
  })
}

it('explains saved cloud setup credential removal and defaults to cancellation', async () => {
  savedCloudSetup()
  render(
    <>
      <Page />
      <ConfirmDialogHost />
    </>
  )
  const card = await screen.findByRole('region', {
    name: 'Cloud setup Cloud researcher',
  })
  fireEvent.click(
    within(card).getByRole('button', { name: /^Remove saved (review|setup)$/ })
  )
  expect(
    mocks.call.mock.calls.filter(([path]) => path === 'setup/cloud/remove')
  ).toHaveLength(0)
  const dialog = await screen.findByRole('dialog', {
    name: 'Remove Cloud researcher’s saved cloud setup?',
  })
  expect(dialog).toHaveTextContent(
    'its cloud provider access key and any saved SSH connection key'
  )
  expect(dialog).toHaveTextContent('enter your access key again to restart setup')
  expect(within(dialog).getByRole('button', { name: 'Cancel' })).toHaveFocus()
  fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(card).toBeInTheDocument()
  expect(
    mocks.call.mock.calls.filter(([path]) => path === 'setup/cloud/remove')
  ).toHaveLength(0)
})

it('removes only the confirmed cloud setup and holds its control until completion', async () => {
  let finish!: () => void
  savedCloudSetup(
    () => new Promise<void>((resolve) => {
      finish = resolve
    })
  )
  render(
    <>
      <Page />
      <ConfirmDialogHost />
    </>
  )
  const card = await screen.findByRole('region', {
    name: 'Cloud setup Cloud researcher',
  })
  const remove = within(card).getByRole('button', {
    name: /^Remove saved (review|setup)$/,
  })
  fireEvent.click(remove)
  const dialog = await screen.findByRole('dialog')
  fireEvent.click(
    within(dialog).getByRole('button', { name: 'Remove saved setup' })
  )
  await waitFor(() => expect(remove).toBeDisabled())
  fireEvent.click(remove)
  expect(
    mocks.call.mock.calls.filter(([path]) => path === 'setup/cloud/remove')
  ).toEqual([
    ['setup/cloud/remove', { id: 'saved-review' }],
  ])
  await act(async () => finish())
  await waitFor(() => expect(card).not.toBeInTheDocument())
})

it('keeps a rejected cloud setup removal available for an explicitly confirmed retry', async () => {
  const errorToast = vi.spyOn(toast, 'error').mockImplementation(() => 0)
  try {
    let attempts = 0
    savedCloudSetup(async () => {
      if (++attempts === 1) throw new Error('Saved setup could not be removed')
    })
    render(
      <>
        <Page />
        <ConfirmDialogHost />
      </>
    )
    const card = await screen.findByRole('region', {
      name: 'Cloud setup Cloud researcher',
    })
    const remove = within(card).getByRole('button', {
      name: /^Remove saved (review|setup)$/,
    })
    fireEvent.click(remove)
    fireEvent.click(
      within(await screen.findByRole('dialog')).getByRole('button', {
        name: 'Remove saved setup',
      })
    )
    await waitFor(() =>
      expect(errorToast).toHaveBeenCalledWith('Error: Saved setup could not be removed')
    )
    await waitFor(() => expect(remove).toBeEnabled())
    expect(card).toBeInTheDocument()
    fireEvent.click(remove)
    expect(attempts).toBe(1)
    fireEvent.click(
      within(await screen.findByRole('dialog')).getByRole('button', {
        name: 'Remove saved setup',
      })
    )
    await waitFor(() => expect(card).not.toBeInTheDocument())
    expect(attempts).toBe(2)
  } finally {
    errorToast.mockRestore()
  }
})

it('does not remove a saved cloud setup after leaving its page during confirmation', async () => {
  savedCloudSetup()
  const page = render(
    <>
      <Page />
      <ConfirmDialogHost />
    </>
  )
  const card = await screen.findByRole('region', {
    name: 'Cloud setup Cloud researcher',
  })
  fireEvent.click(
    within(card).getByRole('button', { name: /^Remove saved (review|setup)$/ })
  )
  await screen.findByRole('dialog')
  page.unmount()
  await act(async () => settleConfirm(true))
  expect(
    mocks.call.mock.calls.filter(([path]) => path === 'setup/cloud/remove')
  ).toHaveLength(0)
})

it('resumes saved M365 prerequisites without presenting a connected bot workspace', async () => {
  const user = userEvent.setup()
  mocks.listen.mockResolvedValue(() => {})
  const record = {
    id: 'm365-setup',
    name: 'Cloud PC researcher',
    account_id: 'selected-work-account',
    cloud_pc: {
      id: 'selected-cloud-pc',
      display_name: 'Dedicated PC',
      image_name: 'Windows 11',
      plan_name: '2 vCPU',
    },
    route: 'guest_worker',
  }
  mocks.call.mockImplementation(async (path: string) => {
    if (path === 'state')
      return {
        workspaces: [],
        live_sessions: [],
        assignments: [],
        controls: [],
      }
    if (path === 'setup/m365/status') return [record]
    return []
  })
  vi.mocked(connectorAccounts).mockResolvedValue({
    configs: [],
    accounts: [],
    active_flows: [],
    selected_accounts: {},
    services: { google: [], microsoft: [] },
  })
  render(<Page />)
  const card = await screen.findByRole('region', {
    name: 'M365 setup Cloud PC researcher',
  })
  expect(
    within(card).getByText('Setup saved · Desktop control is not connected yet')
  ).toBeInTheDocument()
  expect(
    screen.queryByRole('form', { name: 'Set up Gbot' })
  ).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Run' })).not.toBeInTheDocument()
  await user.click(
    within(card).getByRole('button', { name: 'Resume Cloud PC setup' })
  )
  await screen.findByRole('region', { name: 'M365 Cloud PC setup' })
  expect(
    screen.getByText('Step 4 · Prepare your Cloud PC connection')
  ).toBeInTheDocument()
  const accountPicker = await screen.findByRole('button', {
    name: 'Microsoft account',
  })
  expect(accountPicker).toHaveTextContent('Disconnected saved account')
  await user.click(accountPicker)
  expect(
    screen.getByRole('menuitemradio', { name: 'Disconnected saved account' })
  ).toHaveAttribute('aria-checked', 'true')
  await user.keyboard('{Escape}')
  expect(
    screen.getByLabelText('Worker in the Cloud PC user session')
  ).toBeChecked()
  expect(
    screen.getByRole('button', { name: 'Save Cloud PC setup' })
  ).toBeDisabled()
  expect(
    mocks.call.mock.calls.every(
      ([path]) =>
        ![
          'connect',
          'workspaces',
          'workspaces/ssh',
          'setup/m365/assigned',
        ].includes(path)
    )
  ).toBe(true)
})

function savedM365Setups(remove: (id: string) => Promise<void> = async () => {}) {
  mocks.listen.mockResolvedValue(() => {})
  let records = [
    {
      id: 'm365-setup',
      name: 'Cloud PC researcher',
      account_id: 'work-account',
      cloud_pc: {
        id: 'cloud-pc',
        display_name: 'Dedicated PC',
        image_name: 'Windows 11',
        plan_name: '2 vCPU',
      },
      route: 'brokered_client',
    },
    {
      id: 'other-m365-setup',
      name: 'Cloud PC writer',
      account_id: 'other-work-account',
      cloud_pc: {
        id: 'other-cloud-pc',
        display_name: 'Writer PC',
        image_name: 'Windows 11',
        plan_name: '2 vCPU',
      },
      route: 'guest_worker',
    },
  ]
  mocks.call.mockImplementation(async (path: string, body: { id: string }) => {
    if (path === 'state')
      return { workspaces: [], live_sessions: [], assignments: [], controls: [] }
    if (path === 'setup/m365/status') return records
    if (path === 'setup/m365/remove') {
      await remove(body.id)
      records = records.filter((record) => record.id !== body.id)
      return {}
    }
    return []
  })
}

it('removes only the confirmed saved M365 setup and defaults to keyboard cancellation', async () => {
  const user = userEvent.setup()
  let finish!: () => void
  savedM365Setups(() => new Promise<void>((resolve) => {
    finish = resolve
  }))
  render(<><Page /><ConfirmDialogHost /></>)
  const card = await screen.findByRole('region', {
    name: 'M365 setup Cloud PC researcher',
  })
  const other = screen.getByRole('region', { name: 'M365 setup Cloud PC writer' })
  expect(within(card).getByText(/Removing it keeps your Microsoft account and Cloud PC/)).toBeVisible()
  const remove = within(card).getByRole('button', { name: 'Remove saved Cloud PC setup' })
  fireEvent.click(remove)
  const dialog = await screen.findByRole('dialog', {
    name: 'Remove Cloud PC researcher’s saved Cloud PC setup?',
  })
  expect(dialog).toHaveTextContent('This removes this saved setup from GChat. Your Microsoft account and Cloud PC are kept. You’ll need to choose them again to restart setup.')
  expect(within(dialog).getByRole('button', { name: 'Cancel' })).toHaveFocus()
  expect(mocks.call.mock.calls.filter(([path]) => path === 'setup/m365/remove')).toEqual([])
  await user.keyboard('{Enter}')
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(card).toBeVisible()
  expect(other).toBeVisible()
  expect(mocks.call.mock.calls.filter(([path]) => path === 'setup/m365/remove')).toEqual([])
  fireEvent.click(remove)
  fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', {
    name: 'Remove saved Cloud PC setup',
  }))
  await waitFor(() => expect(remove).toBeDisabled())
  fireEvent.click(remove)
  expect(mocks.call.mock.calls.filter(([path]) => path === 'setup/m365/remove')).toEqual([
    ['setup/m365/remove', { id: 'm365-setup' }],
  ])
  expect(card).toBeInTheDocument()
  expect(other).toBeInTheDocument()
  await act(async () => finish())
  await waitFor(() => expect(card).not.toBeInTheDocument())
  expect(other).toBeVisible()
  expect(mocks.call.mock.calls.filter(([path]) => ![
    'state', 'setup/cloud/status', 'setup/m365/status', 'setup/local-vm/status',
    'tasks', 'tasks/approvals',
  ].includes(path))).toEqual([
    ['setup/m365/remove', { id: 'm365-setup' }],
  ])
})

it('keeps a rejected saved M365 setup removal available for an explicitly confirmed retry', async () => {
  const errorToast = vi.spyOn(toast, 'error').mockImplementation(() => 0)
  try {
    let attempts = 0
    let fail!: (cause: Error) => void
    savedM365Setups(() => ++attempts === 1
      ? new Promise<void>((_, reject) => { fail = reject })
      : Promise.resolve())
    render(<><Page /><ConfirmDialogHost /></>)
    const card = await screen.findByRole('region', {
      name: 'M365 setup Cloud PC researcher',
    })
    const other = screen.getByRole('region', { name: 'M365 setup Cloud PC writer' })
    const remove = within(card).getByRole('button', { name: 'Remove saved Cloud PC setup' })
    fireEvent.click(remove)
    expect(attempts).toBe(0)
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', {
      name: 'Remove saved Cloud PC setup',
    }))
    await waitFor(() => expect(remove).toBeDisabled())
    await act(async () => fail(new Error('Saved Cloud PC setup could not be removed')))
    await waitFor(() => expect(errorToast).toHaveBeenCalledWith('Error: Saved Cloud PC setup could not be removed'))
    await waitFor(() => expect(remove).toBeEnabled())
    expect(card).toBeVisible()
    expect(other).toBeVisible()
    fireEvent.click(remove)
    expect(attempts).toBe(1)
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', {
      name: 'Remove saved Cloud PC setup',
    }))
    await waitFor(() => expect(card).not.toBeInTheDocument())
    expect(other).toBeVisible()
    expect(mocks.call.mock.calls.filter(([path]) => path === 'setup/m365/remove')).toEqual([
      ['setup/m365/remove', { id: 'm365-setup' }],
      ['setup/m365/remove', { id: 'm365-setup' }],
    ])
  } finally {
    errorToast.mockRestore()
  }
})

it('does not remove a saved M365 setup after leaving its page during confirmation', async () => {
  savedM365Setups()
  const page = render(<><Page /><ConfirmDialogHost /></>)
  const card = await screen.findByRole('region', {
    name: 'M365 setup Cloud PC researcher',
  })
  fireEvent.click(within(card).getByRole('button', { name: 'Remove saved Cloud PC setup' }))
  await screen.findByRole('dialog')
  page.unmount()
  await act(async () => settleConfirm(true))
  expect(mocks.call.mock.calls.filter(([path]) => path === 'setup/m365/remove')).toEqual([])
})

it('imports an SSH workspace and preserves setup identity on retry', async () => {
  const workspaces: { id: string; name: string }[] = []
  let attempt = 0
  mocks.listen.mockResolvedValue(() => {})
  mocks.call.mockImplementation(
    async (path: string, body: Record<string, unknown>) => {
      if (path === 'connectors/get') return { account_ids: [], accounts: [] }
      if (path === 'state')
        return { workspaces, live_sessions: [], assignments: [], controls: [] }
      if (path === 'workspaces/ssh/key')
        return { algorithm: 'ssh-ed25519', public_key: 'bot-key' }
      if (path === 'workspaces/ssh') {
        if (++attempt === 1) throw new Error('Workspace could not be saved')
        workspaces.push({ id: body.id as string, name: body.name as string })
        return workspaces[0]
      }
      return []
    }
  )
  render(<Page />)
  await screen.findByRole('form', { name: 'Set up Gbot' })
  fireEvent.change(screen.getByLabelText('Bot name'), {
    target: { value: 'Writer' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
  await screen.findByRole('group', {
    name: 'Where should the Gbot service run?',
  })
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Continue' })).toBeEnabled()
  )
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
  fireEvent.click(await screen.findByLabelText(/Another computer on the LAN/))
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
  fireEvent.click(screen.getByLabelText('Use an existing SSH key (advanced)'))
  for (const [label, value] of [
    ['SSH host', 'bot.local'],
    ['SSH user', 'bot'],
    ['SSH host public key', 'ssh-ed25519 pinned-key'],
    ['SSH private key', 'private-key'],
    ['Key passphrase', 'key-passphrase'],
  ])
    fireEvent.change(screen.getByLabelText(label), { target: { value } })
  fireEvent.click(screen.getByRole('button', { name: 'Import bot key' }))
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Workspace could not be saved'
  )
  fireEvent.click(screen.getByRole('button', { name: 'Import bot key' }))
  await screen.findByRole('button', { name: 'Check SSH access' })
  const creates = mocks.call.mock.calls.filter(
    ([path]) => path === 'workspaces/ssh'
  )
  expect(creates).toHaveLength(2)
  expect(creates[1][1]).toEqual(creates[0][1])
  expect(creates[0][1]).toEqual({
    id: expect.any(String),
    name: 'Writer',
    service_pc: { kind: 'local' },
    bot_pc: { kind: 'lan', computer_id: expect.any(String) },
    endpoint: { hostname: 'bot.local', port: 22, user: 'bot' },
    pinned_host_key: { algorithm: 'ssh-ed25519', public_key: 'pinned-key' },
    private_key: 'private-key',
    passphrase: 'key-passphrase',
  })
  expect(mocks.call).not.toHaveBeenCalledWith(
    'credentials/ssh',
    expect.anything()
  )
  expect(mocks.call).not.toHaveBeenCalledWith('workspaces', expect.anything())
  expect(JSON.stringify(sessionStorage)).not.toContain('private-key')
})

it.each([
  ['Connect', 'connect', 'Could not connect this bot’s computer. Try Connect again.'],
  ['Disconnect', 'disconnect', 'Could not disconnect this bot’s computer. Try Disconnect again.'],
] as const)(
  'keeps a failed computer connection %s inline and retries its original bot',
  async (action, path, message) => {
    const errorToast = vi.spyOn(toast, 'error').mockImplementation(() => 0)
    try {
      const [identity, other] = readyTaskBots()
      let connected = action === 'Disconnect'
      let session = identity
      let fail!: (cause: unknown) => void
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
      mocks.call.mockImplementation(async (request: string, body: Record<string, unknown>) => {
        if (request === 'state') return {
          ...await fallback(request, body) as BotState,
          live_sessions: connected ? [session, other] : [other],
        }
        if (request === path) return change(body)
        return fallback(request, body)
      })
      const updates = new Set<() => void>()
      mocks.listen.mockImplementation(async (event: string, update: () => void) => {
        if (event === 'gbot-task-update') updates.add(update)
        return () => updates.delete(update)
      })
      render(<Page />)
      await screen.findByRole('heading', { name: 'Writer' })
      const originalStatus = connected ? 'Connected' : 'Disconnected'
      const button = screen.getByRole('button', { name: action, exact: true })
      act(() => {
        button.dispatchEvent(new MouseEvent('click', { bubbles: true }))
        button.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      })
      expect(change).toHaveBeenCalledTimes(1)
      const firstPayload = change.mock.calls[0][0]
      expect(firstPayload).toEqual(action === 'Disconnect' ? identity : {
        workspace_id: identity.workspace_id, session_id: expect.any(String),
      })
      expect(button).toBeDisabled()
      expect(screen.getByText(originalStatus, { exact: true })).toBeVisible()
      await act(async () => fail(action === 'Connect'
        ? new Error('Computer connection unavailable')
        : 'Computer connection unavailable'))
      const alert = await screen.findByRole('alert')
      expect(within(alert).getByText(message)).toBeVisible()
      expect(within(alert).getByText('Details').closest('details')).not.toHaveAttribute('open')
      expect(within(alert).getByText('Computer connection unavailable')).not.toBeVisible()
      expect(button).toBeEnabled()
      expect(screen.getByText(originalStatus, { exact: true })).toBeVisible()
      expect(errorToast).not.toHaveBeenCalled()

      const reads = mocks.call.mock.calls.filter(([request]) => request === 'tasks').length
      await act(async () => updates.forEach((update) => update()))
      expect(mocks.call.mock.calls.filter(([request]) => request === 'tasks').length).toBeGreaterThan(reads)
      expect(screen.getByRole('alert')).toHaveTextContent(message)
      expect(change).toHaveBeenCalledTimes(1)
      fireEvent.click(screen.getByRole('button', { name: 'Researcher' }))
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
      fireEvent.click(screen.getByRole('button', { name: 'Writer' }))
      expect(screen.getByRole('alert')).toHaveTextContent(message)
      if (action === 'Disconnect') {
        session = { ...identity, session_id: 'replacement' }
        await act(async () => updates.forEach((update) => update()))
        expect(screen.queryByRole('alert')).not.toBeInTheDocument()
        session = identity
        await act(async () => updates.forEach((update) => update()))
        expect(screen.getByRole('alert')).toHaveTextContent(message)
      }
      mocks.getTarget.mockResolvedValue({ kind: 'paired_host', host_id: 'other-service' })
      await act(async () => updates.forEach((update) => update()))
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
      mocks.getTarget.mockResolvedValue({ kind: 'local' })
      await act(async () => updates.forEach((update) => update()))
      expect(screen.getByRole('alert')).toHaveTextContent(message)
      expect(change).toHaveBeenCalledTimes(1)

      const retry = screen.getByRole('button', { name: action, exact: true })
      fireEvent.click(retry)
      expect(change).toHaveBeenCalledTimes(2)
      const retryPayload = change.mock.calls[1][0]
      expect(retryPayload).toEqual(action === 'Disconnect' ? identity : {
        workspace_id: identity.workspace_id, session_id: expect.any(String),
      })
      if (action === 'Connect') {
        expect(retryPayload.session_id).not.toBe(firstPayload.session_id)
      }
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
      expect(retry).toBeDisabled()
      expect(screen.getByText(originalStatus, { exact: true })).toBeVisible()
      connected = !connected
      if (action === 'Connect') session = retryPayload
      await act(async () => finish())
      expect(await screen.findByRole('button', {
        name: connected ? 'Disconnect' : 'Connect', exact: true,
      })).toBeEnabled()
      expect(screen.getByText(connected ? 'Connected' : 'Disconnected', { exact: true })).toBeVisible()
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
      expect(mocks.call.mock.calls.filter(([request]) =>
        request === 'connect' || request === 'disconnect' || request.startsWith('control/') ||
        (request.startsWith('tasks/') && request !== 'tasks/approvals')
      )).toEqual([[path, firstPayload], [path, retryPayload]])
      expect(errorToast).not.toHaveBeenCalled()
    } finally {
      errorToast.mockRestore()
    }
  }
)

it.each([false, true])(
  'holds connection controls through the status refresh (initially connected: %s)',
  async (initiallyConnected) => {
    let identity = initiallyConnected
      ? { workspace_id: 'one', session_id: 'saved-session' }
      : undefined
    let actionFinished = false
    let finishRefresh!: (state: BotState) => void
    const refreshedState = new Promise<BotState>((resolve) => {
      finishRefresh = resolve
    })
    const snapshot = (): BotState => ({
      workspaces: [{ id: 'one', name: 'Writer' }],
      live_sessions: identity ? [identity] : [],
      controls: [],
      assignments: [],
    })
    const action = initiallyConnected ? 'disconnect' : 'connect'
    mocks.listen.mockResolvedValue(() => {})
    mocks.call.mockImplementation(
      async (path: string, body: Record<string, string>) => {
        if (path === 'connectors/get') return { account_ids: [], accounts: [] }
        if (path === 'state')
          return actionFinished ? refreshedState : snapshot()
        if (path === action) {
          identity = initiallyConnected
            ? undefined
            : { workspace_id: body.workspace_id, session_id: body.session_id }
          actionFinished = true
          return {}
        }
        return []
      }
    )
    render(<Page />)
    await waitFor(() =>
      expect(mocks.call).toHaveBeenCalledWith('tasks', undefined)
    )
    const button = screen.getByRole('button', {
      name: initiallyConnected ? 'Disconnect' : 'Connect',
      exact: true,
    })
    expect(button).toBeEnabled()
    fireEvent.click(button)
    await waitFor(() =>
      expect(
        mocks.call.mock.calls.filter(([path]) => path === 'state')
      ).toHaveLength(2)
    )

    expect(
      screen.getByText(initiallyConnected ? 'Connected' : 'Disconnected')
    ).toBeVisible()
    fireEvent.click(button)
    expect(
      mocks.call.mock.calls.filter(([path]) => path === action)
    ).toHaveLength(1)
    expect(button).toBeDisabled()

    await act(async () => finishRefresh(snapshot()))
    await waitFor(() =>
      expect(
        screen.getByRole('button', {
          name: initiallyConnected ? 'Connect' : 'Disconnect',
          exact: true,
        })
      ).toBeEnabled()
    )
    expect(
      mocks.call.mock.calls.filter(([path]) => path === action)
    ).toHaveLength(1)
  }
)

it('isolates bot assignments and approvals, and holds new tasks during takeover', async () => {
  const identity = { workspace_id: 'one', session_id: 'session' }
  let control = 'bot'
  let assignments: unknown[] = []
  mocks.listen.mockResolvedValue(() => {})
  mocks.call.mockImplementation(
    async (path: string, body: Record<string, unknown>) => {
      if (path === 'connectors/get') return { account_ids: [], accounts: [] }
      if (path === 'state')
        return {
          workspaces: [
            { id: 'one', name: 'Writer' },
            { id: 'two', name: 'Researcher' },
          ],
          live_sessions: [identity],
          assignments,
          controls: [
            {
              identity,
              owner:
                control === 'bot'
                  ? null
                  : sessionStorage.getItem('gbot-control-owner'),
              state: control,
            },
          ],
        }
      if (path === 'tasks')
        return [
          {
            id: 'task',
            identity,
            state: 'paused',
            messages: [{ role: 'assistant', content: 'Saved result' }],
          },
        ]
      if (path === 'tasks/approvals')
        return [
          {
            id: 'approval',
            task_id: 'task',
            request: { operation: { kind: 'desktop_input' } },
          },
          {
            id: 'foreign',
            task_id: 'other-bot-task',
            request: { operation: { kind: 'file_remove' } },
          },
        ]
      if (path === 'assignments/save') {
        const { api_key: _secret, ...config } = body
        assignments = [{ ...config, credential_ref: 'vault-key' }]
      }
      if (path === 'control/take-over') control = 'human'
      return {}
    }
  )
  render(<Page />)
  await screen.findByText('Saved result')
  expect(screen.queryByText(/file_remove/)).not.toBeInTheDocument()
  fireEvent.click(screen.getByLabelText('API endpoint'))
  fireEvent.change(screen.getByLabelText('GInfer API URL'), {
    target: { value: 'http://host/v1' },
  })
  fireEvent.change(screen.getByLabelText('Model ID'), {
    target: { value: 'qwen' },
  })
  fireEvent.change(screen.getByLabelText('Model context tokens'), {
    target: { value: '262144' },
  })
  fireEvent.change(screen.getByLabelText('API key'), {
    target: { value: 'bot-secret' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Researcher' }))
  fireEvent.click(screen.getByLabelText('API endpoint'))
  expect(screen.getByLabelText('API key')).toHaveValue('')
  expect(screen.getByLabelText('Model ID')).toHaveValue('')
  expect(screen.queryByText('Saved result')).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Writer' }))
  expect(screen.getByLabelText('API key')).toHaveValue('bot-secret')
  fireEvent.click(screen.getByRole('button', { name: 'Save brain settings' }))
  await screen.findByText('Brain configured')
  fireEvent.click(screen.getByRole('button', { name: 'Edit brain' }))
  expect(screen.getByLabelText('API key')).toHaveValue('')
  expect(screen.getByLabelText('API key')).toHaveAttribute(
    'placeholder',
    'Saved in secure storage'
  )
  expect(screen.getByLabelText('Model ID')).toHaveValue('qwen')
  cleanup()
  render(<Page />)
  await screen.findByText('Saved result')
  fireEvent.click(screen.getByRole('button', { name: 'Edit brain' }))
  expect(screen.getByLabelText('Model ID')).toHaveValue('qwen')
  expect(screen.getByLabelText('API key')).toHaveValue('')
  fireEvent.change(screen.getByLabelText('Model ID'), {
    target: { value: 'muse' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Save brain settings' }))
  await waitFor(() =>
    expect(mocks.call).toHaveBeenCalledWith('assignments/save', {
      workspace_id: 'one',
      connection: { kind: 'endpoint', api_base: 'http://host/v1' },
      model: 'muse',
      context_tokens: 262144,
      api_key: undefined,
    })
  )
  await screen.findByText('Brain configured')
  fireEvent.click(screen.getByRole('button', { name: 'Allow', exact: true }))
  await waitFor(() =>
    expect(mocks.call).toHaveBeenCalledWith('tasks/approval', {
      id: 'approval',
      allow: true,
    })
  )
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Take over' })).toBeEnabled()
  )
  fireEvent.click(screen.getByRole('button', { name: 'Take over' }))
  await screen.findByText('Bot paused · you have control')
  fireEvent.change(screen.getByLabelText('Bot task'), {
    target: { value: 'Next task' },
  })
  expect(
    screen.getByRole('button', { name: 'Run', exact: true })
  ).toBeDisabled()
  expect(
    screen.getByRole('button', { name: 'Resume', exact: true })
  ).toBeDisabled()
  expect(sessionStorage.getItem('gbot-control-owner')).toBeTruthy()
  expect(JSON.stringify(sessionStorage)).not.toContain('bot-secret')
})

it('keeps separate bot task drafts and submits each to its own ready bot', async () => {
  const identities = readyTaskBots()
  render(<Page />)
  await screen.findByRole('heading', { name: 'Writer' })
  fireEvent.change(screen.getByLabelText('Bot task'), {
    target: { value: 'Write a note' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Researcher' }))
  expect(screen.getByLabelText('Bot task')).toHaveValue('')
  fireEvent.change(screen.getByLabelText('Bot task'), {
    target: { value: 'Find sources' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Writer' }))
  expect(screen.getByLabelText('Bot task')).toHaveValue('Write a note')
  fireEvent.click(screen.getByRole('button', { name: 'Run', exact: true }))
  await waitFor(() => {
    expect(mocks.call).toHaveBeenCalledWith('tasks/start', {
      identity: identities[0],
      prompt: 'Write a note',
    })
    expect(screen.getByLabelText('Bot task')).toHaveValue('')
  })
  fireEvent.click(screen.getByRole('button', { name: 'Researcher' }))
  expect(screen.getByLabelText('Bot task')).toHaveValue('Find sources')
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Run', exact: true })).toBeEnabled()
  )
  fireEvent.click(screen.getByRole('button', { name: 'Run', exact: true }))
  await waitFor(() => {
    expect(mocks.call).toHaveBeenCalledWith('tasks/start', {
      identity: identities[1],
      prompt: 'Find sources',
    })
    expect(screen.getByLabelText('Bot task')).toHaveValue('')
  })
  expect(
    mocks.call.mock.calls.filter(([path]) => path === 'tasks/start')
  ).toHaveLength(2)
})

it.each(['', '   '])(
  'ignores forced empty task submissions (%j)',
  async (prompt) => {
    readyTaskBots()
    render(<Page />)
    await screen.findByRole('heading', { name: 'Writer' })
    const input = screen.getByLabelText('Bot task')
    fireEvent.change(input, { target: { value: prompt } })
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

it('blocks same-tick duplicate tasks, then restores the failed draft for retry', async () => {
  let reject!: (error: Error) => void
  const submit = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise<void>((_, fail) => {
          reject = fail
        })
    )
    .mockResolvedValueOnce({})
  const [identity] = readyTaskBots(submit)
  render(<Page />)
  await screen.findByRole('heading', { name: 'Writer' })
  const input = screen.getByLabelText('Bot task')
  fireEvent.change(input, { target: { value: 'Send exactly once' } })
  const form = input.closest('form')!
  act(() => {
    fireEvent.submit(form)
    fireEvent.submit(form)
  })
  expect(submit).toHaveBeenCalledExactlyOnceWith({
    identity,
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
      screen.getByRole('button', { name: 'Run', exact: true })
    ).toBeEnabled()
  )
  expect(input).toHaveValue('Send exactly once')
  expect(form).toHaveAttribute('aria-busy', 'false')
  fireEvent.submit(form)
  await waitFor(() => expect(input).toHaveValue(''))
  expect(submit).toHaveBeenCalledTimes(2)
})

it('keeps a failed task submission inline through refresh and isolates its settings bot retry', async () => {
  let fail!: (cause: string) => void
  let finish!: () => void
  let accepted = false
  const submit = vi
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
  const [identity] = readyTaskBots(submit)
  const fallback = mocks.call.getMockImplementation()!
  mocks.call.mockImplementation((path: string, body: Record<string, unknown>) =>
    path === 'tasks'
      ? Promise.resolve(
          accepted
            ? [
                {
                  id: 'accepted-writer-task',
                  identity,
                  state: 'running',
                  messages: [{ role: 'user', content: 'Write the saved note' }],
                },
              ]
            : []
        )
      : fallback(path, body)
  )
  const updates = new Set<() => void>()
  mocks.listen.mockImplementation(async (event: string, update: () => void) => {
    if (event === 'gbot-task-update') updates.add(update)
    return () => updates.delete(update)
  })
  render(<Page />)
  await screen.findByRole('heading', { name: 'Writer' })
  const input = screen.getByLabelText('Bot task')
  fireEvent.change(input, { target: { value: 'Write the saved note' } })
  const form = input.closest('form')!
  const payload = { identity, prompt: 'Write the saved note' }
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
  await act(async () => fail('Task admission unavailable'))
  const message = 'Could not send this task. Try again.'
  const alert = await screen.findByRole('alert')
  expect(within(alert).getByText(message)).toBeVisible()
  expect(
    within(alert).getByText('Details').closest('details')
  ).not.toHaveAttribute('open')
  expect(within(alert).getByText('Task admission unavailable')).not.toBeVisible()
  expect(input).toHaveValue(payload.prompt)
  expect(form).toHaveAttribute('aria-busy', 'false')
  expect(screen.getByRole('button', { name: 'Run', exact: true })).toBeEnabled()
  expect(screen.queryByText(payload.prompt)).not.toBeInTheDocument()

  const reads = mocks.call.mock.calls.filter(([path]) => path === 'tasks').length
  await act(async () => updates.forEach((update) => update()))
  await waitFor(() =>
    expect(
      mocks.call.mock.calls.filter(([path]) => path === 'tasks').length
    ).toBeGreaterThan(reads)
  )
  expect(screen.getByRole('heading', { name: 'Writer' })).toBeVisible()
  expect(screen.getByRole('alert')).toHaveTextContent(message)
  expect(input).toHaveValue(payload.prompt)
  expect(submit).toHaveBeenCalledTimes(1)

  fireEvent.click(screen.getByRole('button', { name: 'Researcher' }))
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  expect(input).toHaveValue('')
  fireEvent.change(input, { target: { value: 'Researcher draft' } })
  expect(screen.getByRole('button', { name: 'Run', exact: true })).toBeEnabled()
  fireEvent.click(screen.getByRole('button', { name: 'Writer' }))
  expect(input).toHaveValue(payload.prompt)
  expect(screen.getByRole('alert')).toHaveTextContent(message)

  act(() => {
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  })
  expect(submit.mock.calls).toEqual([[payload], [payload]])
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Sending…' })).toBeDisabled()
  accepted = true
  await act(async () => finish())
  await waitFor(() => expect(input).toHaveValue(''))
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  expect(form).toHaveAttribute('aria-busy', 'false')
  expect(screen.getByText(payload.prompt)).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: 'Researcher' }))
  expect(input).toHaveValue('Researcher draft')
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

it('keeps a rejected task draft available for retry', async () => {
  const submit = vi
    .fn()
    .mockRejectedValueOnce(new Error('Task admission refused'))
    .mockResolvedValueOnce({})
  const [identity] = readyTaskBots(submit)
  render(<Page />)
  await screen.findByRole('heading', { name: 'Writer' })
  fireEvent.change(screen.getByLabelText('Bot task'), {
    target: { value: 'Keep this draft' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Run', exact: true }))
  await waitFor(() => {
    expect(submit).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: 'Run', exact: true })).toBeEnabled()
  })
  expect(screen.getByLabelText('Bot task')).toHaveValue('Keep this draft')
  fireEvent.click(screen.getByRole('button', { name: 'Run', exact: true }))
  await waitFor(() => {
    expect(submit).toHaveBeenCalledTimes(2)
    expect(submit).toHaveBeenLastCalledWith({
      identity,
      prompt: 'Keep this draft',
    })
    expect(screen.getByLabelText('Bot task')).toHaveValue('')
  })
})

it.each([false, true])(
  'clears only the unchanged submitted bot draft after switching while pending (edited: %s)',
  async (editSubmittedDraft) => {
    let finish!: () => void
    const pending = new Promise<void>((resolve) => {
      finish = resolve
    })
    const submit = vi.fn().mockReturnValue(pending)
    const [identity] = readyTaskBots(submit)
    render(<Page />)
    await screen.findByRole('heading', { name: 'Writer' })
    fireEvent.change(screen.getByLabelText('Bot task'), {
      target: { value: 'Original Writer task' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Run', exact: true }))
    await waitFor(() =>
      expect(submit).toHaveBeenCalledWith({
        identity,
        prompt: 'Original Writer task',
      })
    )
    if (editSubmittedDraft)
      fireEvent.change(screen.getByLabelText('Bot task'), {
        target: { value: 'New Writer draft' },
      })
    fireEvent.click(screen.getByRole('button', { name: 'Researcher' }))
    expect(screen.getByLabelText('Bot task')).toHaveValue('')
    fireEvent.change(screen.getByLabelText('Bot task'), {
      target: { value: 'Researcher draft' },
    })
    await act(async () => finish())
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Run', exact: true })).toBeEnabled()
    )
    expect(screen.getByLabelText('Bot task')).toHaveValue('Researcher draft')
    fireEvent.click(screen.getByRole('button', { name: 'Writer' }))
    expect(screen.getByLabelText('Bot task')).toHaveValue(
      editSubmittedDraft ? 'New Writer draft' : ''
    )
    expect(submit).toHaveBeenCalledTimes(1)
  }
)

it('resets task drafts only after explicit service selection succeeds', async () => {
  readyTaskBots()
  mocks.selectService
    .mockRejectedValueOnce(new Error('Service selection failed'))
    .mockResolvedValueOnce(undefined)
  render(<Page />)
  await screen.findByRole('heading', { name: 'Writer' })
  fireEvent.change(screen.getByLabelText('Bot task'), {
    target: { value: 'Writer draft' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Researcher' }))
  fireEvent.change(screen.getByLabelText('Bot task'), {
    target: { value: 'Researcher draft' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Service computer' }))
  fireEvent.click(screen.getByRole('button', { name: 'Use this service' }))
  await screen.findByText('Error: Service selection failed')
  expect(screen.getByLabelText('Bot task')).toHaveValue('Researcher draft')
  fireEvent.click(screen.getByRole('button', { name: 'Writer' }))
  expect(screen.getByLabelText('Bot task')).toHaveValue('Writer draft')
  fireEvent.click(screen.getByRole('button', { name: 'Use this service' }))
  await waitFor(() =>
    expect(
      screen.queryByRole('button', { name: 'Use this service' })
    ).not.toBeInTheDocument()
  )
  await screen.findByRole('heading', { name: 'Writer' })
  expect(screen.getByLabelText('Bot task')).toHaveValue('')
  fireEvent.click(screen.getByRole('button', { name: 'Researcher' }))
  expect(screen.getByLabelText('Bot task')).toHaveValue('')
  expect(mocks.selectService).toHaveBeenCalledTimes(2)
  expect(mocks.selectService).toHaveBeenLastCalledWith({ kind: 'local' })
})

it.each(['success', 'failure'] as const)(
  'keeps the selected service fixed during a pending change (%s)',
  async (outcome) => {
    readyTaskBots()
    let finish!: () => void
    let fail!: (cause: Error) => void
    mocks.selectService.mockImplementationOnce(
      () =>
        new Promise<void>((resolve, reject) => {
          finish = resolve
          fail = reject
        })
    )
    render(<Page />)
    await screen.findByRole('heading', { name: 'Writer' })
    fireEvent.click(screen.getByRole('button', { name: 'Service computer' }))
    const choose = screen.getByRole('button', { name: 'Use this service' })
    const otherComputer = screen.getByLabelText(
      'Another PC on the home or office network (LAN)'
    )
    act(() => {
      choose.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      choose.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      fireEvent.click(otherComputer)
    })
    expect(mocks.selectService).toHaveBeenCalledExactlyOnceWith({ kind: 'local' })
    expect(
      screen.getByRole('group', { name: 'Gbot service selection' })
    ).toBeDisabled()
    expect(screen.getByLabelText('This PC (recommended)')).toBeChecked()
    expect(otherComputer).toBeDisabled()
    expect(
      screen.getByRole('button', { name: 'Cancel service change' })
    ).toBeDisabled()

    await act(async () => {
      if (outcome === 'failure') fail(new Error('Service selection failed'))
      else finish()
    })
    if (outcome === 'failure') {
      expect(screen.getByText('Error: Service selection failed')).toBeVisible()
      expect(screen.getByLabelText('This PC (recommended)')).toBeChecked()
      expect(otherComputer).toBeEnabled()
      expect(choose).toBeEnabled()
      fireEvent.click(choose)
    }
    await waitFor(() =>
      expect(
        screen.queryByRole('button', { name: 'Use this service' })
      ).not.toBeInTheDocument()
    )
    expect(mocks.selectService).toHaveBeenCalledTimes(outcome === 'failure' ? 2 : 1)
    expect(mocks.selectService).toHaveBeenLastCalledWith({ kind: 'local' })
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
  'keeps a failed permission %s inline through refresh and retries it in settings',
  async (action, allow, progress, message) => {
    const [identity] = readyTaskBots()
    const call = mocks.call.getMockImplementation()!
    const task = {
      id: 'writer-task',
      identity,
      state: 'waiting_for_human',
      messages: [],
      help_requests: [],
    }
    let approvals = [
      {
        id: 'writer-permission',
        task_id: task.id,
        request: { operation: { kind: 'read', path: '/home/bot/notes.txt' } },
      },
    ]
    const updates = new Set<() => void>()
    mocks.listen.mockImplementation(async (event: string, update: () => void) => {
      if (event === 'gbot-task-update') updates.add(update)
      return () => updates.delete(update)
    })
    let fail!: (cause: string) => void
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
    mocks.call.mockImplementation(
      async (path: string, body: Record<string, unknown>) => {
        if (path === 'tasks') return [task]
        if (path === 'tasks/approvals') return approvals
        if (path === 'tasks/approval') return reply(body)
        return call(path, body)
      }
    )
    render(<Page />)
    const card = await screen.findByRole('article', {
      name: 'Bot permission request',
    })
    const submit = within(card).getByRole('button', { name: action, exact: true })
    act(() => {
      submit.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      submit.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    const payload = { id: 'writer-permission', allow }
    expect(reply).toHaveBeenCalledExactlyOnceWith(payload)
    expect(within(card).getByRole('status')).toHaveTextContent(progress)
    expect(card).toHaveAttribute('aria-busy', 'true')
    for (const button of within(card).getAllByRole('button'))
      expect(button).toBeDisabled()

    await act(async () => fail('Permission decision unavailable'))
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
    await act(async () => updates.forEach((update) => update()))
    await waitFor(() =>
      expect(
        mocks.call.mock.calls.filter(([path]) => path === 'tasks').length
      ).toBeGreaterThan(reads)
    )
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

it.each(['Send reply', 'Decline'])(
  'keeps a failed human-help %s visible and retryable in settings',
  async (action) => {
    const [identity] = readyTaskBots()
    const call = mocks.call.getMockImplementation()!
    const request = {
      id: 'help',
      question: 'Which folder?',
      status: 'pending',
      response: null as string | null,
    }
    const task = {
      id: 'help-task',
      identity,
      state: 'waiting_for_human',
      messages: [],
      help_requests: [request],
    }
    const updates = new Set<() => void>()
    mocks.listen.mockImplementation(async (event: string, update: () => void) => {
      if (event === 'gbot-task-update') updates.add(update)
      return () => updates.delete(update)
    })
    let rejectReply!: (cause: string) => void
    const pending = new Promise<void>((_, reject) => {
      rejectReply = reject
    })
    let attempts = 0
    mocks.call.mockImplementation(
      async (path: string, body: Record<string, unknown>) => {
        if (path === 'tasks') return [task]
        if (path === 'tasks/help') {
          if (++attempts === 1) return pending
          task.state = 'interrupted'
          request.status = body.response === null ? 'declined' : 'completed'
          request.response = body.response as string | null
          return {}
        }
        return call(path, body)
      }
    )
    render(<Page />)
    const card = (await screen.findByText('Which folder?')).parentElement!
    const reply = within(card).getByLabelText('Your reply')
    fireEvent.change(reply, { target: { value: 'Use Documents' } })
    const submit = within(card).getByRole('button', { name: action })
    act(() => {
      submit.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      submit.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(within(card).getByRole('status')).toHaveTextContent(
      action === 'Send reply' ? 'Sending reply…' : 'Declining request…'
    )
    expect(reply).toBeDisabled()
    for (const button of within(card).getAllByRole('button'))
      expect(button).toBeDisabled()
    const payload = {
      id: 'help-task',
      request_id: 'help',
      response: action === 'Send reply' ? 'Use Documents' : null,
    }
    expect(attempts).toBe(1)
    expect(mocks.call).toHaveBeenCalledWith('tasks/help', payload)

    await act(async () => rejectReply('Gbot service unavailable. Try again.'))
    expect(await within(card).findByRole('alert')).toHaveTextContent(
      'Gbot service unavailable. Try again.'
    )
    expect(reply).toHaveValue('Use Documents')
    expect(reply).toBeEnabled()
    expect(within(card).queryByRole('status')).not.toBeInTheDocument()
    expect(within(card).queryByText('Request declined')).not.toBeInTheDocument()
    expect(
      within(card).queryByText('Your reply: Use Documents')
    ).not.toBeInTheDocument()

    const reads = mocks.call.mock.calls.filter(
      ([path]) => path === 'tasks'
    ).length
    await act(async () => updates.forEach((update) => update()))
    await waitFor(() =>
      expect(
        mocks.call.mock.calls.filter(([path]) => path === 'tasks').length
      ).toBeGreaterThan(reads)
    )
    expect(within(card).getByRole('alert')).toHaveTextContent(
      'Gbot service unavailable. Try again.'
    )
    fireEvent.click(within(card).getByRole('button', { name: action }))
    expect(
      await within(card).findByText(
        action === 'Send reply' ? 'Your reply: Use Documents' : 'Request declined'
      )
    ).toBeVisible()
    expect(attempts).toBe(2)
    expect(
      mocks.call.mock.calls.filter(([path]) => path === 'tasks/help')
    ).toEqual([
      ['tasks/help', payload],
      ['tasks/help', payload],
    ])
    expect(within(card).queryByRole('alert')).not.toBeInTheDocument()
  }
)

it.each(['Send reply', 'Decline'])(
  'recovers a saved human-help %s without resending the response in settings',
  async (action) => {
    const [identity] = readyTaskBots()
    const call = mocks.call.getMockImplementation()!
    const request = {
      id: 'saved-help',
      question: 'Which folder?',
      status: 'pending',
      response: null as string | null,
    }
    const task = {
      id: 'saved-help-task',
      identity,
      state: 'waiting_for_human',
      messages: [],
      help_requests: [request],
    }
    const updates = new Set<() => void>()
    mocks.listen.mockImplementation(async (event: string, update: () => void) => {
      if (event === 'gbot-task-update') updates.add(update)
      return () => updates.delete(update)
    })
    let rejectReply!: (cause: string) => void
    const pendingReply = new Promise<void>((_, reject) => {
      rejectReply = reject
    })
    let finishResume!: () => void
    const pendingResume = new Promise<void>((resolve) => {
      finishResume = resolve
    })
    const help = vi.fn().mockReturnValue(pendingReply)
    const resume = vi.fn().mockReturnValue(pendingResume)
    mocks.call.mockImplementation(
      async (path: string, body: Record<string, unknown>) => {
        if (path === 'tasks') return [task]
        if (path === 'tasks/help') return help(body)
        if (path === 'tasks/resume') return resume(body)
        return call(path, body)
      }
    )
    render(<Page />)
    const card = (await screen.findByText('Which folder?')).closest('article')!
    fireEvent.change(within(card).getByLabelText('Your reply'), {
      target: { value: 'Use Documents' },
    })
    fireEvent.click(within(card).getByRole('button', { name: action }))
    const payload = {
      id: task.id,
      request_id: request.id,
      response: action === 'Send reply' ? 'Use Documents' : null,
    }
    expect(help).toHaveBeenCalledExactlyOnceWith(payload)
    expect(within(card).getByRole('status')).toHaveTextContent(
      action === 'Send reply' ? 'Sending reply…' : 'Declining request…'
    )

    // The service saves the response before attempting to restart execution.
    task.state = 'interrupted'
    request.status = payload.response === null ? 'declined' : 'completed'
    request.response = payload.response
    await act(async () => rejectReply('Model connection unavailable'))
    const guidance =
      'Your response was saved, but this task could not continue. Check the model and computer connections, then resume the task.'
    const outcome =
      action === 'Send reply' ? 'Your reply: Use Documents' : 'Request declined'
    expect(await within(card).findByText(outcome)).toBeVisible()
    expect(await within(card).findByRole('alert')).toHaveTextContent(guidance)
    expect(within(card).queryByLabelText('Your reply')).not.toBeInTheDocument()
    expect(
      within(card).queryByRole('button', { name: 'Send reply' })
    ).not.toBeInTheDocument()
    expect(
      within(card).queryByRole('button', { name: 'Decline' })
    ).not.toBeInTheDocument()

    const reads = mocks.call.mock.calls.filter(
      ([path]) => path === 'tasks'
    ).length
    await act(async () => updates.forEach((update) => update()))
    await waitFor(() =>
      expect(
        mocks.call.mock.calls.filter(([path]) => path === 'tasks').length
      ).toBeGreaterThan(reads)
    )
    expect(within(card).getByRole('alert')).toHaveTextContent(guidance)
    expect(within(card).getByText(outcome)).toBeVisible()
    expect(help).toHaveBeenCalledTimes(1)
    expect(resume).not.toHaveBeenCalled()

    const resumeButton = within(card).getByRole('button', { name: 'Resume' })
    expect(resumeButton).toBeEnabled()
    fireEvent.click(resumeButton)
    expect(resume).toHaveBeenCalledExactlyOnceWith({ id: task.id })
    expect(within(card).getByRole('status')).toHaveTextContent(
      'Resuming this task…'
    )
    task.state = 'running'
    await act(async () => finishResume())
    await waitFor(() =>
      expect(within(card).queryByRole('alert')).not.toBeInTheDocument()
    )
    expect(within(card).getByText(outcome)).toBeVisible()

    task.state = 'interrupted'
    await act(async () => updates.forEach((update) => update()))
    await waitFor(() =>
      expect(
        within(card).getByRole('button', { name: 'Resume' })
      ).toBeEnabled()
    )
    expect(within(card).queryByRole('alert')).not.toBeInTheDocument()
    expect(within(card).getByText(outcome)).toBeVisible()
    expect(
      mocks.call.mock.calls.filter(
        ([path]) => path.startsWith('tasks/') && path !== 'tasks/approvals'
      )
    ).toEqual([
      ['tasks/help', payload],
      ['tasks/resume', { id: task.id }],
    ])
  }
)

it('sends task-bound human replies and declines, retaining them after reload', async () => {
  const identity = { workspace_id: 'one', session_id: 'session' }
  const tasks = [
    {
      id: 'task',
      identity,
      state: 'waiting_for_human',
      messages: [],
      help_requests: [
        {
          id: 'help',
          question: 'Which folder?',
          status: 'pending',
          response: null as string | null,
        },
      ],
    },
    {
      id: 'decline-task',
      identity,
      state: 'waiting_for_human',
      messages: [],
      help_requests: [
        {
          id: 'decline-help',
          question: 'Which date?',
          status: 'pending',
          response: null as string | null,
        },
      ],
    },
  ]
  mocks.listen.mockResolvedValue(() => {})
  mocks.call.mockImplementation(
    async (path: string, body: Record<string, unknown>) => {
      if (path === 'connectors/get') return { account_ids: [], accounts: [] }
      if (path === 'state')
        return {
          workspaces: [{ id: 'one', name: 'Writer' }],
          live_sessions: [identity],
          assignments: [],
          controls: [],
        }
      if (path === 'tasks') return tasks
      if (path === 'tasks/approvals') return []
      if (path === 'tasks/help') {
        const task = tasks.find((task) => task.id === body.id)!
        task.state = 'interrupted'
        task.help_requests[0].status =
          body.response === null ? 'declined' : 'completed'
        task.help_requests[0].response = body.response as string | null
      }
      return {}
    }
  )
  render(<Page />)
  await screen.findByText('Which folder?')
  expect(
    screen.getAllByRole('button', { name: 'Send reply' })[0]
  ).toBeDisabled()
  fireEvent.change(screen.getAllByLabelText('Your reply')[0], {
    target: { value: 'Documents' },
  })
  fireEvent.click(screen.getAllByRole('button', { name: 'Send reply' })[0])
  await screen.findByText('Your reply: Documents')
  expect(mocks.call).toHaveBeenCalledWith('tasks/help', {
    id: 'task',
    request_id: 'help',
    response: 'Documents',
  })
  fireEvent.click(screen.getByRole('button', { name: 'Decline' }))
  await screen.findByText('Request declined')
  expect(mocks.call).toHaveBeenCalledWith('tasks/help', {
    id: 'decline-task',
    request_id: 'decline-help',
    response: null,
  })
  expect(mocks.call).not.toHaveBeenCalledWith(
    'tasks/approval',
    expect.anything()
  )
  expect(mocks.call).not.toHaveBeenCalledWith(
    'control/hand-back',
    expect.anything()
  )
  cleanup()
  render(<Page />)
  await screen.findByText('Your reply: Documents')
  expect(screen.getByText('Request declined')).toBeInTheDocument()
  expect(screen.queryByLabelText('Your reply')).not.toBeInTheDocument()
})

it.each([
  ['Take over', 'control/take-over', 'Could not take over this desktop. Try again.'],
  ['Hand back', 'control/hand-back', 'Could not hand back control. Try again.'],
] as const)(
  'keeps a failed desktop control %s inline and retries its settings session',
  async (action, path, message) => {
    const errorToast = vi.spyOn(toast, 'error').mockImplementation(() => 0)
    try {
      const [identity, other] = readyTaskBots()
      let session = identity
      let human = action === 'Hand back'
      let fail!: (cause: string) => void
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
      mocks.call.mockImplementation(async (request: string, body: Record<string, unknown>) => {
        if (request === 'state') return {
          ...await fallback(request, body) as BotState,
          live_sessions: [session, other],
          controls: [{
            identity: session,
            state: human ? 'human' : 'bot',
            owner: human ? sessionStorage.getItem('gbot-control-owner') : null,
          }],
        }
        if (request === path) {
          if (action === 'Hand back') expect(mocks.mediaStop).toHaveBeenCalled()
          return change(body)
        }
        if (request === 'view/open') return {
          lease_id: 'control-lease',
          ws_url: 'ws://127.0.0.1/mock',
          media_session_id: 'control-media',
          interactive: body.interactive,
        }
        return fallback(request, body)
      })
      const updates = new Set<() => void>()
      mocks.listen.mockImplementation(async (event: string, update: () => void) => {
        if (event === 'gbot-task-update') updates.add(update)
        return () => updates.delete(update)
      })
      render(<Page />)
      await screen.findByRole('heading', { name: 'Writer' })
      fireEvent.click(screen.getByRole('button', { name: 'View bot’s desktop' }))
      await waitFor(() => expect(mocks.mediaStart).toHaveBeenCalled())
      const originalStatus = human ? 'Bot paused · you have control' : 'Connected'
      const payload = { identity, owner: sessionStorage.getItem('gbot-control-owner') }
      const button = screen.getByRole('button', { name: action, exact: true })
      act(() => {
        button.dispatchEvent(new MouseEvent('click', { bubbles: true }))
        button.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      })
      expect(change).toHaveBeenCalledExactlyOnceWith(payload)
      expect(button).toBeDisabled()
      expect(screen.getByText(originalStatus, { exact: true })).toBeVisible()
      await act(async () => fail('Desktop control unavailable'))
      const alert = await screen.findByRole('alert')
      expect(within(alert).getByText(message)).toBeVisible()
      expect(within(alert).getByText('Details').closest('details')).not.toHaveAttribute('open')
      expect(within(alert).getByText('Desktop control unavailable')).not.toBeVisible()
      expect(button).toBeEnabled()
      expect(screen.getByText(originalStatus, { exact: true })).toBeVisible()
      expect(errorToast).not.toHaveBeenCalled()

      const reads = mocks.call.mock.calls.filter(([request]) => request === 'tasks').length
      await act(async () => updates.forEach((update) => update()))
      expect(mocks.call.mock.calls.filter(([request]) => request === 'tasks').length).toBeGreaterThan(reads)
      expect(screen.getByRole('alert')).toHaveTextContent(message)
      expect(change).toHaveBeenCalledTimes(1)
      fireEvent.click(screen.getByRole('button', { name: 'Researcher' }))
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
      fireEvent.click(screen.getByRole('button', { name: 'Writer' }))
      expect(screen.getByRole('alert')).toHaveTextContent(message)
      session = { ...identity, session_id: 'replacement' }
      await act(async () => updates.forEach((update) => update()))
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
      session = identity
      await act(async () => updates.forEach((update) => update()))
      expect(screen.getByRole('alert')).toHaveTextContent(message)
      mocks.getTarget.mockResolvedValue({ kind: 'paired_host', host_id: 'other-service' })
      await act(async () => updates.forEach((update) => update()))
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
      mocks.getTarget.mockResolvedValue({ kind: 'local' })
      await act(async () => updates.forEach((update) => update()))
      expect(screen.getByRole('alert')).toHaveTextContent(message)
      expect(change).toHaveBeenCalledTimes(1)

      const retry = screen.getByRole('button', { name: action, exact: true })
      fireEvent.click(retry)
      expect(change.mock.calls).toEqual([[payload], [payload]])
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
      expect(retry).toBeDisabled()
      expect(screen.getByText(originalStatus, { exact: true })).toBeVisible()
      human = !human
      await act(async () => finish())
      expect(await screen.findByRole('button', {
        name: action === 'Take over' ? 'Hand back' : 'Take over', exact: true,
      })).toBeEnabled()
      expect(screen.getByText(human ? 'Bot paused · you have control' : 'Connected', { exact: true })).toBeVisible()
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
      expect(mocks.call.mock.calls.filter(([request]) =>
        request.startsWith('control/') || (request.startsWith('tasks/') && request !== 'tasks/approvals')
      )).toEqual([[path, payload], [path, payload]])
      expect(errorToast).not.toHaveBeenCalled()
    } finally {
      errorToast.mockRestore()
    }
  }
)

it('opens view-only and closes interactive input before handing back to the bot', async () => {
  const identity = { workspace_id: 'one', session_id: 'session' }
  let human = false
  let lease = 0
  mocks.listen.mockResolvedValue(() => {})
  mocks.call.mockImplementation(
    async (path: string, body: Record<string, unknown>) => {
      if (path === 'connectors/get') return { account_ids: [], accounts: [] }
      if (path === 'state')
        return {
          workspaces: [{ id: 'one', name: 'Writer' }],
          live_sessions: [identity],
          assignments: [],
          controls: [
            {
              identity,
              state: human ? 'human' : 'bot',
              owner: human
                ? sessionStorage.getItem('gbot-control-owner')
                : null,
            },
          ],
        }
      if (path === 'tasks' || path === 'tasks/approvals') return []
      if (path === 'view/open')
        return {
          lease_id: `lease-${++lease}`,
          ws_url: 'ws://127.0.0.1:3000/media?ticket=scoped',
          media_session_id: 'media',
          interactive: body.interactive,
        }
      if (path === 'control/take-over') human = true
      if (path === 'control/hand-back') {
        expect(mocks.mediaStop).toHaveBeenCalled()
        human = false
      }
      return {}
    }
  )
  render(<Page />)
  fireEvent.click(
    await screen.findByRole('button', { name: 'View bot’s desktop' })
  )
  await waitFor(() =>
    expect(mocks.mediaStart).toHaveBeenLastCalledWith(
      expect.objectContaining({ interactive: false })
    )
  )
  expect(screen.getByLabelText('Bot computer desktop')).toHaveAttribute(
    'tabindex',
    '-1'
  )
  fireEvent.click(screen.getByRole('button', { name: 'Take over' }))
  await waitFor(() =>
    expect(mocks.mediaStart).toHaveBeenLastCalledWith(
      expect.objectContaining({ interactive: true })
    )
  )
  expect(mocks.call).toHaveBeenCalledWith(
    'view/close',
    expect.objectContaining({ lease_id: 'lease-1' })
  )
  expect(screen.getByLabelText('Bot computer desktop')).toHaveAttribute(
    'tabindex',
    '0'
  )
  fireEvent.click(screen.getByLabelText('Desktop audio'))
  await waitFor(() =>
    expect(mocks.mediaStart).toHaveBeenLastCalledWith(
      expect.objectContaining({ interactive: true, audio: true })
    )
  )
  expect(mocks.call).toHaveBeenCalledWith(
    'view/close',
    expect.objectContaining({ lease_id: 'lease-2' })
  )
  mocks.mediaStop.mockClear()
  fireEvent.click(screen.getByRole('button', { name: 'Hand back' }))
  await waitFor(() =>
    expect(mocks.call).toHaveBeenCalledWith(
      'control/hand-back',
      expect.objectContaining({ identity })
    )
  )
  await waitFor(() =>
    expect(mocks.mediaStart).toHaveBeenLastCalledWith(
      expect.objectContaining({ interactive: false })
    )
  )
  expect(mocks.call).toHaveBeenCalledWith(
    'view/close',
    expect.objectContaining({ lease_id: 'lease-3' })
  )
})

it.each(['incomplete', 'unavailable', 'service-unavailable'])(
  'keeps an open KVM desktop through task refreshes, then blocks %s setup',
  async (failure) => {
    const [identity] = readyTaskBots(undefined, {
      workspaces: [
        {
          id: 'one',
          name: 'Writer',
          bot_pc: { kind: 'local_vm', hypervisor: 'kvm' },
        },
      ],
    })
    const call = mocks.call.getMockImplementation()!
    const updates = new Map<string, Set<() => void>>()
    mocks.listen.mockImplementation(
      async (event: string, callback: () => void) => {
        const callbacks = updates.get(event) || new Set()
        callbacks.add(callback)
        updates.set(event, callbacks)
        return () => callbacks.delete(callback)
      }
    )
    let record: KvmSetupRecord = {
      id: identity.workspace_id,
      name: 'Writer',
      stage: 'ready',
      issue: null,
    }
    let status = async () => [record]
    let statusReads = 0
    let updated = false
    let failState = false
    mocks.call.mockImplementation(
      async (path: string, body: Record<string, unknown>) => {
        if (path === 'state' && failState)
          throw new Error('Gbot service unavailable')
        if (path === 'setup/local-vm/status') {
          statusReads += 1
          return status()
        }
        if (path === 'view/open')
          return {
            lease_id: 'retained-view',
            ws_url: 'ws://127.0.0.1:3000/media?ticket=scoped',
            media_session_id: 'media',
            interactive: false,
          }
        if (path === 'tasks')
          return updated
            ? [
                {
                  id: 'task',
                  identity,
                  state: 'running',
                  messages: [
                    { role: 'assistant', content: 'Task update received' },
                  ],
                },
              ]
            : []
        return call(path, body)
      }
    )
    render(<Page />)
    fireEvent.click(
      await screen.findByRole('button', { name: 'View bot’s desktop' })
    )
    await waitFor(() => expect(mocks.mediaStart).toHaveBeenCalledTimes(1))
    const canvas = screen.getByLabelText('Bot computer desktop')
    let resolveStatus!: (records: KvmSetupRecord[]) => void
    status = () =>
      new Promise<KvmSetupRecord[]>((resolve) => {
        resolveStatus = resolve
      })
    const before = statusReads
    await act(async () =>
      updates.get('gbot-task-update')!.forEach((callback) => callback())
    )
    await waitFor(() => expect(statusReads).toBeGreaterThan(before))
    expect(canvas).toBeVisible()
    expect(screen.queryByText('Setup incomplete')).not.toBeInTheDocument()
    expect(mocks.mediaStop).not.toHaveBeenCalled()
    expect(mocks.call).not.toHaveBeenCalledWith('view/close', expect.anything())

    updated = true
    await act(async () => resolveStatus([record]))
    await screen.findByText('Task update received')
    expect(screen.getByLabelText('Bot computer desktop')).toBe(canvas)
    expect(mocks.mediaStart).toHaveBeenCalledTimes(1)
    expect(mocks.mediaStop).not.toHaveBeenCalled()

    record = { ...record, stage: 'testing_desktop' }
    status = async () => {
      if (failure === 'unavailable') throw new Error('Setup status unavailable')
      return [record]
    }
    failState = failure === 'service-unavailable'
    await act(async () =>
      updates.get('gbot-setup-update')!.forEach((callback) => callback())
    )
    await screen.findByText('Setup incomplete')
    expect(canvas).not.toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Run', exact: true })
    ).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Take over' })).toBeDisabled()
    await waitFor(() =>
      expect(mocks.call).toHaveBeenCalledWith(
        'view/close',
        expect.objectContaining({ identity, lease_id: 'retained-view' })
      )
    )
  }
)

it.each([false, true])(
  'reconnects paused control before explicit hand-back (disconnect media failure: %s)',
  async (mediaFailure) => {
    const identity = { workspace_id: 'one', session_id: 'retained-session' }
    const owner = 'retained-owner'
    sessionStorage.setItem('gbot-control-owner', owner)
    let live = true
    let control = 'human'
    mocks.listen.mockResolvedValue(() => {})
    mocks.call.mockImplementation(
      async (path: string, body: Record<string, unknown>) => {
        if (path === 'connectors/get') return { account_ids: [], accounts: [] }
        if (path === 'state')
          return {
            workspaces: [{ id: 'one', name: 'Writer' }],
            live_sessions: live ? [identity] : [],
            assignments: [
              {
                workspace_id: 'one',
                connection: { kind: 'endpoint', api_base: 'http://host/v1' },
                model: 'qwen',
                context_tokens: 262144,
              },
            ],
            controls: [
              {
                identity: { workspace_id: 'two', session_id: 'other-session' },
                state: 'paused',
                owner: 'other-owner',
              },
              {
                identity,
                state: control,
                owner: control === 'bot' ? null : owner,
              },
            ],
          }
        if (path === 'tasks')
          return [
            {
              id: 'task',
              identity,
              state: 'paused',
              messages: [{ role: 'assistant', content: 'Saved result' }],
            },
          ]
        if (path === 'tasks/approvals') return []
        if (path === 'disconnect') {
          live = false
          control = 'paused'
          if (mediaFailure) throw new Error('Guest media could not close')
        }
        if (path === 'connect') {
          if (
            body.workspace_id !== identity.workspace_id ||
            body.session_id !== identity.session_id
          )
            throw new Error('Session does not match retained control')
          live = true
        }
        if (path === 'control/hand-back') {
          const session = body.identity as typeof identity
          if (
            session.workspace_id !== identity.workspace_id ||
            session.session_id !== identity.session_id ||
            body.owner !== owner ||
            !live
          )
            throw new Error('Current session and control owner required')
          control = 'bot'
        }
        return {}
      }
    )
    render(<Page />)
    await screen.findByText('Bot paused · you have control')
    await screen.findByText('Saved result')
    fireEvent.click(screen.getByRole('button', { name: 'Disconnect' }))
    fireEvent.click(
      await screen.findByRole('button', { name: 'Connect', exact: true })
    )
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Hand back' })).toBeEnabled()
    )
    expect(screen.getByText('Saved result')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Bot task'), {
      target: { value: 'Next task' },
    })
    expect(
      screen.getByRole('button', { name: 'Run', exact: true })
    ).toBeDisabled()
    expect(
      screen.getByRole('button', { name: 'Resume', exact: true })
    ).toBeDisabled()
    expect(mocks.call).not.toHaveBeenCalledWith(
      'control/hand-back',
      expect.anything()
    )
    expect(mocks.call).not.toHaveBeenCalledWith(
      'tasks/start',
      expect.anything()
    )
    expect(mocks.call).not.toHaveBeenCalledWith(
      'tasks/resume',
      expect.anything()
    )
    fireEvent.click(screen.getByRole('button', { name: 'Hand back' }))
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Take over' })).toBeEnabled()
    )
    expect(
      screen.getByRole('button', { name: 'Run', exact: true })
    ).toBeEnabled()
    expect(
      screen.getByRole('button', { name: 'Resume', exact: true })
    ).toBeEnabled()
    expect(screen.getByText('Saved result')).toBeInTheDocument()
    expect(mocks.call).not.toHaveBeenCalledWith(
      'tasks/start',
      expect.anything()
    )
    expect(mocks.call).not.toHaveBeenCalledWith(
      'tasks/resume',
      expect.anything()
    )
  }
)

it('links existing accounts per bot without inherited selection', async () => {
  const linked: Record<string, string[]> = { one: [], two: [] }
  const accounts = [
    {
      id: 'google-a',
      provider: 'google',
      display_name: 'Google work',
      email: null,
      services: ['calendar'],
      access: 'read_write',
      granted_scopes: [],
      needs_reconnect: false,
    },
    {
      id: 'microsoft-b',
      provider: 'microsoft',
      display_name: 'Microsoft work',
      email: null,
      services: ['mail'],
      access: 'read_only',
      granted_scopes: [],
      needs_reconnect: false,
    },
  ]
  mocks.listen.mockResolvedValue(() => {})
  mocks.call.mockImplementation(
    async (
      path: string,
      body: { workspace_id: string; account_ids: string[] }
    ) => {
      if (path === 'state')
        return {
          workspaces: [
            { id: 'one', name: 'Writer' },
            { id: 'two', name: 'Researcher' },
          ],
          live_sessions: [],
          assignments: [],
          controls: [],
        }
      if (path === 'connectors/get')
        return { accounts, account_ids: linked[body.workspace_id] }
      if (path === 'connectors/save') {
        linked[body.workspace_id] = [...body.account_ids]
        return { accounts, account_ids: linked[body.workspace_id] }
      }
      return []
    }
  )
  render(<Page />)
  fireEvent.click(await screen.findByText('Linked accounts'))
  const google = await screen.findByRole('checkbox', { name: /Google work/ })
  expect(google).not.toBeChecked()
  expect(
    screen.getByRole('checkbox', { name: /Microsoft work/ })
  ).not.toBeChecked()
  fireEvent.click(google)
  fireEvent.click(screen.getByRole('button', { name: 'Save linked accounts' }))
  await waitFor(() => expect(linked.one).toEqual(['google-a']))
  fireEvent.click(screen.getByRole('button', { name: 'Researcher' }))
  fireEvent.click(await screen.findByText('Linked accounts'))
  const microsoft = await screen.findByRole('checkbox', {
    name: /Microsoft work/,
  })
  expect(microsoft).not.toBeChecked()
  expect(
    screen.getByRole('checkbox', { name: /Google work/ })
  ).not.toBeChecked()
  fireEvent.click(microsoft)
  fireEvent.click(screen.getByRole('button', { name: 'Save linked accounts' }))
  await waitFor(() => expect(linked.two).toEqual(['microsoft-b']))
  fireEvent.click(screen.getByRole('button', { name: 'Writer' }))
  fireEvent.click(await screen.findByText('Linked accounts'))
  expect(
    await screen.findByRole('checkbox', { name: /Google work/ })
  ).toBeChecked()
  expect(
    screen.getByRole('checkbox', { name: /Microsoft work/ })
  ).not.toBeChecked()
  fireEvent.click(screen.getByRole('checkbox', { name: /Google work/ }))
  fireEvent.click(screen.getByRole('button', { name: 'Save linked accounts' }))
  await waitFor(() => expect(linked.one).toEqual([]))
  expect(linked.two).toEqual(['microsoft-b'])
  expect(mocks.call).toHaveBeenCalledWith('connectors/save', {
    workspace_id: 'one',
    account_ids: ['google-a'],
  })
  expect(mocks.call).toHaveBeenCalledWith('connectors/save', {
    workspace_id: 'two',
    account_ids: ['microsoft-b'],
  })
})

it.each([
  ['local', true, 'Start', 'Could not start Gbot on this computer. Try Start Gbot service again.'],
  ['local', false, 'Quit', 'Could not stop Gbot on this computer. Try Quit Gbot service again.'],
  ['paired_host', true, 'Connect', 'Could not connect to the Gbot service on your LAN computer. Try Connect Gbot service again.'],
  ['paired_host', false, 'Disconnect', 'Could not disconnect from the Gbot service on your LAN computer. Try Disconnect Gbot service again.'],
] as const)(
  'keeps a failed service action %s %s %s inline until its explicit retry succeeds',
  async (kind, start, action, message) => {
    const errorToast = vi.spyOn(toast, 'error').mockImplementation(() => 0)
    try {
      readyTaskBots()
      const target = kind === 'local' ? { kind } : { kind, host_id: 'paired-host' }
      mocks.getTarget.mockResolvedValue(target)
      mocks.startService.mockReset().mockResolvedValue(undefined)
      mocks.quitService.mockReset().mockResolvedValue(undefined)
      const updates = new Set<() => void>()
      mocks.listen.mockImplementation(async (event: string, update: () => void) => {
        if (event === 'gbot-task-update') updates.add(update)
        return () => updates.delete(update)
      })
      const fallback = mocks.call.getMockImplementation()!
      const snapshot = await fallback('state', {}) as BotState
      let holdRefresh = false
      let finishRefresh!: (state: BotState) => void
      const refreshed = new Promise<BotState>((resolve) => {
        finishRefresh = resolve
      })
      mocks.call.mockImplementation((request: string, body: Record<string, unknown>) =>
        request === 'state' && holdRefresh ? refreshed : fallback(request, body)
      )
      render(<Page />)
      await screen.findByRole('heading', { name: 'Writer' })
      const stopLabel = kind === 'local' ? 'Quit Gbot service' : 'Disconnect Gbot service'
      const startLabel = kind === 'local' ? 'Start Gbot service' : 'Connect Gbot service'
      const stoppedMessage = kind === 'local'
        ? 'Gbot service is stopped. Tasks and schedules will resume when you start it again.'
        : 'Disconnected from the LAN Gbot service. Tasks and schedules continue on that computer.'
      if (start) {
        fireEvent.click(await screen.findByRole('button', { name: stopLabel }))
        await screen.findByText(stoppedMessage)
        await waitFor(() => expect(screen.getByRole('button', { name: startLabel })).toBeEnabled())
      }
      const invoke = start ? mocks.startService : mocks.quitService
      invoke.mockClear()
      let fail!: (cause: unknown) => void
      let finish!: () => void
      invoke.mockImplementationOnce(() => new Promise<void>((_, reject) => {
        fail = reject
      })).mockImplementationOnce(() => new Promise<void>((resolve) => {
        finish = resolve
      }))
      const original = screen.getByRole('button', { name: `${action} Gbot service` })
      act(() => {
        original.dispatchEvent(new MouseEvent('click', { bubbles: true }))
        original.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      })
      expect(invoke).toHaveBeenCalledTimes(1)
      expect(original).toBeDisabled()
      const progressMessage = start
        ? kind === 'local'
          ? 'Starting Gbot on this computer. First-time setup or an update may need several minutes to prepare files. The service will start automatically when preparation finishes. You can keep using GChat.'
          : 'Connecting to the Gbot service on your selected LAN computer. Please wait.'
        : kind === 'local'
          ? 'Stopping the Gbot service. Tasks and schedules will resume when you start it again.'
          : 'Disconnecting from the LAN Gbot service. Tasks and schedules continue on that computer.'
      expect(screen.getByText(progressMessage)).toHaveAttribute('role', 'status')
      expect(screen.getByText(progressMessage)).toBeVisible()
      if (!start) {
        expect(screen.getByRole('heading', { name: 'Writer' })).toBeVisible()
        expect(screen.queryByText(stoppedMessage)).not.toBeInTheDocument()
      }
      const cause = 'Service operation refused'
      await act(async () => fail(kind === 'local' ? new Error(cause) : cause))
      const alert = await screen.findByRole('alert')
      expect(alert).toHaveAttribute('id', 'gbot-service-action-error')
      expect(within(alert).getByText(message)).toBeVisible()
      expect(within(alert).getByText('Details').closest('details')).not.toHaveAttribute('open')
      expect(within(alert).getByText(cause)).not.toBeVisible()
      expect(original).toBeEnabled()
      expect(errorToast).not.toHaveBeenCalled()
      if (start) {
        expect(screen.getByText(stoppedMessage)).toBeVisible()
        expect(screen.queryByRole('heading', { name: 'Writer' })).not.toBeInTheDocument()
      } else {
        expect(screen.getByRole('heading', { name: 'Writer' })).toBeVisible()
        expect(screen.queryByText(stoppedMessage)).not.toBeInTheDocument()
        const reads = mocks.call.mock.calls.filter(([request]) => request === 'tasks').length
        await act(async () => updates.forEach((update) => update()))
        expect(mocks.call.mock.calls.filter(([request]) => request === 'tasks').length).toBeGreaterThan(reads)
        expect(screen.getByRole('alert')).toHaveTextContent(message)
        mocks.getTarget.mockResolvedValue({ kind: 'paired_host', host_id: 'other-service' })
        await act(async () => updates.forEach((update) => update()))
        expect(screen.queryByRole('alert')).not.toBeInTheDocument()
        mocks.getTarget.mockResolvedValue(target)
        await act(async () => updates.forEach((update) => update()))
        expect(screen.getByRole('alert')).toHaveTextContent(message)
      }
      expect(invoke).toHaveBeenCalledTimes(1)
      const retry = screen.getByRole('button', { name: `${action} Gbot service` })
      fireEvent.click(retry)
      expect(invoke).toHaveBeenCalledTimes(2)
      expect(retry).toBeDisabled()
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
      fireEvent.click(retry)
      expect(invoke).toHaveBeenCalledTimes(2)
      if (start) {
        holdRefresh = true
        await act(async () => finish())
        const progress = screen.getByRole('button', {
          name: kind === 'local' ? 'Starting Gbot service…' : 'Connecting Gbot service…',
        })
        expect(progress).toBeDisabled()
        fireEvent.click(progress)
        expect(invoke).toHaveBeenCalledTimes(2)
        await act(async () => finishRefresh(snapshot))
        await waitFor(() => expect(screen.getByRole('button', { name: stopLabel })).toBeEnabled())
        expect(screen.getByRole('heading', { name: 'Writer' })).toBeVisible()
        expect(screen.queryByText(stoppedMessage)).not.toBeInTheDocument()
      } else {
        expect(screen.getByRole('heading', { name: 'Writer' })).toBeVisible()
        expect(screen.queryByText(stoppedMessage)).not.toBeInTheDocument()
        // The companion independently reads state/tasks after service actions.
        // The stopped Settings route must not restart its setup/status refresh.
        const setupReads = () => mocks.call.mock.calls.filter(([request]) =>
          request === 'setup/cloud/status' || request === 'setup/m365/status' ||
          request === 'setup/local-vm/status'
        ).length
        const reads = setupReads()
        await act(async () => finish())
        await waitFor(() => expect(screen.getByRole('button', { name: startLabel })).toBeEnabled())
        expect(screen.getByText(stoppedMessage)).toBeVisible()
        expect(screen.queryByRole('heading', { name: 'Writer' })).not.toBeInTheDocument()
        expect(setupReads()).toBe(reads)
      }
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
      expect(invoke).toHaveBeenCalledTimes(2)
      expect(mocks.selectService).not.toHaveBeenCalled()
      expect(mocks.call.mock.calls.filter(([request]) =>
        request === 'connect' || request === 'disconnect' || request.startsWith('control/') ||
        (request.startsWith('tasks/') && request !== 'tasks/approvals')
      )).toEqual([])
      expect(errorToast).not.toHaveBeenCalled()
    } finally {
      mocks.startService.mockReset().mockResolvedValue(undefined)
      mocks.quitService.mockReset().mockResolvedValue(undefined)
      errorToast.mockRestore()
    }
  }
)

it.each(['local', 'paired_host'] as const)(
  'keeps %s service startup progress visible until connection completes',
  async (kind) => {
    readyTaskBots()
    mocks.getTarget.mockResolvedValue(
      kind === 'local' ? { kind } : { kind, host_id: 'paired-host' }
    )
    mocks.quitService.mockResolvedValue(undefined)
    let finish!: () => void
    mocks.startService.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve
        })
    )
    render(<Page />)
    await screen.findByRole('heading', { name: 'Writer' })
    fireEvent.click(
      screen.getByRole('button', {
        name:
          kind === 'local' ? 'Quit Gbot service' : 'Disconnect Gbot service',
      })
    )
    const startLabel =
      kind === 'local' ? 'Start Gbot service' : 'Connect Gbot service'
    await waitFor(() =>
      expect(screen.getByRole('button', { name: startLabel })).toBeEnabled()
    )
    fireEvent.click(screen.getByRole('button', { name: startLabel }))
    const button = screen.getByRole('button', {
      name:
        kind === 'local'
          ? 'Starting Gbot service…'
          : 'Connecting Gbot service…',
    })
    expect(button).toBeDisabled()
    const progress = screen.getByText(
      kind === 'local'
        ? 'Starting Gbot on this computer. First-time setup or an update may need several minutes to prepare files. The service will start automatically when preparation finishes. You can keep using GChat.'
        : 'Connecting to the Gbot service on your selected LAN computer. Please wait.'
    )
    expect(progress).toHaveAttribute('role', 'status')
    expect(progress).toBeVisible()
    await act(async () => {
      await Promise.resolve()
    })
    expect(progress).toBeVisible()
    fireEvent.click(button)
    expect(mocks.startService).toHaveBeenCalledTimes(1)
    await act(async () => finish())
    await waitFor(() =>
      expect(
        screen.getByRole('button', {
          name:
            kind === 'local' ? 'Quit Gbot service' : 'Disconnect Gbot service',
        })
      ).toBeEnabled()
    )
    expect(progress).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Writer' })).toBeVisible()
  }
)

it('clears failed startup progress and allows an explicit retry', async () => {
  readyTaskBots()
  mocks.quitService.mockResolvedValue(undefined)
  let fail!: (cause: Error) => void
  mocks.startService
    .mockImplementationOnce(
      () =>
        new Promise<void>((_, reject) => {
          fail = reject
        })
    )
    .mockResolvedValue(undefined)
  render(<Page />)
  await screen.findByRole('heading', { name: 'Writer' })
  fireEvent.click(screen.getByRole('button', { name: 'Quit Gbot service' }))
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'Start Gbot service' })
    ).toBeEnabled()
  )
  fireEvent.click(screen.getByRole('button', { name: 'Start Gbot service' }))
  expect(
    screen.getByRole('button', { name: 'Starting Gbot service…' })
  ).toBeDisabled()
  await act(async () => fail(new Error('Service start failed')))
  expect(
    screen.queryByText(/Starting Gbot on this computer/)
  ).not.toBeInTheDocument()
  expect(
    screen.getByText(
      'Gbot service is stopped. Tasks and schedules will resume when you start it again.'
    )
  ).toBeVisible()
  const retry = screen.getByRole('button', { name: 'Start Gbot service' })
  expect(retry).toBeEnabled()
  fireEvent.click(retry)
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'Quit Gbot service' })
    ).toBeEnabled()
  )
  expect(screen.getByRole('heading', { name: 'Writer' })).toBeVisible()
  expect(mocks.startService).toHaveBeenCalledTimes(2)
})

it.each(['local', 'paired_host'] as const)(
  'shows %s shutdown progress without claiming the service has already stopped',
  async (kind) => {
    readyTaskBots()
    mocks.getTarget.mockResolvedValue(
      kind === 'local' ? { kind } : { kind, host_id: 'paired-host' }
    )
    let finish!: () => void
    mocks.quitService.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve
        })
    )
    render(<Page />)
    await screen.findByRole('heading', { name: 'Writer' })
    fireEvent.click(
      screen.getByRole('button', {
        name:
          kind === 'local' ? 'Quit Gbot service' : 'Disconnect Gbot service',
      })
    )
    const progress = screen.getByText(
      kind === 'local'
        ? 'Stopping the Gbot service. Tasks and schedules will resume when you start it again.'
        : 'Disconnecting from the LAN Gbot service. Tasks and schedules continue on that computer.'
    )
    expect(progress).toHaveAttribute('role', 'status')
    expect(
      screen.getByRole('button', {
        name:
          kind === 'local'
            ? 'Stopping Gbot service…'
            : 'Disconnecting Gbot service…',
      })
    ).toBeDisabled()
    expect(screen.getByRole('heading', { name: 'Writer' })).toBeVisible()
    await act(async () => finish())
    await waitFor(() =>
      expect(
        screen.getByRole('button', {
          name:
            kind === 'local' ? 'Start Gbot service' : 'Connect Gbot service',
        })
      ).toBeEnabled()
    )
    expect(progress).not.toBeInTheDocument()
    expect(
      screen.queryByRole('heading', { name: 'Writer' })
    ).not.toBeInTheDocument()
    expect(
      screen.getByText(
        kind === 'local'
          ? 'Gbot service is stopped. Tasks and schedules will resume when you start it again.'
          : 'Disconnected from the LAN Gbot service. Tasks and schedules continue on that computer.'
      )
    ).toBeVisible()
  }
)

it('explicitly stops the service without refreshing and starts it before reconnecting', async () => {
  mocks.listen.mockResolvedValue(() => {})
  mocks.quitService.mockResolvedValue(undefined)
  mocks.startService.mockResolvedValue(undefined)
  mocks.call.mockImplementation(async (path: string) =>
    path === 'state'
      ? { workspaces: [], live_sessions: [], assignments: [], controls: [] }
      : []
  )
  render(<Page />)
  await screen.findByRole('form', { name: 'Set up Gbot' })
  fireEvent.click(screen.getByRole('button', { name: 'Quit Gbot service' }))
  await screen.findByText(
    'Gbot service is stopped. Tasks and schedules will resume when you start it again.'
  )
  expect(mocks.quitService).toHaveBeenCalledTimes(1)
  const calls = mocks.call.mock.calls.length
  await Promise.resolve()
  expect(mocks.call.mock.calls).toHaveLength(calls)
  fireEvent.click(screen.getByRole('button', { name: 'Start Gbot service' }))
  await waitFor(() => expect(mocks.startService).toHaveBeenCalledTimes(1))
  await screen.findByRole('button', { name: 'Quit Gbot service' })
  expect(mocks.call.mock.calls.length).toBeGreaterThan(calls)
})

it('renders service session identities, holds unfinished KVM and admits actions on Ready update', async () => {
  const identity = { workspace_id: 'owned-kvm', session_id: 'session' }
  let record: KvmSetupRecord = {
    id: identity.workspace_id,
    name: 'Writer',
    stage: 'checking_pc',
    issue: {
      code: 'desktop_not_ready',
      message: 'Desktop readiness is unfinished.',
      next_action: 'Resume the saved setup.',
    },
  }
  let resolveStatus!: (records: KvmSetupRecord[]) => void
  const pendingStatus = new Promise<KvmSetupRecord[]>((resolve) => {
    resolveStatus = resolve
  })
  let firstStatus = true
  const updates = new Set<() => void>()
  mocks.listen.mockImplementation(
    async (event: string, callback: () => void) => {
      if (event === 'gbot-setup-update') updates.add(callback)
      return () => updates.delete(callback)
    }
  )
  mocks.call.mockImplementation(
    async (path: string, body: Record<string, unknown>) => {
      if (path === 'state')
        return {
          workspaces: [
            {
              id: identity.workspace_id,
              name: 'Writer',
              bot_pc: { kind: 'local_vm', hypervisor: 'kvm' },
            },
          ],
          live_sessions: [identity],
          controls: [],
          assignments: [
            {
              workspace_id: identity.workspace_id,
              connection: { kind: 'endpoint', api_base: 'http://host/v1' },
              model: 'qwen',
              context_tokens: 262144,
              credential_ref: null,
            },
          ],
        }
      if (path === 'setup/local-vm/status') {
        if (firstStatus) {
          firstStatus = false
          return pendingStatus
        }
        return [record]
      }
      if (path === 'setup/local-vm/preflight') return { ready: true, issues: [] }
      if (path === 'setup/local-vm/start') {
        record = { ...record, stage: 'testing_desktop', issue: null }
        return record
      }
      if (path === 'tasks')
        return [{ id: 'task', identity, state: 'paused', messages: [] }]
      if (path === 'schedules') return { schedules: [], stopped: null }
      if (path === 'connectors/get') return { account_ids: [], accounts: [] }
      if (path === 'tasks/start') return { identity: body.identity }
      return []
    }
  )
  render(<Page />)
  await screen.findByText('Checking setup status…')
  expect(
    screen.getByText('Wait for setup status before running a task.')
  ).toBeVisible()
  fireEvent.change(screen.getByLabelText('Bot task'), {
    target: { value: 'Write a note' },
  })
  expect(
    screen.getByRole('button', { name: 'Run', exact: true })
  ).toBeDisabled()
  expect(screen.getByRole('button', { name: 'Disconnect' })).toBeDisabled()
  expect(
    screen.queryByText('Connected', { exact: true })
  ).not.toBeInTheDocument()
  expect(
    screen.queryByRole('button', { name: 'View bot’s desktop' })
  ).not.toBeInTheDocument()

  resolveStatus([record])
  await screen.findByText('Desktop readiness is unfinished.')
  expect(
    screen.getByText(
      'Finish this bot’s setup with Resume setup before running a task.'
    )
  ).toBeVisible()
  expect(
    await screen.findByRole('button', { name: 'Resume', exact: true })
  ).toBeDisabled()
  expect(screen.getByRole('button', { name: 'Take over' })).toBeDisabled()
  fireEvent.click(screen.getByRole('button', { name: 'Resume setup' }))
  const wizard = await screen.findByRole('form', { name: 'Set up Gbot' })
  expect(within(wizard).queryByLabelText('Bot name')).not.toBeInTheDocument()
  expect(
    within(wizard).queryByRole('button', { name: /Create .*computer/ })
  ).not.toBeInTheDocument()
  await waitFor(() =>
    expect(
      within(wizard).getByRole('button', { name: 'Resume setup' })
    ).toBeEnabled()
  )
  fireEvent.click(within(wizard).getByRole('button', { name: 'Resume setup' }))
  await waitFor(() =>
    expect(mocks.call).toHaveBeenCalledWith('setup/local-vm/start', {
      id: identity.workspace_id,
      name: 'Writer',
    })
  )
  expect(
    mocks.call.mock.calls.filter(([path]) => path === 'setup/local-vm/start')
  ).toHaveLength(1)
  expect(mocks.call).not.toHaveBeenCalledWith('tasks/start', expect.anything())
  expect(mocks.call).not.toHaveBeenCalledWith('view/open', expect.anything())

  record = { ...record, stage: 'ready', issue: null }
  updates.forEach((update) => update())
  await waitFor(() =>
    expect(screen.queryByText('Setup incomplete')).not.toBeInTheDocument()
  )
  fireEvent.click(
    await screen.findByRole('button', { name: 'Use this computer' })
  )
  await waitFor(() =>
    expect(
      screen.queryByRole('form', { name: 'Set up Gbot' })
    ).not.toBeInTheDocument()
  )
  expect(
    await screen.findByText('Connected', { exact: true })
  ).toBeInTheDocument()
  expect(
    screen.getByRole('button', { name: 'View bot’s desktop' })
  ).toBeEnabled()
  expect(screen.getByRole('button', { name: 'Run', exact: true })).toBeEnabled()
  fireEvent.click(screen.getByRole('button', { name: 'Run', exact: true }))
  await waitFor(() =>
    expect(mocks.call).toHaveBeenCalledWith('tasks/start', {
      identity,
      prompt: 'Write a note',
    })
  )

  record = { ...record, id: 'another-kvm', stage: 'checking_pc' }
  const statusCalls = mocks.call.mock.calls.filter(
    ([path]) => path === 'setup/local-vm/status'
  ).length
  updates.forEach((update) => update())
  await waitFor(() =>
    expect(
      mocks.call.mock.calls.filter(([path]) => path === 'setup/local-vm/status')
        .length
    ).toBeGreaterThan(statusCalls)
  )
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Take over' })).toBeEnabled()
  )
  expect(screen.queryByText('Setup incomplete')).not.toBeInTheDocument()
  expect(
    screen.getByRole('button', { name: 'View bot’s desktop' })
  ).toBeEnabled()
})

it.each(['human', 'paused'])(
  'allows the retained %s owner to hand back before explicitly resuming saved setup',
  async (controlState) => {
    const identity = { workspace_id: 'owned-kvm', session_id: 'saved-session' }
    const owner = 'retained-owner'
    sessionStorage.setItem('gbot-control-owner', owner)
    let control = {
      identity,
      owner: owner as string | null,
      state: controlState,
    }
    let attempts = 0
    const record: KvmSetupRecord = {
      id: identity.workspace_id,
      name: 'Writer',
      identity,
      stage: 'testing_desktop',
      issue: {
        code: 'guest_not_ready',
        message:
          'Readiness write failed: bot dispatch is paused for human control',
        next_action: 'Resume the saved setup.',
      },
    }
    mocks.listen.mockResolvedValue(() => {})
    mocks.call.mockImplementation(
      async (path: string, body: Record<string, unknown>) => {
        if (path === 'state')
          return {
            workspaces: [
              {
                id: identity.workspace_id,
                name: 'Writer',
                bot_pc: { kind: 'local_vm', hypervisor: 'kvm' },
              },
            ],
            live_sessions: [identity],
            controls: [control],
            assignments: [
              {
                workspace_id: identity.workspace_id,
                connection: { kind: 'endpoint', api_base: 'http://host/v1' },
                model: 'qwen',
                context_tokens: 262144,
              },
            ],
          }
        if (path === 'setup/local-vm/status') return [record]
        if (path === 'setup/local-vm/preflight') return { ready: true, issues: [] }
        if (path === 'setup/local-vm/start') return record
        if (path === 'tasks')
          return [{ id: 'task', identity, state: 'paused', messages: [] }]
        if (path === 'connectors/get') return { account_ids: [], accounts: [] }
        if (path === 'schedules') return { schedules: [], stopped: null }
        if (path === 'control/hand-back') {
          expect(body).toEqual({ identity, owner })
          if (++attempts === 1)
            throw new Error('Fresh desktop observation failed')
          control = { identity, owner: null, state: 'bot' }
        }
        return []
      }
    )
    render(<Page />)
    await screen.findByText(record.issue!.message)
    const assertSetupBlocked = () => {
      expect(screen.getByText('Setup incomplete')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Disconnect' })).toBeDisabled()
      expect(screen.getByRole('button', { name: 'Edit brain' })).toBeDisabled()
      expect(
        screen.getByRole('button', { name: 'Run', exact: true })
      ).toBeDisabled()
      expect(
        screen.getByRole('button', { name: 'Resume', exact: true })
      ).toBeDisabled()
      expect(
        screen.queryByRole('button', { name: 'View bot’s desktop' })
      ).not.toBeInTheDocument()
    }
    assertSetupBlocked()
    const handBack = screen.getByRole('button', { name: 'Hand back' })
    expect(handBack).toBeEnabled()
    expect(handBack.closest('fieldset')).toBeNull()
    fireEvent.click(handBack)
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Hand back' })).toBeEnabled()
    )
    expect(attempts).toBe(1)
    assertSetupBlocked()
    fireEvent.click(screen.getByRole('button', { name: 'Hand back' }))
    await waitFor(() =>
      expect(
        screen.queryByRole('button', { name: 'Hand back' })
      ).not.toBeInTheDocument()
    )
    expect(attempts).toBe(2)
    assertSetupBlocked()
    expect(screen.getByRole('button', { name: 'Take over' })).toBeDisabled()
    expect(mocks.call).not.toHaveBeenCalledWith(
      'setup/local-vm/start',
      expect.anything()
    )
    for (const path of [
      'tasks/start',
      'tasks/resume',
      'view/open',
      'control/take-over',
    ])
      expect(mocks.call).not.toHaveBeenCalledWith(path, expect.anything())

    fireEvent.click(screen.getByRole('button', { name: 'Resume setup' }))
    const wizard = await screen.findByRole('form', { name: 'Set up Gbot' })
    await waitFor(() =>
      expect(
        within(wizard).getByRole('button', { name: 'Resume setup' })
      ).toBeEnabled()
    )
    expect(mocks.call).not.toHaveBeenCalledWith(
      'setup/local-vm/start',
      expect.anything()
    )
    fireEvent.click(
      within(wizard).getByRole('button', { name: 'Resume setup' })
    )
    await waitFor(() =>
      expect(mocks.call).toHaveBeenCalledWith('setup/local-vm/start', {
        id: identity.workspace_id,
        name: 'Writer',
      })
    )
    expect(record.stage).toBe('testing_desktop')
    for (const path of [
      'tasks/start',
      'tasks/resume',
      'view/open',
      'control/take-over',
    ])
      expect(mocks.call).not.toHaveBeenCalledWith(path, expect.anything())
  }
)

it.each([
  'unknown setup',
  'missing setup identity',
  'foreign setup workspace',
  'different setup session',
  'missing live identity',
  'foreign live workspace',
  'different live session',
  'foreign control workspace',
  'different control session',
  'foreign owner',
  'missing owner',
  'bot control',
])(
  'keeps incomplete-setup control recovery blocked for %s',
  async (scenario) => {
    const identity = { workspace_id: 'owned-kvm', session_id: 'saved-session' }
    const owner = 'retained-owner'
    sessionStorage.setItem('gbot-control-owner', owner)
    const liveIdentity =
      scenario === 'foreign live workspace'
        ? { ...identity, workspace_id: 'other-workspace' }
        : scenario === 'different live session'
          ? { ...identity, session_id: 'other-session' }
          : identity
    const controlIdentity =
      scenario === 'foreign control workspace'
        ? { ...identity, workspace_id: 'other-workspace' }
        : scenario === 'different control session'
          ? { ...identity, session_id: 'other-session' }
          : identity
    const setupIdentity =
      scenario === 'missing setup identity'
        ? undefined
        : scenario === 'foreign setup workspace'
          ? { ...identity, workspace_id: 'other-workspace' }
          : scenario === 'different setup session'
            ? { ...identity, session_id: 'other-session' }
            : identity
    mocks.listen.mockResolvedValue(() => {})
    mocks.call.mockImplementation(async (path: string) => {
      if (path === 'state')
        return {
          workspaces: [
            {
              id: identity.workspace_id,
              name: 'Writer',
              bot_pc: { kind: 'local_vm', hypervisor: 'kvm' },
            },
          ],
          live_sessions:
            scenario === 'missing live identity' ? [] : [liveIdentity],
          controls: [
            {
              identity: controlIdentity,
              state: scenario === 'bot control' ? 'bot' : 'paused',
              owner:
                scenario === 'foreign owner'
                  ? 'other-owner'
                  : scenario === 'missing owner'
                    ? null
                    : owner,
            },
          ],
          assignments: [],
        }
      if (path === 'setup/local-vm/status') {
        if (scenario === 'unknown setup')
          throw new Error('Setup status unavailable')
        return [
          {
            id: identity.workspace_id,
            name: 'Writer',
            identity: setupIdentity,
            stage: 'testing_desktop',
            issue: null,
          },
        ]
      }
      if (path === 'connectors/get') return { account_ids: [], accounts: [] }
      if (path === 'schedules') return { schedules: [], stopped: null }
      return []
    })
    render(<Page />)
    await screen.findByText('Computer setup is incomplete')
    if (scenario === 'unknown setup')
      await screen.findByText('Error: Setup status unavailable')
    else await screen.findByRole('button', { name: 'Resume setup' })
    for (const button of screen.queryAllByRole('button', {
      name: /^(Hand back|Take over)$/,
    })) {
      expect(button).toBeDisabled()
      fireEvent.click(button)
    }
    expect(
      screen.getByRole('button', { name: 'Run', exact: true })
    ).toBeDisabled()
    expect(
      screen.queryByRole('button', { name: 'View bot’s desktop' })
    ).not.toBeInTheDocument()
    expect(mocks.call).not.toHaveBeenCalledWith(
      'control/hand-back',
      expect.anything()
    )
    expect(mocks.call).not.toHaveBeenCalledWith(
      'control/take-over',
      expect.anything()
    )
    expect(mocks.call).not.toHaveBeenCalledWith(
      'tasks/start',
      expect.anything()
    )
    expect(mocks.call).not.toHaveBeenCalledWith(
      'tasks/resume',
      expect.anything()
    )
    expect(mocks.call).not.toHaveBeenCalledWith('view/open', expect.anything())
  }
)

it('shows one plain not-connected message and hides it while the service starts', async () => {
  const notConnected =
    'Gbot service is not running or is disconnected. Use the service button at the top of the Gbot page to start or connect it.'
  mocks.listen.mockResolvedValue(() => {})
  mocks.call.mockRejectedValue(notConnected)
  let finish!: () => void
  mocks.startService.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve
      })
  )
  render(<Page />)
  expect(await screen.findByRole('alert')).toHaveTextContent(notConnected)
  fireEvent.click(screen.getByRole('button', { name: 'Start Gbot service' }))
  expect(
    screen.getByRole('button', { name: 'Starting Gbot service…' })
  ).toBeDisabled()
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  await act(async () => finish())
})

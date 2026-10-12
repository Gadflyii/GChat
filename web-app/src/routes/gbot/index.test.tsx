import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { ComponentType } from 'react'

const mocks = vi.hoisted(() => ({
  call: vi.fn(),
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
vi.mock('@/containers/HeaderPage', () => ({
  default: ({ children }: { children: React.ReactNode }) => (
    <header>{children}</header>
  ),
}))
vi.mock('@/services/gbot', async (original) => ({
  ...(await original<object>()),
  gbot: mocks.call,
}))

import { Route } from './index'
import { useGeneralSetting } from '@/hooks/useGeneralSetting'
const Page = Route.options.component as ComponentType
beforeEach(() => {
  useGeneralSetting.setState({ gbotEnabled: true })
})
afterEach(() => {
  cleanup()
  sessionStorage.clear()
  vi.clearAllMocks()
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

it('creates an SSH workspace in one request and preserves setup identity on retry', async () => {
  const workspaces: { id: string; name: string }[] = []
  let attempt = 0
  mocks.listen.mockResolvedValue(() => {})
  mocks.call.mockImplementation(
    async (path: string, body: Record<string, unknown>) => {
      if (path === 'state')
        return { workspaces, live_sessions: [], assignments: [], controls: [] }
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
  fireEvent.click(screen.getByLabelText(/Another computer on the LAN/))
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
  for (const [label, value] of [
    ['SSH host', 'bot.local'],
    ['SSH user', 'bot'],
    ['SSH host public key', 'ssh-ed25519 pinned-key'],
    ['SSH private key', 'private-key'],
    ['Key passphrase', 'key-passphrase'],
  ])
    fireEvent.change(screen.getByLabelText(label), { target: { value } })
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
  fireEvent.click(screen.getByRole('button', { name: 'Save bot' }))
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Workspace could not be saved'
  )
  fireEvent.click(screen.getByRole('button', { name: 'Save bot' }))
  await waitFor(() =>
    expect(
      screen.queryByRole('form', { name: 'Set up Gbot' })
    ).not.toBeInTheDocument()
  )
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
  expect(screen.getByRole('button', { name: 'Writer' })).toBeInTheDocument()
  expect(JSON.stringify(sessionStorage)).not.toContain('private-key')
})

it('isolates bot assignments and approvals, and holds new tasks during takeover', async () => {
  const identity = { workspace_id: 'one', session_id: 'session' }
  let control = 'bot'
  let assignments: unknown[] = []
  mocks.listen.mockResolvedValue(() => {})
  mocks.call.mockImplementation(
    async (path: string, body: Record<string, unknown>) => {
      if (path === 'state')
        return {
          workspaces: [
            { id: 'one', name: 'Writer' },
            { id: 'two', name: 'Researcher' },
          ],
          live_sessions: [{ identity }],
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
  expect(screen.getByLabelText('API key')).toHaveValue('')
  expect(screen.getByLabelText('Model ID')).toHaveValue('')
  expect(screen.queryByText('Saved result')).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Writer' }))
  expect(screen.getByLabelText('API key')).toHaveValue('bot-secret')
  fireEvent.click(screen.getByRole('button', { name: 'Save brain settings' }))
  await waitFor(() => expect(screen.getByLabelText('API key')).toHaveValue(''))
  expect(screen.getByLabelText('API key')).toHaveAttribute(
    'placeholder',
    'Saved in vault'
  )
  expect(screen.getByLabelText('Model ID')).toHaveValue('qwen')
  cleanup()
  render(<Page />)
  await screen.findByText('Saved result')
  expect(screen.getByLabelText('Model ID')).toHaveValue('qwen')
  expect(screen.getByLabelText('API key')).toHaveValue('')
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
      if (path === 'state')
        return {
          workspaces: [{ id: 'one', name: 'Writer' }],
          live_sessions: [{ identity }],
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

it('opens view-only and closes interactive input before handing back to the bot', async () => {
  const identity = { workspace_id: 'one', session_id: 'session' }
  let human = false
  let lease = 0
  mocks.listen.mockResolvedValue(() => {})
  mocks.call.mockImplementation(
    async (path: string, body: Record<string, unknown>) => {
      if (path === 'state')
        return {
          workspaces: [{ id: 'one', name: 'Writer' }],
          live_sessions: [{ identity }],
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

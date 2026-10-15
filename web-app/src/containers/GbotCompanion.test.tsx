import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import { useState, type ReactNode } from 'react'
import GbotCompanion from './GbotCompanion'
import GbotAvatars from '@/components/GbotAvatars'
import { useGbotCompanion } from '@/stores/gbot-companion-store'
import { useGbotPage } from '@/stores/gbot-page-store'
import type { AgentDefinition } from '@/types/agent'
import { useGeneralSetting } from '@/hooks/useGeneralSetting'
import type { BotState, Task } from '@/services/gbot'

const mocks = vi.hoisted(() => ({
  call: vi.fn(),
  listen: vi.fn(),
  start: vi.fn(),
  stop: vi.fn(),
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
    constructor(readonly options: unknown) {}
    start() {
      mocks.start(this.options)
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

it('ends page sharing when switching bots or hiding the pane', async () => {
  await mount()
  act(() => useGbotPage.getState().publish({
    id: 'studio',
    draft: {
      schemaVersion: 3, id: '', kind: 'standard', name: 'Agent', description: '',
      instructions: '', defaultGoal: '', skills: [], maxSteps: 25,
      outputContract: '', modelInstanceId: null, reasoningEffort: null, builtIn: false,
    } satisfies AgentDefinition,
    update: vi.fn(),
  }))
  fireEvent.click(screen.getByRole('button', { name: 'Help with this page' }))
  expect(useGbotPage.getState().sharing?.workspaceId).toBe('a')
  fireEvent.click(screen.getByRole('button', { name: /Open Bramble/ }))
  expect(useGbotPage.getState().sharing).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: /Open Atlas/ }))
  expect(screen.getByRole('button', { name: 'Help with this page' })).toBeEnabled()
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

it('releases desktop input, audio and leases on hide, then reopens without restarting the bot', async () => {
  await mount()
  fireEvent.click(screen.getByRole('button', { name: 'Desktop', exact: true }))
  fireEvent.click(screen.getByRole('button', { name: 'View bot’s desktop' }))
  await waitFor(() => expect(mocks.start).toHaveBeenCalledTimes(1))
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

it('makes no service calls when disabled and removes subscriptions when disabled later', async () => {
  useGeneralSetting.setState({ gbotEnabled: false })
  const view = render(<GbotCompanion />)
  expect(mocks.call).not.toHaveBeenCalled()
  expect(mocks.listen).not.toHaveBeenCalled()
  act(() => useGeneralSetting.setState({ gbotEnabled: true }))
  await waitFor(() => expect(events.size).toBe(2))
  act(() => useGeneralSetting.setState({ gbotEnabled: false }))
  await waitFor(() => expect(events.size).toBe(0))
  expect(useGbotCompanion.getState().mode).toBe('hidden')
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

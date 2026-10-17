import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { ComponentType } from 'react'
import type { KvmSetupRecord } from '@/services/gbot'
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
  cleanup()
  sessionStorage.clear()
  localStorage.removeItem('gbot-control-owner')
  vi.clearAllMocks()
})

function readyTaskBots(
  startTask?: (body: Record<string, unknown>) => Promise<unknown>
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
        }
      if (path === 'connectors/get') return { account_ids: [], accounts: [] }
      if (path === 'schedules') return { schedules: [], stopped: null }
      if (path === 'tasks/start') return startTask ? startTask(body) : {}
      return []
    }
  )
  return identities
}

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
    if (path === 'setup/kvm/status') return [record]
    if (path === 'setup/kvm/preflight') return { ready: true, issues: [] }
    if (path === 'setup/kvm/start') return record
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
    'setup/kvm/start',
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
    'setup/kvm/start',
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
    expect(mocks.call).toHaveBeenCalledWith('setup/kvm/start', {
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
    expect(mocks.call).toHaveBeenCalledWith('setup/kvm/status', {})
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
    if (path === 'setup/kvm/status') return [record]
    if (path === 'setup/kvm/preflight')
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
    if (path === 'setup/kvm/start') return record
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
    'setup/kvm/start',
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
    'setup/kvm/start',
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
    'setup/kvm/start',
    expect.anything()
  )
  fireEvent.click(within(wizard).getByRole('button', { name: 'Resume setup' }))
  await waitFor(() =>
    expect(mocks.call).toHaveBeenCalledWith('setup/kvm/start', {
      id: record.id,
      name: record.name,
    })
  )
  expect(
    mocks.call.mock.calls.filter(([path]) => path === 'setup/kvm/start')
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
    if (path === 'setup/kvm/status')
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
    'setup/kvm/start',
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
    if (path === 'setup/kvm/status') {
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
  expect(screen.getByLabelText('Provider API token')).toHaveValue('')
  expect(
    mocks.call.mock.calls.some(
      ([path]) => path === 'workspaces/ssh' || path === 'workspaces'
    )
  ).toBe(false)
})

it('resumes saved M365 prerequisites without presenting a connected bot workspace', async () => {
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
  fireEvent.click(
    within(card).getByRole('button', { name: 'Resume Cloud PC setup' })
  )
  await screen.findByRole('region', { name: 'M365 Cloud PC setup' })
  expect(
    screen.getByText('Step 4 of 4 · Prepare your Cloud PC connection')
  ).toBeInTheDocument()
  expect(await screen.findByLabelText('Microsoft account')).toHaveValue(
    record.account_id
  )
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

it('removes only the saved M365 setup and preserves the Cloud PC and Microsoft account', async () => {
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
  ]
  mocks.call.mockImplementation(async (path: string) => {
    if (path === 'state')
      return {
        workspaces: [],
        live_sessions: [],
        assignments: [],
        controls: [],
      }
    if (path === 'setup/m365/status') return records
    if (path === 'setup/m365/remove') {
      records = []
      return {}
    }
    return []
  })
  render(<Page />)
  const card = await screen.findByRole('region', {
    name: 'M365 setup Cloud PC researcher',
  })
  expect(
    within(card).getByText(
      /Removing it keeps your Microsoft account and Cloud PC/
    )
  ).toBeInTheDocument()
  fireEvent.click(
    within(card).getByRole('button', { name: 'Remove saved Cloud PC setup' })
  )
  await waitFor(() =>
    expect(
      screen.queryByRole('region', { name: 'M365 setup Cloud PC researcher' })
    ).not.toBeInTheDocument()
  )
  expect(mocks.call).toHaveBeenCalledWith('setup/m365/remove', {
    id: 'm365-setup',
  })
  expect(
    mocks.call.mock.calls.every(
      ([path]) =>
        !['workspaces/remove', 'connect', 'setup/cloud/delete'].includes(path)
    )
  ).toBe(true)
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
  fireEvent.click(screen.getByLabelText('Use an existing SSH key'))
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
    'Saved in vault'
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
      if (path === 'setup/kvm/status') {
        if (firstStatus) {
          firstStatus = false
          return pendingStatus
        }
        return [record]
      }
      if (path === 'setup/kvm/preflight') return { ready: true, issues: [] }
      if (path === 'setup/kvm/start') {
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
    expect(mocks.call).toHaveBeenCalledWith('setup/kvm/start', {
      id: identity.workspace_id,
      name: 'Writer',
    })
  )
  expect(
    mocks.call.mock.calls.filter(([path]) => path === 'setup/kvm/start')
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
    ([path]) => path === 'setup/kvm/status'
  ).length
  updates.forEach((update) => update())
  await waitFor(() =>
    expect(
      mocks.call.mock.calls.filter(([path]) => path === 'setup/kvm/status')
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
        if (path === 'setup/kvm/status') return [record]
        if (path === 'setup/kvm/preflight') return { ready: true, issues: [] }
        if (path === 'setup/kvm/start') return record
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
      'setup/kvm/start',
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
      'setup/kvm/start',
      expect.anything()
    )
    fireEvent.click(
      within(wizard).getByRole('button', { name: 'Resume setup' })
    )
    await waitFor(() =>
      expect(mocks.call).toHaveBeenCalledWith('setup/kvm/start', {
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
      if (path === 'setup/kvm/status') {
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

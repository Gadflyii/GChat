import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import M365Setup from './M365Setup'
import {
  gbot,
  getGbotServiceTarget,
  type M365SetupRecord,
} from '@/services/gbot'
import {
  beginConnectorAuth,
  cancelConnectorAuth,
  connectorAccounts,
  connectorAuthStatus,
  type ConnectorAccountsView,
} from '@/services/workspace-connectors'

const opener = vi.hoisted(() => vi.fn())
vi.mock('@/services/gbot', () => ({
  gbot: vi.fn(),
  getGbotServiceTarget: vi.fn(),
}))
vi.mock('@/hooks/useServiceHub', () => ({
  getServiceHub: () => ({ opener: () => ({ open: opener }) }),
}))
vi.mock('@/services/workspace-connectors', () => ({
  beginConnectorAuth: vi.fn(),
  cancelConnectorAuth: vi.fn(),
  connectorAccounts: vi.fn(),
  connectorAuthStatus: vi.fn(),
}))

const cloudPc = {
  id: 'assigned-pc',
  display_name: 'Dedicated bot PC',
  image_name: 'Windows 11',
  plan_name: '2 vCPU / 8 GB',
}
const initial: M365SetupRecord = {
  id: 'saved-setup',
  name: 'Research bot',
  account_id: 'work-account',
  cloud_pc: cloudPc,
  route: 'brokered_client',
}
function accounts(permission = true): ConnectorAccountsView {
  return {
    configs: [
      {
        provider: 'microsoft',
        client_id: 'registered-client',
        tenant: 'work-tenant',
        has_client_secret: false,
      },
    ],
    accounts: [
      {
        id: 'work-account',
        provider: 'microsoft',
        subject: 'subject',
        display_name: 'Work account',
        email: 'bot@example.test',
        access: 'read_only',
        services: permission ? ['cloud_pc'] : ['outlook'],
        granted_scopes: permission ? ['CloudPC.Read.All'] : ['Mail.Read'],
        needs_reconnect: false,
      },
    ],
    active_flows: [],
    selected_accounts: { microsoft: 'work-account' },
    services: {
      google: [],
      microsoft: [
        {
          id: 'cloud_pc',
          read_scopes: ['CloudPC.Read.All'],
          write_scopes: ['CloudPC.Read.All'],
        },
      ],
    },
  }
}
beforeEach(() => {
  vi.mocked(getGbotServiceTarget).mockResolvedValue({ kind: 'local' })
  vi.mocked(connectorAccounts).mockResolvedValue(accounts())
  opener.mockResolvedValue(undefined)
})
afterEach(() => {
  cleanup()
  vi.resetAllMocks()
})

function mount(resume?: M365SetupRecord) {
  const saved = vi.fn().mockResolvedValue(undefined)
  render(
    <M365Setup
      name="Research bot"
      initial={resume}
      busy={vi.fn()}
      saved={saved}
    />
  )
  return saved
}
async function chooseAccount() {
  await screen.findByLabelText('Microsoft account')
  fireEvent.change(screen.getByLabelText('Microsoft account'), {
    target: { value: 'work-account' },
  })
}
async function checkAssignments() {
  fireEvent.click(
    screen.getByRole('button', { name: 'Check assigned Cloud PCs' })
  )
  await screen.findByLabelText('Assigned Cloud PC')
}

it('requires explicit account, assigned PC, route and dedicated desktop confirmation', async () => {
  vi.mocked(gbot).mockImplementation(async (path) =>
    path === 'setup/m365/assigned' ? [cloudPc] : initial
  )
  const saved = mount()
  await screen.findByLabelText('Microsoft account')
  expect(screen.getByLabelText('Microsoft account')).toHaveValue('')
  expect(
    screen.getByRole('button', { name: 'Check assigned Cloud PCs' })
  ).toBeDisabled()
  expect(gbot).not.toHaveBeenCalled()
  await chooseAccount()
  await checkAssignments()
  expect(screen.getByLabelText('Assigned Cloud PC')).toHaveValue('')
  const save = screen.getByRole('button', { name: 'Save Cloud PC setup' })
  expect(save).toBeDisabled()
  fireEvent.change(screen.getByLabelText('Assigned Cloud PC'), {
    target: { value: cloudPc.id },
  })
  fireEvent.click(screen.getByLabelText('Supported Microsoft client'))
  expect(save).toBeDisabled()
  fireEvent.click(screen.getByLabelText(/dedicated to the bot/))
  fireEvent.click(save)
  await screen.findByText(
    'Cloud PC setup saved. Desktop control is not connected yet.'
  )
  expect(gbot).toHaveBeenCalledWith('setup/m365/assigned', {
    account_id: 'work-account',
  })
  expect(gbot).toHaveBeenCalledWith('setup/m365/save', {
    id: expect.any(String),
    name: 'Research bot',
    account_id: 'work-account',
    cloud_pc_id: cloudPc.id,
    route: 'brokered_client',
    dedicated: true,
  })
  expect(saved).toHaveBeenCalledOnce()
  expect(
    vi
      .mocked(gbot)
      .mock.calls.every(
        ([path]) => !['connect', 'workspaces', 'workspaces/ssh'].includes(path)
      )
  ).toBe(true)
})

it('explains a release without Microsoft sign-in and offers Advanced without an ID form', async () => {
  vi.mocked(connectorAccounts).mockResolvedValue({ ...accounts(), configs: [] })
  mount()
  expect(
    await screen.findByRole('link', {
      name: 'Settings → Workspace connections',
    })
  ).toHaveAttribute('href', '/settings/workspace-connections')
  expect(
    screen.getByText(/Microsoft sign-in is not configured in this GChat release/)
  ).toHaveTextContent('You do not need to find or enter a client ID.')
  expect(screen.getByRole('alert')).toHaveTextContent(
    'Use an updated release when sign-in is available.'
  )
  expect(screen.getByRole('alert')).toHaveTextContent(
    'If your organization already has an approved Microsoft app, use Advanced'
  )
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  expect(
    screen.getByRole('button', { name: 'Sign in with Microsoft' })
  ).toBeDisabled()
  expect(beginConnectorAuth).not.toHaveBeenCalled()
})

it('recognizes Graph-qualified Cloud PC scopes already accepted by the account owner', async () => {
  const view = accounts()
  view.accounts[0].granted_scopes = [
    'https://graph.microsoft.com/cloudpc.read.all',
  ]
  vi.mocked(connectorAccounts).mockResolvedValue(view)
  mount()
  await chooseAccount()
  expect(
    screen.getByRole('button', { name: 'Check assigned Cloud PCs' })
  ).toBeEnabled()
  expect(
    screen.queryByText(/Cloud PC read permission is missing/)
  ).not.toBeInTheDocument()
})

it('uses read-only account consent and checks sign-in only when requested', async () => {
  vi.mocked(connectorAccounts)
    .mockResolvedValueOnce(accounts(false))
    .mockResolvedValue(accounts())
  vi.mocked(beginConnectorAuth).mockResolvedValue({
    flow_id: 'auth-flow',
    provider: 'microsoft',
    status: 'waiting',
  })
  vi.mocked(connectorAuthStatus).mockResolvedValue({
    flow_id: 'auth-flow',
    provider: 'microsoft',
    status: 'connected',
    account_id: 'work-account',
  })
  mount()
  await chooseAccount()
  expect(
    screen.getByText(/Cloud PC read permission is missing/)
  ).toBeInTheDocument()
  expect(
    screen.getByRole('button', { name: 'Check assigned Cloud PCs' })
  ).toBeDisabled()
  fireEvent.click(
    screen.getByRole('button', { name: 'Allow read-only Cloud PC access' })
  )
  await screen.findByText(/Complete Microsoft sign-in/)
  expect(beginConnectorAuth).toHaveBeenCalledExactlyOnceWith({
    provider: 'microsoft',
    services: ['cloud_pc'],
    access: 'read_only',
    account_id: 'work-account',
  })
  expect(connectorAuthStatus).not.toHaveBeenCalled()
  expect(
    screen.getByRole('button', { name: 'Check assigned Cloud PCs' })
  ).toBeDisabled()
  fireEvent.click(screen.getByRole('button', { name: 'Check sign-in status' }))
  await screen.findByText(
    'Microsoft account connected. Choose the account and check its assigned PCs.'
  )
  expect(connectorAuthStatus).toHaveBeenCalledExactlyOnceWith('auth-flow')
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'Check assigned Cloud PCs' })
    ).toBeEnabled()
  )
  expect(gbot).not.toHaveBeenCalled()
})

it('keeps a newly signed-in account unselected and supports manual cancellation', async () => {
  const view = { ...accounts(), accounts: [], active_flows: [] }
  vi.mocked(connectorAccounts).mockResolvedValue(view)
  vi.mocked(beginConnectorAuth).mockResolvedValue({
    flow_id: 'new-flow',
    provider: 'microsoft',
    status: 'waiting',
  })
  vi.mocked(cancelConnectorAuth).mockResolvedValue({
    flow_id: 'new-flow',
    provider: 'microsoft',
    status: 'cancelled',
  })
  mount()
  await screen.findByLabelText('Microsoft account')
  expect(
    screen.getByRole('button', { name: 'Sign in with Microsoft' })
  ).toBeEnabled()
  expect(
    screen.getByText(/Sign in with your Microsoft work or school account/)
  ).toHaveTextContent('in your browser')
  expect(
    screen.getByText(/GChat requests read-only access/)
  ).toHaveTextContent('multifactor authentication (MFA)')
  expect(
    screen.getByText(/GChat requests read-only access/)
  ).toHaveTextContent('administrator approval')
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  fireEvent.click(
    screen.getByRole('button', { name: 'Sign in with Microsoft' })
  )
  await screen.findByRole('button', { name: 'Cancel sign-in' })
  fireEvent.click(screen.getByRole('button', { name: 'Cancel sign-in' }))
  await screen.findByText('Microsoft sign-in cancelled.')
  expect(beginConnectorAuth).toHaveBeenCalledExactlyOnceWith({
    provider: 'microsoft',
    services: ['cloud_pc'],
    access: 'read_only',
  })
  expect(cancelConnectorAuth).toHaveBeenCalledExactlyOnceWith('new-flow')
  expect(connectorAuthStatus).not.toHaveBeenCalled()
  expect(screen.getByLabelText('Microsoft account')).toHaveValue('')
})

it('does not adopt the connector default after a new account completes sign-in', async () => {
  vi.mocked(connectorAccounts)
    .mockResolvedValueOnce({ ...accounts(), accounts: [] })
    .mockResolvedValue(accounts())
  vi.mocked(beginConnectorAuth).mockResolvedValue({
    flow_id: 'new-flow',
    provider: 'microsoft',
    status: 'waiting',
  })
  vi.mocked(connectorAuthStatus).mockResolvedValue({
    flow_id: 'new-flow',
    provider: 'microsoft',
    status: 'connected',
    account_id: 'work-account',
  })
  mount()
  await screen.findByLabelText('Microsoft account')
  fireEvent.click(
    screen.getByRole('button', { name: 'Sign in with Microsoft' })
  )
  fireEvent.click(
    await screen.findByRole('button', { name: 'Check sign-in status' })
  )
  await screen.findByText(
    'Microsoft account connected. Choose the account and check its assigned PCs.'
  )
  await screen.findByRole('option', { name: 'bot@example.test' })
  expect(screen.getByLabelText('Microsoft account')).toHaveValue('')
  expect(
    screen.getByRole('button', { name: 'Check assigned Cloud PCs' })
  ).toBeDisabled()
  expect(gbot).not.toHaveBeenCalled()
})

it('distinguishes no assignment from a failed permission lookup and allows retry', async () => {
  vi.mocked(gbot)
    .mockRejectedValueOnce(new Error('Tenant denied CloudPC.Read.All'))
    .mockResolvedValueOnce([])
  mount()
  await chooseAccount()
  fireEvent.click(
    screen.getByRole('button', { name: 'Check assigned Cloud PCs' })
  )
  await screen.findByText('Error: Tenant denied CloudPC.Read.All')
  expect(
    screen.queryByText(/No Cloud PCs are assigned/)
  ).not.toBeInTheDocument()
  fireEvent.click(
    screen.getByRole('button', { name: 'Check assigned Cloud PCs' })
  )
  await screen.findByText(/No Cloud PCs are assigned/)
  expect(
    screen.getByRole('button', { name: 'Save Cloud PC setup' })
  ).toBeDisabled()
})

it('resumes the exact saved selection and reports its removed assignment without connecting', async () => {
  vi.mocked(gbot).mockResolvedValue([])
  mount(initial)
  await screen.findByLabelText('Microsoft account')
  expect(screen.getByLabelText('Microsoft account')).toHaveValue(
    initial.account_id
  )
  expect(screen.getByLabelText('Supported Microsoft client')).toBeChecked()
  expect(screen.getByLabelText(/dedicated to the bot/)).not.toBeChecked()
  expect(
    screen.getByRole('button', { name: 'Save Cloud PC setup' })
  ).toBeDisabled()
  expect(gbot).not.toHaveBeenCalled()
  fireEvent.click(
    screen.getByRole('button', { name: 'Check assigned Cloud PCs' })
  )
  await screen.findByText(/saved Cloud PC is no longer assigned/)
  expect(
    screen.getByRole('button', { name: 'Open Microsoft client' })
  ).toBeDisabled()
  expect(
    vi.mocked(gbot).mock.calls.every(([path]) => path === 'setup/m365/assigned')
  ).toBe(true)
})

it('requests a fresh launch URL each time and never saves or renders it', async () => {
  vi.mocked(gbot)
    .mockResolvedValueOnce({
      url: 'https://windows365.microsoft.com/temporary-one',
    })
    .mockResolvedValueOnce({
      url: 'https://windows365.microsoft.com/temporary-two',
    })
  mount(initial)
  await screen.findByLabelText('Microsoft account')
  fireEvent.click(screen.getByRole('button', { name: 'Open Microsoft client' }))
  await screen.findByText(
    'Microsoft client opened. Desktop control is not connected yet.'
  )
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'Open Microsoft client' })
    ).toBeEnabled()
  )
  fireEvent.click(screen.getByRole('button', { name: 'Open Microsoft client' }))
  await waitFor(() => expect(opener).toHaveBeenCalledTimes(2))
  expect(opener.mock.calls).toEqual([
    ['https://windows365.microsoft.com/temporary-one'],
    ['https://windows365.microsoft.com/temporary-two'],
  ])
  expect(vi.mocked(gbot).mock.calls).toEqual([
    ['setup/m365/launch', { id: initial.id }],
    ['setup/m365/launch', { id: initial.id }],
  ])
  expect(
    screen.queryByText(/temporary-one|temporary-two/)
  ).not.toBeInTheDocument()
})

it('keeps the same setup ID and exact route through a failed save retry', async () => {
  vi.mocked(gbot)
    .mockResolvedValueOnce([cloudPc])
    .mockRejectedValueOnce(new Error('Setup store unavailable'))
    .mockResolvedValueOnce({ ...initial, route: 'guest_worker' })
  const saved = mount(initial)
  await screen.findByLabelText('Microsoft account')
  await checkAssignments()
  expect(screen.getByLabelText('Assigned Cloud PC')).toHaveValue(cloudPc.id)
  fireEvent.click(screen.getByLabelText('Worker in the Cloud PC user session'))
  expect(
    screen.getByRole('button', { name: 'Open Microsoft client' })
  ).toBeDisabled()
  fireEvent.click(screen.getByLabelText(/dedicated to the bot/))
  fireEvent.click(screen.getByRole('button', { name: 'Save Cloud PC setup' }))
  await screen.findByText('Error: Setup store unavailable')
  expect(saved).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Save Cloud PC setup' }))
  await waitFor(() => expect(saved).toHaveBeenCalledOnce())
  const saves = vi
    .mocked(gbot)
    .mock.calls.filter(([path]) => path === 'setup/m365/save')
  expect(saves).toEqual(
    Array(2).fill([
      'setup/m365/save',
      {
        id: initial.id,
        name: 'Research bot',
        account_id: initial.account_id,
        cloud_pc_id: cloudPc.id,
        route: 'guest_worker',
        dedicated: true,
      },
    ])
  )
})

it('uses Microsoft accounts on the selected LAN service and keeps sign-in there', async () => {
  vi.mocked(getGbotServiceTarget).mockResolvedValue({
    kind: 'paired_host',
    host_id: 'remote-host',
  })
  vi.mocked(gbot).mockImplementation(async (path) =>
    path === 'setup/m365/accounts' ? accounts() : []
  )
  mount()
  await screen.findByLabelText('Microsoft account')
  expect(connectorAccounts).not.toHaveBeenCalled()
  expect(gbot).toHaveBeenCalledWith('setup/m365/accounts')
  expect(
    screen.getByRole('button', { name: /Sign in with Microsoft/ })
  ).toBeDisabled()
  expect(
    screen.getByText(/These accounts belong to the service computer/)
  ).toHaveTextContent(
    'Sign-in and Microsoft’s desktop client run on the service computer.'
  )
  expect(
    screen.getByRole('button', { name: 'Open Microsoft client' })
  ).toBeDisabled()
  fireEvent.click(
    screen.getByRole('button', { name: 'Refresh Microsoft accounts' })
  )
  await waitFor(() => expect(gbot).toHaveBeenCalledTimes(2))
  expect(vi.mocked(gbot).mock.calls).toEqual([
    ['setup/m365/accounts'],
    ['setup/m365/accounts'],
  ])
  expect(connectorAccounts).not.toHaveBeenCalled()
  expect(beginConnectorAuth).not.toHaveBeenCalled()
  expect(opener).not.toHaveBeenCalled()
})

import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  ConnectorAccountsView,
  ConnectorAuthFlow,
} from '@/services/workspace-connectors'
import { WorkspaceConnections } from '../workspace-connections'

const api = vi.hoisted(() => ({
  connectorAccounts: vi.fn(),
  configureConnector: vi.fn(),
  nativeInvoke: vi.fn(),
  beginConnectorAuth: vi.fn(),
  connectorAuthStatus: vi.fn(),
  cancelConnectorAuth: vi.fn(),
  selectConnectorAccount: vi.fn(),
  disconnectConnectorAccount: vi.fn(),
}))
vi.mock('@/services/workspace-connectors', async () => ({
  ...(await vi.importActual<typeof import('@/services/workspace-connectors')>(
    '@/services/workspace-connectors'
  )),
  ...api,
}))
vi.mock('@tauri-apps/api/core', () => ({ invoke: api.nativeInvoke }))
vi.mock('@/containers/SettingsMenu', () => ({
  default: () => <nav>Settings</nav>,
}))
vi.mock('@/containers/HeaderPage', () => ({
  default: ({ children }: { children: React.ReactNode }) => (
    <header>{children}</header>
  ),
}))
vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: unknown) => options,
}))

const initialView = (): ConnectorAccountsView => ({
  configs: [
    {
      provider: 'google',
      client_id: 'google-client',
      tenant: null,
      has_client_secret: false,
    },
    {
      provider: 'microsoft',
      client_id: 'microsoft-client',
      tenant: 'common',
      has_client_secret: false,
    },
  ],
  accounts: [],
  active_flows: [],
  selected_accounts: {},
  services: {
    google: [
      {
        id: 'gmail',
        read_scopes: ['gmail.readonly'],
        write_scopes: ['gmail.modify'],
      },
    ],
    microsoft: [
      {
        id: 'excel',
        read_scopes: ['Files.ReadWrite'],
        write_scopes: ['Files.ReadWrite'],
      },
    ],
  },
})
const waiting: ConnectorAuthFlow = {
  flow_id: 'flow-google',
  provider: 'google',
  status: 'waiting',
}
function googleCard() {
  return within(
    screen.getByRole('heading', { name: 'Google Workspace' }).parentElement!
  )
}
async function ready() {
  render(<WorkspaceConnections />)
  await screen.findByRole('button', { name: 'Connect Google Workspace' })
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'Refresh accounts' })
    ).toBeEnabled()
  )
}

beforeEach(() => {
  vi.resetAllMocks()
  api.connectorAccounts.mockResolvedValue(initialView())
})
afterEach(() => {
  vi.useRealTimers()
})

describe('Workspace connections', () => {
  it('loads saved accounts only after an explicit connection from a cold session', async () => {
    api.connectorAccounts
      .mockRejectedValueOnce(new Error('Connect the account service first'))
      .mockResolvedValue(initialView())
    render(<WorkspaceConnections />)
    const connect = await screen.findByRole('button', {
      name: 'Connect account service',
    })
    expect(api.connectorAccounts).toHaveBeenCalledExactlyOnceWith()
    await userEvent.setup().click(connect)
    await screen.findByRole('button', { name: 'Connect Google Workspace' })
    expect(api.connectorAccounts).toHaveBeenNthCalledWith(2, true)
    expect(api.connectorAccounts).toHaveBeenCalledTimes(2)
  })

  it('requires saved registration and explicit services before sign-in', async () => {
    const view = initialView()
    view.configs[0].client_id = ''
    api.connectorAccounts.mockResolvedValue(view)
    await ready()
    const user = userEvent.setup()
    await user.click(googleCard().getByLabelText('Gmail'))
    expect(
      screen.getByRole('button', { name: 'Connect Google Workspace' })
    ).toBeDisabled()
    expect(
      screen.getByText('Import your Desktop app JSON before connecting.')
    ).toBeInTheDocument()
    expect(api.beginConnectorAuth).not.toHaveBeenCalled()
  })

  it('guides user-owned Desktop setup with direct project, API and OAuth console links', async () => {
    const view = initialView()
    view.configs[0].client_id = ''
    api.connectorAccounts.mockResolvedValue(view)
    await ready()
    const google = googleCard()
    expect(
      google.getByText(/GChat does not include a shared Google app/)
    ).toBeInTheDocument()
    expect(
      google.getByRole('link', { name: 'Google Cloud Console' })
    ).toHaveAttribute(
      'href',
      'https://console.cloud.google.com/projectcreate'
    )
    for (const [name, page] of [
      ['Branding', 'branding'],
      ['Audience', 'audience'],
      ['Clients', 'clients'],
    ]) {
      expect(google.getByRole('link', { name })).toHaveAttribute(
        'href',
        `https://console.cloud.google.com/auth/${page}`
      )
    }
    expect(
      google.getAllByRole('link').filter((link) =>
        link
          .getAttribute('href')
          ?.startsWith('https://console.cloud.google.com/apis/enableflow;apiid=')
      )
    ).toHaveLength(8)
    expect(google.getByText(/choose External/)).toBeInTheDocument()
    expect(
      google.getByText(/add your own Google email as a test user/)
    ).toBeInTheDocument()
    expect(google.getByText(/In production/)).toBeInTheDocument()
    expect(
      google.getByRole('link', {
        name: /Testing refresh tokens expire after seven days/,
      })
    ).toBeInTheDocument()
    expect(
      google.getByText(/This does not bypass an organization block/)
    ).toBeInTheDocument()
    expect(google.queryByText(/drop it here/i)).not.toBeInTheDocument()
  })

  it('imports a Desktop JSON file directly to the native vault without credential fields', async () => {
    await ready()
    expect(googleCard().getByText(/The app secret goes directly to GChat’s protected credential store/)).toBeInTheDocument()
    api.nativeInvoke.mockResolvedValue(initialView())
    const file = new File(
      [JSON.stringify({ installed: {
        client_id: 'downloaded-client.apps.googleusercontent.com',
        client_secret: 'private-desktop-secret',
      } })],
      'client-secret.json',
      { type: 'application/json' }
    )
    const input = googleCard().getByLabelText('Import Google Desktop app JSON')
    await userEvent.setup().upload(input, file)
    await waitFor(() => expect(api.nativeInvoke).toHaveBeenCalledWith(
      'connector_configure',
      { request: {
        provider: 'google',
        client_id: 'downloaded-client.apps.googleusercontent.com',
        client_secret: 'private-desktop-secret',
      } }
    ))
    await waitFor(() => expect(input).toBeEnabled())
    expect(input).toHaveValue('')
    expect(googleCard().queryByLabelText('Client ID')).not.toBeInTheDocument()
    expect(googleCard().queryByLabelText('App secret (optional)')).not.toBeInTheDocument()
    expect(screen.queryByText(/private-desktop-secret/)).not.toBeInTheDocument()
    expect(api.beginConnectorAuth).not.toHaveBeenCalled()
  })

  it('imports a replacement Desktop JSON and clears any previously saved vault secret when absent', async () => {
    const view = initialView()
    view.configs[0].has_client_secret = true
    api.connectorAccounts.mockResolvedValue(view)
    api.nativeInvoke.mockResolvedValue(initialView())
    await ready()
    const file = new File(
      [JSON.stringify({ installed: { client_id: 'replacement-client' } })],
      'desktop.json'
    )
    await userEvent.setup().upload(
      googleCard().getByLabelText('Import Google Desktop app JSON'), file
    )
    await waitFor(() => expect(api.nativeInvoke).toHaveBeenCalledWith(
      'connector_configure',
      { request: { provider: 'google', client_id: 'replacement-client', client_secret: '' } }
    ))
    expect(screen.queryByText(/replacement-client/)).not.toBeInTheDocument()
    expect(api.beginConnectorAuth).not.toHaveBeenCalled()
  })

  it('keeps imported contents and native error details out of validation and saving errors', async () => {
    await ready()
    const group = googleCard().getByRole('group', { name: 'Google Desktop app JSON import' })
    const input = googleCard().getByLabelText('Import Google Desktop app JSON')
    const user = userEvent.setup()
    const webClient = new File(
      [JSON.stringify({ web: { client_id: 'web-client', client_secret: 'private-file-secret' } })],
      'web.json'
    )
    await user.upload(input, webClient)
    await screen.findByText(/Choose the downloaded Google Desktop app JSON file/)
    expect(api.nativeInvoke).not.toHaveBeenCalled()
    expect(screen.queryByText(/private-file-secret/)).not.toBeInTheDocument()
    await waitFor(() => expect(group).toHaveAttribute('aria-busy', 'false'))
    api.nativeInvoke.mockRejectedValue(new Error('private-native-secret'))
    await user.upload(input, new File(
      [JSON.stringify({ installed: { client_id: 'client', client_secret: 'private-file-secret' } })],
      'desktop.json'
    ))
    await screen.findByText(/Could not save the Google registration/)
    expect(screen.queryByText(/private-native-secret|private-file-secret/)).not.toBeInTheDocument()
  })

  it('rejects multiple files and ignores a second import while one is pending', async () => {
    await ready()
    const group = googleCard().getByRole('group', { name: 'Google Desktop app JSON import' })
    const input = googleCard().getByLabelText('Import Google Desktop app JSON')
    const file = new File([JSON.stringify({ installed: { client_id: 'client' } })], 'desktop.json')
    fireEvent.change(input, { target: { files: [file, file] } })
    expect(googleCard().getByRole('alert')).toHaveTextContent('Choose one downloaded Google Desktop app JSON file.')
    expect(api.nativeInvoke).not.toHaveBeenCalled()
    let finish!: (view: ConnectorAccountsView) => void
    api.nativeInvoke.mockImplementation(() => new Promise((resolve) => { finish = resolve }))
    fireEvent.change(input, { target: { files: [file] } })
    await waitFor(() => expect(api.nativeInvoke).toHaveBeenCalledTimes(1))
    expect(input).toBeDisabled()
    fireEvent.change(input, { target: { files: [file] } })
    expect(api.nativeInvoke).toHaveBeenCalledTimes(1)
    await act(async () => { finish(initialView()) })
    await waitFor(() => expect(group).toHaveAttribute('aria-busy', 'false'))
  })

  it('omits an empty optional Microsoft tenant so native registration uses common', async () => {
    const view = initialView()
    view.configs[1].tenant = null
    api.connectorAccounts.mockResolvedValue(view)
    api.configureConnector.mockResolvedValue(initialView())
    await ready()
    const user = userEvent.setup()
    const microsoft = within(
      screen.getByRole('heading', { name: 'Microsoft 365' }).parentElement!
    )
    await user.click(
      microsoft.getByText('Advanced: use your organization’s Microsoft app')
    )
    expect(
      microsoft.getByText(/leave Tenant blank to use common/)
    ).toHaveTextContent('work, school and personal accounts')
    await user.click(
      microsoft.getByRole('button', { name: 'Save Microsoft 365 registration' })
    )
    await waitFor(() =>
      expect(api.configureConnector).toHaveBeenCalledWith({
        provider: 'microsoft',
        client_id: 'microsoft-client',
      })
    )
    await waitFor(() =>
      expect(microsoft.getByLabelText('Tenant (optional)')).toHaveValue('common')
    )
    expect(
      microsoft.getByRole('button', { name: 'Save Microsoft 365 registration' })
    ).toBeEnabled()
  })

  it('explains a missing release identity without exposing a default client ID form', async () => {
    const view = initialView()
    view.configs = view.configs.filter((config) => config.provider !== 'microsoft')
    api.connectorAccounts.mockResolvedValue(view)
    await ready()
    const microsoft = within(
      screen.getByRole('heading', { name: 'Microsoft 365' }).parentElement!
    )
    expect(
      microsoft.getByText(
        /Microsoft sign-in is unavailable in this GChat build/
      )
    ).toHaveTextContent('Install a release that includes Microsoft sign-in')
    expect(
      microsoft.getByRole('button', { name: 'Sign in with Microsoft' })
    ).toBeDisabled()
    const field = microsoft.getByLabelText('Client ID')
    expect(field.closest('details')).not.toHaveAttribute('open')
    expect(api.beginConnectorAuth).not.toHaveBeenCalled()
    await userEvent.setup().click(
      microsoft.getByText('Advanced: use your organization’s Microsoft app')
    )
    expect(field.closest('details')).toHaveAttribute('open')
    expect(
      microsoft.getByText(/copy its Application \(client\) ID/)
    ).toBeInTheDocument()
    expect(
      microsoft.getByText('http://localhost/oauth/callback')
    ).toBeInTheDocument()
    expect(
      microsoft.queryByLabelText('App secret (optional)')
    ).not.toBeInTheDocument()
  })

  it('uses the configured release identity for Microsoft browser sign-in without editing an ID', async () => {
    await ready()
    const microsoft = within(
      screen.getByRole('heading', { name: 'Microsoft 365' }).parentElement!
    )
    const signIn = microsoft.getByRole('button', { name: 'Sign in with Microsoft' })
    expect(signIn).toBeDisabled()
    expect(
      microsoft.getByText(/The app registration is already set up/)
    ).toHaveTextContent('you do not need to enter an app ID')
    expect(
      microsoft.getByLabelText('Client ID').closest('details')
    ).not.toHaveAttribute('open')
    const user = userEvent.setup()
    await user.click(microsoft.getByLabelText('Excel'))
    api.beginConnectorAuth.mockResolvedValue({
      ...waiting,
      provider: 'microsoft',
      flow_id: 'flow-microsoft',
    })
    await user.click(signIn)
    await waitFor(() =>
      expect(api.beginConnectorAuth).toHaveBeenCalledWith({
        provider: 'microsoft',
        services: ['excel'],
        access: 'read_only',
      })
    )
    expect(api.configureConnector).not.toHaveBeenCalled()
    expect(
      screen.getByText('Complete Microsoft 365 sign-in in your browser.')
    ).toBeInTheDocument()
  })

  it('requests only selected services and access through system-browser sign-in', async () => {
    await ready()
    const user = userEvent.setup()
    await user.click(googleCard().getByLabelText('Gmail'))
    await user.selectOptions(
      googleCard().getByLabelText('Access'),
      'read_write'
    )
    api.beginConnectorAuth.mockResolvedValue(waiting)
    await user.click(
      screen.getByRole('button', { name: 'Connect Google Workspace' })
    )
    await waitFor(() =>
      expect(api.beginConnectorAuth).toHaveBeenCalledWith({
        provider: 'google',
        services: ['gmail'],
        access: 'read_write',
      })
    )
    expect(
      screen.getByText('Complete Google Workspace sign-in in your browser.')
    ).toBeInTheDocument()
    expect(
      screen.queryByText('Google Workspace account connected.')
    ).not.toBeInTheDocument()
  })

  it('offers personal Outlook and OneDrive through the common registration without app setup', async () => {
    const view = initialView()
    view.services.microsoft = [
      {
        id: 'outlook',
        read_scopes: ['Mail.Read'],
        write_scopes: ['Mail.ReadWrite'],
      },
      {
        id: 'onedrive',
        read_scopes: ['Files.Read'],
        write_scopes: ['Files.ReadWrite'],
      },
    ]
    api.connectorAccounts.mockResolvedValue(view)
    api.beginConnectorAuth.mockResolvedValue({
      ...waiting,
      provider: 'microsoft',
      flow_id: 'personal-sign-in',
    })
    await ready()
    const microsoft = within(
      screen.getByRole('heading', { name: 'Microsoft 365' }).parentElement!
    )
    expect(
      microsoft.getByText(/Outlook.com, Hotmail and personal OneDrive/)
    ).toBeInTheDocument()
    const user = userEvent.setup()
    await user.click(microsoft.getByLabelText('Outlook mail'))
    await user.click(microsoft.getByLabelText('OneDrive'))
    await user.click(
      microsoft.getByRole('button', { name: 'Sign in with Microsoft' })
    )
    await waitFor(() =>
      expect(api.beginConnectorAuth).toHaveBeenCalledExactlyOnceWith({
        provider: 'microsoft',
        services: ['outlook', 'onedrive'],
        access: 'read_only',
      })
    )
    expect(api.configureConnector).not.toHaveBeenCalled()
    expect(
      microsoft.queryByText(/This needs a work or school account/)
    ).not.toBeInTheDocument()
  })

  it('explains work-only services and keeps administrator approval failures actionable', async () => {
    const view = initialView()
    view.services.microsoft = [
      {
        id: 'sharepoint',
        read_scopes: ['Sites.Read.All'],
        write_scopes: ['Sites.ReadWrite.All'],
      },
    ]
    api.connectorAccounts.mockResolvedValue(view)
    const approvalMessage =
      'Microsoft needs permission approval. Sign in again and review the requested permissions. If your organization requires administrator approval, ask its administrator to approve GChat.'
    api.beginConnectorAuth.mockResolvedValue({
      flow_id: 'approval-needed',
      provider: 'microsoft',
      status: 'failed',
      error: approvalMessage,
    })
    await ready()
    const microsoft = within(
      screen.getByRole('heading', { name: 'Microsoft 365' }).parentElement!
    )
    const user = userEvent.setup()
    await user.click(microsoft.getByLabelText('SharePoint'))
    expect(
      microsoft.getByText(/This needs a work or school account/)
    ).toBeInTheDocument()
    await user.click(
      microsoft.getByRole('button', { name: 'Sign in with Microsoft' })
    )
    expect(await screen.findByText(approvalMessage)).toBeInTheDocument()
    expect(
      microsoft.getByRole('button', { name: 'Sign in with Microsoft' })
    ).toBeEnabled()
    expect(api.configureConnector).not.toHaveBeenCalled()
    expect(api.selectConnectorAccount).not.toHaveBeenCalled()
  })

  it('shows actual broader Excel provider consent for a read-only connection', async () => {
    await ready()
    const user = userEvent.setup()
    await user.click(screen.getByLabelText('Excel'))
    await user.click(screen.getByText('Requested service permissions'))
    expect(screen.getByText('Files.ReadWrite')).toBeInTheDocument()
    expect(
      screen.getAllByText(/Read only prevents GChat from writing/)
    ).toHaveLength(2)
  })

  it('keeps the account and default when a disconnect fails, then retries local Microsoft disconnect', async () => {
    const view = initialView()
    view.accounts = [
      {
        id: 'ms-account',
        provider: 'microsoft',
        subject: 'subject',
        display_name: 'Ron Microsoft',
        email: 'ron@example.test',
        services: ['excel'],
        access: 'read_only',
        granted_scopes: ['Files.ReadWrite'],
        needs_reconnect: false,
      },
    ]
    view.selected_accounts.microsoft = 'ms-account'
    api.connectorAccounts.mockResolvedValue(view)
    api.disconnectConnectorAccount
      .mockRejectedValueOnce(new Error('Vault unavailable'))
      .mockResolvedValueOnce(initialView())
    await ready()
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Disconnect' }))
    expect(screen.getByText(/This removes local access/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Disconnect account' }))
    expect(
      await within(screen.getByRole('dialog')).findByRole('alert')
    ).toHaveTextContent('Vault unavailable')
    expect(
      screen.getByRole('button', { name: 'Disconnect account' })
    ).toBeEnabled()
    expect(screen.getByText('Ron Microsoft')).toBeInTheDocument()
    expect(screen.getByText('Connected · Default account')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Disconnect account' }))
    await waitFor(() =>
      expect(screen.queryByText('Ron Microsoft')).not.toBeInTheDocument()
    )
    expect(api.disconnectConnectorAccount).toHaveBeenNthCalledWith(
      1,
      'microsoft',
      'ms-account',
      false
    )
    expect(api.disconnectConnectorAccount).toHaveBeenNthCalledWith(
      2,
      'microsoft',
      'ms-account',
      false
    )
  })

  it('reconnects the existing account with its recorded service grants and access', async () => {
    const view = initialView()
    view.accounts = [
      {
        id: 'google-account',
        provider: 'google',
        subject: 'subject',
        display_name: 'Ron Google',
        email: null,
        services: ['gmail'],
        access: 'read_only',
        granted_scopes: ['gmail.readonly'],
        needs_reconnect: true,
      },
    ]
    api.connectorAccounts.mockResolvedValue(view)
    api.beginConnectorAuth.mockResolvedValue(waiting)
    await ready()
    const user = userEvent.setup()
    expect(screen.getByText('Reconnect required')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Reconnect' }))
    await waitFor(() =>
      expect(api.beginConnectorAuth).toHaveBeenCalledWith({
        provider: 'google',
        services: ['gmail'],
        access: 'read_only',
        account_id: 'google-account',
      })
    )
  })

  it('changes the provider default only after native selection succeeds', async () => {
    const view = initialView()
    view.accounts = [
      {
        id: 'google-account',
        provider: 'google',
        subject: 'subject',
        display_name: 'Ron Google',
        email: null,
        services: ['gmail'],
        access: 'read_only',
        granted_scopes: ['gmail.readonly'],
        needs_reconnect: false,
      },
    ]
    api.connectorAccounts.mockResolvedValue(view)
    api.selectConnectorAccount
      .mockRejectedValueOnce(new Error('Could not save selection'))
      .mockResolvedValueOnce({
        ...view,
        selected_accounts: { google: 'google-account' },
      })
    await ready()
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Make default' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Could not save selection'
    )
    expect(
      screen.queryByText('Connected · Default account')
    ).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Make default' }))
    expect(
      await screen.findByText('Connected · Default account')
    ).toBeInTheDocument()
    expect(api.selectConnectorAccount).toHaveBeenCalledWith(
      'google',
      'google-account'
    )
  })

  it('refreshes public account metadata only after the native flow reports connected', async () => {
    vi.useFakeTimers()
    api.beginConnectorAuth.mockResolvedValue(waiting)
    api.connectorAuthStatus.mockResolvedValue({
      ...waiting,
      status: 'connected',
      account_id: 'google-account',
    })
    const connected = initialView()
    connected.accounts = [
      {
        id: 'google-account',
        provider: 'google',
        subject: 'subject',
        display_name: 'Ron Google',
        email: null,
        services: ['gmail'],
        access: 'read_only',
        granted_scopes: ['gmail.readonly'],
        needs_reconnect: false,
      },
    ]
    api.connectorAccounts
      .mockResolvedValueOnce(initialView())
      .mockResolvedValue(connected)
    render(<WorkspaceConnections />)
    await act(async () => {})
    fireEvent.click(googleCard().getByLabelText('Gmail'))
    await act(async () => {
      fireEvent.click(
        screen.getByRole('button', { name: 'Connect Google Workspace' })
      )
    })
    expect(screen.queryByText('Ron Google')).not.toBeInTheDocument()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })
    expect(
      screen.getByText('Google Workspace account connected.')
    ).toBeInTheDocument()
    expect(screen.getByText('Ron Google')).toBeInTheDocument()
    expect(api.connectorAccounts).toHaveBeenCalledTimes(2)
  })

  it('ignores an older waiting poll after explicit cancellation', async () => {
    vi.useFakeTimers()
    let releaseStatus!: (value: ConnectorAuthFlow) => void
    api.beginConnectorAuth.mockResolvedValue(waiting)
    api.connectorAuthStatus.mockImplementation(
      () =>
        new Promise<ConnectorAuthFlow>((resolve) => {
          releaseStatus = resolve
        })
    )
    api.cancelConnectorAuth.mockResolvedValue({
      ...waiting,
      status: 'cancelled',
    })
    render(<WorkspaceConnections />)
    await act(async () => {})
    fireEvent.click(googleCard().getByLabelText('Gmail'))
    await act(async () => {
      fireEvent.click(
        screen.getByRole('button', { name: 'Connect Google Workspace' })
      )
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })
    expect(api.connectorAuthStatus).toHaveBeenCalledWith('flow-google')
    await act(async () => {
      fireEvent.click(
        screen.getByRole('button', { name: 'Cancel Google Workspace sign-in' })
      )
    })
    await act(async () => {
      releaseStatus(waiting)
    })
    expect(screen.getByText('Sign-in cancelled.')).toBeInTheDocument()
    expect(
      screen.queryByText('Complete Google Workspace sign-in in your browser.')
    ).not.toBeInTheDocument()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000)
    })
    expect(api.connectorAuthStatus).toHaveBeenCalledTimes(1)
  })

  it('resumes native pending flows on remount and cancels only the chosen provider', async () => {
    vi.useFakeTimers()
    const view = initialView()
    const microsoft: ConnectorAuthFlow = {
      flow_id: 'flow-microsoft',
      provider: 'microsoft',
      status: 'waiting',
    }
    view.active_flows = [waiting, microsoft]
    api.connectorAccounts.mockResolvedValue(view)
    api.cancelConnectorAuth.mockResolvedValue({
      ...waiting,
      status: 'cancelled',
    })
    api.connectorAuthStatus.mockResolvedValue(microsoft)
    render(<WorkspaceConnections />)
    await act(async () => {})
    expect(
      screen.getByText('Complete Google Workspace sign-in in your browser.')
    ).toBeInTheDocument()
    expect(
      screen.getByText('Complete Microsoft 365 sign-in in your browser.')
    ).toBeInTheDocument()
    await act(async () => {
      fireEvent.click(
        screen.getByRole('button', { name: 'Cancel Google Workspace sign-in' })
      )
    })
    expect(api.cancelConnectorAuth).toHaveBeenCalledWith('flow-google')
    expect(
      screen.getByText('Complete Microsoft 365 sign-in in your browser.')
    ).toBeInTheDocument()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })
    expect(api.connectorAuthStatus).toHaveBeenCalledWith('flow-microsoft')
    expect(api.beginConnectorAuth).not.toHaveBeenCalled()
  })

  it('pauses a failed status read until an explicit retry without declaring sign-in failed', async () => {
    vi.useFakeTimers()
    const view = initialView()
    view.active_flows = [waiting]
    api.connectorAccounts.mockResolvedValue(view)
    api.connectorAuthStatus
      .mockRejectedValueOnce(new Error('Status unavailable'))
      .mockResolvedValueOnce(waiting)
    render(<WorkspaceConnections />)
    await act(async () => {})
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Use Check sign-in status to retry'
    )
    expect(
      screen.getByText('Complete Google Workspace sign-in in your browser.')
    ).toBeInTheDocument()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000)
    })
    expect(api.connectorAuthStatus).toHaveBeenCalledTimes(1)
    fireEvent.click(
      screen.getByRole('button', { name: 'Check sign-in status' })
    )
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })
    expect(api.connectorAuthStatus).toHaveBeenCalledTimes(2)
  })
})

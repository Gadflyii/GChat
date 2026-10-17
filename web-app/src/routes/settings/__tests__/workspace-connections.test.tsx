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
  await screen.findByRole('heading', { name: 'Google Workspace' })
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'Refresh accounts' })
    ).toBeEnabled()
  )
}

async function openGoogleImport() {
  const user = userEvent.setup()
  await user.click(
    googleCard().getByRole('button', {
      name: /^(Set up Google|Review Google setup)$/,
    })
  )
  const guide = within(screen.getByRole('dialog'))
  await user.click(
    guide.getByRole('button', {
      name: 'I already have the downloaded JSON file',
    })
  )
  return guide
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
      screen.getByRole('button', { name: 'Set up Google' })
    ).toBeInTheDocument()
    expect(api.beginConnectorAuth).not.toHaveBeenCalled()
  })

  it('keeps Google instructions in a sequential pop-out guide with an explicit return path', async () => {
    const view = initialView()
    view.configs[0].client_id = ''
    api.connectorAccounts.mockResolvedValue(view)
    await ready()
    const user = userEvent.setup()
    expect(
      screen.queryByRole('link', { name: 'Google Cloud Console' })
    ).not.toBeInTheDocument()
    await user.click(
      googleCard().getByRole('button', { name: 'Set up Google' })
    )
    const guide = within(screen.getByRole('dialog'))
    expect(guide.getByText('Step 1 of 6')).toBeInTheDocument()
    expect(
      guide.getByText(/GChat does not include a shared Google app/)
    ).toBeInTheDocument()
    expect(
      guide.getByRole('link', { name: 'Google Cloud Console' })
    ).toHaveAttribute('href', 'https://console.cloud.google.com/projectcreate')
    expect(
      guide.queryByRole('link', { name: 'Branding' })
    ).not.toBeInTheDocument()
    await user.click(guide.getByRole('button', { name: 'Next' }))
    expect(guide.getByText('Step 2 of 6')).toBeInTheDocument()
    expect(
      guide
        .getAllByRole('link')
        .filter((link) =>
          link.getAttribute('href')?.includes('/apis/enableflow;apiid=')
        )
    ).toHaveLength(8)
    await user.click(guide.getByRole('button', { name: 'Next' }))
    for (const [name, page] of [
      ['Branding', 'branding'],
      ['Audience', 'audience'],
      ['Data Access', 'scopes'],
    ]) {
      expect(guide.getByRole('link', { name })).toHaveAttribute(
        'href',
        `https://console.cloud.google.com/auth/${page}`
      )
    }
    expect(
      guide.getByText(/add your own Google email as a test user/)
    ).toBeInTheDocument()
    expect(
      guide.getByRole('link', {
        name: /Testing refresh tokens expire after seven days/,
      })
    ).toBeInTheDocument()
    await user.click(guide.getByRole('button', { name: 'Next' }))
    expect(guide.getByRole('link', { name: 'Clients' })).toHaveAttribute(
      'href',
      'https://console.cloud.google.com/auth/clients'
    )
    expect(
      guide.getByText(/alternative form on the next step/)
    ).toBeInTheDocument()
    expect(guide.getByText(/temporary local callback at/)).toHaveTextContent(
      'http://127.0.0.1:<port>/oauth/callback'
    )
    await user.click(guide.getByRole('button', { name: 'Next' }))
    expect(
      guide.getByLabelText('Import Google Desktop app JSON')
    ).toBeInTheDocument()
    expect(
      guide.queryByRole('button', { name: 'Next' })
    ).not.toBeInTheDocument()
    await user.click(guide.getByRole('button', { name: 'Back' }))
    expect(guide.getByText('Step 4 of 6')).toBeInTheDocument()
    await user.click(guide.getByRole('button', { name: 'Close' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(
      googleCard().getByRole('button', { name: 'Set up Google' })
    ).toBeVisible()
  })

  it('imports a Desktop JSON file directly to the native vault without displaying its secret', async () => {
    await ready()
    const guide = await openGoogleImport()
    expect(
      guide.getByText(
        /The app secret goes directly to GChat’s protected credential store/
      )
    ).toBeInTheDocument()
    api.nativeInvoke.mockResolvedValue(initialView())
    const file = new File(
      [
        JSON.stringify({
          installed: {
            client_id: 'downloaded-client.apps.googleusercontent.com',
            client_secret: 'private-desktop-secret',
          },
        }),
      ],
      'client-secret.json',
      { type: 'application/json' }
    )
    const input = guide.getByLabelText('Import Google Desktop app JSON')
    await userEvent.setup().upload(input, file)
    await waitFor(() =>
      expect(api.nativeInvoke).toHaveBeenCalledWith('connector_configure', {
        request: {
          provider: 'google',
          client_id: 'downloaded-client.apps.googleusercontent.com',
          client_secret: 'private-desktop-secret',
        },
      })
    )
    expect(
      await screen.findByText(
        /Your Google registration has been saved in GChat/
      )
    ).toHaveTextContent('Your account is not connected yet')
    expect(
      screen.queryByLabelText('Import Google Desktop app JSON')
    ).not.toBeInTheDocument()
    await userEvent
      .setup()
      .click(guide.getByRole('button', { name: 'Choose services' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(googleCard().queryByLabelText('Client ID')).not.toBeInTheDocument()
    expect(
      googleCard().queryByLabelText('App secret (optional)')
    ).not.toBeInTheDocument()
    expect(screen.queryByText(/private-desktop-secret/)).not.toBeInTheDocument()
    expect(api.beginConnectorAuth).not.toHaveBeenCalled()
  })

  it('saves pasted Desktop credentials, clears the secret before saving, then enables explicit browser sign-in', async () => {
    const empty = initialView()
    empty.configs[0].client_id = ''
    api.connectorAccounts.mockResolvedValue(empty)
    let finish!: (view: ConnectorAccountsView) => void
    api.nativeInvoke.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve
        })
    )
    await ready()
    const user = userEvent.setup()
    const guide = await openGoogleImport()
    await user.click(
      guide.getByText('Paste a Desktop client ID and secret instead')
    )
    const client = guide.getByLabelText('Google Desktop client ID')
    const secret = guide.getByLabelText('Google Desktop client secret')
    const save = guide.getByRole('button', { name: 'Save Google registration' })
    expect(save).toBeDisabled()
    expect(secret).toHaveAttribute('type', 'password')
    await user.type(client, 'pasted.apps.googleusercontent.com')
    await user.type(secret, 'synthetic-desktop-secret')
    await user.click(save)
    await waitFor(() =>
      expect(api.nativeInvoke).toHaveBeenCalledExactlyOnceWith(
        'connector_configure',
        {
          request: {
            provider: 'google',
            client_id: 'pasted.apps.googleusercontent.com',
            client_secret: 'synthetic-desktop-secret',
          },
        }
      )
    )
    expect(secret).toHaveValue('')
    expect(save).toBeDisabled()
    fireEvent.submit(save.closest('form')!)
    expect(api.nativeInvoke).toHaveBeenCalledTimes(1)
    expect(api.beginConnectorAuth).not.toHaveBeenCalled()
    const saved = initialView()
    saved.configs[0].client_id = 'pasted.apps.googleusercontent.com'
    saved.configs[0].has_client_secret = true
    await act(async () => {
      finish(saved)
    })
    expect(
      await guide.findByText(/Your Google registration has been saved in GChat/)
    ).toHaveTextContent('Your account is not connected yet')
    expect(guide.getByText(/Keep GChat open/)).toHaveTextContent(
      'do not paste a callback URL or authorization code anywhere'
    )
    expect(
      guide.queryByLabelText('Google Desktop client secret')
    ).not.toBeInTheDocument()
    await user.click(guide.getByRole('button', { name: 'Choose services' }))
    const google = googleCard()
    await user.click(google.getByLabelText('Gmail'))
    api.beginConnectorAuth.mockResolvedValue(waiting)
    await user.click(
      google.getByRole('button', { name: 'Connect Google Workspace' })
    )
    expect(api.beginConnectorAuth).toHaveBeenCalledExactlyOnceWith({
      provider: 'google',
      services: ['gmail'],
      access: 'read_only',
    })
  })

  it('clears a pasted secret on save failure and shows safe retry guidance without claiming success', async () => {
    const empty = initialView()
    empty.configs[0].client_id = ''
    api.connectorAccounts.mockResolvedValue(empty)
    api.nativeInvoke.mockRejectedValue(
      new Error('synthetic-private-native-secret')
    )
    await ready()
    const user = userEvent.setup()
    const guide = await openGoogleImport()
    await user.click(
      guide.getByText('Paste a Desktop client ID and secret instead')
    )
    await user.type(guide.getByLabelText('Google Desktop client ID'), 'client')
    const secret = guide.getByLabelText('Google Desktop client secret')
    await user.type(secret, 'synthetic-private-desktop-secret')
    await user.click(
      guide.getByRole('button', { name: 'Save Google registration' })
    )
    await guide.findByText(
      /Could not save the Google registration. Unlock secure storage if asked/
    )
    expect(secret).toHaveValue('')
    expect(
      guide.getByRole('button', { name: 'Save Google registration' })
    ).toBeDisabled()
    expect(
      guide.queryByText(
        /synthetic-private-native-secret|synthetic-private-desktop-secret/
      )
    ).not.toBeInTheDocument()
    expect(
      guide.queryByText(/Your Google registration has been saved/)
    ).not.toBeInTheDocument()
    expect(api.beginConnectorAuth).not.toHaveBeenCalled()
    await user.click(guide.getByRole('button', { name: 'Close' }))
    expect(
      googleCard().getByRole('button', { name: 'Connect Google Workspace' })
    ).toBeDisabled()
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
    const guide = await openGoogleImport()
    await userEvent
      .setup()
      .upload(guide.getByLabelText('Import Google Desktop app JSON'), file)
    await waitFor(() =>
      expect(api.nativeInvoke).toHaveBeenCalledWith('connector_configure', {
        request: {
          provider: 'google',
          client_id: 'replacement-client',
          client_secret: '',
        },
      })
    )
    expect(screen.queryByText(/replacement-client/)).not.toBeInTheDocument()
    expect(api.beginConnectorAuth).not.toHaveBeenCalled()
  })

  it('keeps imported contents and native error details out of validation and saving errors', async () => {
    await ready()
    const guide = await openGoogleImport()
    const group = guide.getByRole('group', {
      name: 'Google Desktop app JSON import',
    })
    const input = guide.getByLabelText('Import Google Desktop app JSON')
    const user = userEvent.setup()
    const webClient = new File(
      [
        JSON.stringify({
          web: {
            client_id: 'web-client',
            client_secret: 'private-file-secret',
          },
        }),
      ],
      'web.json'
    )
    await user.upload(input, webClient)
    await screen.findByText(
      /Choose the downloaded Google Desktop app JSON file/
    )
    expect(api.nativeInvoke).not.toHaveBeenCalled()
    expect(screen.queryByText(/private-file-secret/)).not.toBeInTheDocument()
    await waitFor(() => expect(group).toHaveAttribute('aria-busy', 'false'))
    api.nativeInvoke.mockRejectedValue(new Error('private-native-secret'))
    await user.upload(
      input,
      new File(
        [
          JSON.stringify({
            installed: {
              client_id: 'client',
              client_secret: 'private-file-secret',
            },
          }),
        ],
        'desktop.json'
      )
    )
    await screen.findByText(/Could not save the Google registration/)
    expect(
      screen.queryByText(/private-native-secret|private-file-secret/)
    ).not.toBeInTheDocument()
  })

  it('rejects multiple files and ignores a second import while one is pending', async () => {
    await ready()
    const guide = await openGoogleImport()
    const group = guide.getByRole('group', {
      name: 'Google Desktop app JSON import',
    })
    const input = guide.getByLabelText('Import Google Desktop app JSON')
    const file = new File(
      [JSON.stringify({ installed: { client_id: 'client' } })],
      'desktop.json'
    )
    fireEvent.change(input, { target: { files: [file, file] } })
    expect(guide.getByRole('alert')).toHaveTextContent(
      'Choose one downloaded Google Desktop app JSON file.'
    )
    expect(api.nativeInvoke).not.toHaveBeenCalled()
    let finish!: (view: ConnectorAccountsView) => void
    api.nativeInvoke.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve
        })
    )
    fireEvent.change(input, { target: { files: [file] } })
    await waitFor(() => expect(api.nativeInvoke).toHaveBeenCalledTimes(1))
    expect(input).toBeDisabled()
    expect(group).toHaveAttribute('aria-busy', 'true')
    fireEvent.change(input, { target: { files: [file] } })
    expect(api.nativeInvoke).toHaveBeenCalledTimes(1)
    await act(async () => {
      finish(initialView())
    })
    expect(
      await guide.findByText(/Your Google registration has been saved in GChat/)
    ).toBeInTheDocument()
    expect(
      guide.queryByRole('group', { name: 'Google Desktop app JSON import' })
    ).not.toBeInTheDocument()
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
      expect(microsoft.getByLabelText('Tenant (optional)')).toHaveValue(
        'common'
      )
    )
    expect(
      microsoft.getByRole('button', { name: 'Save Microsoft 365 registration' })
    ).toBeEnabled()
  })

  it('explains a missing release identity without exposing a default client ID form', async () => {
    const view = initialView()
    view.configs = view.configs.filter(
      (config) => config.provider !== 'microsoft'
    )
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
    await userEvent
      .setup()
      .click(
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
    const signIn = microsoft.getByRole('button', {
      name: 'Sign in with Microsoft',
    })
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

  it('lets a missing saved account recover from an old connected flow instead of blocking sign-in', async () => {
    const view = initialView()
    view.active_flows = [
      {
        flow_id: 'old-connected',
        provider: 'microsoft',
        status: 'connected',
        account_id: 'removed-account',
      },
    ]
    api.connectorAccounts.mockResolvedValue(view)
    api.beginConnectorAuth.mockResolvedValue({
      ...waiting,
      provider: 'microsoft',
      flow_id: 'replacement-sign-in',
    })
    await ready()
    const microsoft = within(
      screen.getByRole('heading', { name: 'Microsoft 365' }).parentElement!
    )
    expect(microsoft.getByRole('status')).toHaveTextContent(
      'Sign-in received. Confirm your saved account.'
    )
    expect(
      microsoft.queryByText('Microsoft 365 account connected.')
    ).not.toBeInTheDocument()
    const user = userEvent.setup()
    await user.click(
      microsoft.getByRole('button', { name: 'Start sign-in again' })
    )
    await user.click(microsoft.getByLabelText('Excel'))
    await user.click(
      microsoft.getByRole('button', { name: 'Sign in with Microsoft' })
    )
    expect(await microsoft.findByRole('status')).toHaveTextContent(
      'Complete Microsoft 365 sign-in in your browser.'
    )
    expect(
      microsoft.queryByText('Sign-in received. Confirm your saved account.')
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
      microsoft.getByRole('button', { name: 'Try Microsoft sign-in again' })
    ).toBeEnabled()
    expect(microsoft.getByRole('alert')).toHaveTextContent(
      'Microsoft 365 was not connected.'
    )
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

  it('shows Microsoft browser progress, confirms a durable account and offers another sign-in', async () => {
    vi.useFakeTimers()
    const microsoftFlow: ConnectorAuthFlow = {
      flow_id: 'flow-microsoft',
      provider: 'microsoft',
      status: 'waiting',
    }
    api.beginConnectorAuth.mockResolvedValue(microsoftFlow)
    api.connectorAuthStatus.mockResolvedValue({
      ...microsoftFlow,
      status: 'connected',
      account_id: 'ms-account',
    })
    let finishAccounts!: (view: ConnectorAccountsView) => void
    api.connectorAccounts
      .mockResolvedValueOnce(initialView())
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finishAccounts = resolve
          })
      )
    render(<WorkspaceConnections />)
    await act(async () => {})
    const microsoft = within(
      screen.getByRole('heading', { name: 'Microsoft 365' }).parentElement!
    )
    fireEvent.click(microsoft.getByLabelText('Excel'))
    await act(async () => {
      fireEvent.click(
        microsoft.getByRole('button', { name: 'Sign in with Microsoft' })
      )
    })
    expect(
      microsoft.getByRole('button', { name: 'Waiting for browser sign-in…' })
    ).toBeDisabled()
    expect(microsoft.getByRole('status')).toHaveTextContent(
      'GChat is waiting for the browser response'
    )
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })
    expect(microsoft.getByRole('status')).toHaveTextContent(
      'Finishing your connection…'
    )
    expect(
      microsoft.queryByText('Microsoft 365 account connected.')
    ).not.toBeInTheDocument()
    expect(
      microsoft.getByRole('button', { name: 'Sign in with Microsoft' })
    ).toBeDisabled()
    const saved = initialView()
    saved.accounts = [
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
    await act(async () => {
      finishAccounts(saved)
    })
    expect(microsoft.getByRole('status')).toHaveTextContent(
      'Microsoft 365 account connected.'
    )
    expect(
      microsoft.getByRole('region', { name: 'Ron Microsoft' })
    ).toHaveTextContent('ron@example.test')
    expect(
      microsoft.getByRole('button', {
        name: 'Sign in another Microsoft account',
      })
    ).toBeEnabled()
    expect(api.connectorAccounts).toHaveBeenCalledTimes(2)
  })

  it('keeps a completed browser flow recoverable when the saved-account refresh fails', async () => {
    const flow: ConnectorAuthFlow = {
      flow_id: 'flow-microsoft',
      provider: 'microsoft',
      status: 'connected',
      account_id: 'ms-account',
    }
    api.beginConnectorAuth.mockResolvedValue(flow)
    api.connectorAccounts
      .mockResolvedValueOnce(initialView())
      .mockRejectedValueOnce(new Error('Could not read saved accounts'))
    await ready()
    const microsoft = within(
      screen.getByRole('heading', { name: 'Microsoft 365' }).parentElement!
    )
    const user = userEvent.setup()
    await user.click(microsoft.getByLabelText('Excel'))
    await user.click(
      microsoft.getByRole('button', { name: 'Sign in with Microsoft' })
    )
    expect(await microsoft.findByRole('status')).toHaveTextContent(
      'Sign-in received. Confirm your saved account.'
    )
    expect(
      microsoft.queryByText('Microsoft 365 account connected.')
    ).not.toBeInTheDocument()
    expect(
      microsoft.getByRole('button', { name: 'Sign in with Microsoft' })
    ).toBeDisabled()
    const saved = initialView()
    saved.accounts = [
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
    api.connectorAccounts.mockResolvedValueOnce(saved)
    await user.click(
      microsoft.getByRole('button', { name: 'Refresh connected accounts' })
    )
    expect(
      await microsoft.findByText('Microsoft 365 account connected.')
    ).toBeInTheDocument()
    expect(
      microsoft.getByRole('region', { name: 'Ron Microsoft' })
    ).toBeVisible()
    expect(
      screen.queryByText(/Could not read saved accounts/)
    ).not.toBeInTheDocument()
  })

  it('restores a failed Microsoft save after navigation and retains actionable retry instructions', async () => {
    const snapshot = initialView()
    snapshot.active_flows = [
      {
        flow_id: 'ms-save-failed',
        provider: 'microsoft',
        status: 'failed',
        error:
          'Sign-in was received, but secure storage could not save it. Unlock secure storage and try again.',
      },
    ]
    api.connectorAccounts.mockResolvedValue(snapshot)
    await ready()
    const microsoft = within(
      screen.getByRole('heading', { name: 'Microsoft 365' }).parentElement!
    )
    expect(microsoft.getByRole('alert')).toHaveTextContent(
      'Microsoft 365 was not connected.'
    )
    expect(microsoft.getByRole('alert')).toHaveTextContent(
      'Unlock secure storage and try again.'
    )
    expect(
      microsoft.queryByText('Microsoft 365 account connected.')
    ).not.toBeInTheDocument()
    expect(microsoft.getByText('No connected accounts.')).toBeVisible()
    await userEvent.setup().click(microsoft.getByLabelText('Excel'))
    expect(
      microsoft.getByRole('button', { name: 'Try Microsoft sign-in again' })
    ).toBeEnabled()
    expect(api.beginConnectorAuth).not.toHaveBeenCalled()
    expect(api.connectorAuthStatus).not.toHaveBeenCalled()
  })

  it('keeps a browser-launch failure attached to its provider and lets the user retry', async () => {
    api.beginConnectorAuth.mockRejectedValueOnce(
      new Error(
        'Could not open the sign-in browser. Check your default browser and try again.'
      )
    )
    await ready()
    const microsoft = within(
      screen.getByRole('heading', { name: 'Microsoft 365' }).parentElement!
    )
    const user = userEvent.setup()
    await user.click(microsoft.getByLabelText('Excel'))
    await user.click(
      microsoft.getByRole('button', { name: 'Sign in with Microsoft' })
    )
    expect(await microsoft.findByRole('alert')).toHaveTextContent(
      'Check your default browser and try again.'
    )
    expect(
      microsoft.getByRole('button', { name: 'Try Microsoft sign-in again' })
    ).toBeEnabled()
    api.beginConnectorAuth.mockResolvedValueOnce({
      ...waiting,
      provider: 'microsoft',
      flow_id: 'ms-retry',
    })
    await user.click(
      microsoft.getByRole('button', { name: 'Try Microsoft sign-in again' })
    )
    expect(microsoft.queryByRole('alert')).not.toBeInTheDocument()
    expect(
      microsoft.getByRole('button', { name: 'Waiting for browser sign-in…' })
    ).toBeDisabled()
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

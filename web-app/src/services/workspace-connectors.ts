import { invoke } from '@tauri-apps/api/core'

export type ConnectorProvider = 'google' | 'microsoft'
export type ConnectorAccess = 'read_only' | 'read_write'

export type ConnectorConfig = {
  provider: ConnectorProvider
  client_id: string
  tenant: string | null
  has_client_secret: boolean
}

export type ConnectorService = {
  id: string
  read_scopes: string[]
  write_scopes: string[]
}

export type ConnectorAccount = {
  id: string
  provider: ConnectorProvider
  subject: string
  display_name: string
  email: string | null
  services: string[]
  access: ConnectorAccess
  granted_scopes: string[]
  needs_reconnect: boolean
}

export type ConnectorAccountsView = {
  configs: ConnectorConfig[]
  accounts: ConnectorAccount[]
  active_flows: ConnectorAuthFlow[]
  selected_accounts: Partial<Record<ConnectorProvider, string>>
  services: Record<ConnectorProvider, ConnectorService[]>
}

export type ConnectorAuthFlow = {
  flow_id: string
  provider: ConnectorProvider
  status: 'waiting' | 'connected' | 'failed' | 'cancelled'
  account_id?: string | null
  error?: string | null
}

export type ConfigureConnectorRequest = {
  provider: ConnectorProvider
  client_id: string
  tenant?: string
  client_secret?: string
}

export type BeginConnectorAuthRequest = {
  provider: ConnectorProvider
  services: string[]
  access: ConnectorAccess
  account_id?: string
}

export const connectorAccounts = (connect = false) =>
  connect
    ? invoke<ConnectorAccountsView>('connector_accounts', { connect: true })
    : invoke<ConnectorAccountsView>('connector_accounts')

export const configureConnector = (request: ConfigureConnectorRequest) =>
  invoke<ConnectorAccountsView>('connector_configure', { request })

export async function configureGoogleDesktopRegistration(
  clientId: string,
  clientSecret: string
): Promise<ConnectorAccountsView> {
  if (
    !clientId.trim() ||
    clientId.length > 4096 ||
    !clientSecret.trim() ||
    clientSecret.length > 4096
  )
    throw new Error(
      'Paste the client ID and client secret from your Google Desktop app. Each must be no longer than 4096 characters.'
    )
  try {
    return await configureConnector({
      provider: 'google',
      client_id: clientId.trim(),
      client_secret: clientSecret.trim(),
    })
  } catch {
    throw new Error(
      'Could not save the Google registration. Unlock secure storage if asked, then paste the Desktop client details and try again.'
    )
  }
}

const GOOGLE_REGISTRATION_MAX_BYTES = 64 * 1024
const GOOGLE_REGISTRATION_INVALID =
  'Choose the downloaded Google Desktop app JSON file, no larger than 64 KB.'

// Credential material stays in this call and goes directly to the native vault.
// In particular, neither file contents nor native errors are returned to the UI.
export async function importGoogleDesktopRegistration(
  file: File
): Promise<ConnectorAccountsView> {
  let request: ConfigureConnectorRequest
  try {
    if (file.size === 0 || file.size > GOOGLE_REGISTRATION_MAX_BYTES)
      throw new Error()
    const text = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () =>
        typeof reader.result === 'string'
          ? resolve(reader.result)
          : reject(new Error())
      reader.onerror = () => reject(new Error())
      reader.onabort = () => reject(new Error())
      reader.readAsText(file)
    })
    const parsed: unknown = JSON.parse(text)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
      throw new Error()
    const root = parsed as Record<string, unknown>
    const installed = root.installed
    if (
      root.web !== undefined ||
      !installed ||
      typeof installed !== 'object' ||
      Array.isArray(installed)
    )
      throw new Error()
    const registration = installed as Record<string, unknown>
    const clientId = registration.client_id
    const secret = registration.client_secret
    if (
      typeof clientId !== 'string' ||
      !clientId.trim() ||
      clientId.length > 4096 ||
      (secret !== undefined &&
        (typeof secret !== 'string' || secret.length > 4096))
    )
      throw new Error()
    request = {
      provider: 'google',
      client_id: clientId.trim(),
      // Explicitly clear an old vault secret when this registration has none.
      client_secret: typeof secret === 'string' ? secret : '',
    }
  } catch {
    throw new Error(GOOGLE_REGISTRATION_INVALID)
  }
  try {
    return await configureConnector(request)
  } catch {
    throw new Error(
      'Could not save the Google registration. Try importing the Desktop app JSON again.'
    )
  }
}

export const beginConnectorAuth = (request: BeginConnectorAuthRequest) =>
  invoke<ConnectorAuthFlow>('connector_begin_auth', { request })

export const connectorAuthStatus = (flowId: string) =>
  invoke<ConnectorAuthFlow>('connector_auth_status', { flowId })

export const cancelConnectorAuth = (flowId: string) =>
  invoke<ConnectorAuthFlow>('connector_cancel_auth', { flowId })

export const selectConnectorAccount = (
  provider: ConnectorProvider,
  accountId: string
) =>
  invoke<ConnectorAccountsView>('connector_select_account', {
    provider,
    accountId,
  })

export const disconnectConnectorAccount = (
  provider: ConnectorProvider,
  accountId: string,
  revoke: boolean
) =>
  invoke<ConnectorAccountsView>('connector_disconnect', {
    provider,
    accountId,
    revoke,
  })

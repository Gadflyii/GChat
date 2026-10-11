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

export const connectorAccounts = () =>
  invoke<ConnectorAccountsView>('connector_accounts')

export const configureConnector = (request: ConfigureConnectorRequest) =>
  invoke<ConnectorAccountsView>('connector_configure', { request })

export const beginConnectorAuth = (request: BeginConnectorAuthRequest) =>
  invoke<ConnectorAuthFlow>('connector_begin_auth', { request })

export const connectorAuthStatus = (flowId: string) =>
  invoke<ConnectorAuthFlow>('connector_auth_status', { flowId })

export const cancelConnectorAuth = (flowId: string) =>
  invoke<ConnectorAuthFlow>('connector_cancel_auth', { flowId })

export const selectConnectorAccount = (
  provider: ConnectorProvider,
  accountId: string
) => invoke<ConnectorAccountsView>('connector_select_account', { provider, accountId })

export const disconnectConnectorAccount = (
  provider: ConnectorProvider,
  accountId: string,
  revoke: boolean
) => invoke<ConnectorAccountsView>('connector_disconnect', { provider, accountId, revoke })

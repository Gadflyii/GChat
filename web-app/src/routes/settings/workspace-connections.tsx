import { createFileRoute } from '@tanstack/react-router'
import { useCallback, useEffect, useRef, useState } from 'react'
import { route } from '@/constants/routes'
import HeaderPage from '@/containers/HeaderPage'
import SettingsMenu from '@/containers/SettingsMenu'
import { Card } from '@/containers/Card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { useTranslation } from '@/i18n/react-i18next-compat'
import {
  beginConnectorAuth,
  cancelConnectorAuth,
  configureConnector,
  connectorAccounts,
  connectorAuthStatus,
  disconnectConnectorAccount,
  selectConnectorAccount,
  type BeginConnectorAuthRequest,
  type ConfigureConnectorRequest,
  type ConnectorAccess,
  type ConnectorAccount,
  type ConnectorAccountsView,
  type ConnectorAuthFlow,
  type ConnectorConfig,
  type ConnectorProvider,
  type ConnectorService,
} from '@/services/workspace-connectors'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const Route = createFileRoute(route.settings.workspace_connections)({
  component: WorkspaceConnections,
})

const providers: ConnectorProvider[] = ['google', 'microsoft']
const providerNames = { google: 'Google Workspace', microsoft: 'Microsoft 365' }
const serviceNames: Record<string, string> = {
  gmail: 'Gmail',
  calendar: 'Calendar',
  drive: 'Google Drive',
  docs: 'Google Docs',
  sheets: 'Google Sheets',
  slides: 'Google Slides',
  people: 'Google Contacts',
  tasks: 'Google Tasks',
  outlook: 'Outlook mail',
  contacts: 'Contacts',
  onedrive: 'OneDrive',
  sharepoint: 'SharePoint',
  teams: 'Teams',
  todo: 'Microsoft To Do',
  onenote: 'OneNote',
  excel: 'Excel',
}
const serviceName = (id: string) => serviceNames[id] ?? id

type ProviderCardProps = {
  provider: ConnectorProvider
  config?: ConnectorConfig
  services: ConnectorService[]
  accounts: ConnectorAccount[]
  selectedAccount?: string
  disabled: boolean
  onConfigure: (request: ConfigureConnectorRequest) => Promise<void>
  onConnect: (request: BeginConnectorAuthRequest) => Promise<void>
  onSelect: (account: ConnectorAccount) => Promise<void>
  onDisconnect: (account: ConnectorAccount) => void
}

function ProviderCard({
  provider,
  config,
  services,
  accounts,
  selectedAccount,
  disabled,
  onConfigure,
  onConnect,
  onSelect,
  onDisconnect,
}: ProviderCardProps) {
  const [clientId, setClientId] = useState(config?.client_id ?? '')
  const [tenant, setTenant] = useState(config?.tenant ?? '')
  const [clearSecret, setClearSecret] = useState(false)
  const secretInput = useRef<HTMLInputElement>(null)
  const [selectedServices, setSelectedServices] = useState<string[]>([])
  const [access, setAccess] = useState<ConnectorAccess>('read_only')

  useEffect(() => {
    setClientId(config?.client_id ?? '')
    setTenant(config?.tenant ?? '')
    setClearSecret(false)
  }, [config?.client_id, config?.tenant, config?.has_client_secret])

  const saveRegistration = async () => {
    const secret = secretInput.current?.value ?? ''
    if (secretInput.current) secretInput.current.value = ''
    await onConfigure({
      provider,
      client_id: clientId.trim(),
      ...(provider === 'microsoft' && tenant.trim()
        ? { tenant: tenant.trim() }
        : {}),
      ...(clearSecret
        ? { client_secret: '' }
        : secret
          ? { client_secret: secret }
          : {}),
    })
  }
  const requestedScopes = [
    ...new Set(
      services
        .filter((service) => selectedServices.includes(service.id))
        .flatMap((service) =>
          access === 'read_only' ? service.read_scopes : service.write_scopes
        )
    ),
  ]

  return (
    <Card title={providerNames[provider]}>
      <details className="mb-4">
        <summary className="cursor-pointer text-foreground">
          App registration
        </summary>
        <p className="my-2 text-sm">
          Use your app registration’s client ID. Sign-in opens your system
          browser.
        </p>
        <p className="mb-3 text-sm">
          {provider === 'google'
            ? 'Create a Google Desktop app registration.'
            : 'Use a Microsoft mobile or desktop app registration with http://localhost/oauth/callback as its redirect URI.'}
        </p>
        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault()
            void saveRegistration()
          }}
        >
          <label className="block text-sm">
            Client ID
            <Input
              value={clientId}
              onChange={(event) => setClientId(event.target.value)}
              disabled={disabled}
            />
          </label>
          {provider === 'microsoft' && (
            <label className="block text-sm">
              Tenant (optional)
              <Input
                value={tenant}
                onChange={(event) => setTenant(event.target.value)}
                disabled={disabled}
                placeholder="common"
              />
            </label>
          )}
          {provider === 'google' && (
            <>
              <label className="block text-sm">
                App secret (optional)
                <Input
                  ref={secretInput}
                  type="password"
                  autoComplete="off"
                  disabled={disabled || clearSecret}
                />
              </label>
              {config?.has_client_secret && (
                <label className="flex gap-2 items-center text-sm">
                  <input
                    type="checkbox"
                    checked={clearSecret}
                    onChange={(event) => setClearSecret(event.target.checked)}
                    disabled={disabled}
                  />
                  Remove the saved app secret
                </label>
              )}
              <p className="text-xs">
                An app secret is sent directly to the native vault and cleared
                from this form.
              </p>
            </>
          )}
          <Button
            type="submit"
            variant="outline"
            size="sm"
            disabled={disabled || !clientId.trim()}
          >
            Save {providerNames[provider]} registration
          </Button>
        </form>
      </details>
      {!config?.client_id && (
        <p className="mb-3 text-sm">
          Save a client ID in App registration before connecting.
        </p>
      )}
      <fieldset disabled={disabled} className="space-y-3">
        <legend className="mb-2 font-medium text-foreground">
          Services to connect
        </legend>
        <div className="flex flex-wrap gap-x-5 gap-y-2">
          {services.map((service) => (
            <label key={service.id} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={selectedServices.includes(service.id)}
                onChange={(event) => {
                  setSelectedServices((current) =>
                    event.target.checked
                      ? [...current, service.id]
                      : current.filter((id) => id !== service.id)
                  )
                }}
              />
              {serviceName(service.id)}
            </label>
          ))}
        </div>
        <label className="flex items-center gap-3 text-sm">
          Access
          <select
            className="rounded border border-border bg-background px-2 py-1 text-foreground"
            value={access}
            onChange={(event) =>
              setAccess(event.target.value as ConnectorAccess)
            }
          >
            <option value="read_only">Read only</option>
            <option value="read_write">Read and write</option>
          </select>
        </label>
        <p className="text-xs">
          Read only prevents GChat from writing. Provider consent can include
          broader permissions required for a service.
        </p>
        {requestedScopes.length > 0 && (
          <details className="text-xs">
            <summary className="cursor-pointer">
              Requested service permissions
            </summary>
            <ul className="mt-2 space-y-1 break-all">
              {requestedScopes.map((scope) => (
                <li key={scope}>{scope}</li>
              ))}
            </ul>
          </details>
        )}
        <Button
          disabled={
            disabled || !config?.client_id || selectedServices.length === 0
          }
          onClick={() =>
            void onConnect({ provider, services: selectedServices, access })
          }
        >
          Connect {providerNames[provider]}
        </Button>
      </fieldset>
      <div className="mt-5 border-t border-border pt-3">
        <h2 className="mb-2 font-medium text-foreground">Connected accounts</h2>
        {accounts.length === 0 && (
          <p className="text-sm">No connected accounts.</p>
        )}
        {accounts.map((account) => (
          <section
            key={account.id}
            className="mb-3 rounded border border-border p-3"
            aria-label={
              account.display_name || account.email || account.subject
            }
          >
            <div className="flex flex-wrap justify-between gap-2">
              <div className="min-w-0">
                <p className="break-all font-medium text-foreground">
                  {account.display_name || account.email || account.subject}
                </p>
                {account.email && (
                  <p className="break-all text-sm">{account.email}</p>
                )}
                <p className="text-sm">
                  {account.needs_reconnect ? 'Reconnect required' : 'Connected'}
                  {selectedAccount === account.id ? ' · Default account' : ''}
                </p>
                <p className="text-xs">
                  {account.services.map(serviceName).join(', ')} ·{' '}
                  {account.access === 'read_only'
                    ? 'Read only'
                    : 'Read and write'}
                </p>
                {account.granted_scopes.length > 0 && (
                  <details className="mt-1 text-xs">
                    <summary className="cursor-pointer">
                      Granted provider permissions
                    </summary>
                    <ul className="mt-2 space-y-1 break-all">
                      {account.granted_scopes.map((scope) => (
                        <li key={scope}>{scope}</li>
                      ))}
                    </ul>
                  </details>
                )}
              </div>
              <div className="flex flex-wrap items-start gap-2">
                {selectedAccount !== account.id && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={disabled}
                    onClick={() => void onSelect(account)}
                  >
                    Make default
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="outline"
                  disabled={disabled || !config?.client_id}
                  onClick={() =>
                    void onConnect({
                      provider,
                      services: account.services,
                      access: account.access,
                      account_id: account.id,
                    })
                  }
                >
                  Reconnect
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={disabled}
                  onClick={() => onDisconnect(account)}
                >
                  Disconnect
                </Button>
              </div>
            </div>
          </section>
        ))}
      </div>
    </Card>
  )
}

export function WorkspaceConnections() {
  const { t } = useTranslation()
  const [view, setView] = useState<ConnectorAccountsView | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [flows, setFlows] = useState<ConnectorAuthFlow[]>([])
  const [pollingPaused, setPollingPaused] = useState(false)
  const [disconnecting, setDisconnecting] = useState<ConnectorAccount | null>(
    null
  )
  const [revoke, setRevoke] = useState(false)
  const snapshotSequence = useRef(0)
  const flowSequence = useRef(0)

  const receiveSnapshot = useCallback((next: ConnectorAccountsView) => {
    setView(next)
    setLoading(false)
    setFlows((current) => [
      ...current.filter(
        (known) =>
          known.status !== 'waiting' &&
          !next.active_flows.some(
            (active) => active.provider === known.provider
          )
      ),
      ...next.active_flows,
    ])
  }, [])

  const loadAccounts = useCallback(async () => {
    const sequence = ++snapshotSequence.current
    setLoading(true)
    try {
      const next = await connectorAccounts()
      if (sequence === snapshotSequence.current) {
        receiveSnapshot(next)
        setError(null)
      }
    } catch (cause) {
      if (sequence === snapshotSequence.current) setError(String(cause))
    } finally {
      if (sequence === snapshotSequence.current) setLoading(false)
    }
  }, [receiveSnapshot])

  useEffect(() => {
    void loadAccounts()
    return () => {
      snapshotSequence.current++
      flowSequence.current++
    }
  }, [loadAccounts])

  useEffect(() => {
    const waiting = flows.filter((flow) => flow.status === 'waiting')
    if (waiting.length === 0 || pollingPaused) return
    let disposed = false
    const sequence = flowSequence.current
    const timer = setTimeout(async () => {
      const results = await Promise.allSettled(
        waiting.map((flow) => connectorAuthStatus(flow.flow_id))
      )
      if (disposed || sequence !== flowSequence.current) return
      const updates = new Map<string, ConnectorAuthFlow>()
      for (const result of results) {
        if (result.status === 'fulfilled')
          updates.set(result.value.flow_id, result.value)
        else {
          setError(
            `Could not check sign-in status. Use Check sign-in status to retry. ${String(result.reason)}`
          )
          setPollingPaused(true)
        }
      }
      if (updates.size > 0)
        setFlows((current) =>
          current.map((flow) => updates.get(flow.flow_id) ?? flow)
        )
      if ([...updates.values()].some((flow) => flow.status === 'connected'))
        await loadAccounts()
    }, 1000)
    return () => {
      disposed = true
      clearTimeout(timer)
    }
  }, [flows, pollingPaused, loadAccounts])

  const perform = async (name: string, operation: () => Promise<void>) => {
    setBusy(name)
    setError(null)
    snapshotSequence.current++
    setLoading(false)
    try {
      await operation()
    } catch (cause) {
      setError(String(cause))
    } finally {
      setBusy(null)
    }
  }
  const acceptSnapshot = (next: ConnectorAccountsView) => {
    snapshotSequence.current++
    receiveSnapshot(next)
  }
  const connect = (request: BeginConnectorAuthRequest) =>
    perform('Opening sign-in', async () => {
      flowSequence.current++
      setFlows((current) =>
        current.filter((flow) => flow.provider !== request.provider)
      )
      setPollingPaused(false)
      const next = await beginConnectorAuth(request)
      setFlows((current) => [...current, next])
      if (next.status === 'connected') await loadAccounts()
    })
  const cancel = (flowId: string) =>
    perform('Cancelling sign-in', async () => {
      flowSequence.current++
      setPollingPaused(false)
      try {
        const next = await cancelConnectorAuth(flowId)
        setFlows((current) =>
          current.map((flow) => (flow.flow_id === next.flow_id ? next : flow))
        )
        if (next.status === 'connected') await loadAccounts()
      } catch (cause) {
        setFlows((current) => [...current])
        throw cause
      }
    })
  const disabled =
    loading || busy !== null || flows.some((flow) => flow.status === 'waiting')

  return (
    <div className="flex h-svh w-full flex-col">
      <HeaderPage>
        <span className="font-studio text-base font-medium">
          {t('common:settings')}
        </span>
      </HeaderPage>
      <div className="flex h-[calc(100%-60px)]">
        <SettingsMenu />
        <main className="w-full space-y-4 overflow-y-auto p-4">
          <div className="flex items-center justify-between gap-3">
            <h1 className="text-lg font-medium">Workspace connections</h1>
            <Button
              size="sm"
              variant="outline"
              disabled={loading || busy !== null}
              onClick={() => void loadAccounts()}
            >
              Refresh accounts
            </Button>
          </div>
          <p className="text-sm text-muted-foreground">
            Use the same accounts in Chat, Agent and Code. Sign-in uses your
            system browser; account tokens stay in your operating system’s
            credential vault.
          </p>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          {busy && (
            <p role="status" className="text-sm">
              {busy}…
            </p>
          )}
          {loading && !view && <p role="status">Loading accounts…</p>}
          {flows.map((flow) => (
            <div
              key={flow.flow_id}
              role="status"
              className="space-y-2 rounded border border-border p-3 text-sm"
            >
              {flow.status === 'waiting' && (
                <>
                  <p>
                    Complete {providerNames[flow.provider]} sign-in in your
                    browser.
                  </p>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy !== null}
                      onClick={() => void cancel(flow.flow_id)}
                    >
                      Cancel {providerNames[flow.provider]} sign-in
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy !== null}
                      onClick={() => {
                        setError(null)
                        setPollingPaused(false)
                        setFlows((current) => [...current])
                      }}
                    >
                      Check sign-in status
                    </Button>
                  </div>
                </>
              )}
              {flow.status === 'connected' && (
                <p>{providerNames[flow.provider]} account connected.</p>
              )}
              {flow.status === 'cancelled' && <p>Sign-in cancelled.</p>}
              {flow.status === 'failed' && (
                <p className="text-destructive">
                  {flow.error || 'Sign-in failed. Try connecting again.'}
                </p>
              )}
            </div>
          ))}
          {view &&
            providers.map((provider) => (
              <ProviderCard
                key={provider}
                provider={provider}
                config={view.configs.find(
                  (config) => config.provider === provider
                )}
                services={view.services[provider]}
                accounts={view.accounts.filter(
                  (account) => account.provider === provider
                )}
                selectedAccount={view.selected_accounts[provider]}
                disabled={disabled}
                onConfigure={(request) =>
                  perform('Saving registration', async () =>
                    acceptSnapshot(await configureConnector(request))
                  )
                }
                onConnect={connect}
                onSelect={(account) =>
                  perform('Selecting default account', async () =>
                    acceptSnapshot(
                      await selectConnectorAccount(account.provider, account.id)
                    )
                  )
                }
                onDisconnect={(account) => {
                  setDisconnecting(account)
                  setRevoke(false)
                }}
              />
            ))}
        </main>
      </div>
      <Dialog
        open={disconnecting !== null}
        onOpenChange={(open) => {
          if (!open && !busy) setDisconnecting(null)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Disconnect account</DialogTitle>
            <DialogDescription>
              Remove this connection from all GChat modes. Other accounts are
              kept.
            </DialogDescription>
          </DialogHeader>
          <p className="break-all">
            {disconnecting?.email || disconnecting?.display_name}
          </p>
          {disconnecting?.provider === 'google' ? (
            <label className="flex gap-2 items-center text-sm">
              <input
                type="checkbox"
                checked={revoke}
                onChange={(event) => setRevoke(event.target.checked)}
                disabled={busy !== null}
              />
              Also revoke Google access
            </label>
          ) : (
            <p className="text-sm text-muted-foreground">
              This removes local access. To remove Microsoft’s consent too, use
              your Microsoft account’s app permissions page.
            </p>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              disabled={busy !== null}
              onClick={() => setDisconnecting(null)}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={busy !== null}
              onClick={() => {
                if (!disconnecting) return
                const account = disconnecting
                void perform('Disconnecting account', async () => {
                  acceptSnapshot(
                    await disconnectConnectorAccount(
                      account.provider,
                      account.id,
                      revoke
                    )
                  )
                  setDisconnecting(null)
                })
              }}
            >
              Disconnect account
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { getServiceHub } from '@/hooks/useServiceHub'
import {
  gbot,
  type CloudPc,
  type M365Route,
  type M365SetupRecord,
} from '@/services/gbot'
import {
  beginConnectorAuth,
  cancelConnectorAuth,
  connectorAccounts,
  connectorAuthStatus,
  type ConnectorAccountsView,
  type ConnectorAuthFlow,
} from '@/services/workspace-connectors'

export default function M365Setup({
  name,
  initial,
  busy,
  saved,
}: {
  name: string
  initial?: M365SetupRecord
  busy: (value: boolean) => void
  saved: () => Promise<void>
}) {
  const [id] = useState(() => initial?.id ?? crypto.randomUUID())
  const [view, setView] = useState<ConnectorAccountsView>()
  const [accountId, setAccountId] = useState(initial?.account_id ?? '')
  const [pcs, setPcs] = useState<CloudPc[]>()
  const [pcId, setPcId] = useState(initial?.cloud_pc.id ?? '')
  const [route, setRoute] = useState<M365Route | ''>(initial?.route ?? '')
  const [dedicated, setDedicated] = useState(false)
  const [record, setRecord] = useState(initial)
  const [flow, setFlow] = useState<ConnectorAuthFlow>()
  const [working, setWorking] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const active = useRef(true)
  const locked = useRef(false)

  useEffect(() => {
    active.current = true
    connectorAccounts().then(
      (next) => {
        if (!active.current) return
        setView(next)
        setFlow(
          next.active_flows.find(
            (item) => item.provider === 'microsoft' && item.status === 'waiting'
          )
        )
      },
      (cause) => {
        if (active.current) setError(String(cause))
      }
    )
    return () => {
      active.current = false
    }
  }, [])

  const accounts =
    view?.accounts.filter((item) => item.provider === 'microsoft') ?? []
  const account = accounts.find((item) => item.id === accountId)
  const configured = Boolean(
    view?.configs
      .find((item) => item.provider === 'microsoft')
      ?.client_id.trim()
  )
  const permission = Boolean(
    account &&
      !account.needs_reconnect &&
      account.services.includes('cloud_pc') &&
      account.granted_scopes.some(
        (scope) =>
          scope
            .replace(/^https:\/\/graph\.microsoft\.com\//, '')
            .toLowerCase() === 'cloudpc.read.all'
      )
  )
  const waiting = flow?.status === 'waiting'
  const disabled = working || waiting
  const pc = pcs?.find((item) => item.id === pcId)
  const removed = Boolean(
    initial &&
      pcs &&
      accountId === initial.account_id &&
      !pcs.some((item) => item.id === initial.cloud_pc.id)
  )
  const unchanged = Boolean(
    record &&
      record.account_id === accountId &&
      record.cloud_pc.id === pcId &&
      record.route === route
  )

  const perform = async (operation: () => Promise<void>) => {
    if (locked.current) return
    locked.current = true
    setWorking(true)
    busy(true)
    setError('')
    setNotice('')
    try {
      await operation()
    } catch (cause) {
      if (active.current) setError(String(cause))
    } finally {
      locked.current = false
      if (active.current) {
        setWorking(false)
        busy(false)
      }
    }
  }
  const refreshAccounts = async () => {
    const next = await connectorAccounts()
    if (active.current) setView(next)
  }
  const acceptFlow = async (next: ConnectorAuthFlow) => {
    if (!active.current) return
    setFlow(next)
    if (next.status === 'connected') {
      // Sign-in never silently chooses an account or a computer.
      setPcs(undefined)
      await refreshAccounts()
    }
  }

  return (
    <section aria-label="M365 Cloud PC setup" className="space-y-3 text-sm">
      <p>
        Use an existing Cloud PC assigned to your Microsoft work or school
        account. No Cloud PC is purchased or provisioned here.
      </p>
      <p className="text-muted-foreground">
        Desktop control is not connected yet. Save your setup and open
        Microsoft’s client to prepare the connection. Gbot desktop viewing and
        control still need to be connected.
      </p>
      {!view && !error && <p role="status">Loading Microsoft accounts…</p>}
      <Button
        type="button"
        variant="outline"
        disabled={disabled}
        onClick={() =>
          void perform(async () => {
            setPcs(undefined)
            await refreshAccounts()
          })
        }
      >
        Refresh Microsoft accounts
      </Button>
      {view && !configured && (
        <p role="alert">
          Microsoft app registration is missing. Configure it in{' '}
          <a className="underline" href="/settings/workspace-connections">
            Settings → Workspace connections
          </a>
          , then refresh accounts.
        </p>
      )}
      {view && (
        <>
          <label className="block space-y-1">
            Microsoft account
            <select
              className="block w-full rounded-md border bg-background p-2"
              value={accountId}
              disabled={disabled}
              onChange={(event) => {
                setAccountId(event.target.value)
                setPcId('')
                setPcs(undefined)
                setDedicated(false)
                setError('')
                setNotice('')
              }}
            >
              <option value="">Choose a Microsoft account</option>
              {initial &&
                !accounts.some((item) => item.id === initial.account_id) && (
                  <option value={initial.account_id}>
                    Disconnected saved account
                  </option>
                )}
              {accounts.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.email || item.display_name || item.id}
                </option>
              ))}
            </select>
          </label>
          {accountId && !account && (
            <p role="alert">
              The saved Microsoft account is disconnected. Sign in again or
              explicitly choose another account.
            </p>
          )}
          {account && !permission && (
            <p role="alert">
              {account.needs_reconnect
                ? 'Reconnect this Microsoft account.'
                : 'Cloud PC read permission is missing.'}{' '}
              Allow read-only Cloud PC access below. Your tenant may require
              administrator consent.
            </p>
          )}
          <p className="text-muted-foreground">
            Sign-in requests read-only CloudPC.Read.All. Microsoft handles MFA
            and tenant policy; tokens stay with GChat’s existing account vault.
          </p>
          <Button
            type="button"
            variant="outline"
            disabled={disabled || !configured}
            onClick={() =>
              void perform(async () => {
                setPcs(undefined)
                await acceptFlow(
                  await beginConnectorAuth({
                    provider: 'microsoft',
                    services: ['cloud_pc'],
                    access: 'read_only',
                    ...(account ? { account_id: account.id } : {}),
                  })
                )
              })
            }
          >
            {account
              ? 'Allow read-only Cloud PC access'
              : 'Sign in with Microsoft'}
          </Button>
        </>
      )}
      {flow && (
        <div role="status" className="space-y-2 rounded-md border p-3">
          {waiting && (
            <>
              <p>
                Complete Microsoft sign-in in your browser, then check its
                status here.
              </p>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  disabled={working}
                  onClick={() =>
                    void perform(async () =>
                      acceptFlow(await connectorAuthStatus(flow.flow_id))
                    )
                  }
                >
                  Check sign-in status
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  disabled={working}
                  onClick={() =>
                    void perform(async () =>
                      acceptFlow(await cancelConnectorAuth(flow.flow_id))
                    )
                  }
                >
                  Cancel sign-in
                </Button>
              </div>
            </>
          )}
          {flow.status === 'connected' && (
            <p>
              Microsoft account connected. Choose the account and check its
              assigned PCs.
            </p>
          )}
          {flow.status === 'cancelled' && <p>Microsoft sign-in cancelled.</p>}
          {flow.status === 'failed' && (
            <p>
              {flow.error ||
                'Microsoft sign-in failed. Retry sign-in or ask your tenant administrator.'}
            </p>
          )}
        </div>
      )}
      <Button
        type="button"
        variant="outline"
        disabled={disabled || !permission}
        onClick={() =>
          void perform(async () => {
            setPcs(undefined)
            const next = await gbot<CloudPc[]>('setup/m365/assigned', {
              account_id: accountId,
            })
            if (!active.current) return
            setPcs(next)
            if (!next.some((item) => item.id === pcId)) setPcId('')
          })
        }
      >
        Check assigned Cloud PCs
      </Button>
      {removed && (
        <p role="alert">
          The saved Cloud PC is no longer assigned to this account. Choose an
          available assignment or ask your tenant administrator.
        </p>
      )}
      {pcs?.length === 0 && (
        <p>
          No Cloud PCs are assigned to this account. Check the account and ask
          your tenant administrator to assign a Cloud PC.
        </p>
      )}
      {pcs && pcs.length > 0 && (
        <label className="block space-y-1">
          Assigned Cloud PC
          <select
            className="block w-full rounded-md border bg-background p-2"
            value={pcId}
            disabled={disabled}
            onChange={(event) => {
              setPcId(event.target.value)
              setDedicated(false)
              setNotice('')
            }}
          >
            <option value="">Choose an assigned Cloud PC</option>
            {pcs.map((item) => (
              <option key={item.id} value={item.id}>
                {item.display_name || item.id} ·{' '}
                {item.plan_name || 'Plan not supplied'}
              </option>
            ))}
          </select>
        </label>
      )}
      {(pc || record) && (
        <p>
          {pc ? 'Selected' : 'Saved'} Cloud PC:{' '}
          {(pc ?? record?.cloud_pc)?.display_name ||
            (pc ?? record?.cloud_pc)?.id}{' '}
          · {(pc ?? record?.cloud_pc)?.image_name || 'Image not supplied'} ·{' '}
          {(pc ?? record?.cloud_pc)?.plan_name || 'Plan not supplied'}
        </p>
      )}
      <fieldset disabled={disabled} className="space-y-2">
        <legend className="mb-2 font-medium">Desktop connection method</legend>
        <label className="flex items-start gap-2">
          <input
            type="radio"
            name="m365-route"
            checked={route === 'brokered_client'}
            onChange={() => {
              setRoute('brokered_client')
              setNotice('')
            }}
          />
          Supported Microsoft client
        </label>
        <p className="text-muted-foreground">
          Open Microsoft’s client on the computer running Gbot, then sign in to
          your Cloud PC. Gbot desktop viewing and control need to be connected
          before you can use Take over or Hand back.
        </p>
        <label className="flex items-start gap-2">
          <input
            type="radio"
            name="m365-route"
            checked={route === 'guest_worker'}
            onChange={() => {
              setRoute('guest_worker')
              setNotice('')
            }}
          />
          Worker in the Cloud PC user session
        </label>
        <p className="text-muted-foreground">
          Ask your tenant administrator to approve installation of the Gbot
          worker in your signed-in Cloud PC session and a network connection to
          the computer running Gbot. The worker must run in that desktop
          session.
        </p>
        <p className="text-muted-foreground">
          Keep the Cloud PC signed in and unlocked. Your tenant’s sign-in and
          screen capture policies may limit desktop access.
        </p>
        <label className="flex items-start gap-2">
          <input
            type="checkbox"
            checked={dedicated}
            onChange={(event) => setDedicated(event.target.checked)}
          />
          This Cloud PC is dedicated to the bot and does not share my own
          desktop.
        </label>
      </fieldset>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          disabled={disabled || !permission || !pc || !route || !dedicated}
          onClick={() =>
            void perform(async () => {
              const next = await gbot<M365SetupRecord>('setup/m365/save', {
                id,
                name: name.trim(),
                account_id: accountId,
                cloud_pc_id: pcId,
                route,
                dedicated: true,
              })
              if (!active.current) return
              setRecord(next)
              setNotice(
                'Cloud PC setup saved. Desktop control is not connected yet.'
              )
              await saved()
            })
          }
        >
          Save Cloud PC setup
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={
            disabled ||
            !permission ||
            !record ||
            !unchanged ||
            (pcs !== undefined && !pc)
          }
          onClick={() =>
            void perform(async () => {
              const launch = await gbot<{ url: string }>('setup/m365/launch', {
                id,
              })
              await getServiceHub().opener().open(launch.url)
              if (active.current)
                setNotice(
                  'Microsoft client opened. Desktop control is not connected yet.'
                )
            })
          }
        >
          Open Microsoft client
        </Button>
      </div>
      {notice && <p role="status">{notice}</p>}
      {error && (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}
    </section>
  )
}

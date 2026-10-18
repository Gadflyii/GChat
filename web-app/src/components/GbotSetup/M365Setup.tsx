import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { ChoiceSelect } from '@/components/ui/choice-select'
import { getServiceHub } from '@/hooks/useServiceHub'
import {
  gbot,
  getGbotServiceTarget,
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

const pendingActions = {
  refresh: {
    label: 'Refreshing Microsoft accounts…',
    message:
      'Refreshing the Microsoft accounts connected to GChat. Please wait.',
  },
  signIn: {
    label: 'Opening Microsoft sign-in…',
    message: 'Opening Microsoft sign-in in your browser. Please wait.',
  },
  checkSignIn: {
    label: 'Checking sign-in status…',
    message: 'Checking whether Microsoft sign-in has completed. Please wait.',
  },
  cancelSignIn: {
    label: 'Cancelling sign-in…',
    message: 'Cancelling Microsoft sign-in. Please wait.',
  },
  checkPcs: {
    label: 'Checking assigned Cloud PCs…',
    message:
      'Checking the Cloud PCs assigned to your selected Microsoft account. Please wait.',
  },
  save: {
    label: 'Saving Cloud PC setup…',
    message: 'Saving your Cloud PC setup. Please wait.',
  },
  openClient: {
    label: 'Opening Microsoft client…',
    message: 'Opening Microsoft’s client. Please wait.',
  },
}

type PendingAction = keyof typeof pendingActions

const failureMessages = {
  load: 'Could not load your Microsoft accounts. Choose Refresh Microsoft accounts to try again.',
  refresh:
    'Could not refresh your Microsoft accounts. Choose Refresh Microsoft accounts to try again.',
  signIn: 'Could not open Microsoft sign-in. Try signing in again.',
  checkSignIn:
    'Could not check Microsoft sign-in. Choose Check sign-in status to try again.',
  cancelSignIn:
    'Could not confirm Microsoft sign-in was cancelled. Choose Cancel sign-in to try again.',
  checkPcs:
    'Could not check your assigned Cloud PCs. Choose Check assigned Cloud PCs to try again.',
  save: 'Could not confirm your Cloud PC setup was saved. Choose Save Cloud PC setup to try again.',
  refreshSaved:
    'Your Cloud PC setup was saved, but the computer list could not be refreshed. Close setup to try refreshing the list again.',
  openClient:
    'Could not open Microsoft’s client. Choose Open Microsoft client to try again.',
} satisfies Record<PendingAction | 'load' | 'refreshSaved', string>

type SetupFailure = {
  action: keyof typeof failureMessages
  detail: string
}

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
  const [remote, setRemote] = useState<boolean>()
  const [loadingAccounts, setLoadingAccounts] = useState(true)
  const [accountId, setAccountId] = useState(initial?.account_id ?? '')
  const [pcs, setPcs] = useState<CloudPc[]>()
  const [pcId, setPcId] = useState(initial?.cloud_pc.id ?? '')
  const [route, setRoute] = useState<M365Route | ''>(initial?.route ?? '')
  const [dedicated, setDedicated] = useState(false)
  const [record, setRecord] = useState(initial)
  const [flow, setFlow] = useState<ConnectorAuthFlow>()
  const [pendingAction, setPendingAction] = useState<PendingAction>()
  const [error, setError] = useState<SetupFailure>()
  const [notice, setNotice] = useState('')
  const active = useRef(true)
  const locked = useRef(false)

  useEffect(() => {
    active.current = true
    getGbotServiceTarget()
      .then(async (target) => {
        if (!active.current) return
        const remote = target.kind === 'paired_host'
        const next = remote
          ? await gbot<ConnectorAccountsView>('setup/m365/accounts')
          : await connectorAccounts()
        if (!active.current) return
        setRemote(remote)
        setView(next)
        setFlow(
          next.active_flows.find(
            (item) => item.provider === 'microsoft' && item.status === 'waiting'
          )
        )
      })
      .catch((cause) => {
        if (active.current) setError({ action: 'load', detail: String(cause) })
      })
      .finally(() => {
        if (active.current) setLoadingAccounts(false)
      })
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
  const checkPrerequisite =
    remote === undefined
      ? 'Resolve the Gbot service computer before checking assigned PCs.'
      : !account
        ? remote
          ? 'Connect Microsoft to GChat on the service computer, then choose an account above.'
          : 'First sign in to GChat, then choose a connected work or school account above.'
        : account.needs_reconnect
          ? 'Reconnect this account and allow read-only Cloud PC access before checking assigned PCs.'
          : !permission
            ? 'Allow read-only Cloud PC access for this account before checking assigned PCs.'
            : undefined
  const working = pendingAction !== undefined
  const waiting = flow?.status === 'waiting'
  const disabled = loadingAccounts || working || waiting
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

  const perform = async (
    action: PendingAction,
    operation: () => Promise<void>
  ) => {
    if (locked.current) return
    locked.current = true
    setPendingAction(action)
    busy(true)
    setError(undefined)
    setNotice('')
    try {
      await operation()
    } catch (cause) {
      if (active.current) setError({ action, detail: String(cause) })
    } finally {
      locked.current = false
      if (active.current) {
        setPendingAction(undefined)
        busy(false)
      }
    }
  }
  const refreshAccounts = async (announce = false) => {
    const target = await getGbotServiceTarget()
    if (!active.current) return
    const remote = target.kind === 'paired_host'
    const next = remote
      ? await gbot<ConnectorAccountsView>('setup/m365/accounts')
      : await connectorAccounts()
    if (!active.current) return
    setRemote(remote)
    setView(next)
    if (announce) {
      const count = next.accounts.filter(
        (item) => item.provider === 'microsoft'
      ).length
      setNotice(
        count === 0
          ? 'Microsoft accounts refreshed. No accounts are connected to GChat yet.'
          : `Microsoft accounts refreshed. ${count} connected ${count === 1 ? 'account is' : 'accounts are'} available. Choose an account above.`
      )
    }
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
        This needs a work or school account with an assigned Windows 365 Cloud
        PC. Personal accounts can connect Outlook.com, Hotmail and OneDrive in
        Settings → Workspace connections. No Cloud PC is purchased or
        provisioned here.
      </p>
      <ol className="list-decimal space-y-1 pl-5">
        <li>
          Sign in with Microsoft using the work or school account that has the
          Cloud PC.
        </li>
        <li>
          Choose that account below, then choose Check assigned Cloud PCs.
        </li>
        <li>
          Select your Cloud PC and review the connection options before saving.
        </li>
      </ol>
      <p className="text-muted-foreground">
        Desktop control is not connected yet. Save your setup and open
        Microsoft’s client to prepare the connection. Gbot desktop viewing and
        control still need to be connected.
      </p>
      <p className="text-muted-foreground">
        This list shows Microsoft accounts connected to GChat. Accounts signed
        in to Windows or other Microsoft apps are not added automatically.
        Connect an account with Microsoft sign-in to add it to this list.
      </p>
      {!view && !error && !working && (
        <p role="status">Loading Microsoft accounts…</p>
      )}
      {pendingAction && (
        <p role="status">{pendingActions[pendingAction].message}</p>
      )}
      {remote && (
        <p role="status" className="text-muted-foreground">
          These accounts belong to the service computer. Connect Microsoft there
          in Settings → Workspace connections, then refresh here. Sign-in and
          Microsoft’s desktop client run on the service computer.
        </p>
      )}
      <Button
        type="button"
        variant="outline"
        disabled={disabled}
        onClick={() =>
          void perform('refresh', async () => {
            setPcs(undefined)
            await refreshAccounts(true)
          })
        }
      >
        {pendingAction === 'refresh'
          ? pendingActions.refresh.label
          : 'Refresh Microsoft accounts'}
      </Button>
      {view && !configured && (
        <p role="alert">
          Microsoft sign-in is unavailable in this GChat build. You do not need
          to find or enter a client ID. Install a release that includes
          Microsoft sign-in. If your organization already has an approved
          Microsoft app, use Advanced in{' '}
          {remote ? (
            'Settings → Workspace connections on the service computer'
          ) : (
            <a className="underline" href="/settings/workspace-connections">
              Settings → Workspace connections
            </a>
          )}
          , then refresh Microsoft accounts here.
        </p>
      )}
      {view && (
        <>
          {accounts.length === 0 && (
            <p>
              No Microsoft accounts are connected to GChat yet.{' '}
              {remote
                ? 'Connect Microsoft on the service computer, then refresh here.'
                : 'Choose Sign in with Microsoft below to add an account.'}
            </p>
          )}
          <label className="block space-y-1">
            Microsoft account
            <ChoiceSelect
              aria-label="Microsoft account"
              className="block w-full rounded-md border bg-background p-2"
              value={accountId}
              disabled={disabled}
              onValueChange={(value) => {
                setAccountId(value)
                setPcId('')
                setPcs(undefined)
                setDedicated(false)
                setError(undefined)
                setNotice('')
              }}
              options={[
                { value: '', label: 'Choose a Microsoft account' },
                ...(initial && !accounts.some((item) => item.id === initial.account_id)
                  ? [{ value: initial.account_id, label: 'Disconnected saved account' }]
                  : []),
                ...accounts.map((item) => ({
                  value: item.id,
                  label: item.email || item.display_name || item.id,
                })),
              ]}
            />
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
              Allow read-only Cloud PC access below. Your organization may
              require administrator approval.
            </p>
          )}
          <p className="text-muted-foreground">
            Sign in with your Microsoft work or school account in your browser.
            GChat requests read-only access to find your assigned Cloud PCs.
            Microsoft may ask for multifactor authentication (MFA) or your
            organization’s administrator approval. Your saved sign-in stays in
            GChat’s protected credential store.
          </p>
          <Button
            type="button"
            variant="outline"
            disabled={disabled || !configured || remote}
            onClick={() =>
              void perform('signIn', async () => {
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
            {pendingAction === 'signIn'
              ? pendingActions.signIn.label
              : account
                ? 'Allow read-only Cloud PC access'
                : 'Sign in with Microsoft'}
          </Button>
        </>
      )}
      {flow && !remote && (
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
                    void perform('checkSignIn', async () =>
                      acceptFlow(await connectorAuthStatus(flow.flow_id))
                    )
                  }
                >
                  {pendingAction === 'checkSignIn'
                    ? pendingActions.checkSignIn.label
                    : 'Check sign-in status'}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  disabled={working}
                  onClick={() =>
                    void perform('cancelSignIn', async () =>
                      acceptFlow(await cancelConnectorAuth(flow.flow_id))
                    )
                  }
                >
                  {pendingAction === 'cancelSignIn'
                    ? pendingActions.cancelSignIn.label
                    : 'Cancel sign-in'}
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
            <div className="space-y-2">
              <p role="alert" className="text-destructive">
                Microsoft sign-in could not be completed in GChat. Choose{' '}
                {account
                  ? 'Allow read-only Cloud PC access'
                  : 'Sign in with Microsoft'}{' '}
                to try again.
              </p>
              {flow.error && (
                <details>
                  <summary>Details</summary>
                  <p className="whitespace-pre-wrap break-words text-muted-foreground">
                    {flow.error}
                  </p>
                </details>
              )}
            </div>
          )}
        </div>
      )}
      <Button
        type="button"
        variant="outline"
        disabled={disabled || !permission}
        aria-describedby={
          checkPrerequisite ? `${id}-cloud-pc-prerequisite` : undefined
        }
        onClick={() =>
          void perform('checkPcs', async () => {
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
        {pendingAction === 'checkPcs'
          ? pendingActions.checkPcs.label
          : 'Check assigned Cloud PCs'}
      </Button>
      {checkPrerequisite && (
        <p id={`${id}-cloud-pc-prerequisite`} className="text-muted-foreground">
          {checkPrerequisite}
        </p>
      )}
      {removed && (
        <p role="alert">
          The saved Cloud PC is no longer assigned to this account. Choose an
          available assignment or ask your organization’s administrator.
        </p>
      )}
      {pcs?.length === 0 && (
        <p>
          No Cloud PCs are assigned to this account. Check the account and ask
          your organization’s administrator to assign a Cloud PC.
        </p>
      )}
      {pcs && pcs.length > 0 && (
        <label className="block space-y-1">
          Assigned Cloud PC
          <ChoiceSelect
            aria-label="Assigned Cloud PC"
            className="block w-full rounded-md border bg-background p-2"
            value={pcId}
            disabled={disabled}
            onValueChange={(value) => {
              setPcId(value)
              setDedicated(false)
              setNotice('')
            }}
            options={[
              { value: '', label: 'Choose an assigned Cloud PC' },
              ...pcs.map((item) => ({
                value: item.id,
                label: `${item.display_name || item.id} · ${item.plan_name || 'Plan not supplied'}`,
              })),
            ]}
          />
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
          Ask your organization’s administrator to approve installation of the
          Gbot worker in your signed-in Cloud PC session and a network
          connection to the computer running Gbot. The worker must run in that
          desktop session.
        </p>
        <p className="text-muted-foreground">
          Keep the Cloud PC signed in and unlocked. Your organization’s sign-in
          and screen capture policies may limit desktop access.
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
            void perform('save', async () => {
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
              try {
                await saved()
              } catch (cause) {
                if (active.current)
                  setError({ action: 'refreshSaved', detail: String(cause) })
              }
            })
          }
        >
          {pendingAction === 'save'
            ? pendingActions.save.label
            : 'Save Cloud PC setup'}
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={
            disabled ||
            remote ||
            !permission ||
            !record ||
            !unchanged ||
            (pcs !== undefined && !pc)
          }
          onClick={() =>
            void perform('openClient', async () => {
              const launch = await gbot<{ url: string }>('setup/m365/launch', {
                id,
              })
              if (!active.current) return
              await getServiceHub().opener().open(launch.url)
              if (active.current)
                setNotice(
                  'Microsoft client opened. Desktop control is not connected yet.'
                )
            })
          }
        >
          {pendingAction === 'openClient'
            ? pendingActions.openClient.label
            : 'Open Microsoft client'}
        </Button>
      </div>
      {notice && <p role="status">{notice}</p>}
      {error && (
        <div className="space-y-2">
          <p role="alert" className="text-destructive">
            {failureMessages[error.action]}
          </p>
          <details>
            <summary>Details</summary>
            <p className="break-words text-muted-foreground">{error.detail}</p>
          </details>
        </div>
      )}
    </section>
  )
}

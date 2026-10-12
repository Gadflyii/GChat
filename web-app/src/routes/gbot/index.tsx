import { useCallback, useEffect, useRef, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { listen } from '@tauri-apps/api/event'
import { toast } from 'sonner'
import HeaderPage from '@/containers/HeaderPage'
import GbotAvatar from '@/components/GbotAvatar'
import GbotConnectors from '@/components/GbotConnectors'
import GbotSchedules from '@/components/GbotSchedules'
import GbotSetup, { type BotConnection } from '@/components/GbotSetup'
import { useGeneralSetting } from '@/hooks/useGeneralSetting'
import GbotDesktopView, {
  type DesktopViewHandle,
} from '@/components/GbotDesktopView'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  gbot,
  messageText,
  quitGbotService,
  startGbotService,
  type Approval,
  type Assignment,
  type BotState,
  type HelpRequest,
  type Identity,
  type KvmSetupRecord,
  type Task,
} from '@/services/gbot'

export const Route = createFileRoute('/gbot/')({ component: GbotPage })

function HumanHelp({
  request,
  busy,
  reply,
}: {
  request: HelpRequest
  busy: boolean
  reply: (response: string | null) => void
}) {
  const [answer, setAnswer] = useState('')
  return (
    <div className="space-y-2 rounded-md border bg-muted/30 p-3">
      <p className="text-sm font-medium">Asking you for help</p>
      <p className="whitespace-pre-wrap text-sm">{request.question}</p>
      {request.status === 'pending' ? (
        <form
          className="space-y-2"
          onSubmit={(event) => {
            event.preventDefault()
            if (answer.trim()) reply(answer)
          }}
        >
          <textarea
            aria-label="Your reply"
            className="min-h-20 w-full rounded-md border bg-background p-2 text-sm"
            value={answer}
            disabled={busy}
            onChange={(event) => setAnswer(event.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            Your reply continues this task. Other actions still need their own
            approval.
          </p>
          <div className="flex gap-2">
            <Button disabled={busy || !answer.trim()}>Send reply</Button>
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => reply(null)}
            >
              Decline
            </Button>
          </div>
        </form>
      ) : (
        <p className="whitespace-pre-wrap text-sm text-muted-foreground">
          {request.status === 'completed'
            ? `Your reply: ${request.response}`
            : request.status === 'declined'
              ? 'Request declined'
              : 'Request cancelled'}
        </p>
      )}
    </div>
  )
}

function GbotPage() {
  const [state, setState] = useState<BotState>()
  const [tasks, setTasks] = useState<Task[]>([])
  const [approvals, setApprovals] = useState<Approval[]>([])
  const [selected, setSelected] = useState('')
  const [owner] = useState(() => {
    const saved = sessionStorage.getItem('gbot-control-owner')
    if (saved) return saved
    const id = crypto.randomUUID()
    sessionStorage.setItem('gbot-control-owner', id)
    return id
  })
  const desktop = useRef<DesktopViewHandle>(null)
  const [busy, setBusy] = useState(false)
  const [serviceStopped, setServiceStopped] = useState(false)
  const stopped = useRef(false)
  const [error, setError] = useState('')
  const [executorError, setExecutorError] = useState('')
  const [adding, setAdding] = useState(false)
  const [resuming, setResuming] = useState<{ id: string; name: string }>()
  const [setups, setSetups] = useState<KvmSetupRecord[]>()
  const [setupError, setSetupError] = useState('')
  const [prompt, setPrompt] = useState('')
  const [assignments, setAssignments] = useState<Record<string, Assignment>>({})
  const gbotEnabled = useGeneralSetting((state) => state.gbotEnabled)
  const setGbotEnabled = useGeneralSetting((state) => state.setGbotEnabled)
  const setupOffered = useRef(false)
  const setupIdentity = useRef<{ id: string; computerId: string } | null>(null)
  const refreshVersion = useRef(0)
  const refresh = useCallback(async () => {
    if (stopped.current) return
    const version = ++refreshVersion.current
    setSetups(undefined)
    try {
      const value = await gbot<BotState>('state')
      if (stopped.current || version !== refreshVersion.current) return
      const hasKvm = value.workspaces.some(
        (workspace) =>
          workspace.bot_pc?.kind === 'local_vm' &&
          workspace.bot_pc.hypervisor === 'kvm'
      )
      setState(value)
      setSetupError('')
      if (hasKvm) {
        try {
          const records = await gbot<KvmSetupRecord[]>('setup/kvm/status', {})
          if (stopped.current || version !== refreshVersion.current) return
          setSetups(records)
        } catch (cause) {
          if (stopped.current || version !== refreshVersion.current) return
          setSetupError(String(cause))
        }
      }
      if (!setupOffered.current) {
        setupOffered.current = true
        if (!value.workspaces.length) setAdding(true)
      }
      setError('')
      try {
        const [history, pending] = await Promise.all([
          gbot<Task[]>('tasks'),
          gbot<Approval[]>('tasks/approvals'),
        ])
        if (stopped.current || version !== refreshVersion.current) return
        setTasks(history)
        setApprovals(pending)
        setExecutorError('')
      } catch (cause) {
        if (stopped.current || version !== refreshVersion.current) return
        setExecutorError(String(cause))
      }
    } catch (cause) {
      if (stopped.current || version !== refreshVersion.current) return
      setError(String(cause))
    }
  }, [])
  useEffect(() => {
    if (!gbotEnabled || serviceStopped) return
    void refresh()
    const subscriptions = [
      listen('gbot-task-update', () => void refresh()),
      listen('gbot-setup-update', () => void refresh()),
    ]
    return () => {
      subscriptions.forEach((subscription) => {
        void subscription.then((stop) => stop())
      })
    }
  }, [refresh, gbotEnabled, serviceStopped])
  const changeService = async (start: boolean) => {
    if (busy) return
    setBusy(true)
    try {
      if (start) {
        await startGbotService()
        stopped.current = false
        setServiceStopped(false)
        await refresh()
      } else {
        stopped.current = true
        await quitGbotService()
        setServiceStopped(true)
      }
    } catch (cause) {
      if (!start) stopped.current = false
      toast.error(String(cause))
    } finally {
      setBusy(false)
    }
  }
  const perform = async (action: () => Promise<unknown>) => {
    if (busy) return
    setBusy(true)
    try {
      await action()
    } catch (cause) {
      toast.error(String(cause))
    } finally {
      setBusy(false)
      await refresh()
    }
  }
  const workspaceId = selected || state?.workspaces[0]?.id
  const bot = state?.workspaces.find(
    (workspace) => workspace.id === workspaceId
  )
  const identity = state?.live_sessions.find(
    (session) => session.identity.workspace_id === workspaceId
  )?.identity
  const control = state?.controls.find(
    (value) => value.identity.workspace_id === workspaceId
  )
  const history = tasks.filter(
    (task) => task.identity.workspace_id === workspaceId
  )
  const savedAssignment = state?.assignments?.find(
    (value) => value.workspace_id === workspaceId
  )
  const draft = assignments[workspaceId || '']
  const assignment = draft ||
    savedAssignment || {
      api_base: '',
      model: '',
      context_tokens: 0,
    }
  const setAssignment = (value: Assignment) => {
    if (workspaceId)
      setAssignments((previous) => ({ ...previous, [workspaceId]: value }))
  }
  const isKvm =
    bot?.bot_pc?.kind === 'local_vm' && bot.bot_pc.hypervisor === 'kvm'
  const setup = isKvm ? setups?.find((record) => record.id === bot.id) : undefined
  const setupBlocked = Boolean(
    isKvm && (setups === undefined || (setup && setup.stage !== 'ready'))
  )
  const botHasControl = !control || control.state === 'bot'
  const ready = Boolean(
    identity &&
      !setupBlocked &&
      !executorError &&
      !draft &&
      savedAssignment?.api_base.trim() &&
      savedAssignment.model.trim() &&
      savedAssignment.context_tokens > 0
  )
  const add = async (connection: BotConnection) => {
    const [algorithm, publicKey] = connection.hostKey.trim().split(/\s+/)
    if (!algorithm || !publicKey)
      throw new Error('Enter the dedicated computer’s SSH host public key')
    const identity = setupIdentity.current || {
      id: crypto.randomUUID(),
      computerId: crypto.randomUUID(),
    }
    setupIdentity.current = identity
    const created = await gbot<{ id: string }>('workspaces/ssh', {
      id: identity.id,
      name: connection.name,
      service_pc: { kind: 'local' },
      bot_pc: { kind: 'lan', computer_id: identity.computerId },
      endpoint: {
        hostname: connection.hostname,
        port: Number(connection.port),
        user: connection.user,
      },
      pinned_host_key: { algorithm, public_key: publicKey },
      private_key: connection.key,
      passphrase: connection.passphrase || null,
    })
    setupIdentity.current = null
    setSelected(created.id)
    setAdding(false)
    await refresh()
  }
  if (!gbotEnabled)
    return (
      <div className="flex h-full flex-col">
        <HeaderPage>Gbot</HeaderPage>
        <div className="space-y-3 p-5">
          <p>Enable Gbot to set up your bot's separate computer workspace.</p>
          <Button onClick={() => setGbotEnabled(true)}>Enable Gbot</Button>
        </div>
      </div>
    )
  return (
    <div className="flex h-full flex-col overflow-hidden">
      <HeaderPage>
        <span>Gbot</span>
        <Button
          variant="outline"
          size="sm"
          disabled={busy}
          onClick={() => void changeService(serviceStopped || Boolean(error))}
        >
          {serviceStopped || error ? 'Start Gbot service' : 'Quit Gbot service'}
        </Button>
      </HeaderPage>
      {serviceStopped ? (
        <div className="space-y-3 p-5">
          <p>
            Gbot service is stopped. Tasks and schedules will resume when you
            start it again.
          </p>
          <p className="text-sm text-muted-foreground">
            Connected account operations also use this service. Saved
            workspaces, schedules and accounts are retained.
          </p>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1">
          <aside className="w-48 shrink-0 space-y-2 overflow-y-auto border-r p-3">
            {state?.workspaces.map((workspace) => (
              <Button
                key={workspace.id}
                variant={workspace.id === workspaceId ? 'secondary' : 'ghost'}
                className="w-full justify-start truncate"
                onClick={() => setSelected(workspace.id)}
              >
                <GbotAvatar
                  size={24}
                  decorative
                  state={
                    !state.live_sessions.some(
                      (session) =>
                        session.identity.workspace_id === workspace.id
                    )
                      ? 'sleeping'
                      : tasks.some(
                            (task) =>
                              task.identity.workspace_id === workspace.id &&
                              task.state === 'running'
                          )
                        ? 'thinking'
                        : 'idle'
                  }
                />
                {workspace.name}
              </Button>
            ))}
            <Button
              variant="outline"
              className="w-full"
              onClick={() => {
                if (adding) setupIdentity.current = null
                setResuming(undefined)
                setAdding(!adding)
              }}
            >
              Add bot
            </Button>
          </aside>
          <main className="min-w-0 flex-1 space-y-4 overflow-y-auto p-5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <GbotAvatar
                  state={
                    !identity
                      ? 'sleeping'
                      : history.some(
                            (task) => task.state === 'waiting_for_human'
                          ) ||
                          approvals.some((approval) =>
                            history.some((task) => task.id === approval.task_id)
                          ) ||
                          prompt.trim()
                        ? 'listening'
                        : history.some((task) => task.state === 'running')
                          ? 'thinking'
                          : 'idle'
                  }
                />
                <h2 className="text-lg font-medium">
                  {bot?.name || 'Your bots'}
                </h2>
              </div>
              <Button
                variant="ghost"
                disabled={busy}
                onClick={() => void refresh()}
              >
                Refresh
              </Button>
            </div>
            {error && (
              <p role="alert" className="text-destructive">
                {error}
              </p>
            )}
            {adding && (
              <GbotSetup
                key={resuming?.id ?? 'new'}
                resume={resuming}
                save={add}
                localReady={async (id) => {
                  setSelected(id)
                  setAdding(false)
                  setResuming(undefined)
                  await refresh()
                }}
                cancel={() => {
                  setupIdentity.current = null
                  setResuming(undefined)
                  setAdding(false)
                }}
              />
            )}
            {bot && (
              <>
                {setupBlocked && (
                  <div className="space-y-2 rounded-md border p-3 text-sm">
                    <p role="status">Setup incomplete</p>
                    {setups === undefined && (
                      <p>{setupError || 'Checking setup status…'}</p>
                    )}
                    {setup?.issue && (
                      <div role="alert">
                        <p>{setup.issue.message}</p>
                        <p>{setup.issue.next_action}</p>
                      </div>
                    )}
                    {setup && (
                      <Button
                        variant="outline"
                        disabled={busy}
                        onClick={() => {
                          setResuming({ id: setup.id, name: setup.name })
                          setAdding(true)
                        }}
                      >
                        Resume setup
                      </Button>
                    )}
                  </div>
                )}
                <fieldset disabled={setupBlocked} className="min-w-0 space-y-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm text-muted-foreground">
                      {setupBlocked
                        ? 'Computer setup is incomplete'
                        : identity
                          ? control?.state === 'human'
                            ? 'Bot paused · you have control'
                            : 'Connected'
                          : 'Disconnected'}
                    </span>
                    <Button
                      variant="outline"
                      disabled={busy}
                      onClick={() =>
                        void perform(() =>
                          gbot(
                            identity ? 'disconnect' : 'connect',
                            identity || {
                              workspace_id: bot.id,
                              session_id: crypto.randomUUID(),
                            }
                          )
                        )
                      }
                    >
                      {identity ? 'Disconnect' : 'Connect'}
                    </Button>
                    {identity && (
                      <Button
                        variant="outline"
                        disabled={
                          busy || (!!control?.owner && control.owner !== owner)
                        }
                        onClick={() =>
                          void perform(() => {
                            const returning =
                              control?.state === 'human' ||
                              control?.state === 'paused'
                            if (returning) desktop.current?.stopInput()
                            return gbot(
                              returning
                                ? 'control/hand-back'
                                : 'control/take-over',
                              { identity, owner }
                            )
                          })
                        }
                      >
                        {control?.state === 'human' || control?.state === 'paused'
                          ? 'Hand back'
                          : 'Take over'}
                      </Button>
                    )}
                  </div>
                  {identity && !setupBlocked && (
                    <GbotDesktopView
                      key={`${identity.workspace_id}:${identity.session_id}`}
                      ref={desktop}
                      identity={identity}
                      owner={owner}
                      interactive={
                        control?.state === 'human' && control.owner === owner
                      }
                    />
                  )}

                  {executorError && (
                    <p role="status" className="rounded-md border p-3 text-sm">
                      {executorError}
                    </p>
                  )}
                  <GbotConnectors key={bot.id} workspaceId={bot.id} />
                  <GbotSchedules
                    key={`schedules-${bot.id}`}
                    workspaceId={bot.id}
                    assignment={savedAssignment}
                  />
                  <details className="rounded-lg border p-3">
                    <summary className="cursor-pointer text-sm">
                      Bot brain
                    </summary>
                    <p className="mt-3 text-sm text-muted-foreground">
                      For background tasks, select a Host endpoint that stays
                      running when GChat closes. GChat’s local port 1337 API stops
                      when GChat exits.
                    </p>
                    <div className="mt-3 grid gap-3 sm:grid-cols-2">
                      <label className="text-sm">
                        GInfer API URL
                        <Input
                          placeholder="http://host:port/v1"
                          value={assignment.api_base}
                          onChange={(event) =>
                            setAssignment({
                              ...assignment,
                              api_base: event.target.value,
                            })
                          }
                        />
                      </label>
                      <label className="text-sm">
                        Model ID
                        <Input
                          value={assignment.model}
                          onChange={(event) =>
                            setAssignment({
                              ...assignment,
                              model: event.target.value,
                            })
                          }
                        />
                      </label>
                      <label className="text-sm">
                        Model context tokens
                        <Input
                          type="number"
                          min="1"
                          value={assignment.context_tokens || ''}
                          onChange={(event) =>
                            setAssignment({
                              ...assignment,
                              context_tokens: Number(event.target.value),
                            })
                          }
                        />
                      </label>
                      <label className="text-sm">
                        API key
                        <Input
                          type="password"
                          autoComplete="off"
                          placeholder={
                            savedAssignment?.credential_ref
                              ? 'Saved in vault'
                              : ''
                          }
                          value={
                            'api_key' in assignment
                              ? assignment.api_key || ''
                              : ''
                          }
                          onChange={(event) =>
                            setAssignment({
                              ...assignment,
                              api_key: event.target.value,
                            })
                          }
                        />
                      </label>
                    </div>
                    <Button
                      className="mt-3"
                      variant="outline"
                      disabled={
                        busy ||
                        !assignment.api_base.trim() ||
                        !assignment.model.trim() ||
                        assignment.context_tokens <= 0
                      }
                      onClick={() =>
                        void perform(async () => {
                          await gbot('assignments/save', {
                            ...assignment,
                            workspace_id: workspaceId,
                          })
                          setAssignments((previous) => {
                            const next = { ...previous }
                            delete next[workspaceId || '']
                            return next
                          })
                        })
                      }
                    >
                      Save brain settings
                    </Button>
                    {draft && (
                      <p className="mt-2 text-xs text-muted-foreground">
                        Save these settings before starting a task.
                      </p>
                    )}
                  </details>
                  {approvals
                    .filter((approval) =>
                      history.some((task) => task.id === approval.task_id)
                    )
                    .map((approval) => (
                      <div
                        key={approval.id}
                        className="space-y-2 rounded-lg border p-3"
                      >
                        <p className="text-sm">Bot requests permission</p>
                        <pre className="overflow-x-auto text-xs">
                          {JSON.stringify(approval.request.operation, null, 2)}
                        </pre>
                        <Button
                          disabled={busy}
                          onClick={() =>
                            void perform(() =>
                              gbot('tasks/approval', {
                                id: approval.id,
                                allow: true,
                              })
                            )
                          }
                        >
                          Allow
                        </Button>{' '}
                        <Button
                          variant="outline"
                          disabled={busy}
                          onClick={() =>
                            void perform(() =>
                              gbot('tasks/approval', {
                                id: approval.id,
                                allow: false,
                              })
                            )
                          }
                        >
                          Deny
                        </Button>
                      </div>
                    ))}
                  {history.map((task) => (
                    <article
                      key={task.id}
                      className="space-y-2 rounded-lg border p-3"
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-sm capitalize">
                          {task.state.replaceAll('_', ' ')}
                        </span>
                        {['running', 'waiting_for_human'].includes(task.state) ? (
                          <Button
                            variant="ghost"
                            disabled={busy}
                            onClick={() =>
                              void perform(() =>
                                gbot('tasks/cancel', { id: task.id })
                              )
                            }
                          >
                            Stop
                          </Button>
                        ) : (
                          [
                            'ready',
                            'paused',
                            'interrupted',
                            'cancelled',
                          ].includes(task.state) && (
                            <Button
                              variant="ghost"
                              disabled={busy || !ready || !botHasControl}
                              onClick={() =>
                                void perform(() =>
                                  gbot('tasks/resume', { id: task.id })
                                )
                              }
                            >
                              Resume
                            </Button>
                          )
                        )}
                      </div>
                      {task.messages
                        .filter(
                          (message) =>
                            message.role === 'user' ||
                            message.role === 'assistant'
                        )
                        .map((message, index) => (
                          <p key={index} className="whitespace-pre-wrap text-sm">
                            {messageText(message.content)}
                          </p>
                        ))}
                      {task.help_requests?.map((request) => (
                        <HumanHelp
                          key={request.id}
                          request={request}
                          busy={busy}
                          reply={(response) =>
                            void perform(() =>
                              gbot('tasks/help', {
                                id: task.id,
                                request_id: request.id,
                                response,
                              })
                            )
                          }
                        />
                      ))}
                    </article>
                  ))}
                  <form
                    className="flex gap-2"
                    onSubmit={(event) => {
                      event.preventDefault()
                      if (!identity || !ready || !botHasControl) return
                      void perform(async () => {
                        await gbot('tasks/start', {
                          identity: identity as Identity,
                          prompt,
                        })
                        setPrompt('')
                      })
                    }}
                  >
                    <Input
                      aria-label="Bot task"
                      placeholder="Give this bot a task"
                      value={prompt}
                      onChange={(event) => setPrompt(event.target.value)}
                    />
                    <Button
                      disabled={
                        busy || !ready || !prompt.trim() || !botHasControl
                      }
                    >
                      Run
                    </Button>
                  </form>
                </fieldset>
              </>
            )}
            {!bot && !adding && (
              <p className="text-sm text-muted-foreground">
                Add a dedicated bot computer to start a channel. Each bot keeps
                its own task history.
              </p>
            )}
          </main>
        </div>
      )}
    </div>
  )
}

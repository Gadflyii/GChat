import { useCallback, useEffect, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { listen } from '@tauri-apps/api/event'
import { toast } from 'sonner'
import HeaderPage from '@/containers/HeaderPage'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  gbot,
  messageText,
  type Approval,
  type Assignment,
  type BotState,
  type Identity,
  type Task,
} from '@/services/gbot'

export const Route = createFileRoute('/gbot/')({ component: GbotPage })

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
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [executorError, setExecutorError] = useState('')
  const [adding, setAdding] = useState(false)
  const [prompt, setPrompt] = useState('')
  const [assignments, setAssignments] = useState<Record<string, Assignment>>({})
  const [connection, setConnection] = useState({
    name: '',
    hostname: '',
    port: '22',
    user: '',
    hostKey: '',
    key: '',
    passphrase: '',
  })
  const refresh = useCallback(async () => {
    try {
      const value = await gbot<BotState>('state')
      setState(value)
      setError('')
      try {
        const [history, pending] = await Promise.all([
          gbot<Task[]>('tasks'),
          gbot<Approval[]>('tasks/approvals'),
        ])
        setTasks(history)
        setApprovals(pending)
        setExecutorError('')
      } catch (cause) {
        setExecutorError(String(cause))
      }
    } catch (cause) {
      setError(String(cause))
    }
  }, [])
  useEffect(() => {
    void refresh()
    const subscription = listen('gbot-task-update', () => void refresh())
    return () => {
      void subscription.then((stop) => stop())
    }
  }, [refresh])
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
  const botHasControl = !control || control.state === 'bot'
  const ready = Boolean(
    identity &&
      !executorError &&
      !draft &&
      savedAssignment?.api_base.trim() &&
      savedAssignment.model.trim() &&
      savedAssignment.context_tokens > 0
  )
  const add = async () => {
    const [algorithm, publicKey] = connection.hostKey.trim().split(/\s+/)
    if (!algorithm || !publicKey)
      throw new Error('Enter the dedicated computer’s SSH host public key')
    const imported = await gbot<{ credential_ref: string }>('credentials/ssh', {
      private_key: connection.key,
      passphrase: connection.passphrase || null,
    })
    setConnection((previous) => ({ ...previous, key: '', passphrase: '' }))
    const id = crypto.randomUUID()
    await gbot('workspaces', {
      id,
      name: connection.name,
      service_pc: { kind: 'local' },
      bot_pc: { kind: 'lan', computer_id: crypto.randomUUID() },
      connection: {
        kind: 'ssh',
        endpoint: {
          hostname: connection.hostname,
          port: Number(connection.port),
          user: connection.user,
        },
        pinned_host_key: { algorithm, public_key: publicKey },
        credential_ref: imported.credential_ref,
      },
    })
    setSelected(id)
    setAdding(false)
  }
  return (
    <div className="flex h-full flex-col overflow-hidden">
      <HeaderPage>
        <span>Gbot</span>
      </HeaderPage>
      <div className="flex min-h-0 flex-1">
        <aside className="w-48 shrink-0 space-y-2 overflow-y-auto border-r p-3">
          {state?.workspaces.map((workspace) => (
            <Button
              key={workspace.id}
              variant={workspace.id === workspaceId ? 'secondary' : 'ghost'}
              className="w-full justify-start truncate"
              onClick={() => setSelected(workspace.id)}
            >
              {workspace.name}
            </Button>
          ))}
          <Button
            variant="outline"
            className="w-full"
            onClick={() => setAdding(!adding)}
          >
            Add bot
          </Button>
        </aside>
        <main className="min-w-0 flex-1 space-y-4 overflow-y-auto p-5">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-medium">{bot?.name || 'Your bots'}</h2>
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
            <form
              className="space-y-3 rounded-lg border p-4"
              onSubmit={(event) => {
                event.preventDefault()
                void perform(add)
              }}
            >
              <p className="text-sm text-muted-foreground">
                Connect a dedicated bot computer with the pinned Cua guest
                tools. Use a separate VM or bot desktop.
              </p>
              <div className="grid gap-3 sm:grid-cols-2">
                {(['name', 'hostname', 'port', 'user', 'hostKey'] as const).map(
                  (field) => (
                    <label key={field} className="space-y-1 text-sm">
                      {
                        {
                          name: 'Bot name',
                          hostname: 'SSH host',
                          port: 'SSH port',
                          user: 'SSH user',
                          hostKey: 'SSH host public key',
                        }[field]
                      }
                      <Input
                        required
                        value={connection[field]}
                        onChange={(event) =>
                          setConnection({
                            ...connection,
                            [field]: event.target.value,
                          })
                        }
                      />
                    </label>
                  )
                )}
              </div>
              <label className="block space-y-1 text-sm">
                SSH private key
                <textarea
                  required
                  className="min-h-24 w-full rounded-md border bg-background p-2 font-mono"
                  value={connection.key}
                  onChange={(event) =>
                    setConnection({ ...connection, key: event.target.value })
                  }
                  autoComplete="off"
                />
              </label>
              <label className="block space-y-1 text-sm">
                Key passphrase
                <Input
                  type="password"
                  autoComplete="off"
                  value={connection.passphrase}
                  onChange={(event) =>
                    setConnection({
                      ...connection,
                      passphrase: event.target.value,
                    })
                  }
                />
              </label>
              <p className="text-xs text-muted-foreground">
                The key is imported into GChat’s vault. Bot accounts and
                connector settings are independent.
              </p>
              <Button disabled={busy}>Save bot</Button>
            </form>
          )}
          {bot && (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm text-muted-foreground">
                  {identity
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
                      void perform(() =>
                        gbot(
                          control?.state === 'human' ||
                            control?.state === 'paused'
                            ? 'control/hand-back'
                            : 'control/take-over',
                          { identity, owner }
                        )
                      )
                    }
                  >
                    {control?.state === 'human' || control?.state === 'paused'
                      ? 'Hand back'
                      : 'Take over'}
                  </Button>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                Take over pauses bot input. The embedded desktop viewer is
                pending its Cua media adapter.
              </p>
              {executorError && (
                <p role="status" className="rounded-md border p-3 text-sm">
                  {executorError}
                </p>
              )}
              <details className="rounded-lg border p-3">
                <summary className="cursor-pointer text-sm">Bot brain</summary>
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
                        savedAssignment?.credential_ref ? 'Saved in vault' : ''
                      }
                      value={
                        'api_key' in assignment ? assignment.api_key || '' : ''
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
                    {task.state === 'running' ? (
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
                      ['paused', 'interrupted', 'cancelled'].includes(
                        task.state
                      ) && (
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
                        message.role === 'user' || message.role === 'assistant'
                    )
                    .map((message, index) => (
                      <p key={index} className="whitespace-pre-wrap text-sm">
                        {messageText(message.content)}
                      </p>
                    ))}
                </article>
              ))}
              <form
                className="flex gap-2"
                onSubmit={(event) => {
                  event.preventDefault()
                  if (!identity) return
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
                  disabled={busy || !ready || !prompt.trim() || !botHasControl}
                >
                  Run
                </Button>
              </form>
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
    </div>
  )
}

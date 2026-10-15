import { useEffect, useRef, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { listen } from '@tauri-apps/api/event'
import {
  IconArrowsMaximize,
  IconArrowsMinimize,
  IconChevronDown,
  IconX,
} from '@tabler/icons-react'
import { toast } from 'sonner'
import GbotAvatar from '@/components/GbotAvatar'
import GbotDesktopView, {
  type DesktopViewHandle,
} from '@/components/GbotDesktopView'
import GbotHumanHelp from '@/components/GbotHumanHelp'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useGeneralSetting } from '@/hooks/useGeneralSetting'
import { route } from '@/constants/routes'
import {
  gbot,
  gbotControlOwner,
  messageText,
  validBrainConnection,
  type Task,
} from '@/services/gbot'
import {
  draftFields,
  draftProposal,
  pageMessage,
  useGbotPage,
} from '@/stores/gbot-page-store'
import {
  avatarStatus,
  botAvatarState,
  useGbotCompanion,
  type CompanionTab,
} from '@/stores/gbot-companion-store'

const tabs: { id: CompanionTab; label: string }[] = [
  { id: 'conversation', label: 'Conversation' },
  { id: 'agents', label: 'Agents' },
  { id: 'desktop', label: 'Desktop' },
]

export default function GbotCompanion() {
  const enabled = useGeneralSetting((s) => s.gbotEnabled)
  const state = useGbotCompanion()
  const pageState = useGbotPage()
  const [owner] = useState(gbotControlOwner)
  const [busy, setBusy] = useState(false)
  const desktop = useRef<DesktopViewHandle>(null)
  const panel = useRef<HTMLElement>(null)
  const wasVisible = useRef(false)
  const visible = enabled && state.mode !== 'hidden'
  const workspaceId = state.selected
  const sharingPage =
    pageState.sharing?.workspaceId === workspaceId &&
    pageState.sharing.target === state.target
  const bot = state.snapshot.workspaces.find((b) => b.id === workspaceId)
  const identity = state.snapshot.live_sessions.find(
    (i) => i.workspace_id === workspaceId
  )
  const control = state.snapshot.controls.find(
    (c) =>
      c.identity.workspace_id === workspaceId &&
      c.identity.session_id === identity?.session_id
  )
  const assignment = state.snapshot.assignments?.find(
    (a) => a.workspace_id === workspaceId
  )
  const history = state.tasks.filter(
    (t) => t.identity.workspace_id === workspaceId
  )
  const approvals = state.approvals.filter((a) =>
    history.some((t) => t.id === a.task_id)
  )
  const botHasControl = !control || control.state === 'bot'
  const isKvm =
    bot?.bot_pc?.kind === 'local_vm' && bot.bot_pc.hypervisor === 'kvm'
  const setup = state.setups?.find((record) => record.id === workspaceId)
  const setupBlocked = Boolean(
    isKvm && (state.setups === undefined || (setup && setup.stage !== 'ready'))
  )
  const ready = Boolean(
    state.available &&
      identity &&
      !setupBlocked &&
      !state.executorError &&
      assignment &&
      validBrainConnection(assignment.connection) &&
      assignment.model.trim() &&
      assignment.context_tokens > 0
  )
  const tab = state.tabs[workspaceId] ?? 'conversation'
  const draft = state.drafts[workspaceId] ?? ''

  useEffect(() => {
    const sharing = useGbotPage.getState().sharing
    if (
      sharing &&
      (!visible ||
        sharing.workspaceId !== workspaceId ||
        sharing.target !== state.target)
    )
      useGbotPage.getState().stop()
  }, [visible, workspaceId, state.target])

  useEffect(() => () => useGbotPage.getState().stop(), [])
  const animation = botAvatarState(state, workspaceId)

  useEffect(() => {
    if (!enabled) {
      useGbotCompanion.getState().reset()
      return
    }
    const refresh = () => void useGbotCompanion.getState().refresh()
    // Subscribe before the first snapshot so an update cannot be lost during startup.
    let cancelled = false
    const subscriptions = ['gbot-task-update', 'gbot-setup-update'].map(
      (event) => listen(event, refresh)
    )
    void Promise.all(subscriptions)
      .then(() => {
        if (!cancelled) refresh()
      })
      .catch(() => {
        if (!cancelled) refresh()
      })
    return () => {
      cancelled = true
      subscriptions.forEach((subscription) => {
        void subscription.then((stop) => stop()).catch(() => {})
      })
      useGbotCompanion.getState().reset()
    }
  }, [enabled])

  useEffect(() => {
    if (!state.greeting) return
    const timer = window.setTimeout(
      () => useGbotCompanion.getState().endGreeting(),
      3200
    )
    return () => window.clearTimeout(timer)
  }, [state.greeting])

  useEffect(() => {
    if (!visible || tab !== 'conversation' || !state.unread[workspaceId]) return
    const timer = window.setTimeout(
      () => useGbotCompanion.getState().acknowledge(workspaceId),
      4000
    )
    return () => window.clearTimeout(timer)
  }, [visible, tab, workspaceId, state.unread])

  useEffect(() => {
    if (visible) panel.current?.focus()
    else if (wasVisible.current) {
      desktop.current?.stopInput()
      const avatars =
        document.querySelectorAll<HTMLElement>('[data-gbot-avatar]')
      Array.from(avatars)
        .find((a) => a.dataset.gbotAvatar === workspaceId)
        ?.focus()
    }
    wasVisible.current = visible
  }, [visible, workspaceId])

  const perform = async (action: () => Promise<unknown>) => {
    if (busy) return
    setBusy(true)
    try {
      await action()
    } catch (cause) {
      toast.error(String(cause))
    } finally {
      await useGbotCompanion.getState().refresh()
      setBusy(false)
    }
  }
  const hide = () => {
    desktop.current?.stopInput()
    state.setMode('hidden')
  }

  if (!enabled) return null
  return (
    <aside
      ref={panel}
      id="gbot-companion"
      aria-label="Gbot companion"
      tabIndex={-1}
      aria-hidden={!visible}
      inert={!visible}
      data-mode={state.mode}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault()
          event.stopPropagation()
          hide()
        }
      }}
      className={`absolute inset-y-0 right-0 z-40 flex flex-col border-l bg-background shadow-2xl outline-none transition-[transform,width,visibility] duration-200 motion-reduce:transition-none ${
        state.mode === 'expanded' ? 'w-full' : 'w-[min(30rem,100%)]'
      } ${visible ? 'visible translate-x-0' : 'invisible translate-x-full'}`}
    >
      <header className="flex shrink-0 items-center gap-3 border-b px-4 py-3">
        <GbotAvatar state={animation} size={36} decorative />
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-sm font-semibold">
            {bot?.name || 'Your bot'}
          </h2>
          <p className="text-xs text-muted-foreground">
            {avatarStatus[animation]}
          </p>
        </div>
        <Button
          variant="ghost"
          size="icon"
          aria-label={
            state.mode === 'expanded' ? 'Minimize bot pane' : 'Expand bot pane'
          }
          onClick={() =>
            state.setMode(state.mode === 'expanded' ? 'compact' : 'expanded')
          }
        >
          {state.mode === 'expanded' ? (
            <IconArrowsMinimize size={18} />
          ) : (
            <IconArrowsMaximize size={18} />
          )}
        </Button>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Hide bot pane"
          onClick={hide}
        >
          <IconX size={18} />
        </Button>
      </header>
      {state.snapshot.workspaces.length > 1 && (
        <div className="flex items-center gap-2 border-b px-4 py-2 text-xs">
          Bot
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                aria-label="Companion bot"
                className="min-w-0 flex-1 justify-between bg-background text-foreground"
              >
                <span className="truncate">{bot?.name || 'Choose a bot'}</span>
                <IconChevronDown size={14} />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuRadioGroup
                value={workspaceId}
                onValueChange={(id) => {
                  if (id === workspaceId) return
                  desktop.current?.stopInput()
                  state.open(id)
                }}
              >
                {state.snapshot.workspaces.map((b) => (
                  <DropdownMenuRadioItem key={b.id} value={b.id}>
                    {b.name}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}
      <nav
        aria-label="Bot views"
        className="flex shrink-0 gap-1 border-b px-3 py-2"
      >
        {tabs.map((item) => (
          <Button
            key={item.id}
            variant={tab === item.id ? 'secondary' : 'ghost'}
            size="sm"
            aria-pressed={tab === item.id}
            onClick={() => {
              if (tab === item.id) return
              desktop.current?.stopInput()
              state.setTab(item.id)
            }}
          >
            {item.label}
          </Button>
        ))}
      </nav>
      {state.error && (
        <div role="alert" className="space-y-2 border-b p-4 text-sm">
          <p>{state.error}</p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void state.refresh()}
          >
            Retry connection
          </Button>
        </div>
      )}
      {!bot ? (
        <div className="space-y-3 p-4 text-sm">
          <p>Add a bot computer in Gbot settings to begin.</p>
          <Link
            to={route.gbot.index}
            onClick={hide}
            className="text-primary underline"
          >
            Open Gbot settings
          </Link>
        </div>
      ) : (
        <>
          <section
            aria-label="Bot conversation"
            hidden={tab !== 'conversation'}
            className="min-h-0 flex-1 overflow-y-auto p-4"
          >
            <div className="mx-auto max-w-3xl space-y-4">
              {!history.length && (
                <p className="text-sm text-muted-foreground">
                  Give {bot.name} a task, or ask a question about its work.
                </p>
              )}
              {approvals.map((approval) => (
                <article
                  key={approval.id}
                  className="space-y-2 rounded-lg border p-3"
                >
                  <p className="text-sm font-medium">Bot requests permission</p>
                  <pre className="overflow-x-auto whitespace-pre-wrap break-words text-xs">
                    {JSON.stringify(approval.request.operation, null, 2)}
                  </pre>
                  <div className="flex gap-2">
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
                    </Button>
                    <Button
                      disabled={busy}
                      variant="outline"
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
                </article>
              ))}
              {history.map((task) => (
                <article
                  key={task.id}
                  className="space-y-3 rounded-lg border p-3"
                >
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>{task.state.replaceAll('_', ' ')}</span>
                    {['running', 'waiting_for_human'].includes(task.state) ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={busy}
                        onClick={() =>
                          void perform(() =>
                            gbot('tasks/cancel', { id: task.id })
                          )
                        }
                      >
                        Stop task
                      </Button>
                    ) : (
                      ['ready', 'paused', 'interrupted', 'cancelled'].includes(
                        task.state
                      ) && (
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={busy || !ready || !botHasControl}
                          onClick={() =>
                            void perform(() =>
                              gbot('tasks/resume', { id: task.id })
                            )
                          }
                        >
                          Resume task
                        </Button>
                      )
                    )}
                  </div>
                  {task.messages
                    .filter(
                      (m) =>
                        ['user', 'assistant'].includes(m.role) &&
                        messageText(m.content)
                    )
                    .map((message, index) => (
                      <div key={index} className="space-y-1">
                        <p className="text-xs font-medium text-muted-foreground">
                          {message.role === 'user' ? 'You' : bot.name}
                        </p>
                        {message.role === 'user' &&
                          pageMessage(messageText(message.content)).shared && (
                            <p className="text-xs text-muted-foreground">
                              Shared Agent Studio draft
                            </p>
                          )}
                        {message.role === 'user' ? (
                          <p className="whitespace-pre-wrap break-words text-sm">
                            {pageMessage(messageText(message.content)).text}
                          </p>
                        ) : (
                          <GbotDraftProposal
                            taskId={task.id}
                            workspaceId={workspaceId}
                            target={state.target}
                            text={messageText(message.content)}
                            busy={busy || !ready || !botHasControl}
                          />
                        )}
                      </div>
                    ))}
                  {task.help_requests?.map((request) => (
                    <GbotHumanHelp
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
              {state.executorError && (
                <p role="status" className="text-sm text-muted-foreground">
                  {state.executorError}
                </p>
              )}
              {!ready && (
                <p className="text-sm text-muted-foreground">
                  {setupBlocked
                    ? 'Finish this bot’s computer setup in Gbot settings to run tasks.'
                    : 'Connect this bot and save its model in Gbot settings to run tasks.'}
                </p>
              )}
              {!botHasControl && (
                <p className="text-sm text-muted-foreground">
                  The bot is paused for desktop control. Hand back in Desktop to
                  continue.
                </p>
              )}
            </div>
          </section>
          {tab === 'conversation' && (
            <form
              className="shrink-0 space-y-2 border-t p-4"
              onSubmit={(event) => {
                event.preventDefault()
                if (!identity || !ready || !botHasControl || !draft.trim())
                  return
                const submitted = draft
                void perform(async () => {
                  const request = useGbotPage
                    .getState()
                    .capture(workspaceId, state.target, submitted)
                  const task = await gbot<Task>('tasks/start', {
                    identity,
                    prompt: request?.prompt ?? submitted,
                  })
                  if (request && task?.id)
                    useGbotPage.getState().remember(task.id, request)
                  const current = useGbotCompanion.getState()
                  if (current.drafts[workspaceId] === submitted)
                    current.setDraft(workspaceId, '')
                })
              }}
            >
              {pageState.page && (
                <div className="mb-2 space-y-1">
                  {sharingPage ? (
                    <>
                      <p className="text-xs text-muted-foreground">
                        Sharing the current Agent Studio draft with {bot.name}{' '}
                        when you send. Applied edits stay unsaved.
                      </p>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => pageState.stop()}
                      >
                        Stop sharing page
                      </Button>
                    </>
                  ) : (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={busy || !ready || !botHasControl}
                      onClick={() => pageState.share(workspaceId, state.target)}
                    >
                      Help with this page
                    </Button>
                  )}
                </div>
              )}
              <textarea
                aria-label="Message bot"
                placeholder={`Message ${bot.name}`}
                value={draft}
                className="min-h-20 max-h-48 w-full resize-y rounded-lg border bg-background p-3 text-sm"
                onFocus={() => state.setFocused(workspaceId)}
                onBlur={() => state.setFocused('')}
                onChange={(event) =>
                  state.setDraft(workspaceId, event.target.value)
                }
              />
              <div className="flex items-center justify-between gap-2">
                <Link
                  to={route.gbot.index}
                  onClick={hide}
                  className="text-xs text-muted-foreground underline"
                >
                  Gbot settings
                </Link>
                <Button
                  disabled={busy || !ready || !botHasControl || !draft.trim()}
                >
                  Send
                </Button>
              </div>
            </form>
          )}
          <section
            aria-label="Bot agents"
            hidden={tab !== 'agents'}
            className="min-h-0 flex-1 overflow-y-auto p-4"
          >
            <div className="mx-auto max-w-3xl space-y-4">
              <h3 className="text-sm font-semibold">Assigned agent</h3>
              <p className="text-sm">
                {assignment?.model || 'Choose a model in Gbot settings.'}
              </p>
              <p className="text-xs text-muted-foreground">
                The assigned model runs this bot’s tasks. Tool activity appears
                below as the service reports it.
              </p>
              {history.map((task) => (
                <article
                  key={task.id}
                  className="space-y-2 rounded-lg border p-3 text-sm"
                >
                  <p className="truncate font-medium">
                    {task.messages.find((m) => m.role === 'user')
                      ? pageMessage(
                          messageText(
                            task.messages.find((m) => m.role === 'user')!
                              .content
                          )
                        ).text
                      : 'Bot task'}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {task.state.replaceAll('_', ' ')}
                  </p>
                  {[...(task.calls ?? []), ...(task.connector_calls ?? [])].map(
                    (call) => (
                      <p key={call.call_id} className="text-xs">
                        {call.name} ·{' '}
                        {'not_executed' in call && call.not_executed
                          ? 'not executed'
                          : call.reply == null
                            ? 'awaiting result'
                            : 'result received'}
                      </p>
                    )
                  )}
                </article>
              ))}
            </div>
          </section>
          <section
            aria-label="Bot desktop controls"
            hidden={tab !== 'desktop'}
            className="min-h-0 flex-1 overflow-y-auto p-4"
          >
            <div className="mx-auto max-w-5xl space-y-4">
              {identity && !setupBlocked ? (
                <>
                  <div className="flex items-center gap-3">
                    <p className="flex-1 text-sm">
                      {control?.state === 'human'
                        ? 'Bot paused · human control'
                        : control?.state === 'paused'
                          ? 'Bot paused'
                          : 'Bot has control'}
                    </p>
                    <Button
                      variant="outline"
                      disabled={
                        busy ||
                        Boolean(control?.owner && control.owner !== owner)
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
                  </div>
                  <GbotDesktopView
                    key={`${identity.workspace_id}:${identity.session_id}`}
                    ref={desktop}
                    identity={identity}
                    owner={owner}
                    interactive={
                      control?.state === 'human' && control.owner === owner
                    }
                    visible={visible && tab === 'desktop'}
                  />
                  <p className="text-xs text-muted-foreground">
                    Hiding this pane closes desktop input and audio. A bot
                    paused for takeover stays paused until you hand back
                    control.
                  </p>
                </>
              ) : (
                <p className="text-sm text-muted-foreground">
                  {setupBlocked
                    ? 'Finish this bot’s computer setup in Gbot settings to view its desktop.'
                    : 'Connect this bot in Gbot settings to view its computer.'}
                </p>
              )}
            </div>
          </section>
        </>
      )}
    </aside>
  )
}

function GbotDraftProposal({
  taskId,
  workspaceId,
  target,
  text,
  busy,
}: {
  taskId: string
  workspaceId: string
  target: string
  text: string
  busy: boolean
}) {
  const page = useGbotPage()
  const [applied, setApplied] = useState(false)
  const edits = draftProposal(text)
  const canApply = edits && page.canApply(taskId, workspaceId, target, edits)
  return (
    <>
      <p className="whitespace-pre-wrap break-words text-sm">
        {edits
          ? text.replace(/```gchat-agent-draft\s*\n[\s\S]*?\n```/, '').trim()
          : text}
      </p>
      {edits && (
        <div className="space-y-2 rounded-md border bg-muted/30 p-3">
          <details>
            <summary className="cursor-pointer text-sm font-medium">
              Review draft edits
            </summary>
            <dl className="mt-2 space-y-3">
              {Object.entries(edits).map(([key, value]) => (
                <div key={key}>
                  <dt className="text-xs font-medium">
                    {draftFields[key as keyof typeof draftFields]}
                  </dt>
                  <dd className="whitespace-pre-wrap break-words text-sm">
                    {value || '(empty)'}
                  </dd>
                </div>
              ))}
            </dl>
          </details>
          <Button
            type="button"
            size="sm"
            disabled={busy || !canApply || applied}
            onClick={() => {
              if (edits && page.apply(taskId, workspaceId, target, edits)) {
                setApplied(true)
                toast.success(
                  'Updated Agent Studio draft. Review it before saving.'
                )
              }
            }}
          >
            {applied ? 'Applied to draft' : 'Apply to draft'}
          </Button>
          {!canApply && !applied && (
            <p className="text-xs text-muted-foreground">
              The shared draft has changed or sharing has ended. Share the
              current draft and ask again to apply edits.
            </p>
          )}
        </div>
      )}
    </>
  )
}

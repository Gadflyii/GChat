import { create } from 'zustand'
import type { AvatarState } from '@/components/GbotAvatar'
import {
  gbot,
  getGbotServiceTarget,
  messageText,
  type Approval,
  type BotState,
  type Task,
  type KvmSetupRecord,
} from '@/services/gbot'

export type CompanionTab = 'conversation' | 'agents' | 'desktop'
type PanelMode = 'hidden' | 'compact' | 'expanded'
const empty: BotState = {
  workspaces: [],
  live_sessions: [],
  controls: [],
  assignments: [],
}

type CompanionState = {
  mode: PanelMode
  selected: string
  tabs: Record<string, CompanionTab>
  drafts: Record<string, string>
  focused: string
  greeting: string
  unread: Record<string, boolean>
  replyBaseline: Record<string, string[]> | null
  snapshot: BotState
  tasks: Task[]
  approvals: Approval[]
  available: boolean
  loading: boolean
  error: string
  executorError: string
  setups: KvmSetupRecord[] | undefined
  target: string
  version: number
  open: (workspaceId?: string) => void
  setMode: (mode: PanelMode) => void
  setTab: (tab: CompanionTab) => void
  setDraft: (workspaceId: string, draft: string) => void
  setFocused: (workspaceId: string) => void
  acknowledge: (workspaceId: string) => void
  endGreeting: () => void
  refresh: () => Promise<void>
  reset: () => void
}

function replyKey(tasks: Task[], workspaceId: string) {
  return tasks
    .filter((t) => t.identity.workspace_id === workspaceId)
    .flatMap((t) =>
      t.messages
        .filter((m) => m.role === 'assistant' && messageText(m.content))
        .map((m, index) =>
          JSON.stringify([t.id, index, messageText(m.content)])
        )
    )
}

export const useGbotCompanion = create<CompanionState>((set, get) => ({
  mode: 'hidden',
  selected: '',
  tabs: {},
  drafts: {},
  focused: '',
  greeting: '',
  unread: {},
  replyBaseline: null,
  snapshot: empty,
  tasks: [],
  approvals: [],
  available: false,
  loading: false,
  error: '',
  executorError: '',
  setups: undefined,
  target: '',
  version: 0,
  open: (workspaceId) =>
    set((s) => {
      const selected =
        workspaceId ?? (s.selected || s.snapshot.workspaces[0]?.id || '')
      return {
        selected,
        mode: s.mode === 'hidden' ? 'compact' : s.mode,
        greeting:
          s.mode === 'hidden' || selected !== s.selected
            ? selected
            : s.greeting,
      }
    }),
  setMode: (mode) => set({ mode, focused: '' }),
  setTab: (tab) =>
    set((s) => ({ tabs: { ...s.tabs, [s.selected]: tab }, focused: '' })),
  setDraft: (workspaceId, draft) =>
    set((s) => ({ drafts: { ...s.drafts, [workspaceId]: draft } })),
  setFocused: (focused) => set({ focused }),
  acknowledge: (workspaceId) =>
    set((s) => ({ unread: { ...s.unread, [workspaceId]: false } })),
  endGreeting: () => set({ greeting: '' }),
  reset: () =>
    set((s) => ({
      mode: 'hidden',
      selected: '',
      tabs: {},
      drafts: {},
      focused: '',
      greeting: '',
      unread: {},
      replyBaseline: null,
      snapshot: empty,
      tasks: [],
      approvals: [],
      available: false,
      loading: false,
      error: '',
      executorError: '',
      setups: undefined,
      target: '',
      version: s.version + 1,
    })),
  refresh: async () => {
    const version = get().version + 1
    set({ version, loading: true })
    try {
      const target = JSON.stringify(await getGbotServiceTarget())
      if (get().version !== version) return
      if (get().target && target !== get().target) {
        get().reset()
        set({ version, target, loading: true })
      }
      const snapshot = await gbot<BotState>('state')
      if (get().version !== version) return
      let setups: KvmSetupRecord[] | undefined
      if (
        snapshot.workspaces.some(
          (b) => b.bot_pc?.kind === 'local_vm' && b.bot_pc.hypervisor === 'kvm'
        )
      ) {
        try {
          setups = await gbot<KvmSetupRecord[]>('setup/kvm/status', {})
        } catch {
          /* Hold admission when setup status is unavailable. */
        }
        if (get().version !== version) return
      }
      let tasks: Task[] = []
      let approvals: Approval[] = []
      let executorError = ''
      try {
        const result = await Promise.all([
          gbot<Task[]>('tasks'),
          gbot<Approval[]>('tasks/approvals'),
        ])
        tasks = result[0]
        approvals = result[1]
      } catch (cause) {
        executorError = String(cause)
      }
      if (get().version !== version) return
      set((s) => {
        const unread = { ...s.unread }
        let replyBaseline = s.replyBaseline
        if (!executorError) {
          const next = Object.fromEntries(
            snapshot.workspaces.map((bot) => [bot.id, replyKey(tasks, bot.id)])
          )
          if (s.target === target && s.replyBaseline) {
            for (const bot of snapshot.workspaces) {
              const previous = new Set(s.replyBaseline[bot.id] ?? [])
              if (next[bot.id].some((reply) => !previous.has(reply)))
                unread[bot.id] = true
            }
          }
          replyBaseline = next
        }
        const selected = snapshot.workspaces.some((b) => b.id === s.selected)
          ? s.selected
          : snapshot.workspaces[0]?.id || ''
        return {
          snapshot,
          tasks,
          approvals,
          selected,
          unread,
          replyBaseline,
          available: true,
          target,
          error: '',
          executorError,
          setups,
        }
      })
    } catch (cause) {
      if (get().version === version)
        set((s) => ({
          error: String(cause),
          available: false,
          tasks: [],
          approvals: [],
          snapshot: { ...s.snapshot, live_sessions: [], controls: [] },
        }))
    } finally {
      if (get().version === version) set({ loading: false })
    }
  },
}))

export function botAvatarState(
  s: CompanionState,
  workspaceId: string
): AvatarState {
  if (
    !s.available ||
    s.executorError ||
    !s.snapshot.live_sessions.some((i) => i.workspace_id === workspaceId)
  )
    return 'sleeping'
  const tasks = s.tasks.filter((t) => t.identity.workspace_id === workspaceId)
  if (
    s.focused === workspaceId ||
    tasks.some((t) => t.state === 'waiting_for_human') ||
    s.approvals.some((a) => tasks.some((t) => t.id === a.task_id))
  )
    return 'listening'
  const running = tasks.filter((t) => t.state === 'running')
  if (running.length)
    return running.some(
      (t) => (t.calls?.length ?? 0) + (t.connector_calls?.length ?? 0) > 0
    )
      ? 'thinking-hard'
      : 'thinking'
  if (
    s.snapshot.controls.some(
      (c) => c.identity.workspace_id === workspaceId && c.state !== 'bot'
    )
  )
    return 'sleeping'
  if (s.unread[workspaceId]) return 'speaking'
  if (s.greeting === workspaceId) return 'greeting'
  return 'idle'
}

export const avatarStatus = {
  'idle': 'Ready',
  'listening': 'Listening',
  'thinking': 'Thinking',
  'thinking-hard': 'Working through steps',
  'speaking': 'New reply',
  'greeting': 'Hello',
  'sleeping': 'Resting',
} satisfies Record<AvatarState, string>

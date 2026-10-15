import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  gbot,
  getGbotServiceTarget,
  type BotState,
  type Task,
} from '@/services/gbot'
import { botAvatarState, useGbotCompanion } from './gbot-companion-store'

vi.mock('@/services/gbot', async (original) => ({
  ...(await original<object>()),
  gbot: vi.fn(),
  getGbotServiceTarget: vi.fn(),
}))
const snapshot: BotState = {
  workspaces: [
    { id: 'a', name: 'A' },
    { id: 'b', name: 'B' },
  ],
  live_sessions: [{ workspace_id: 'a', session_id: 'session-a' }],
  controls: [],
  assignments: [],
}
const task = (state: string): Task => ({
  id: 'task-a',
  identity: snapshot.live_sessions[0],
  state,
  messages: [{ role: 'user', content: 'Help me' }],
  help_requests: [],
})
beforeEach(() => {
  vi.resetAllMocks()
  useGbotCompanion.getState().reset()
  vi.mocked(getGbotServiceTarget).mockResolvedValue({ kind: 'local' })
  vi.mocked(gbot).mockImplementation(async (path) =>
    path === 'state' ? snapshot : []
  )
})

describe('Gbot companion state', () => {
  it('preserves per-bot drafts and tabs across all pane modes', async () => {
    await useGbotCompanion.getState().refresh()
    const s = useGbotCompanion.getState()
    s.open('a')
    s.setDraft('a', 'Unsent A')
    s.setTab('desktop')
    s.setMode('expanded')
    s.open('b')
    s.setDraft('b', 'Unsent B')
    s.setTab('agents')
    s.setMode('hidden')
    s.open('a')
    expect(useGbotCompanion.getState()).toMatchObject({
      mode: 'compact',
      selected: 'a',
      drafts: { a: 'Unsent A', b: 'Unsent B' },
      tabs: { a: 'desktop', b: 'agents' },
    })
  })

  it('maps all seven animations to connection, attention, actual work and replies', async () => {
    const animation = () => botAvatarState(useGbotCompanion.getState(), 'a')
    expect(animation()).toBe('sleeping')
    await useGbotCompanion.getState().refresh()
    expect(animation()).toBe('idle')
    useGbotCompanion.getState().open('a')
    expect(animation()).toBe('greeting')
    useGbotCompanion.getState().endGreeting()
    useGbotCompanion.getState().setFocused('a')
    expect(animation()).toBe('listening')
    useGbotCompanion.getState().setFocused('')
    useGbotCompanion.setState({ tasks: [task('running')] })
    expect(animation()).toBe('thinking')
    useGbotCompanion.setState({
      tasks: [
        {
          ...task('running'),
          calls: [{ call_id: 'read', name: 'read_file', reply: null }],
        },
      ],
    })
    expect(animation()).toBe('thinking-hard')
    useGbotCompanion.setState({ tasks: [task('waiting_for_human')] })
    expect(animation()).toBe('listening')
    useGbotCompanion.setState({
      tasks: [task('completed')],
      unread: { a: true },
    })
    expect(animation()).toBe('speaking')
    useGbotCompanion.getState().acknowledge('a')
    expect(animation()).toBe('idle')
    useGbotCompanion.setState({
      snapshot: {
        ...snapshot,
        controls: [
          {
            identity: snapshot.live_sessions[0],
            owner: 'human',
            state: 'human',
          },
        ],
      },
    })
    expect(animation()).toBe('sleeping')
  })

  it('marks only new assistant text as an unread reply', async () => {
    let tasks = [
      {
        ...task('completed'),
        messages: [{ role: 'assistant', content: 'Old reply' }],
      },
    ]
    vi.mocked(gbot).mockImplementation(async (path) =>
      path === 'state' ? snapshot : path === 'tasks' ? tasks : []
    )
    await useGbotCompanion.getState().refresh()
    expect(useGbotCompanion.getState().unread.a).toBeUndefined()
    tasks = [
      ...tasks,
      {
        ...task('running'),
        id: 'new-task',
        messages: [{ role: 'user', content: 'Next task' }],
      },
    ]
    await useGbotCompanion.getState().refresh()
    expect(useGbotCompanion.getState().unread.a).toBeUndefined()
    tasks = [
      tasks[0],
      {
        ...tasks[1],
        messages: [
          ...tasks[1].messages,
          { role: 'assistant', content: 'New reply' },
        ],
      },
    ]
    await useGbotCompanion.getState().refresh()
    expect(useGbotCompanion.getState().unread.a).toBe(true)
  })

  it('rejects stale responses after disable or a newer refresh', async () => {
    let finish!: (value: BotState) => void
    vi.mocked(gbot).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve
        })
    )
    const pending = useGbotCompanion.getState().refresh()
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
    useGbotCompanion.getState().reset()
    finish(snapshot)
    await pending
    expect(useGbotCompanion.getState().snapshot.workspaces).toEqual([])
    expect(useGbotCompanion.getState().available).toBe(false)
  })

  it('clears the previous service context and drafts when the selected service changes', async () => {
    await useGbotCompanion.getState().refresh()
    useGbotCompanion.getState().open('a')
    useGbotCompanion.getState().setDraft('a', 'Private local draft')
    vi.mocked(getGbotServiceTarget).mockResolvedValue({
      kind: 'paired_host',
      host_id: 'remote',
    })
    vi.mocked(gbot).mockImplementation(async (path) =>
      path === 'state' ? { ...snapshot, workspaces: [] } : []
    )
    await useGbotCompanion.getState().refresh()
    expect(useGbotCompanion.getState()).toMatchObject({
      mode: 'hidden',
      selected: '',
      drafts: {},
      tasks: [],
    })
  })
})

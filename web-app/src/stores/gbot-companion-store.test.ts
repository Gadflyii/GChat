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
const replyTask = (...replies: string[]): Task => ({
  ...task('completed'),
  messages: replies.map((content) => ({ role: 'assistant', content })),
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
  it('tracks pending refreshes while retaining known bot names and drafts', async () => {
    await useGbotCompanion.getState().refresh()
    useGbotCompanion.getState().open('a')
    useGbotCompanion.getState().setDraft('a', 'Keep this draft')
    let finish!: (value: BotState) => void
    vi.mocked(gbot).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve
        })
    )
    const pending = useGbotCompanion.getState().refresh()
    expect(useGbotCompanion.getState().loading).toBe(true)
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
    expect(useGbotCompanion.getState()).toMatchObject({
      selected: 'a',
      snapshot: { workspaces: snapshot.workspaces },
      drafts: { a: 'Keep this draft' },
    })
    finish(snapshot)
    await pending
    expect(useGbotCompanion.getState().loading).toBe(false)
  })

  it('settles loading on failure without dropping known bot identity or drafts', async () => {
    await useGbotCompanion.getState().refresh()
    useGbotCompanion.getState().open('a')
    useGbotCompanion.getState().setDraft('a', 'Keep this draft')
    vi.mocked(gbot).mockRejectedValueOnce('Resource preparation failed')
    await useGbotCompanion.getState().refresh()
    expect(useGbotCompanion.getState()).toMatchObject({
      loading: false,
      available: false,
      error: 'Resource preparation failed',
      snapshot: {
        workspaces: snapshot.workspaces,
        live_sessions: [],
        controls: [],
      },
      drafts: { a: 'Keep this draft' },
    })
  })

  it('keeps the newer refresh loading when an older request finishes', async () => {
    const finish: ((value: BotState) => void)[] = []
    vi.mocked(gbot).mockImplementation(async (path) =>
      path === 'state'
        ? new Promise<BotState>((resolve) => {
            finish.push(resolve)
          })
        : []
    )
    const older = useGbotCompanion.getState().refresh()
    await vi.waitFor(() => expect(finish).toHaveLength(1))
    const newer = useGbotCompanion.getState().refresh()
    await vi.waitFor(() => expect(finish).toHaveLength(2))
    finish[0](snapshot)
    await older
    expect(useGbotCompanion.getState().loading).toBe(true)
    expect(useGbotCompanion.getState().available).toBe(false)
    finish[1](snapshot)
    await newer
    expect(useGbotCompanion.getState().loading).toBe(false)
    expect(useGbotCompanion.getState().available).toBe(true)
  })

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

  it.each(['tasks', 'tasks/approvals', 'state', 'service target'])(
    'preserves read reply history when %s fails without losing genuinely new replies',
    async (failedEndpoint) => {
      let tasks = [replyTask('Read reply')]
      let failing = false
      const animation = () => botAvatarState(useGbotCompanion.getState(), 'a')
      vi.mocked(getGbotServiceTarget).mockImplementation(async () => {
        if (failing && failedEndpoint === 'service target')
          throw new Error('Temporary executor failure')
        return { kind: 'local' }
      })
      vi.mocked(gbot).mockImplementation(async (path) => {
        if (failing && path === failedEndpoint)
          throw new Error('Temporary executor failure')
        return path === 'state' ? snapshot : path === 'tasks' ? tasks : []
      })
      await useGbotCompanion.getState().refresh()
      useGbotCompanion.getState().acknowledge('a')
      expect(animation()).toBe('idle')

      failing = true
      await useGbotCompanion.getState().refresh()
      const serviceFailure =
        failedEndpoint === 'state' || failedEndpoint === 'service target'
      expect(useGbotCompanion.getState()).toMatchObject({
        available: !serviceFailure,
        tasks: [],
        approvals: [],
        error: serviceFailure ? 'Error: Temporary executor failure' : '',
        executorError: serviceFailure ? '' : 'Error: Temporary executor failure',
        unread: { a: false },
      })
      expect(animation()).toBe('sleeping')

      failing = false
      await useGbotCompanion.getState().refresh()
      expect(useGbotCompanion.getState().executorError).toBe('')
      expect(useGbotCompanion.getState().unread.a).toBe(false)
      expect(animation()).toBe('idle')

      failing = true
      await useGbotCompanion.getState().refresh()
      tasks = [replyTask('Read reply', 'Arrived while unavailable')]
      failing = false
      await useGbotCompanion.getState().refresh()
      expect(useGbotCompanion.getState().unread.a).toBe(true)
      expect(animation()).toBe('speaking')

      useGbotCompanion.getState().acknowledge('a')
      await useGbotCompanion.getState().refresh()
      expect(useGbotCompanion.getState().unread.a).toBe(false)
      expect(animation()).toBe('idle')
    }
  )

  it.each(['disable/re-enable', 'service target change'])(
    'starts fresh reply history after %s even when its first executor fetch fails',
    async (contextChange) => {
      let tasks = [replyTask('Previous context reply')]
      let failing = false
      const animation = () => botAvatarState(useGbotCompanion.getState(), 'a')
      vi.mocked(gbot).mockImplementation(async (path) => {
        if (failing && path === 'tasks/approvals')
          throw new Error('Approvals unavailable')
        return path === 'state' ? snapshot : path === 'tasks' ? tasks : []
      })
      await useGbotCompanion.getState().refresh()
      tasks = [replyTask('Previous context reply', 'Unread previous reply')]
      await useGbotCompanion.getState().refresh()
      expect(useGbotCompanion.getState().unread.a).toBe(true)
      useGbotCompanion.getState().setDraft('a', 'Previous context draft')

      if (contextChange === 'disable/re-enable')
        useGbotCompanion.getState().reset()
      else
        vi.mocked(getGbotServiceTarget).mockResolvedValue({
          kind: 'paired_host',
          host_id: 'remote',
        })
      tasks = [replyTask('Historical reply in the new context')]
      failing = true
      await useGbotCompanion.getState().refresh()
      expect(useGbotCompanion.getState()).toMatchObject({
        mode: 'hidden',
        tasks: [],
        executorError: 'Error: Approvals unavailable',
      })
      expect(useGbotCompanion.getState().drafts).toEqual({})
      expect(useGbotCompanion.getState().unread).toEqual({})
      expect(animation()).toBe('sleeping')

      failing = false
      await useGbotCompanion.getState().refresh()
      expect(useGbotCompanion.getState().unread.a).toBeUndefined()
      expect(animation()).toBe('idle')

      tasks = [
        replyTask('Historical reply in the new context', 'New context reply'),
      ]
      await useGbotCompanion.getState().refresh()
      expect(useGbotCompanion.getState().unread.a).toBe(true)
      expect(animation()).toBe('speaking')
    }
  )

  it('recognizes the first new reply after a successfully empty task snapshot', async () => {
    let tasks: Task[] = []
    vi.mocked(gbot).mockImplementation(async (path) =>
      path === 'state' ? snapshot : path === 'tasks' ? tasks : []
    )
    await useGbotCompanion.getState().refresh()
    expect(useGbotCompanion.getState().unread.a).toBeUndefined()
    expect(botAvatarState(useGbotCompanion.getState(), 'a')).toBe('idle')

    tasks = [replyTask('The first new reply')]
    await useGbotCompanion.getState().refresh()
    expect(useGbotCompanion.getState().unread.a).toBe(true)
    expect(botAvatarState(useGbotCompanion.getState(), 'a')).toBe('speaking')
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
    expect(useGbotCompanion.getState().loading).toBe(false)
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

import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { AgentEvent } from '@/types/agent'
import { useStudioRuns } from './studio-run-store'
import { deleteAgentRun, listAgentRuns } from '@/services/agent/definitions'
import { runAgentTurn } from '@/services/agent/tauri'

vi.mock('@/services/agent/definitions', () => ({
  listAgentRuns: vi.fn(),
  deleteAgentRun: vi.fn(),
}))

const transport = vi.hoisted(() => ({ emit: (_event: AgentEvent) => {} }))
vi.mock('@/services/agent/tauri', () => ({
  runAgentTurn: vi.fn((_request, emit) => {
    transport.emit = emit
    return new Promise(() => {})
  }),
}))

beforeEach(() => {
  vi.useFakeTimers()
  useStudioRuns.setState({ runs: {}, deleting: false, historyRevision: 0 })
  vi.mocked(listAgentRuns).mockReset().mockResolvedValue([])
  vi.mocked(deleteAgentRun).mockReset().mockResolvedValue(undefined)
})

function startRun(id: string) {
  useStudioRuns.getState().start(id, {
    run_id: id, session_id: id, model_id: 'model', user_message: 'Test', auto_approve: false,
  })
}

it('waits for history persistence before allowing deletion', async () => {
  let finish!: () => void
  vi.mocked(runAgentTurn).mockImplementationOnce((_request, emit) => {
    transport.emit = emit
    return new Promise<void>((resolve) => { finish = resolve })
  })
  startRun('run')
  transport.emit({ type: 'turn_finished', reason: 'finish', step_count: 1 })
  await useStudioRuns.getState().deleteHistory('run')
  expect(listAgentRuns).not.toHaveBeenCalled()
  finish()
  await Promise.resolve()
  await Promise.resolve()
  expect(useStudioRuns.getState().runs.run.settled).toBe(true)
  vi.mocked(listAgentRuns).mockResolvedValue([{ id: 'storage-id', runId: 'run' }] as never)
  await useStudioRuns.getState().deleteHistory('run')
  expect(deleteAgentRun).toHaveBeenCalledWith('storage-id')
  expect(useStudioRuns.getState().runs.run).toBeUndefined()
})

it('clears saved history and early failures while preserving active runs', async () => {
  startRun('active')
  startRun('failed')
  const runs = useStudioRuns.getState().runs
  useStudioRuns.setState({ runs: { ...runs, failed: { ...runs.failed, settled: true } } })
  vi.mocked(listAgentRuns).mockResolvedValue([
    { id: 'old-storage', runId: 'old' }, { id: 'active-storage', runId: 'active' },
  ] as never)
  await useStudioRuns.getState().deleteHistory()
  expect(deleteAgentRun).toHaveBeenCalledExactlyOnceWith('old-storage')
  expect(Object.keys(useStudioRuns.getState().runs)).toEqual(['active'])
})

it('keeps the run visible when deleting its persisted history fails', async () => {
  startRun('run')
  const run = useStudioRuns.getState().runs.run
  useStudioRuns.setState({ runs: { run: { ...run, settled: true } } })
  vi.mocked(listAgentRuns).mockResolvedValue([{ id: 'storage', runId: 'run' }] as never)
  vi.mocked(deleteAgentRun).mockRejectedValue(new Error('Disk error'))
  await expect(useStudioRuns.getState().deleteHistory('run')).rejects.toThrow('Disk error')
  expect(useStudioRuns.getState().runs.run).toBeDefined()
  expect(useStudioRuns.getState().deleting).toBe(false)
})
afterEach(() => vi.useRealTimers())

it('batches monitor traffic without losing simultaneous approvals or completion', () => {
  useStudioRuns.getState().start('Team', {
    run_id: 'run',
    session_id: 'session',
    model_id: 'model',
    user_message: 'Inspect the workspace',
    auto_approve: false,
  })
  transport.emit({
    type: 'stage_queued',
    stage_id: 'worker-a',
    name: 'Reader',
    reason: 'Waiting for capacity',
  })
  for (const approval_id of ['first', 'second']) {
    transport.emit({
      type: 'approval_requested',
      run_id: 'run',
      approval_id,
      tool: 'os.fs.write',
      reason: 'Write file',
      preview: {},
      affected_resources: [],
      can_remember: false,
    })
  }
  expect(useStudioRuns.getState().runs.run.approvals).toHaveLength(2)
  useStudioRuns.getState().resolve('run', 'first')
  expect(useStudioRuns.getState().runs.run.approvals).toMatchObject([
    { approval_id: 'second' },
  ])
  transport.emit({ type: 'assistant_reply', text: 'Completed work' })
  transport.emit({ type: 'turn_finished', reason: 'finish', step_count: 1 })
  expect(useStudioRuns.getState().runs.run.approvals).toEqual([])
  expect(useStudioRuns.getState().runs.run.state.finishedAtMs).toBeDefined()
  const finished = useStudioRuns.getState().runs.run.state
  vi.runAllTimers()
  expect(useStudioRuns.getState().runs.run.state).toBe(finished)
})

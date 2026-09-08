import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { AgentEvent } from '@/types/agent'
import { useStudioRuns } from './studio-run-store'

const transport = vi.hoisted(() => ({ emit: (_event: AgentEvent) => {} }))
vi.mock('@/services/agent/tauri', () => ({
  runAgentTurn: vi.fn((_request, emit) => {
    transport.emit = emit
    return new Promise(() => {})
  }),
}))

beforeEach(() => {
  vi.useFakeTimers()
  useStudioRuns.setState({ runs: {} })
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

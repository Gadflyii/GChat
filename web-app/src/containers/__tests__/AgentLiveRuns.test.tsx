import { beforeEach, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { AgentLiveRuns } from '../AgentLiveRuns'
import { useStudioRuns } from '@/stores/studio-run-store'
import { createAgentRunState, reduceAgentRunState } from '@/hooks/useAgentRun'
import { studioCommand } from '@/services/agent/studio'

vi.mock('@/services/agent/studio', () => ({ studioCommand: vi.fn().mockResolvedValue({ queued: true }) }))
import { deleteAgentRun, listAgentRuns } from '@/services/agent/definitions'

vi.mock('@/hooks/useStudioCatalog', () => ({
  useStudioCatalog: () => ({ catalog: { instances: [] }, refresh: vi.fn() }),
}))
vi.mock('@/services/agent/definitions', () => ({
  listAgentRuns: vi.fn(), deleteAgentRun: vi.fn(),
}))

beforeEach(() => {
  vi.mocked(listAgentRuns).mockReset().mockResolvedValue([])
  vi.mocked(deleteAgentRun).mockReset().mockResolvedValue(undefined)
  useStudioRuns.setState({
    deleting: false,
    runs: Object.fromEntries(['Active', 'Finished'].map((name) => [name, {
      name,
      request: { run_id: name, session_id: name, model_id: 'model', user_message: 'test', auto_approve: false },
      state: { ...createAgentRunState(), status: name === 'Active' ? 'running' : 'finished' },
      approvals: [],
      settled: name === 'Finished',
    }])),
  })
})

it('allows deleting finished cards but protects active runs', async () => {
  render(<AgentLiveRuns />)
  expect(screen.getByRole('button', { name: 'Delete run Active' })).toBeDisabled()
  fireEvent.click(screen.getByRole('button', { name: 'Delete run Finished' }))
  await waitFor(() => expect(screen.queryByRole('heading', { name: 'Finished' })).not.toBeInTheDocument())
  expect(screen.getByRole('heading', { name: 'Active' })).toBeInTheDocument()
})

it('requires confirmation before clearing saved history', async () => {
  vi.mocked(listAgentRuns).mockResolvedValue([{ id: 'saved', runId: 'Finished' }] as never)
  render(<AgentLiveRuns />)
  fireEvent.click(screen.getByRole('button', { name: 'Delete all' }))
  expect(deleteAgentRun).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
  expect(listAgentRuns).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Delete all' }))
  fireEvent.click(screen.getByRole('button', { name: 'Delete history' }))
  await waitFor(() => expect(deleteAgentRun).toHaveBeenCalledWith('saved'))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  expect(useStudioRuns.getState().runs.Active).toBeDefined()
})

it('shows per-worker context and requests compaction for that worker only', async () => {
  const run = useStudioRuns.getState().runs.Active
  let state = reduceAgentRunState(run.state, {
    type: 'stage_started', stage_id: 'worker-a', name: 'Coder', role: 'worker',
    cycle: null, model_instance_id: 'model', reasoning_effort: null,
  })
  state = reduceAgentRunState(state, {
    type: 'stage_activity', stage_id: 'worker-a', event: {
      type: 'context_status', context_id: 'context-a', input_tokens: 8000,
      context_tokens: 32768, reserved_tokens: 12288, compactions: 2,
      status: 'ready', archive_path: '/run/worker-a/context',
    },
  })
  useStudioRuns.setState({ runs: { Active: { ...run, state } } })
  render(<AgentLiveRuns />)
  expect(screen.getByText('8,000 / 32,768 tokens')).toBeInTheDocument()
  expect(screen.getByText('12,288 reserved · 2 compactions')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Compact', exact: true }))
  await waitFor(() => expect(studioCommand).toHaveBeenCalledWith('compact_worker', { id: 'context-a' }))
  fireEvent.click(screen.getByRole('button', { name: 'Coder' }))
  expect(screen.getByText('Full transcript and tool outputs: /run/worker-a/context')).toBeInTheDocument()
})

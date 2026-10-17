import { beforeEach, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { toast } from 'sonner'
import { AgentLiveRuns } from '../AgentLiveRuns'
import { useStudioRuns, type StudioRun } from '@/stores/studio-run-store'
import { createAgentRunState, reduceAgentRunState } from '@/hooks/useAgentRun'
import { studioCommand } from '@/services/agent/studio'
import { cancelAgentTurn, resolveAgentApproval, resolveAgentFolderAccess } from '@/services/agent/tauri'

vi.mock('@/services/agent/studio', () => ({ studioCommand: vi.fn().mockResolvedValue({ queued: true }) }))
import { deleteAgentRun, listAgentRuns } from '@/services/agent/definitions'

vi.mock('@/hooks/useStudioCatalog', () => ({
  useStudioCatalog: () => ({ catalog: { instances: [] }, refresh: vi.fn() }),
}))
vi.mock('@/services/agent/definitions', () => ({
  listAgentRuns: vi.fn(), deleteAgentRun: vi.fn(),
}))
vi.mock('@/services/agent/tauri', async (original) => ({
  ...(await original<object>()),
  cancelAgentTurn: vi.fn(),
  resolveAgentApproval: vi.fn(),
  resolveAgentFolderAccess: vi.fn(),
}))

const toolApproval: StudioRun['approvals'][number] = {
  type: 'approval_requested',
  run_id: 'Active',
  approval_id: 'tool-approval',
  tool: 'shell',
  reason: 'Run the requested tests',
  preview: { command: 'make test' },
  affected_resources: [],
  can_remember: false,
}
const folderApproval: StudioRun['approvals'][number] = {
  type: 'folder_access_requested',
  run_id: 'Active',
  access_id: 'folder-approval',
  tool: 'fileWrite',
  path: '/project/src',
  display_name: 'Project sources',
  root_id: 'project',
  reason: 'Write the reviewed project changes',
}

const approvalCases = [
  {
    name: 'tool approval',
    approval: toolApproval,
    request: resolveAgentApproval,
    payload: (allow: boolean) => ({
      approval_id: 'tool-approval',
      decision: allow ? 'allow_once' : 'deny',
    }),
  },
  {
    name: 'folder access',
    approval: folderApproval,
    request: resolveAgentFolderAccess,
    payload: (allow: boolean) => ({
      run_id: 'Active',
      access_id: 'folder-approval',
      allow,
    }),
  },
]

function deferred() {
  let resolve!: () => void
  let reject!: (reason: Error) => void
  const promise = new Promise<void>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function renderApprovals(approvals: StudioRun['approvals']) {
  const run = useStudioRuns.getState().runs.Active
  useStudioRuns.setState({ runs: { Active: { ...run, approvals } } })
  render(<AgentLiveRuns />)
}

beforeEach(() => {
  vi.mocked(listAgentRuns).mockReset().mockResolvedValue([])
  vi.mocked(deleteAgentRun).mockReset().mockResolvedValue(undefined)
  vi.mocked(cancelAgentTurn).mockReset().mockResolvedValue(undefined)
  vi.mocked(resolveAgentApproval).mockReset().mockResolvedValue(undefined)
  vi.mocked(resolveAgentFolderAccess).mockReset().mockResolvedValue(undefined)
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

it('requests Stop once while pending and waits for the run lifecycle before allowing deletion', async () => {
  const stopping = deferred()
  vi.mocked(cancelAgentTurn).mockReturnValue(stopping.promise)
  render(<AgentLiveRuns />)
  const stop = screen.getByRole('button', { name: 'Stop run' })
  const deleteRun = screen.getByRole('button', { name: 'Delete run Active' })
  const card = screen.getByRole('heading', { name: 'Active' }).closest('article') as HTMLElement

  act(() => {
    stop.click()
    stop.click()
  })

  expect(cancelAgentTurn).toHaveBeenCalledExactlyOnceWith('Active')
  expect(screen.getByRole('button', { name: 'Stopping…' })).toBeDisabled()
  expect(stop).toHaveAttribute('aria-busy', 'true')
  expect(screen.getByRole('status')).toHaveTextContent('Requesting stop for Active…')
  expect(within(card).getByText(/^running ·/)).toBeInTheDocument()
  expect(deleteRun).toBeDisabled()
  fireEvent.click(deleteRun)
  expect(listAgentRuns).not.toHaveBeenCalled()
  expect(useStudioRuns.getState().runs.Active).toMatchObject({
    state: { status: 'running' }, settled: false,
  })

  await act(async () => stopping.resolve())

  expect(screen.getByRole('button', { name: 'Stop run' })).toBeEnabled()
  expect(stop).not.toHaveAttribute('aria-busy', 'true')
  expect(screen.queryByRole('status')).not.toBeInTheDocument()
  expect(deleteRun).toBeDisabled()
  expect(useStudioRuns.getState().runs.Active).toMatchObject({
    state: { status: 'running' }, settled: false,
  })
  expect(cancelAgentTurn).toHaveBeenCalledOnce()

  act(() => {
    const run = useStudioRuns.getState().runs.Active
    useStudioRuns.setState((state) => ({
      runs: {
        ...state.runs,
        Active: {
          ...run,
          state: reduceAgentRunState(run.state, {
            type: 'turn_finished', reason: 'cancelled', step_count: 0,
          }),
          settled: true,
        },
      },
    }))
  })

  expect(screen.queryByRole('button', { name: 'Stop run' })).not.toBeInTheDocument()
  expect(deleteRun).toBeEnabled()
})

it('reports a failed Stop request without settling the run and permits retry', async () => {
  const failed = deferred()
  const retry = deferred()
  vi.mocked(cancelAgentTurn)
    .mockReturnValueOnce(failed.promise)
    .mockReturnValueOnce(retry.promise)
  const errorToast = vi.spyOn(toast, 'error').mockReturnValue('stop-request-error')

  try {
    render(<AgentLiveRuns />)
    fireEvent.click(screen.getByRole('button', { name: 'Stop run' }))

    await act(async () => failed.reject(new Error('Could not contact the agent')))

    expect(errorToast).toHaveBeenCalledExactlyOnceWith('Error: Could not contact the agent')
    expect(screen.getByRole('button', { name: 'Stop run' })).toBeEnabled()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Delete run Active' })).toBeDisabled()
    expect(useStudioRuns.getState().runs.Active).toMatchObject({
      state: { status: 'running' }, settled: false,
    })
    fireEvent.click(screen.getByRole('button', { name: 'Stop run' }))
    expect(vi.mocked(cancelAgentTurn).mock.calls).toEqual([['Active'], ['Active']])
    expect(screen.getByRole('button', { name: 'Stopping…' })).toBeDisabled()

    await act(async () => retry.resolve())

    expect(screen.getByRole('button', { name: 'Stop run' })).toBeEnabled()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(errorToast).toHaveBeenCalledOnce()
  } finally {
    errorToast.mockRestore()
  }
})

it('lets another active run complete its Stop request while the first request is pending', async () => {
  const first = deferred()
  const second = deferred()
  vi.mocked(cancelAgentTurn)
    .mockReturnValueOnce(first.promise)
    .mockReturnValueOnce(second.promise)
  const active = useStudioRuns.getState().runs.Active
  useStudioRuns.setState((state) => ({
    runs: {
      ...state.runs,
      Second: {
        ...active,
        name: 'Second',
        request: { ...active.request, run_id: 'Second', session_id: 'Second' },
      },
    },
  }))
  render(<AgentLiveRuns />)
  const firstCard = screen.getByRole('heading', { name: 'Active' }).closest('article') as HTMLElement
  const secondCard = screen.getByRole('heading', { name: 'Second' }).closest('article') as HTMLElement
  fireEvent.click(within(firstCard).getByRole('button', { name: 'Stop run' }))

  expect(within(firstCard).getByRole('button', { name: 'Stopping…' })).toBeDisabled()
  expect(within(secondCard).getByRole('button', { name: 'Stop run' })).toBeEnabled()
  fireEvent.click(within(secondCard).getByRole('button', { name: 'Stop run' }))
  expect(vi.mocked(cancelAgentTurn).mock.calls).toEqual([['Active'], ['Second']])
  expect(within(secondCard).getByRole('status')).toHaveTextContent('Requesting stop for Second…')

  await act(async () => second.resolve())

  expect(within(secondCard).getByRole('button', { name: 'Stop run' })).toBeEnabled()
  expect(within(secondCard).queryByRole('status')).not.toBeInTheDocument()
  expect(within(firstCard).getByRole('button', { name: 'Stopping…' })).toBeDisabled()
  expect(within(firstCard).getByRole('status')).toHaveTextContent('Requesting stop for Active…')

  await act(async () => first.resolve())

  expect(within(firstCard).getByRole('button', { name: 'Stop run' })).toBeEnabled()
  expect(screen.queryByRole('status')).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Delete run Active' })).toBeDisabled()
  expect(screen.getByRole('button', { name: 'Delete run Second' })).toBeDisabled()
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

it.each(approvalCases.flatMap((scenario) => [
  { ...scenario, firstDecision: 'Allow once', allow: true },
  { ...scenario, firstDecision: 'Deny', allow: false },
]))(
  'submits only the first conflicting $firstDecision decision for $name',
  async ({ approval, request, payload, firstDecision, allow }) => {
    const pending = deferred()
    vi.mocked(request).mockReturnValue(pending.promise)
    renderApprovals([approval])
    const first = screen.getByRole('button', { name: firstDecision, exact: true })
    const opposite = screen.getByRole('button', {
      name: allow ? 'Deny' : 'Allow once', exact: true,
    })

    act(() => {
      fireEvent.click(first)
      fireEvent.click(opposite)
      fireEvent.click(first)
    })

    expect(request).toHaveBeenCalledExactlyOnceWith(payload(allow))
    expect(first).toBeDisabled()
    expect(opposite).toBeDisabled()
    expect(screen.getByText(approval.reason)).toBeInTheDocument()
    expect(useStudioRuns.getState().runs.Active.approvals).toEqual([approval])

    await act(async () => pending.resolve())

    expect(screen.queryByText(approval.reason)).not.toBeInTheDocument()
    expect(useStudioRuns.getState().runs.Active.approvals).toEqual([])
    expect(request).toHaveBeenCalledOnce()
  }
)

it.each(approvalCases)(
  'retains failed $name and lets the user retry the opposite decision',
  async ({ approval, request, payload }) => {
    const pending = deferred()
    vi.mocked(request).mockReturnValueOnce(pending.promise)
    renderApprovals([approval])
    fireEvent.click(screen.getByRole('button', { name: 'Allow once' }))

    await act(async () => pending.reject(new Error('The service is unavailable')))

    expect(screen.getByText(approval.reason)).toBeInTheDocument()
    expect(useStudioRuns.getState().runs.Active.approvals).toEqual([approval])
    expect(screen.getByRole('button', { name: 'Allow once' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Deny' })).toBeEnabled()
    expect(request).toHaveBeenCalledExactlyOnceWith(payload(true))
    fireEvent.click(screen.getByRole('button', { name: 'Deny' }))

    await waitFor(() => expect(screen.queryByText(approval.reason)).not.toBeInTheDocument())
    expect(request).toHaveBeenCalledTimes(2)
    expect(request).toHaveBeenLastCalledWith(payload(false))
    expect(useStudioRuns.getState().runs.Active.approvals).toEqual([])
  }
)

it('keeps separate tool and folder approvals independently actionable while pending', async () => {
  const toolRequest = deferred()
  const folderRequest = deferred()
  vi.mocked(resolveAgentApproval).mockReturnValue(toolRequest.promise)
  vi.mocked(resolveAgentFolderAccess).mockReturnValue(folderRequest.promise)
  renderApprovals([toolApproval, folderApproval])
  const [allowTool, allowFolder] = screen.getAllByRole('button', { name: 'Allow once' })
  const [denyTool, denyFolder] = screen.getAllByRole('button', { name: 'Deny' })

  fireEvent.click(allowTool)

  expect(allowTool).toBeDisabled()
  expect(denyTool).toBeDisabled()
  expect(allowFolder).toBeEnabled()
  expect(denyFolder).toBeEnabled()
  fireEvent.click(denyFolder)
  expect(resolveAgentApproval).toHaveBeenCalledExactlyOnceWith({
    approval_id: 'tool-approval', decision: 'allow_once',
  })
  expect(resolveAgentFolderAccess).toHaveBeenCalledExactlyOnceWith({
    run_id: 'Active', access_id: 'folder-approval', allow: false,
  })
  expect(allowFolder).toBeDisabled()
  expect(denyFolder).toBeDisabled()

  await act(async () => folderRequest.resolve())

  expect(screen.queryByText(folderApproval.reason)).not.toBeInTheDocument()
  expect(screen.getByText(toolApproval.reason)).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Allow once' })).toBeDisabled()
  expect(screen.getByRole('button', { name: 'Deny' })).toBeDisabled()
  expect(useStudioRuns.getState().runs.Active.approvals).toEqual([toolApproval])

  await act(async () => toolRequest.resolve())

  expect(screen.queryByText(toolApproval.reason)).not.toBeInTheDocument()
  expect(useStudioRuns.getState().runs.Active.approvals).toEqual([])
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

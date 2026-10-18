import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AgentRunSetup } from '../AgentRunSetup'
import { useStudioRuns } from '@/stores/studio-run-store'
import type { AgentDefinition } from '@/types/agent'

const mocks = vi.hoisted(() => ({
  start: vi.fn(),
  turn: vi.fn(async () => undefined),
  save: vi.fn(),
  current: 'local',
  catalog: {
    pools: [
      {
        id: 'coding',
        name: 'Coding workers',
        members: [{ instanceId: 'lan-instance', workerLimit: 2 }],
      },
    ],
    instances: [
      {
        id: 'local',
        modelId: 'Muse',
        hostName: 'This computer',
        concurrency: 4,
        vision: true,
        maxContext: 32768,
      },
      {
        id: 'lan-instance',
        modelId: 'Qwen',
        hostName: 'Server 2',
        concurrency: 2,
        vision: true,
        maxContext: 16384,
      },
    ],
    usage: {},
    aliases: {},
    fleetTargets: ['lan-instance'],
    fleetHosts: [],
    fleet: {
      connected: true,
      revision: 1,
      authorityId: 'host',
      migrationIssues: [],
    },
  },
}))
vi.mock('@/services/agent/studio', async (original) => ({
  ...(await original<object>()),
  studioCommand: async () => mocks.catalog,
}))
vi.mock('@/services/agent/definitions', async (original) => ({
  ...(await original<object>()),
  saveAgentDefinition: mocks.save,
}))
vi.mock('@/services/agent/tauri', () => ({
  runAgentTurn: mocks.turn,
  resolveConversationWorkspaceRoot: async () => ({
    path: '/workspace',
    name: 'Workspace',
  }),
}))
vi.mock('@/hooks/useModelProvider', () => ({
  useModelProvider: (select: (s: unknown) => unknown) =>
    select({ selectedModel: mocks.current ? { id: mocks.current } : null }),
}))
const startRun = useStudioRuns.getState().start
afterEach(cleanup)
beforeEach(() => {
  vi.clearAllMocks()
  mocks.start.mockImplementation(startRun)
  useStudioRuns.setState({ runs: {}, start: mocks.start })
  mocks.current = 'local'
  mocks.catalog.fleet.connected = true
})
const definition: AgentDefinition = {
  schemaVersion: 3,
  id: 'loop',
  name: 'Goal loop',
  description: '',
  instructions: 'Work',
  skills: [],
  maxSteps: 12,
  outputContract: 'Result',
  modelInstanceId: null,
  reasoningEffort: 'high',
  builtIn: false,
  kind: 'goal_loop',
  maxCycles: 3,
  successCriteria: 'Complete',
  evaluatorInstructions: 'Evaluate',
  evaluatorModelInstanceId: null,
  evaluatorReasoningEffort: 'high',
}

function deferredSave() {
  let resolve!: () => void
  let reject!: (error: Error) => void
  const promise = new Promise<void>((resolveSave, rejectSave) => {
    resolve = resolveSave
    reject = rejectSave
  })
  return { promise, resolve, reject }
}

async function submitWithSavedDefaults() {
  fireEvent.change(screen.getByLabelText('Task or goal'), {
    target: { value: 'Review the workspace' },
  })
  fireEvent.click(
    screen.getByRole('checkbox', {
      name: 'Save these role assignments as defaults',
    })
  )
  const run = screen.getByRole('button', { name: 'Run', exact: true })
  await waitFor(() => expect(run).toBeEnabled())
  fireEvent.click(run)
  expect(mocks.save).toHaveBeenCalledOnce()
  expect(mocks.start).not.toHaveBeenCalled()
  return run
}

describe('Agent Studio run setup', () => {
  it('keeps minimum context empty while editing and submits numeric assignments before blur', async () => {
    const user = userEvent.setup()
    const saved = {
      ...definition,
      roleAssignments: {
        executor: {
          target: { kind: 'current' as const },
          vision: false,
          minimumContext: 0,
        },
        evaluator: {
          target: { kind: 'current' as const },
          vision: false,
          minimumContext: 8192,
        },
      },
    }
    mocks.save.mockResolvedValueOnce(undefined)
    render(
      <AgentRunSetup
        definition={saved}
        initialTask="Review the workspace"
        onClose={vi.fn()}
        onRun={vi.fn()}
      />
    )
    const [executor, evaluator] = screen.getAllByRole('spinbutton', {
      name: 'Minimum context',
    })
    const run = screen.getByRole('button', { name: 'Run', exact: true })
    await waitFor(() => expect(run).toBeEnabled())

    fireEvent.change(executor, { target: { value: '65536' } })
    expect(run).toBeDisabled()
    await user.clear(executor)
    expect(executor).toHaveProperty('value', '')
    expect(run).toBeEnabled()
    await user.type(executor, '32768')
    expect(executor).toHaveProperty('value', '32768')
    expect(executor).toHaveFocus()
    expect(evaluator).toHaveValue(8192)
    expect(run).toBeEnabled()

    // Submit without moving focus, so blur cannot supply the numeric value.
    fireEvent.click(
      screen.getByRole('checkbox', {
        name: 'Save these role assignments as defaults',
      })
    )
    fireEvent.click(run)
    expect(executor).toHaveFocus()
    await waitFor(() => expect(mocks.start).toHaveBeenCalledOnce())
    const expectedAssignments = {
      executor: { ...saved.roleAssignments.executor, minimumContext: 32768 },
      evaluator: saved.roleAssignments.evaluator,
    }
    expect(mocks.save).toHaveBeenCalledExactlyOnceWith({
      ...saved,
      roleAssignments: expectedAssignments,
    })
    expect(mocks.start.mock.calls[0][1].role_assignments).toEqual(
      expectedAssignments
    )
    expect(saved.roleAssignments.executor.minimumContext).toBe(0)
  })

  it('normalizes minimum context on blur without mixing role drafts', async () => {
    const user = userEvent.setup()
    render(
      <AgentRunSetup definition={definition} onClose={vi.fn()} onRun={vi.fn()} />
    )
    const [executor, evaluator] = screen.getAllByRole('spinbutton', {
      name: 'Minimum context',
    })

    await user.clear(executor)
    expect(executor).toHaveProperty('value', '')
    // userEvent canonicalizes number-input leading zeroes; native editing retains them.
    fireEvent.change(executor, { target: { value: '032768' } })
    expect(executor).toHaveProperty('value', '032768')
    expect(evaluator).toHaveValue(0)
    await user.tab()
    expect(executor).toHaveProperty('value', '32768')

    await user.clear(evaluator)
    expect(evaluator).toHaveProperty('value', '')
    fireEvent.change(evaluator, { target: { value: '08192' } })
    expect(evaluator).toHaveProperty('value', '08192')
    expect(executor).toHaveProperty('value', '32768')
    fireEvent.blur(evaluator)
    expect(evaluator).toHaveProperty('value', '8192')
    await user.clear(executor)
    expect(executor).toHaveProperty('value', '')
    fireEvent.blur(executor)
    expect(executor).toHaveProperty('value', '0')
    expect(evaluator).toHaveProperty('value', '8192')
  })

  it('keeps invalid minimum context limits blocked without clamping on blur', async () => {
    const user = userEvent.setup()
    render(
      <AgentRunSetup
        definition={definition}
        initialTask="Review the workspace"
        onClose={vi.fn()}
        onRun={vi.fn()}
      />
    )
    const context = screen.getAllByRole('spinbutton', {
      name: 'Minimum context',
    })[0]
    const run = screen.getByRole('button', { name: 'Run', exact: true })
    await waitFor(() => expect(run).toBeEnabled())

    for (const value of ['-1', '0.5', '16777217']) {
      fireEvent.change(context, { target: { value } })
      expect(screen.getAllByRole('status')[0]).toHaveTextContent(
        'Enter a valid minimum context size.'
      )
      expect(run).toBeDisabled()
      fireEvent.blur(context)
      expect(context).toHaveProperty('value', value)
      expect(run).toBeDisabled()
      fireEvent.click(run)
      expect(mocks.start).not.toHaveBeenCalled()
      expect(mocks.save).not.toHaveBeenCalled()

      await user.clear(context)
      expect(context).toHaveProperty('value', '')
      expect(run).toBeEnabled()
      fireEvent.blur(context)
      expect(context).toHaveProperty('value', '0')
    }
  })

  it('discards cancelled minimum context drafts when setup is reopened', async () => {
    const user = userEvent.setup()
    const saved = {
      ...definition,
      roleAssignments: {
        executor: {
          target: { kind: 'current' as const },
          vision: false,
          minimumContext: 8192,
        },
        evaluator: {
          target: { kind: 'current' as const },
          vision: false,
          minimumContext: 16384,
        },
      },
    }
    const onClose = vi.fn()
    const { unmount } = render(
      <AgentRunSetup definition={saved} onClose={onClose} onRun={vi.fn()} />
    )
    const context = screen.getAllByRole('spinbutton', {
      name: 'Minimum context',
    })[0]
    await user.clear(context)
    fireEvent.change(context, { target: { value: '032768' } })
    expect(context).toHaveProperty('value', '032768')
    fireEvent.click(
      screen.getByRole('checkbox', {
        name: 'Save these role assignments as defaults',
      })
    )
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onClose).toHaveBeenCalledOnce()
    expect(mocks.save).not.toHaveBeenCalled()
    expect(mocks.start).not.toHaveBeenCalled()
    unmount()

    render(
      <AgentRunSetup definition={saved} onClose={vi.fn()} onRun={vi.fn()} />
    )
    const [executor, evaluator] = screen.getAllByRole('spinbutton', {
      name: 'Minimum context',
    })
    expect(executor).toHaveProperty('value', '8192')
    expect(evaluator).toHaveProperty('value', '16384')
    expect(
      screen.getByRole('checkbox', {
        name: 'Save these role assignments as defaults',
      })
    ).not.toBeChecked()
    expect(saved.roleAssignments.executor.minimumContext).toBe(8192)
    expect(saved.roleAssignments.evaluator.minimumContext).toBe(16384)
  })

  it('does not start after Cancel while saving role defaults', async () => {
    const save = deferredSave()
    mocks.save.mockReturnValueOnce(save.promise)
    const onClose = vi.fn()
    const onRun = vi.fn()
    render(
      <AgentRunSetup
        definition={definition}
        onClose={onClose}
        onRun={onRun}
      />
    )
    await submitWithSavedDefaults()

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onClose).toHaveBeenCalledOnce()
    await act(async () => {
      save.resolve()
      await save.promise
    })

    expect(mocks.start).not.toHaveBeenCalled()
    expect(onRun).not.toHaveBeenCalled()
    expect(useStudioRuns.getState().runs).toEqual({})
  })

  it('does not start after unmount while saving role defaults', async () => {
    const save = deferredSave()
    mocks.save.mockReturnValueOnce(save.promise)
    const onRun = vi.fn()
    const { unmount } = render(
      <AgentRunSetup definition={definition} onClose={vi.fn()} onRun={onRun} />
    )
    await submitWithSavedDefaults()

    unmount()
    await act(async () => {
      save.resolve()
      await save.promise
    })

    expect(mocks.start).not.toHaveBeenCalled()
    expect(onRun).not.toHaveBeenCalled()
    expect(useStudioRuns.getState().runs).toEqual({})
  })

  it('starts exactly once after saving role defaults successfully', async () => {
    const save = deferredSave()
    mocks.save.mockReturnValueOnce(save.promise)
    const onRun = vi.fn()
    render(
      <AgentRunSetup definition={definition} onClose={vi.fn()} onRun={onRun} />
    )
    const run = await submitWithSavedDefaults()
    expect(run).toBeDisabled()
    fireEvent.click(run)
    expect(mocks.save).toHaveBeenCalledOnce()

    await act(async () => {
      save.resolve()
      await save.promise
    })

    expect(mocks.start).toHaveBeenCalledOnce()
    expect(mocks.start.mock.calls[0][1]).toMatchObject({
      definition_id: definition.id,
      user_message: 'Review the workspace',
    })
    expect(onRun).toHaveBeenCalledOnce()
    const runs = Object.values(useStudioRuns.getState().runs)
    expect(runs).toHaveLength(1)
    expect(runs[0]).toMatchObject({
      name: definition.name,
      request: {
        definition_id: definition.id,
        model_id: 'local',
        user_message: 'Review the workspace',
      },
      state: { status: 'running', runId: runs[0].request.run_id },
      approvals: [],
    })
    expect(runs[0].request.session_id).toBe(runs[0].request.run_id)
  })

  it('allows retry after saving role defaults fails without starting a run', async () => {
    const failedSave = deferredSave()
    const retrySave = deferredSave()
    mocks.save
      .mockReturnValueOnce(failedSave.promise)
      .mockReturnValueOnce(retrySave.promise)
    const onRun = vi.fn()
    render(
      <AgentRunSetup definition={definition} onClose={vi.fn()} onRun={onRun} />
    )
    const run = await submitWithSavedDefaults()

    await act(async () => {
      failedSave.reject(new Error('Could not save defaults'))
      await failedSave.promise.catch(() => undefined)
    })
    expect(mocks.start).not.toHaveBeenCalled()
    expect(onRun).not.toHaveBeenCalled()
    expect(useStudioRuns.getState().runs).toEqual({})
    expect(run).toBeEnabled()
    expect(screen.getByLabelText('Task or goal')).toHaveValue(
      'Review the workspace'
    )
    fireEvent.click(run)
    expect(mocks.save).toHaveBeenCalledTimes(2)

    await act(async () => {
      retrySave.resolve()
      await retrySave.promise
    })

    expect(mocks.start).toHaveBeenCalledOnce()
    expect(onRun).toHaveBeenCalledOnce()
    const runs = Object.values(useStudioRuns.getState().runs)
    expect(runs).toHaveLength(1)
    expect(runs[0].request.user_message).toBe('Review the workspace')
  })

  it('submits explicit client fleet placement without a current model or changing saved defaults', async () => {
    const user = userEvent.setup()
    mocks.current = ''
    render(
      <AgentRunSetup
        definition={definition}
        onClose={vi.fn()}
        onRun={vi.fn()}
      />
    )
    fireEvent.change(screen.getByLabelText('Task or goal'), {
      target: { value: 'Use the assigned fleet workers' },
    })
    for (const name of ['Executor assignment', 'Evaluator assignment']) {
      await user.click(screen.getByRole('button', { name }))
      const fleet = await screen.findByRole('menuitemradio', {
        name: 'Use client fleet assignment',
      })
      await waitFor(() => expect(fleet).not.toHaveAttribute('aria-disabled', 'true'))
      await user.click(fleet)
    }
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Run', exact: true })
      ).toBeEnabled()
    )
    fireEvent.click(screen.getByRole('button', { name: 'Run', exact: true }))
    await waitFor(() => expect(mocks.start).toHaveBeenCalledOnce())
    expect(mocks.start.mock.calls[0][1].role_assignments).toMatchObject({
      executor: { target: { kind: 'fleet' } },
      evaluator: { target: { kind: 'fleet' } },
    })
    expect(mocks.save).not.toHaveBeenCalled()
  })
  it('keeps Current usable when the fleet coordinator is offline and blocks an explicit pooled role', async () => {
    const user = userEvent.setup()
    mocks.catalog.fleet.connected = false
    render(
      <AgentRunSetup
        definition={definition}
        onClose={vi.fn()}
        onRun={vi.fn()}
      />
    )
    fireEvent.change(screen.getByLabelText('Task or goal'), {
      target: { value: 'Keep local work available' },
    })
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Run', exact: true })
      ).toBeEnabled()
    )
    await user.click(screen.getByRole('button', { name: 'Executor assignment' }))
    expect(screen.getByRole('menuitemradio', { name: 'Use client fleet assignment' })).toHaveAttribute('aria-disabled', 'true')
    await user.click(screen.getByRole('menuitemradio', { name: 'Coding workers · 1 members' }))
    expect(
      screen.getByRole('button', { name: 'Run', exact: true })
    ).toBeDisabled()
    expect(
      screen.getByText(/Connect before starting pooled work/)
    ).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Executor assignment' }))
    await user.click(screen.getByRole('menuitemradio', { name: 'Current model · local' }))
    expect(
      screen.getByRole('button', { name: 'Run', exact: true })
    ).toBeEnabled()
  })
  it('prefills the saved goal and submits edits only for this run', async () => {
    const saved = {
      ...definition,
      defaultGoal: 'Run the workspace performance tests',
    }
    render(
      <AgentRunSetup definition={saved} onClose={vi.fn()} onRun={vi.fn()} />
    )
    expect(screen.getByLabelText('Task or goal')).toHaveValue(saved.defaultGoal)
    fireEvent.change(screen.getByLabelText('Task or goal'), {
      target: { value: 'Run only the startup test' },
    })
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Run', exact: true })
      ).toBeEnabled()
    )
    fireEvent.click(screen.getByRole('button', { name: 'Run', exact: true }))
    await waitFor(() => expect(mocks.start).toHaveBeenCalledOnce())
    expect(mocks.start.mock.calls[0][1].user_message).toBe(
      'Run only the startup test'
    )
    expect(saved.defaultGoal).toBe('Run the workspace performance tests')
    expect(mocks.save).not.toHaveBeenCalled()
  })

  it('uses the previous run task instead of the default when rerunning', () => {
    render(
      <AgentRunSetup
        definition={{ ...definition, defaultGoal: 'Default goal' }}
        initialTask="Previous run task"
        onClose={vi.fn()}
        onRun={vi.fn()}
      />
    )
    expect(screen.getByLabelText('Task or goal')).toHaveValue(
      'Previous run task'
    )
  })

  it('assigns a pool to a Vision role and a fixed evaluator without mutating the definition', async () => {
    const user = userEvent.setup()
    const onRun = vi.fn()
    render(
      <AgentRunSetup definition={definition} onClose={vi.fn()} onRun={onRun} />
    )
    fireEvent.change(screen.getByLabelText('Task or goal'), {
      target: { value: 'Inspect the image files in the workspace' },
    })
    await user.click(screen.getByRole('button', { name: 'Executor assignment' }))
    await user.click(await screen.findByRole('menuitemradio', { name: 'Coding workers · 1 members' }))
    fireEvent.click(
      screen.getAllByRole('checkbox', { name: 'Requires Vision' })[0]
    )
    await user.click(screen.getByRole('button', { name: 'Evaluator assignment' }))
    await user.click(screen.getByRole('menuitemradio', { name: 'Muse · C4 · Vision' }))
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Run', exact: true })
      ).toBeEnabled()
    )
    fireEvent.click(screen.getByRole('button', { name: 'Run', exact: true }))
    await waitFor(() => expect(onRun).toHaveBeenCalledOnce())
    expect(mocks.start.mock.calls[0][1].role_assignments).toMatchObject({
      executor: { target: { kind: 'pool', id: 'coding' }, vision: true },
      evaluator: { target: { kind: 'instance', id: 'local' } },
    })
    expect(mocks.save).not.toHaveBeenCalled()
  })
  it('blocks unresolved current-model roles and keeps the task when editing pools', async () => {
    mocks.current = ''
    render(
      <AgentRunSetup
        definition={definition}
        onClose={vi.fn()}
        onRun={vi.fn()}
      />
    )
    fireEvent.change(screen.getByLabelText('Task or goal'), {
      target: { value: 'Keep this task' },
    })
    expect(
      screen.getByRole('button', { name: 'Run', exact: true })
    ).toBeDisabled()
    fireEvent.click(
      screen.getByRole('button', { name: 'Create or edit pools' })
    )
    expect(screen.getByLabelText('Task or goal')).toHaveValue('Keep this task')
    fireEvent.click(screen.getByRole('button', { name: 'Hide pool editor' }))
    expect(screen.getByLabelText('Task or goal')).toHaveValue('Keep this task')
  })
})

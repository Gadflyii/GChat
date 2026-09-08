import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AgentRunSetup } from '../AgentRunSetup'
import type { AgentDefinition } from '@/types/agent'

const mocks = vi.hoisted(() => ({
  start: vi.fn(),
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
      },
      {
        id: 'lan-instance',
        modelId: 'Qwen',
        hostName: 'Server 2',
        concurrency: 2,
        vision: true,
      },
    ],
    usage: {},
  },
}))
vi.mock('@/services/agent/studio', async (original) => ({
  ...(await original<object>()),
  studioCommand: async () => mocks.catalog,
}))
vi.mock('@/services/agent/definitions', () => ({
  saveAgentDefinition: mocks.save,
}))
vi.mock('@/hooks/useModelProvider', () => ({
  useModelProvider: (select: (s: unknown) => unknown) =>
    select({ selectedModel: mocks.current ? { id: mocks.current } : null }),
}))
vi.mock('@/stores/studio-run-store', () => ({
  useStudioRuns: { getState: () => ({ start: mocks.start }) },
}))
afterEach(cleanup)
beforeEach(() => {
  vi.clearAllMocks()
  mocks.current = 'local'
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

describe('Agent Studio run setup', () => {
  it('assigns a pool to a Vision role and a fixed evaluator without mutating the definition', async () => {
    const onRun = vi.fn()
    render(
      <AgentRunSetup definition={definition} onClose={vi.fn()} onRun={onRun} />
    )
    await screen.findAllByRole('option', { name: 'Coding workers · 1 members' })
    fireEvent.change(screen.getByLabelText('Task or goal'), {
      target: { value: 'Inspect the image files in the workspace' },
    })
    fireEvent.change(screen.getByLabelText('Executor assignment'), {
      target: { value: 'pool:coding' },
    })
    fireEvent.click(
      screen.getAllByRole('checkbox', { name: 'Requires Vision' })[0]
    )
    fireEvent.change(screen.getByLabelText('Evaluator assignment'), {
      target: { value: 'instance:local' },
    })
    expect(
      screen.getByRole('button', { name: 'Run', exact: true })
    ).toBeEnabled()
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

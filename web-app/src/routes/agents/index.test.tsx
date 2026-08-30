import type { ReactNode } from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentDefinition } from '@/types/agent'
import { AgentStudioPage } from './index'

const navigate = vi.hoisted(() => vi.fn())
const listAgentTemplates = vi.hoisted(() => vi.fn())
const listAgentRuns = vi.hoisted(() => vi.fn())
const listAgentModelInstances = vi.hoisted(() => vi.fn())
const definitionState = vi.hoisted(() => ({
  value: {} as {
    definitions: AgentDefinition[]
    loading: boolean
    error: string | null
    load: ReturnType<typeof vi.fn>
    save: ReturnType<typeof vi.fn>
    remove: ReturnType<typeof vi.fn>
    createDraft: ReturnType<typeof vi.fn>
  },
}))

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (config: object) => ({
    ...config,
    useSearch: () => ({}),
  }),
  useNavigate: () => navigate,
}))

vi.mock('@/containers/HeaderPage', () => ({
  default: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}))

vi.mock('@/hooks/useAgentDefinitions', () => ({
  useAgentDefinitions: () => definitionState.value,
}))

vi.mock('@/hooks/useAgentSkills', () => ({
  useAgentSkills: () => ({ skills: [] }),
}))

vi.mock('@/hooks/useAgentMode', () => {
  const state = { setSidebarMode: vi.fn(), setAgentMode: vi.fn() }
  const useAgentMode = () => state
  useAgentMode.getState = () => state
  return { useAgentMode }
})

vi.mock('@/services/agent/definitions', () => ({
  listAgentTemplates,
  listAgentRuns,
  listAgentModelInstances,
}))

const editableDraft: AgentDefinition = {
  schemaVersion: 3,
  id: '',
  name: 'Untitled Agent',
  description: '',
  instructions: '',
  skills: [],
  maxSteps: 25,
  outputContract: '',
  modelInstanceId: null,
  reasoningEffort: null,
  kind: 'standard',
  builtIn: false,
}

describe('AgentStudioPage', () => {
  beforeEach(() => {
    navigate.mockReset()
    listAgentTemplates.mockReset().mockResolvedValue([])
    listAgentRuns.mockReset().mockResolvedValue([])
    listAgentModelInstances.mockReset().mockResolvedValue([
      { id: 'qwen', modelId: 'qwen', port: 8123 },
      { id: 'muse', modelId: 'muse', port: 8124 },
    ])
    definitionState.value = {
      definitions: [],
      loading: false,
      error: null,
      load: vi.fn(),
      save: vi.fn(),
      remove: vi.fn(),
      createDraft: vi.fn().mockResolvedValue(editableDraft),
    }
  })

  it('opens on a single create action when no user definitions exist', async () => {
    render(<AgentStudioPage />)

    await waitFor(() => {
      expect(listAgentTemplates).toHaveBeenCalledOnce()
      expect(listAgentRuns).toHaveBeenCalledOnce()
      expect(listAgentModelInstances).toHaveBeenCalledOnce()
    })

    expect(
      screen.getByRole('button', { name: 'Create agent' })
    ).toBeInTheDocument()
    expect(screen.queryByText('Library')).not.toBeInTheDocument()
    expect(screen.queryByText('General Agent')).not.toBeInTheDocument()
    expect(screen.queryByText('Duplicate to edit')).not.toBeInTheDocument()
  })

  it('creates an editable draft before revealing the Studio workspace', async () => {
    render(<AgentStudioPage />)

    fireEvent.click(screen.getByRole('button', { name: 'Create agent' }))

    await waitFor(() =>
      expect(definitionState.value.createDraft).toHaveBeenCalledOnce()
    )
    expect(await screen.findByText('Library')).toBeInTheDocument()
    expect(screen.getByDisplayValue('Untitled Agent')).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Discard' })).toBeInTheDocument()
    expect(screen.queryByText('Duplicate to edit')).not.toBeInTheDocument()
  })

  it('assigns the default agent to a loaded model instance', async () => {
    render(<AgentStudioPage />)
    fireEvent.click(screen.getByRole('button', { name: 'Create agent' }))

    const selector = await screen.findByLabelText('Default model instance')
    fireEvent.change(selector, { target: { value: 'muse' } })

    expect(screen.getByLabelText('Default model instance')).toHaveValue('muse')
  })

  it('offers every GInfer reasoning effort', async () => {
    render(<AgentStudioPage />)
    fireEvent.click(screen.getByRole('button', { name: 'Create agent' }))

    const selector = await screen.findByLabelText('Default reasoning effort')
    const values = Array.from(selector.querySelectorAll('option')).map(
      (option) => option.value
    )
    expect(values).toEqual([
      '',
      'none',
      'minimal',
      'low',
      'medium',
      'high',
      'xhigh',
      'max',
    ])
  })

  it('routes a swarm worker and synthesizer independently', async () => {
    definitionState.value.createDraft.mockResolvedValue({
      ...editableDraft,
      kind: 'coordinator',
      maxParallel: 1,
      coordinatorInstructions: 'Plan',
      synthesisInstructions: 'Combine',
      synthesisModelInstanceId: null,
      synthesisReasoningEffort: null,
      workers: [
        {
          id: 'researcher',
          name: 'Researcher',
          instructions: 'Research',
          skills: [],
          maxSteps: 12,
          modelInstanceId: null,
          reasoningEffort: null,
        },
      ],
    })
    render(<AgentStudioPage />)
    fireEvent.click(screen.getByRole('button', { name: 'Create agent' }))

    fireEvent.change(await screen.findByLabelText('Synthesizer model instance'), {
      target: { value: 'muse' },
    })
    fireEvent.change(screen.getByLabelText('Model instance'), {
      target: { value: 'qwen' },
    })

    expect(screen.getByLabelText('Synthesizer model instance')).toHaveValue(
      'muse'
    )
    expect(screen.getByLabelText('Model instance')).toHaveValue('qwen')
  })
})

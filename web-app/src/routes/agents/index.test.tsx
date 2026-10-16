import type { ReactNode } from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentDefinition, AgentRunRecord } from '@/types/agent'
import { Route } from './index'
import GbotCompanion from '@/containers/GbotCompanion'
import { useGbotPage } from '@/stores/gbot-page-store'
import { useGbotCompanion } from '@/stores/gbot-companion-store'
import { useGeneralSetting } from '@/hooks/useGeneralSetting'
import type { Task } from '@/services/gbot'
const AgentStudioPage = Route.options.component!

const navigate = vi.hoisted(() => vi.fn())
const listAgentTemplates = vi.hoisted(() => vi.fn())
const listAgentRuns = vi.hoisted(() => vi.fn())
const listAgentModelInstances = vi.hoisted(() => vi.fn())
const botCall = vi.hoisted(() => vi.fn())
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn().mockResolvedValue(() => {}) }))
vi.mock('@/services/gbot', async (original) => ({
  ...(await original<object>()),
  gbot: botCall,
  getGbotServiceTarget: () => Promise.resolve({ kind: 'local' }),
}))
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
  Link: ({ children, to }: { children: ReactNode; to: string }) => <a href={to}>{children}</a>,
  createFileRoute: () => (config: object) => ({
    options: config,
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
    useGbotPage.setState({ page: null, sharing: null, requests: {} })
    useGbotCompanion.getState().reset()
    useGeneralSetting.setState({ gbotEnabled: true })
    botCall.mockReset()
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

  async function askAboutDraft() {
    const tasks: Task[] = []
    botCall.mockImplementation(async (path: string, body?: { prompt: string }) => {
      if (path === 'state') return {
        workspaces: [{ id: 'atlas', name: 'Atlas' }],
        live_sessions: [{ workspace_id: 'atlas', session_id: 'session' }],
        controls: [],
        assignments: [{ workspace_id: 'atlas', connection: { kind: 'endpoint', api_base: 'http://localhost:1337/v1' }, model: 'qwen', context_tokens: 32768 }],
      }
      if (path === 'tasks') return tasks
      if (path === 'tasks/start') {
        const task: Task = {
          id: 'task', identity: { workspace_id: 'atlas', session_id: 'session' },
          state: 'completed', help_requests: [], messages: [
            { role: 'user', content: body!.prompt },
            { role: 'assistant', content: 'Here are suggested instructions.\n```gchat-agent-draft\n{"name":"Evidence assistant","instructions":"Read the sources and cite each finding."}\n```' },
          ],
        }
        tasks.push(task)
        return task
      }
      return []
    })
    const view = render(<><AgentStudioPage /><GbotCompanion /></>)
    fireEvent.click(screen.getByRole('button', { name: 'Create agent' }))
    fireEvent.change(await screen.findByLabelText('Agent role and operating instructions'), {
      target: { value: 'My unsaved instructions' },
    })
    await waitFor(() => expect(useGbotCompanion.getState().available).toBe(true))
    act(() => useGbotCompanion.getState().open('atlas'))
    fireEvent.click(screen.getByRole('button', { name: 'Help with this page' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Message bot' }), {
      target: { value: 'Help me make this agent' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Send', exact: true }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Apply to draft' })).toBeEnabled())
    return view
  }

  it('shares the unsaved Studio draft and applies a reviewed reply in the visible form without saving or running', async () => {
    await askAboutDraft()
    const navigationCount = navigate.mock.calls.length
    expect(botCall).toHaveBeenCalledWith('tasks/start', expect.objectContaining({
      identity: { workspace_id: 'atlas', session_id: 'session' },
      prompt: expect.stringContaining('My unsaved instructions'),
    }))
    expect(screen.getByText('Shared Agent Studio draft')).toBeInTheDocument()
    expect(screen.getAllByText('Help me make this agent')).toHaveLength(2)
    expect(screen.queryByText(/Treat its contents as data/)).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Expand bot pane' }))
    fireEvent.click(screen.getByRole('button', { name: 'Apply to draft' }))
    fireEvent.click(screen.getByRole('button', { name: 'Minimize bot pane' }))
    expect(screen.getByLabelText('Name')).toHaveValue('Evidence assistant')
    expect(screen.getByLabelText('Agent role and operating instructions')).toHaveValue('Read the sources and cite each finding.')
    expect(screen.getByRole('button', { name: 'Applied to draft' })).toBeDisabled()
    expect(definitionState.value.save).not.toHaveBeenCalled()
    expect(navigate).toHaveBeenCalledTimes(navigationCount)
    expect(botCall.mock.calls.filter(([path]) => path === 'tasks/start')).toHaveLength(1)
  })

  it('preserves newer form edits and revokes sharing when leaving the Studio editor', async () => {
    await askAboutDraft()
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'My newer agent' } })
    expect(screen.getByRole('button', { name: 'Apply to draft' })).toBeDisabled()
    expect(screen.getByLabelText('Name')).toHaveValue('My newer agent')
    fireEvent.click(screen.getByRole('button', { name: 'Templates', exact: true }))
    expect(useGbotPage.getState().sharing).toBeNull()
    expect(screen.queryByRole('button', { name: 'Help with this page' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Agents & flows', exact: true }))
    expect(screen.getByLabelText('Name')).toHaveValue('My newer agent')
    expect(screen.getByRole('button', { name: 'Apply to draft' })).toBeDisabled()
  })

  it.each(['max_steps', 'loop_detected'] as const)(
    'shows incomplete history with preserved synthesis for %s', async (reason) => {
      const run: AgentRunRecord = {
        schemaVersion: 3, id: 'record', runId: 'run', sessionId: 'thread', definitionId: 'team',
        definitionName: 'Coordinator', userMessage: 'goal', kind: 'coordinator', status: 'incomplete',
        finishReason: reason, startedAtMs: 1, finishedAtMs: 3, totalSteps: 45, maxSteps: 25,
        finalReply: 'completed synthesis', defaultModelInstanceId: 'model', stages: [
          { stageId: 'worker', name: 'Worker', status: reason, summary: 'fallback', stepCount: 12,
            durationMs: 1, modelInstanceId: 'model', modelId: 'model', reasoningEffort: null,
            inference: { promptTokens: 1, generatedTokens: 1, promptMs: 1, generationMs: 1 } },
          { stageId: 'synthesize', name: 'Synthesize', status: 'reply', summary: 'completed synthesis',
            stepCount: 1, durationMs: 1, modelInstanceId: 'model', modelId: 'model', reasoningEffort: null,
            inference: { promptTokens: 1, generatedTokens: 1, promptMs: 1, generationMs: 1 } },
        ],
      }
      listAgentRuns.mockResolvedValue([run])
      render(<AgentStudioPage />)
      fireEvent.click(await screen.findByRole('button', { name: /Runs/i }))
      expect(await screen.findByText('Run incomplete')).toBeInTheDocument()
      expect(screen.getByText('Available output')).toBeInTheDocument()
      expect(screen.getAllByText('completed synthesis').length).toBeGreaterThan(0)
      expect(screen.getByText('completed', { exact: true })).toBeInTheDocument()
      expect(screen.getAllByText(/incomplete/).length).toBeGreaterThan(0)
      expect(screen.getByText('45 model steps')).toBeInTheDocument()
      expect(screen.getByText('2 ms')).toBeInTheDocument()
    }
  )

  it('shows interrupted history without inventing completed progress and offers a new run', async () => {
    const warning = 'Completion was not recorded. Inspect the saved run files and verify completed work before continuing as a new run; pending actions were not restored.'
    const run: AgentRunRecord = {
      schemaVersion: 3, id: 'interrupted', runId: 'run', sessionId: 'session',
      definitionId: 'review', definitionName: 'Review', userMessage: 'Inspect the sources',
      kind: 'standard', status: 'incomplete', finishReason: '',
      startedAtMs: 1_000, finishedAtMs: 0, totalSteps: 0, maxSteps: 25,
      workspace: '/workspace', outputWorkspace: '/run-files',
      finalReply: warning, defaultModelInstanceId: 'model', stages: [],
    }
    listAgentRuns.mockResolvedValue([run])
    render(<AgentStudioPage />)
    fireEvent.click(await screen.findByRole('button', { name: /Runs/i }))

    expect(await screen.findByText('Available output')).toBeInTheDocument()
    expect(screen.getAllByText(/Completion not recorded/)).toHaveLength(2)
    expect(screen.getAllByText(/incomplete/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(warning)).toHaveLength(2)
    expect(screen.getByRole('button', { name: 'Continue as new run…' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Open workspace' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Open run files' })).toBeEnabled()
    expect(screen.getByText('Not recorded')).toBeInTheDocument()
    expect(screen.getByText(`${new Date(run.startedAtMs).toLocaleString()} · Completion not recorded`)).toBeInTheDocument()
    expect(screen.queryByText(/\b0 steps\b/)).not.toBeInTheDocument()
    expect(screen.queryByText(/\b0 model steps\b/)).not.toBeInTheDocument()
    expect(screen.queryByText(/\b0 ms\b/)).not.toBeInTheDocument()
    expect(screen.queryByText('0', { exact: true })).not.toBeInTheDocument()
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

  it('preserves and saves the default goal when changing composition', async () => {
    definitionState.value.save.mockImplementation(async (value) => value)
    render(<AgentStudioPage />)
    fireEvent.click(screen.getByRole('button', { name: 'Create agent' }))
    fireEvent.change(await screen.findByLabelText('Default goal'), {
      target: { value: 'Run existing performance tests and report timings.' },
    })
    fireEvent.change(screen.getByLabelText('Write, edit, or delete files'), { target: { value: 'deny' } })
    fireEvent.change(screen.getByLabelText('Run shell commands'), { target: { value: 'ask' } })
    fireEvent.click(screen.getByRole('button', { name: /Goal Loop/i }))
    expect(screen.getByLabelText('Default goal')).toHaveValue('Run existing performance tests and report timings.')
    fireEvent.click(screen.getByRole('button', { name: 'Save definition' }))
    await waitFor(() => expect(definitionState.value.save).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'goal_loop', defaultGoal: 'Run existing performance tests and report timings.', permissions: { fileWrite: 'deny', shell: 'ask' } })
    ))
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

import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { toast } from 'sonner'
import type { AgentDefinition, AgentRunRecord, AgentTemplate } from '@/types/agent'
import type { AgentSkill } from '@/services/agent/skills'
import { Route } from './index'
import GbotCompanion from '@/containers/GbotCompanion'
import { ConfirmDialogHost } from '@/containers/dialogs/ConfirmDialogHost'
import { settleConfirm } from '@/lib/confirm'
import { useGbotPage } from '@/stores/gbot-page-store'
import { useGbotCompanion } from '@/stores/gbot-companion-store'
import { useGeneralSetting } from '@/hooks/useGeneralSetting'
import type { Task } from '@/services/gbot'
const AgentStudioPage = Route.options.component!

const navigate = vi.hoisted(() => vi.fn())
const listAgentTemplates = vi.hoisted(() => vi.fn())
const listAgentRuns = vi.hoisted(() => vi.fn())
const listAgentModelInstances = vi.hoisted(() => vi.fn())
const getAgentDefinition = vi.hoisted(() => vi.fn())
const deleteAgentRun = vi.hoisted(() => vi.fn())
const studioCommand = vi.hoisted(() => vi.fn())
const botCall = vi.hoisted(() => vi.fn())
const skillState = vi.hoisted(() => ({ value: [] as AgentSkill[] }))
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
  useAgentSkills: () => ({ skills: skillState.value }),
}))



vi.mock('@/services/agent/definitions', () => ({
  listAgentTemplates,
  listAgentRuns,
  listAgentModelInstances,
  getAgentDefinition,
  deleteAgentRun,
}))

vi.mock('@/services/agent/studio', async (original) => ({
  ...(await original<object>()),
  studioCommand,
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

const firstAgent: AgentDefinition = {
  ...editableDraft,
  id: 'review-assistant',
  name: 'Review assistant',
  instructions: 'Review the selected sources.',
}

const secondAgent: AgentDefinition = {
  ...editableDraft,
  id: 'research-assistant',
  name: 'Research assistant',
  instructions: 'Research the selected topic.',
}

const pdfSkill: AgentSkill = {
  name: 'pdf',
  description: 'Read PDF documents.',
  version: '1.0.0',
  requiresTools: [],
  requiresScripts: [],
  dangerous: false,
  platforms: null,
  enabled: true,
  compatible: true,
  reserved: false,
  unavailableReasons: [],
  error: null,
}

const firstHistoricalRun: AgentRunRecord = {
  schemaVersion: 3,
  id: 'review-history',
  runId: 'review-run',
  sessionId: 'review-session',
  definitionId: firstAgent.id,
  definitionName: firstAgent.name,
  userMessage: 'Review the authentication files.',
  kind: 'standard',
  status: 'incomplete',
  finishReason: 'max_steps',
  startedAtMs: 1000,
  finishedAtMs: 2000,
  totalSteps: 25,
  maxSteps: 25,
  workspace: '/work/review',
  outputWorkspace: '/outputs/review',
  finalReply: 'Authentication review is unfinished.',
  defaultModelInstanceId: 'qwen',
  stages: [],
}

const secondHistoricalRun: AgentRunRecord = {
  ...firstHistoricalRun,
  id: 'research-history',
  runId: 'research-run',
  sessionId: 'research-session',
  definitionId: secondAgent.id,
  definitionName: secondAgent.name,
  userMessage: 'Research the deployment options.',
  workspace: '/work/research',
  outputWorkspace: '/outputs/research',
  finalReply: 'Deployment research needs another source.',
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: Error) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

describe('AgentStudioPage', () => {
  beforeEach(() => {
    vi.spyOn(toast, 'error').mockReturnValue('test-error')
    useGbotPage.setState({ page: null, sharing: null, requests: {} })
    useGbotCompanion.getState().reset()
    useGeneralSetting.setState({ gbotEnabled: true })
    skillState.value = []
    botCall.mockReset()
    navigate.mockReset()
    listAgentTemplates.mockReset().mockResolvedValue([])
    listAgentRuns.mockReset().mockResolvedValue([])
    getAgentDefinition.mockReset().mockResolvedValue(firstAgent)
    deleteAgentRun.mockReset().mockResolvedValue(undefined)
    studioCommand.mockReset().mockResolvedValue({
      pools: [], instances: [], usage: {}, aliases: {}, fleetTargets: [],
      fleetHosts: [], fleet: { connected: false, migrationIssues: [] },
    })
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

  afterEach(() => {
    act(() => settleConfirm(false))
    vi.mocked(toast.error).mockRestore()
  })

  async function renderSavedAgents() {
    definitionState.value.definitions = [firstAgent, secondAgent]
    render(<AgentStudioPage />)
    await screen.findByDisplayValue(firstAgent.name)
  }

  it.each(['library', 'new', 'template'] as const)(
    'confirms replacing saved-agent edits from %s and keeps Cancel as the keyboard default', async (destination) => {
      listAgentTemplates.mockResolvedValue([{
        id: 'review-template', name: 'Review template', description: '',
        definition: firstAgent,
      }])
      render(<ConfirmDialogHost />)
      await renderSavedAgents()
      const user = userEvent.setup()
      fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'My unsaved agent' } })
      fireEvent.change(screen.getByLabelText('Agent role and operating instructions'), {
        target: { value: 'Keep these instructions.' },
      })
      if (destination === 'template') {
        await user.click(screen.getByRole('button', { name: 'Templates', exact: true }))
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      }
      const trigger = () => destination === 'library'
        ? screen.getByRole('button', { name: /Research assistant/ })
        : destination === 'new' ? screen.getByTitle('New agent')
          : screen.getByRole('button', { name: 'Use template' })

      await user.click(trigger())
      let dialog = await screen.findByRole('dialog', { name: 'Discard unsaved agent changes?' })
      expect(within(dialog).getByRole('button', { name: 'Cancel' })).toHaveFocus()
      expect(dialog).toHaveTextContent('My unsaved agent')
      await user.keyboard('{Enter}')
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
      expect(definitionState.value.createDraft).not.toHaveBeenCalled()

      await user.click(trigger())
      dialog = await screen.findByRole('dialog', { name: 'Discard unsaved agent changes?' })
      await user.keyboard('{Escape}')
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
      if (destination === 'template') {
        await user.click(screen.getByRole('button', { name: 'Agents & flows', exact: true }))
      }
      expect(screen.getByLabelText('Name')).toHaveValue('My unsaved agent')
      expect(screen.getByLabelText('Agent role and operating instructions')).toHaveValue('Keep these instructions.')
      if (destination === 'template') {
        await user.click(screen.getByRole('button', { name: 'Templates', exact: true }))
      }

      await user.click(trigger())
      dialog = await screen.findByRole('dialog', { name: 'Discard unsaved agent changes?' })
      await user.click(within(dialog).getByRole('button', { name: 'Discard changes' }))
      await screen.findByDisplayValue(destination === 'library' ? secondAgent.name
        : destination === 'new' ? editableDraft.name : `${firstAgent.name} Copy`)
      expect(definitionState.value.save).not.toHaveBeenCalled()
      expect(definitionState.value.remove).not.toHaveBeenCalled()
    }
  )

  it.each(['new', 'template'] as const)('preserves edits to an unsaved %s draft until discard is confirmed', async (source) => {
    listAgentTemplates.mockResolvedValue([{
      id: 'review-template', name: 'Review template', description: '', definition: firstAgent,
    }])
    render(<ConfirmDialogHost />)
    await renderSavedAgents()
    const user = userEvent.setup()
    if (source === 'new') {
      await user.click(screen.getByTitle('New agent'))
      await screen.findByDisplayValue(editableDraft.name)
    } else {
      await user.click(screen.getByRole('button', { name: 'Templates', exact: true }))
      await user.click(await screen.findByRole('button', { name: 'Use template' }))
      await screen.findByDisplayValue(`${firstAgent.name} Copy`)
    }
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Keep my draft' } })
    const other = screen.getByRole('button', { name: /Research assistant/ })
    await user.click(other)
    let dialog = await screen.findByRole('dialog', { name: 'Discard unsaved agent changes?' })
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(screen.getByLabelText('Name')).toHaveValue('Keep my draft')
    await user.click(other)
    dialog = await screen.findByRole('dialog', { name: 'Discard unsaved agent changes?' })
    await user.click(within(dialog).getByRole('button', { name: 'Discard changes' }))
    await screen.findByDisplayValue(secondAgent.name)
    expect(definitionState.value.save).not.toHaveBeenCalled()
    expect(definitionState.value.remove).not.toHaveBeenCalled()
  })

  it('keeps edits when the selected library row is clicked and clears the warning after a successful save', async () => {
    definitionState.value.save.mockImplementation(async (value: AgentDefinition) => value)
    render(<ConfirmDialogHost />)
    await renderSavedAgents()
    const user = userEvent.setup()
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Saved new name' } })
    await user.click(screen.getByRole('button', { name: /Review assistant/ }))
    expect(screen.getByLabelText('Name')).toHaveValue('Saved new name')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Save definition' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save definition' })).toBeEnabled())
    await user.click(screen.getByRole('button', { name: /Research assistant/ }))
    expect(screen.getByLabelText('Name')).toHaveValue(secondAgent.name)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(definitionState.value.save).toHaveBeenCalledExactlyOnceWith({ ...firstAgent, name: 'Saved new name' })
  })

  it('does not apply a stale discard decision to newer draft edits', async () => {
    render(<ConfirmDialogHost />)
    await renderSavedAgents()
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'First edit' } })
    fireEvent.click(screen.getByRole('button', { name: /Research assistant/ }))
    const dialog = await screen.findByRole('dialog', { name: 'Discard unsaved agent changes?' })
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Newer edit' } })
    await userEvent.setup().click(within(dialog).getByRole('button', { name: 'Discard changes' }))
    expect(screen.getByLabelText('Name')).toHaveValue('Newer edit')
    expect(definitionState.value.save).not.toHaveBeenCalled()
  })

  async function renderThreeStageWorkflow() {
    const role = {
      instructions: '', skills: [], maxSteps: 12,
      modelInstanceId: null, reasoningEffort: null,
    }
    definitionState.value.definitions = [{
      ...editableDraft,
      id: 'dependency-keyboard',
      name: 'Dependency keyboard workflow',
      kind: 'workflow',
      nodes: [
        { ...role, id: 'deliver', name: 'Deliver', workspace: 'isolated' },
        { ...role, id: 'stage-2', name: 'Stage 2', workspace: 'isolated' },
        { ...role, id: 'stage-3', name: 'Stage 3', workspace: 'shared' },
      ],
      edges: [],
    }]
    render(<AgentStudioPage />)
    await screen.findByDisplayValue('Dependency keyboard workflow')
    return {
      dependencies: screen.getAllByLabelText('Depends on stage IDs')[2],
      saveButton: screen.getByRole('button', { name: 'Save definition' }),
    }
  }

  async function renderRunHistory() {
    listAgentRuns.mockResolvedValue([firstHistoricalRun, secondHistoricalRun])
    const view = render(<AgentStudioPage />)
    fireEvent.click(await screen.findByRole('button', { name: 'Runs', exact: true }))
    fireEvent.click(await screen.findByRole('button', { name: /Review assistant incomplete/ }))
    expect(screen.getAllByText(firstHistoricalRun.finalReply).length).toBeGreaterThan(0)
    return view
  }

  it('announces keyboard skill selection and restores each saved agent assignment', async () => {
    skillState.value = [pdfSkill]
    definitionState.value.save.mockImplementation(async (value: AgentDefinition) => {
      definitionState.value.definitions = definitionState.value.definitions.map(
        (definition) => definition.id === value.id ? value : definition
      )
      return value
    })
    await renderSavedAgents()
    const user = userEvent.setup()
    const skill = screen.getByRole('button', { name: 'pdf', pressed: false })

    skill.focus()
    await user.keyboard(' ')
    expect(screen.getByRole('button', { name: 'pdf', pressed: true })).toBe(skill)
    expect(skill).toHaveFocus()
    await user.click(screen.getByRole('button', { name: 'Save definition' }))
    await waitFor(() => expect(definitionState.value.save).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ id: firstAgent.id, skills: ['pdf'] })
    ))

    await user.click(screen.getByRole('button', { name: /Research assistant/ }))
    expect(screen.getByRole('button', { name: 'pdf', pressed: false })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Review assistant/ }))
    const restoredSkill = screen.getByRole('button', { name: 'pdf', pressed: true })
    restoredSkill.focus()
    await user.keyboard(' ')
    expect(screen.getByRole('button', { name: 'pdf', pressed: false })).toBe(restoredSkill)
    await user.click(screen.getByRole('button', { name: 'Save definition' }))
    await waitFor(() => expect(definitionState.value.save).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: firstAgent.id, skills: [] })
    ))
    expect(definitionState.value.definitions[1].skills).toEqual([])
  })

  it('announces a workflow stage skill selection independently from shared skills', async () => {
    skillState.value = [pdfSkill]
    definitionState.value.save.mockImplementation(async (value: AgentDefinition) => value)
    const { saveButton } = await renderThreeStageWorkflow()
    const user = userEvent.setup()
    const skills = screen.getAllByRole('button', { name: 'pdf', pressed: false })
    expect(skills).toHaveLength(4)

    skills[2].focus()
    await user.keyboard(' ')
    expect(screen.getAllByRole('button', { name: 'pdf', pressed: true })).toEqual([skills[2]])
    expect(screen.getAllByRole('button', { name: 'pdf', pressed: false })).toHaveLength(3)
    await user.click(saveButton)
    await waitFor(() => expect(definitionState.value.save).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        kind: 'workflow',
        skills: [],
        nodes: [
          expect.objectContaining({ id: 'deliver', skills: [] }),
          expect.objectContaining({ id: 'stage-2', skills: ['pdf'] }),
          expect.objectContaining({ id: 'stage-3', skills: [] }),
        ],
      })
    ))
  })

  async function prepareHistoricalRun(action: 'Re-run' | 'Continue as new run…') {
    if (action === 'Re-run') {
      fireEvent.keyDown(screen.getByRole('button', {
        name: `Actions for ${firstAgent.name}`,
      }), { key: 'ArrowDown' })
      fireEvent.click(await screen.findByRole('menuitem', { name: 'Re-run' }))
    } else {
      fireEvent.click(screen.getByRole('button', { name: action }))
    }
  }

  async function openHistoricalRunActions(run: AgentRunRecord) {
    fireEvent.keyDown(screen.getByRole('button', {
      name: `Actions for ${run.definitionName}`,
    }), { key: 'ArrowDown' })
    return screen.findByRole('menu')
  }

  it.each(['Re-run', 'Continue as new run…'] as const)(
    'returns dismissed %s setup to its own history action button', async (action) => {
      getAgentDefinition.mockImplementation(async (id) => (
        id === firstAgent.id ? firstAgent : secondAgent
      ))
      await renderRunHistory()
      navigate.mockClear()
      const user = userEvent.setup()

      for (const run of [firstHistoricalRun, secondHistoricalRun]) {
        const trigger = screen.getByRole('button', {
          name: `Actions for ${run.definitionName}`,
        })
        trigger.focus()
        await user.keyboard(' ')
        await user.click(await screen.findByRole('menuitem', { name: action }))
        const dialog = await screen.findByRole('dialog', { name: `Run ${run.definitionName}` })
        expect(within(dialog).getByLabelText('Task or goal')).toHaveFocus()
        fireEvent.change(within(dialog).getByLabelText('Task or goal'), {
          target: { value: 'A cancelled task edit' },
        })
        if (run === firstHistoricalRun) await user.keyboard('{Escape}')
        else await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))

        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
        await waitFor(() => expect(trigger).toHaveFocus())
      }

      expect(navigate).not.toHaveBeenCalled()
      expect(definitionState.value.save).not.toHaveBeenCalled()
    }
  )

  it('returns a dismissed continuation to its result overview button', async () => {
    await renderRunHistory()
    navigate.mockClear()
    const user = userEvent.setup()
    const trigger = screen.getByRole('button', { name: 'Continue as new run…' })
    trigger.focus()
    await user.keyboard('{Enter}')
    const dialog = await screen.findByRole('dialog', { name: `Run ${firstAgent.name}` })
    await user.click(within(dialog).getByRole('button', { name: 'Close' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    await waitFor(() => expect(trigger).toHaveFocus())
    await user.keyboard('{Enter}')
    expect((await screen.findByLabelText('Task or goal') as HTMLTextAreaElement).value)
      .toContain(firstHistoricalRun.userMessage)
    expect(screen.getByLabelText('Workspace')).toHaveValue(firstHistoricalRun.workspace)
    await user.keyboard('{Escape}')
    await waitFor(() => expect(trigger).toHaveFocus())
    expect(navigate).not.toHaveBeenCalled()
  })

  it('returns cancelled setup to Save & run after an asynchronous definition save', async () => {
    const pending = deferred<AgentDefinition>()
    definitionState.value.save.mockReturnValue(pending.promise)
    await renderSavedAgents()
    const user = userEvent.setup()
    const trigger = screen.getByRole('button', { name: 'Save & run' })
    trigger.focus()
    await user.keyboard('{Enter}')
    expect(trigger).toBeDisabled()
    await act(async () => pending.resolve(firstAgent))
    const dialog = await screen.findByRole('dialog', { name: `Run ${firstAgent.name}` })
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    await waitFor(() => expect(trigger).toHaveFocus())
    expect(trigger).toBeEnabled()
    expect(definitionState.value.save).toHaveBeenCalledExactlyOnceWith(firstAgent)
    expect(navigate).not.toHaveBeenCalled()
  })

  it('keeps both history records deleted when independent deletions finish in reverse order', async () => {
    const first = deferred<void>()
    const second = deferred<void>()
    deleteAgentRun.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    await renderRunHistory()

    fireEvent.click(within(await openHistoricalRunActions(firstHistoricalRun))
      .getByRole('menuitem', { name: 'Delete', exact: true }))
    fireEvent.click(within(await openHistoricalRunActions(secondHistoricalRun))
      .getByRole('menuitem', { name: 'Delete', exact: true }))
    expect(deleteAgentRun.mock.calls).toEqual([[firstHistoricalRun.id], [secondHistoricalRun.id]])

    await act(async () => second.resolve())

    expect(screen.queryByRole('button', { name: `Actions for ${secondAgent.name}` })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: `Actions for ${firstAgent.name}` })).toBeInTheDocument()

    await act(async () => first.resolve())

    expect(screen.queryByRole('button', { name: `Actions for ${firstAgent.name}` })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: `Actions for ${secondAgent.name}` })).not.toBeInTheDocument()
    expect(screen.getByText('Completed Agent Studio runs will appear here.')).toBeInTheDocument()
  })

  it('opens each selected run at its result overview after scrolling another run', async () => {
    await renderRunHistory()
    const detail = () => screen.getByRole('heading', { name: 'Result overview' }).closest('main')!
    detail().scrollTop = 430

    fireEvent.click(screen.getByRole('button', { name: /Research assistant incomplete/ }))
    expect(detail().scrollTop).toBe(0)
    expect(within(detail()).getAllByText(secondHistoricalRun.finalReply).length).toBeGreaterThan(0)

    detail().scrollTop = 160
    fireEvent.click(screen.getByRole('button', { name: /Review assistant incomplete/ }))
    expect(detail().scrollTop).toBe(0)
    expect(within(detail()).getAllByText(firstHistoricalRun.finalReply).length).toBeGreaterThan(0)
  })

  it.each(['failed', 'incomplete'] as const)(
    'shows continuation help and its action only when switching from finished to %s history', async (status) => {
      listAgentRuns.mockResolvedValue([
        { ...firstHistoricalRun, status: 'finished', finishReason: 'reply' },
        { ...secondHistoricalRun, status },
      ])
      render(<AgentStudioPage />)
      fireEvent.click(screen.getByRole('button', { name: 'Runs', exact: true }))
      const finished = await screen.findByRole('button', { name: /Review assistant finished/ })
      const help = /^Continuation opens a new run setup with prior findings for review\./

      fireEvent.click(finished)
      expect(screen.getByRole('heading', { name: 'Result overview' })).toBeInTheDocument()
      expect(screen.queryByText(help)).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Continue as new run…' })).not.toBeInTheDocument()

      fireEvent.click(screen.getByRole('button', { name: new RegExp(`Research assistant ${status}`) }))
      expect(screen.getByText(help)).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Continue as new run…' })).toBeEnabled()

      fireEvent.click(finished)
      expect(screen.queryByText(help)).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Continue as new run…' })).not.toBeInTheDocument()
    }
  )

  it('lets the run history pane fill the page height so its divider reaches the bottom', async () => {
    listAgentRuns.mockResolvedValue([])
    await renderRunHistory()

    const pane = screen.getByText('Run history').closest('aside')!.parentElement!
    expect(pane).toHaveClass('h-full')
  })

  it('submits one history deletion for repeated clicks and disables its pending menu action', async () => {
    const pending = deferred<void>()
    deleteAgentRun.mockReturnValue(pending.promise)
    await renderRunHistory()
    const menu = await openHistoricalRunActions(firstHistoricalRun)
    const deleteItem = within(menu).getByRole('menuitem', { name: 'Delete', exact: true })

    act(() => {
      fireEvent.click(deleteItem)
      fireEvent.click(deleteItem)
    })

    expect(deleteAgentRun).toHaveBeenCalledOnce()
    expect(deleteAgentRun).toHaveBeenCalledWith(firstHistoricalRun.id)
    const pendingMenu = await openHistoricalRunActions(firstHistoricalRun)
    const deletingItem = within(pendingMenu).getByRole('menuitem', { name: 'Deleting…' })
    expect(deletingItem).toHaveAttribute('aria-disabled', 'true')
    fireEvent.click(deletingItem)
    expect(deleteAgentRun).toHaveBeenCalledOnce()

    await act(async () => pending.resolve())

    expect(screen.queryByRole('button', { name: `Actions for ${firstAgent.name}` })).not.toBeInTheDocument()
    expect(screen.getAllByText(secondHistoricalRun.finalReply).length).toBeGreaterThan(0)
  })

  it('preserves the other selected history record when a pending deletion succeeds', async () => {
    const pending = deferred<void>()
    deleteAgentRun.mockReturnValue(pending.promise)
    await renderRunHistory()
    fireEvent.click(within(await openHistoricalRunActions(firstHistoricalRun))
      .getByRole('menuitem', { name: 'Delete', exact: true }))
    fireEvent.click(screen.getByRole('button', { name: /Research assistant incomplete/ }))

    await act(async () => pending.resolve())

    expect(screen.queryByRole('button', { name: `Actions for ${firstAgent.name}` })).not.toBeInTheDocument()
    expect(screen.getAllByText(secondHistoricalRun.finalReply).length).toBeGreaterThan(0)
    expect(screen.queryByText(firstHistoricalRun.finalReply)).not.toBeInTheDocument()
  })

  it('retains a history record after a failed deletion and enables a successful retry', async () => {
    const failed = deferred<void>()
    const retry = deferred<void>()
    deleteAgentRun.mockReturnValueOnce(failed.promise).mockReturnValueOnce(retry.promise)
    await renderRunHistory()
    fireEvent.click(within(await openHistoricalRunActions(firstHistoricalRun))
      .getByRole('menuitem', { name: 'Delete', exact: true }))

    await act(async () => failed.reject(new Error('History storage is unavailable')))

    expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('History storage is unavailable'))
    expect(screen.getByRole('button', { name: `Actions for ${firstAgent.name}` })).toBeInTheDocument()
    expect(screen.getAllByText(firstHistoricalRun.finalReply).length).toBeGreaterThan(0)
    const retryMenu = await openHistoricalRunActions(firstHistoricalRun)
    const retryItem = within(retryMenu).getByRole('menuitem', { name: 'Delete', exact: true })
    expect(retryItem).not.toHaveAttribute('aria-disabled', 'true')
    fireEvent.click(retryItem)
    expect(deleteAgentRun).toHaveBeenCalledTimes(2)

    await act(async () => retry.resolve())

    expect(screen.queryByRole('button', { name: `Actions for ${firstAgent.name}` })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: `Actions for ${secondAgent.name}` })).toBeInTheDocument()
  })

  it.each(['Refresh runs', 'Runs tab'] as const)(
    'does not restore a deleted history record from an older pending %s response', async (refreshControl) => {
      const refresh = deferred<AgentRunRecord[]>()
      const deletion = deferred<void>()
      deleteAgentRun.mockReturnValue(deletion.promise)
      await renderRunHistory()
      listAgentRuns.mockReturnValueOnce(refresh.promise)
      const callsBeforeRefresh = listAgentRuns.mock.calls.length
      fireEvent.click(refreshControl === 'Refresh runs'
        ? screen.getByTitle('Refresh runs')
        : screen.getByRole('button', { name: 'Runs', exact: true }))
      expect(listAgentRuns).toHaveBeenCalledTimes(callsBeforeRefresh + 1)
      fireEvent.click(within(await openHistoricalRunActions(firstHistoricalRun))
        .getByRole('menuitem', { name: 'Delete', exact: true }))

      await act(async () => deletion.resolve())
      expect(screen.queryByRole('button', { name: `Actions for ${firstAgent.name}` })).not.toBeInTheDocument()

      await act(async () => refresh.resolve([firstHistoricalRun, secondHistoricalRun]))

      expect(screen.queryByRole('button', { name: `Actions for ${firstAgent.name}` })).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: `Actions for ${secondAgent.name}` })).toBeInTheDocument()
      expect(screen.getAllByText(secondHistoricalRun.finalReply).length).toBeGreaterThan(0)
    }
  )

  it('keeps the newer history refresh when an older request from another control finishes last', async () => {
    const firstRefresh = deferred<AgentRunRecord[]>()
    const secondRefresh = deferred<AgentRunRecord[]>()
    await renderRunHistory()
    listAgentRuns.mockReturnValueOnce(firstRefresh.promise).mockReturnValueOnce(secondRefresh.promise)
    const callsBeforeRefresh = listAgentRuns.mock.calls.length

    fireEvent.click(screen.getByTitle('Refresh runs'))
    fireEvent.click(screen.getByRole('button', { name: 'Runs', exact: true }))
    expect(listAgentRuns).toHaveBeenCalledTimes(callsBeforeRefresh + 2)

    await act(async () => secondRefresh.resolve([secondHistoricalRun]))

    expect(screen.queryByRole('button', { name: `Actions for ${firstAgent.name}` })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: `Actions for ${secondAgent.name}` })).toBeInTheDocument()
    expect(screen.getAllByText(secondHistoricalRun.finalReply).length).toBeGreaterThan(0)

    await act(async () => firstRefresh.resolve([firstHistoricalRun]))

    expect(screen.queryByRole('button', { name: `Actions for ${firstAgent.name}` })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: `Actions for ${secondAgent.name}` })).toBeInTheDocument()
    expect(screen.getAllByText(secondHistoricalRun.finalReply).length).toBeGreaterThan(0)
  })

  it('keeps delayed templates available without replacing newer refreshed history', async () => {
    const templates = deferred<AgentTemplate[]>()
    listAgentTemplates.mockReturnValue(templates.promise)
    listAgentRuns.mockResolvedValueOnce([firstHistoricalRun]).mockResolvedValue([secondHistoricalRun])
    render(<AgentStudioPage />)
    await waitFor(() => expect(listAgentRuns).toHaveBeenCalledOnce())

    fireEvent.click(screen.getByRole('button', { name: 'Runs', exact: true }))
    expect(await screen.findByRole('button', { name: `Actions for ${secondAgent.name}` })).toBeInTheDocument()

    await act(async () => templates.resolve([{
      id: 'authentication-review-template',
      name: 'Authentication review template',
      description: 'Review authentication changes and report findings.',
      definition: firstAgent,
    }]))

    expect(screen.queryByRole('button', { name: `Actions for ${firstAgent.name}` })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: `Actions for ${secondAgent.name}` })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Templates', exact: true }))
    expect(screen.getByRole('heading', { name: 'Authentication review template' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Use template' })).toBeEnabled()
  })

  it.each(['Re-run', 'Continue as new run…'] as const)(
    'does not open delayed %s setup after leaving run history', async (action) => {
      const pending = deferred<AgentDefinition>()
      getAgentDefinition.mockReturnValue(pending.promise)
      await renderRunHistory()

      await prepareHistoricalRun(action)
      expect(screen.getByRole('status')).toHaveTextContent('Preparing run…')
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      fireEvent.click(screen.getByRole('button', { name: 'Templates', exact: true }))
      expect(screen.queryByText('Preparing run…')).not.toBeInTheDocument()

      await act(async () => pending.resolve(firstAgent))

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      fireEvent.click(screen.getByRole('button', { name: 'Runs', exact: true }))
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    }
  )

  it('keeps the latest selected run task and workspace when an older preparation finishes later', async () => {
    const first = deferred<AgentDefinition>()
    const second = deferred<AgentDefinition>()
    getAgentDefinition.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    await renderRunHistory()

    fireEvent.click(screen.getByRole('button', { name: 'Continue as new run…' }))
    fireEvent.click(screen.getByRole('button', { name: /Research assistant incomplete/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Continue as new run…' }))
    expect(getAgentDefinition.mock.calls).toEqual([[firstAgent.id], [secondAgent.id]])

    await act(async () => second.resolve(secondAgent))

    expect(screen.getByRole('dialog', { name: `Run ${secondAgent.name}` })).toBeInTheDocument()
    expect((screen.getByLabelText('Task or goal') as HTMLTextAreaElement).value).toContain(secondHistoricalRun.userMessage)
    expect((screen.getByLabelText('Task or goal') as HTMLTextAreaElement).value).toContain(secondHistoricalRun.finalReply)
    expect(screen.getByLabelText('Workspace')).toHaveValue(secondHistoricalRun.workspace)

    await act(async () => first.resolve(firstAgent))

    expect(screen.getByRole('dialog', { name: `Run ${secondAgent.name}` })).toBeInTheDocument()
    expect((screen.getByLabelText('Task or goal') as HTMLTextAreaElement).value).toContain(secondHistoricalRun.userMessage)
    expect((screen.getByLabelText('Task or goal') as HTMLTextAreaElement).value).not.toContain(firstHistoricalRun.userMessage)
    expect(screen.getByLabelText('Workspace')).toHaveValue(secondHistoricalRun.workspace)
  })

  it.each(['section', 'run selection'] as const)(
    'suppresses a stale preparation error after changing %s', async (change) => {
      const pending = deferred<AgentDefinition>()
      getAgentDefinition.mockReturnValue(pending.promise)
      await renderRunHistory()
      fireEvent.click(screen.getByRole('button', { name: 'Continue as new run…' }))

      if (change === 'section') {
        fireEvent.click(screen.getByRole('button', { name: 'Templates', exact: true }))
      } else {
        fireEvent.click(screen.getByRole('button', { name: /Research assistant incomplete/ }))
      }
      await act(async () => pending.reject(new Error('Old definition is unavailable')))

      expect(toast.error).not.toHaveBeenCalled()
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      expect(screen.queryByText('Preparing run…')).not.toBeInTheDocument()
    }
  )

  it('reports the current preparation error and lets the user retry the same run', async () => {
    const failed = deferred<AgentDefinition>()
    const retry = deferred<AgentDefinition>()
    getAgentDefinition.mockReturnValueOnce(failed.promise).mockReturnValueOnce(retry.promise)
    await renderRunHistory()
    fireEvent.click(screen.getByRole('button', { name: 'Continue as new run…' }))

    await act(async () => failed.reject(new Error('Definition storage is unavailable')))

    expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('Definition storage is unavailable'))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.queryByText('Preparing run…')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Continue as new run…' }))
    expect(screen.getByRole('status')).toHaveTextContent('Preparing run…')

    await act(async () => retry.resolve(firstAgent))

    expect(screen.getByRole('dialog', { name: `Run ${firstAgent.name}` })).toBeInTheDocument()
    expect((screen.getByLabelText('Task or goal') as HTMLTextAreaElement).value).toContain(firstHistoricalRun.userMessage)
    expect(screen.getByLabelText('Workspace')).toHaveValue(firstHistoricalRun.workspace)
    expect(getAgentDefinition).toHaveBeenCalledTimes(2)
  })

  it('does not report a pending preparation failure after Studio unmounts', async () => {
    const pending = deferred<AgentDefinition>()
    getAgentDefinition.mockReturnValue(pending.promise)
    const view = await renderRunHistory()
    fireEvent.click(screen.getByRole('button', { name: 'Continue as new run…' }))

    view.unmount()
    await act(async () => pending.reject(new Error('Definition lookup finished after leaving Studio')))

    expect(toast.error).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
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

  it('saves a same-name new agent separately and keeps its identifier on later edits', async () => {
    definitionState.value.definitions = [
      firstAgent,
      { ...firstAgent, id: `${firstAgent.id}-2` },
    ]
    definitionState.value.save.mockImplementation(async (value) => value)
    render(<AgentStudioPage />)
    await screen.findByDisplayValue(firstAgent.name)
    fireEvent.click(screen.getByTitle('New agent'))
    await screen.findByDisplayValue(editableDraft.name)
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: firstAgent.name } })
    fireEvent.change(screen.getByLabelText('Agent role and operating instructions'), {
      target: { value: 'A separate task for a separate agent.' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save definition' }))

    await waitFor(() => expect(screen.getByLabelText('Identifier')).toHaveValue('review-assistant-3'))
    expect(definitionState.value.save).toHaveBeenLastCalledWith(expect.objectContaining({
      id: 'review-assistant-3',
      instructions: 'A separate task for a separate agent.',
    }))
    expect(definitionState.value.definitions[0]).toEqual(firstAgent)

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Renamed agent' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save definition' }))
    await waitFor(() => expect(definitionState.value.save).toHaveBeenCalledTimes(2))
    expect(definitionState.value.save).toHaveBeenLastCalledWith(expect.objectContaining({
      id: 'review-assistant-3', name: 'Renamed agent',
    }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Delete', exact: true })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: 'Delete', exact: true }))
    expect(definitionState.value.remove).toHaveBeenCalledExactlyOnceWith('review-assistant-3')
  })

  it.each(['new', 'existing'] as const)(
    'keeps a hyphenated identifier while typing a %s draft and normalizes it on blur', async (source) => {
      const user = userEvent.setup()
      definitionState.value.save.mockImplementation(async (definition) => definition)
      await renderSavedAgents()
      const savedDefinitions = structuredClone(definitionState.value.definitions)
      if (source === 'new') {
        await user.click(screen.getByTitle('New agent'))
        await screen.findByDisplayValue(editableDraft.name)
      }

      const identifier = screen.getByLabelText('Identifier')
      await user.clear(identifier)
      await user.type(identifier, 'keyboard-helper')
      expect(identifier).toHaveValue('keyboard-helper')
      expect(identifier).toHaveFocus()
      expect(screen.getByLabelText('Identifier')).toBe(identifier)

      await user.type(identifier, '-')
      expect(identifier).toHaveValue('keyboard-helper-')
      expect(identifier).toHaveFocus()
      await user.tab()
      expect(identifier).toHaveValue('keyboard-helper')
      expect(identifier).not.toHaveFocus()
      await user.click(screen.getByRole('button', { name: 'Save definition' }))

      await waitFor(() => expect(definitionState.value.save).toHaveBeenCalledExactlyOnceWith({
        ...(source === 'new' ? editableDraft : firstAgent),
        id: 'keyboard-helper',
      }))
      expect(screen.getByLabelText('Identifier')).toHaveValue('keyboard-helper')
      expect(definitionState.value.definitions).toEqual(savedDefinitions)
      expect(definitionState.value.remove).not.toHaveBeenCalled()
    }
  )

  it.each(['new', 'template'] as const)(
    'rejects a saved identifier in a %s draft and discards without deleting the saved agent', async (source) => {
      listAgentTemplates.mockResolvedValue([{
        id: 'review-template',
        name: 'Review template',
        description: 'Start a separate review agent.',
        definition: firstAgent,
      }])
      await renderSavedAgents()
      if (source === 'new') {
        fireEvent.click(screen.getByTitle('New agent'))
        await screen.findByDisplayValue(editableDraft.name)
      } else {
        fireEvent.click(screen.getByRole('button', { name: 'Templates', exact: true }))
        fireEvent.click(await screen.findByRole('button', { name: 'Use template' }))
        await screen.findByDisplayValue(`${firstAgent.name} Copy`)
      }
      fireEvent.change(screen.getByLabelText('Identifier'), {
        target: { value: firstAgent.id },
      })

      expect(screen.getByRole('button', { name: 'Discard' })).toBeEnabled()
      expect(screen.queryByRole('button', { name: 'Delete', exact: true })).not.toBeInTheDocument()
      fireEvent.click(screen.getByRole('button', { name: 'Save definition' }))
      fireEvent.click(screen.getByRole('button', { name: 'Save & run' }))

      expect(toast.error).toHaveBeenCalledTimes(2)
      expect(toast.error).toHaveBeenCalledWith(
        `An agent with identifier "${firstAgent.id}" already exists. Choose a different identifier.`
      )
      expect(definitionState.value.save).not.toHaveBeenCalled()
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      fireEvent.click(screen.getByRole('button', { name: 'Discard' }))
      await screen.findByDisplayValue(firstAgent.name)
      expect(definitionState.value.remove).not.toHaveBeenCalled()
      expect(definitionState.value.definitions).toEqual([firstAgent, secondAgent])
    }
  )

  it('rejects another saved identifier during an edit and still saves changes to the selected agent', async () => {
    definitionState.value.save.mockImplementation(async (definition) => definition)
    await renderSavedAgents()
    fireEvent.change(screen.getByLabelText('Name'), {
      target: { value: 'My edited review agent' },
    })
    fireEvent.change(screen.getByLabelText('Identifier'), {
      target: { value: secondAgent.id },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save definition' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save & run' }))

    expect(toast.error).toHaveBeenCalledTimes(2)
    expect(toast.error).toHaveBeenCalledWith(
      `An agent with identifier "${secondAgent.id}" already exists. Choose a different identifier.`
    )
    expect(definitionState.value.save).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(definitionState.value.remove).not.toHaveBeenCalled()
    expect(definitionState.value.definitions).toEqual([firstAgent, secondAgent])

    fireEvent.change(screen.getByLabelText('Identifier'), {
      target: { value: firstAgent.id },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save definition' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save definition' })).toBeEnabled())
    expect(definitionState.value.save).toHaveBeenCalledExactlyOnceWith({
      ...firstAgent,
      name: 'My edited review agent',
    })
  })

  it.each([secondAgent.id, ''])(
    'deletes only the selected saved agent after changing its identifier to %s', async (id) => {
      await renderSavedAgents()
      fireEvent.change(screen.getByLabelText('Identifier'), {
        target: { value: id },
      })
      fireEvent.click(screen.getByRole('button', { name: 'Delete', exact: true }))

      expect(definitionState.value.remove).toHaveBeenCalledExactlyOnceWith(firstAgent.id)
      expect(definitionState.value.save).not.toHaveBeenCalled()
      expect(definitionState.value.definitions[1]).toEqual(secondAgent)
      await waitFor(() => expect(screen.getByRole('button', { name: 'Delete', exact: true })).toBeEnabled())
    }
  )

  it.each([
    ['General', 'general-2'],
    ['旅行助手', 'agent'],
  ])('generates an available identifier for the name %s', async (name, id) => {
    definitionState.value.save.mockImplementation(async (value) => value)
    render(<AgentStudioPage />)
    fireEvent.click(screen.getByRole('button', { name: 'Create agent' }))
    fireEvent.change(await screen.findByLabelText('Name'), { target: { value: name } })
    fireEvent.click(screen.getByRole('button', { name: 'Save definition' }))

    await waitFor(() => expect(screen.getByLabelText('Identifier')).toHaveValue(id))
    expect(screen.getByLabelText('Name')).toHaveValue(name)
    expect(definitionState.value.save).toHaveBeenCalledWith(expect.objectContaining({ name, id }))
  })

  it('asks for a name before generating a new identifier', async () => {
    render(<AgentStudioPage />)
    fireEvent.click(screen.getByRole('button', { name: 'Create agent' }))
    fireEvent.change(await screen.findByLabelText('Name'), { target: { value: '   ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save definition' }))

    expect(definitionState.value.save).not.toHaveBeenCalled()
    expect(toast.error).toHaveBeenCalledWith('Give the agent a name before saving.')
    expect(screen.getByLabelText('Identifier')).toHaveValue('')
    expect(screen.getByRole('button', { name: 'Discard' })).toBeEnabled()
  })

  it('saves once while keeping newer edits when the reviewed save completes', async () => {
    const pending = deferred<AgentDefinition>()
    definitionState.value.save.mockReturnValue(pending.promise)
    await renderSavedAgents()

    const saveButton = screen.getByRole('button', { name: 'Save definition' })
    act(() => {
      fireEvent.click(saveButton)
      fireEvent.click(saveButton)
    })

    expect(definitionState.value.save).toHaveBeenCalledExactlyOnceWith(firstAgent)
    expect(screen.getByRole('button', { name: 'Saving…' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Save & run' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Delete', exact: true })).toBeDisabled()
    expect(screen.getByTitle('New agent')).toBeDisabled()
    expect(screen.getByLabelText('Name')).toBeEnabled()
    expect(screen.getByRole('button', { name: /Research assistant/ })).toBeEnabled()

    fireEvent.change(screen.getByLabelText('Name'), {
      target: { value: 'My newer agent name' },
    })
    fireEvent.change(screen.getByLabelText('Agent role and operating instructions'), {
      target: { value: 'My newer unsaved instructions.' },
    })
    await act(async () => pending.resolve(firstAgent))

    expect(screen.getByLabelText('Name')).toHaveValue('My newer agent name')
    expect(screen.getByLabelText('Agent role and operating instructions')).toHaveValue('My newer unsaved instructions.')
    expect(screen.getByRole('button', { name: 'Save definition' })).toBeEnabled()
    expect(definitionState.value.save).toHaveBeenCalledOnce()
  })

  it('keeps the newly selected agent when an earlier save completes', async () => {
    const pending = deferred<AgentDefinition>()
    definitionState.value.save.mockReturnValue(pending.promise)
    await renderSavedAgents()

    fireEvent.click(screen.getByRole('button', { name: 'Save definition' }))
    fireEvent.click(screen.getByRole('button', { name: /Research assistant/ }))
    expect(screen.getByLabelText('Name')).toHaveValue(secondAgent.name)

    await act(async () => pending.resolve(firstAgent))

    expect(screen.getByLabelText('Name')).toHaveValue(secondAgent.name)
    expect(screen.getByLabelText('Agent role and operating instructions')).toHaveValue(secondAgent.instructions)
    expect(definitionState.value.save).toHaveBeenCalledExactlyOnceWith(firstAgent)
  })

  it.each(['edit', 'select'] as const)(
    'keeps the newer draft after %s while deletion is pending', async (change) => {
      const pending = deferred<void>()
      definitionState.value.remove.mockReturnValue(pending.promise)
      await renderSavedAgents()

      const deleteButton = screen.getByRole('button', { name: 'Delete', exact: true })
      act(() => {
        fireEvent.click(deleteButton)
        fireEvent.click(deleteButton)
      })
      expect(definitionState.value.remove).toHaveBeenCalledExactlyOnceWith(firstAgent.id)
      expect(screen.getByRole('button', { name: 'Deleting…' })).toBeDisabled()
      expect(screen.getByRole('button', { name: 'Save definition' })).toBeDisabled()
      expect(screen.getByRole('button', { name: 'Save & run' })).toBeDisabled()
      expect(screen.getByTitle('New agent')).toBeDisabled()

      if (change === 'edit') {
        fireEvent.change(screen.getByLabelText('Name'), {
          target: { value: 'Keep my edited draft' },
        })
      } else {
        fireEvent.click(screen.getByRole('button', { name: /Research assistant/ }))
      }
      await act(async () => pending.resolve())

      expect(screen.getByLabelText('Name')).toHaveValue(
        change === 'edit' ? 'Keep my edited draft' : secondAgent.name
      )
      expect(screen.getByRole('button', { name: 'Save definition' })).toBeEnabled()
      expect(definitionState.value.remove).toHaveBeenCalledOnce()
    }
  )

  it('does not open run setup for an older draft after Save & run is double clicked', async () => {
    const pending = deferred<AgentDefinition>()
    definitionState.value.save.mockReturnValue(pending.promise)
    await renderSavedAgents()

    const runButton = screen.getByRole('button', { name: 'Save & run' })
    act(() => {
      fireEvent.click(runButton)
      fireEvent.click(runButton)
    })
    expect(definitionState.value.save).toHaveBeenCalledExactlyOnceWith(firstAgent)
    expect(runButton).toBeDisabled()
    fireEvent.change(screen.getByLabelText('Name'), {
      target: { value: 'A different run draft' },
    })

    await act(async () => pending.resolve(firstAgent))

    expect(screen.getByLabelText('Name')).toHaveValue('A different run draft')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Task or goal')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save & run' })).toBeEnabled()
    expect(definitionState.value.save).toHaveBeenCalledOnce()
  })

  it('retains the edited draft after a failed save and retries the latest values', async () => {
    const pending = deferred<AgentDefinition>()
    definitionState.value.save
      .mockReturnValueOnce(pending.promise)
      .mockImplementationOnce(async (definition) => definition)
    await renderSavedAgents()
    fireEvent.change(screen.getByLabelText('Name'), {
      target: { value: 'Reviewed name to retry' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save definition' }))

    await act(async () => pending.reject(new Error('Saving is unavailable')))

    expect(screen.getByLabelText('Name')).toHaveValue('Reviewed name to retry')
    expect(screen.getByRole('button', { name: 'Save definition' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Save & run' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Delete', exact: true })).toBeEnabled()
    expect(screen.getByTitle('New agent')).toBeEnabled()
    fireEvent.change(screen.getByLabelText('Name'), {
      target: { value: 'Latest retry name' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save definition' }))

    await waitFor(() => expect(screen.getByRole('button', { name: 'Save definition' })).toBeEnabled())
    expect(definitionState.value.save).toHaveBeenCalledTimes(2)
    expect(definitionState.value.save).toHaveBeenLastCalledWith(expect.objectContaining({
      id: firstAgent.id,
      name: 'Latest retry name',
    }))
    expect(screen.getByLabelText('Name')).toHaveValue('Latest retry name')
  })

  it('creates once without replacing an agent selected while creation is pending', async () => {
    const pending = deferred<AgentDefinition>()
    definitionState.value.createDraft.mockReturnValue(pending.promise)
    await renderSavedAgents()

    const createButton = screen.getByTitle('New agent')
    act(() => {
      fireEvent.click(createButton)
      fireEvent.click(createButton)
    })
    expect(definitionState.value.createDraft).toHaveBeenCalledOnce()
    expect(createButton).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Save definition' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Save & run' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Delete', exact: true })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: /Research assistant/ }))

    await act(async () => pending.resolve(editableDraft))

    expect(screen.getByLabelText('Name')).toHaveValue(secondAgent.name)
    expect(screen.getByLabelText('Agent role and operating instructions')).toHaveValue(secondAgent.instructions)
    expect(screen.getByTitle('New agent')).toBeEnabled()
    expect(definitionState.value.createDraft).toHaveBeenCalledOnce()
  })

  it('assigns the default agent to a loaded model instance', async () => {
    render(<AgentStudioPage />)
    fireEvent.click(screen.getByRole('button', { name: 'Create agent' }))

    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'Default model instance' }))
    await user.click(screen.getByRole('menuitemradio', { name: 'muse · port 8124' }))

    expect(screen.getByRole('button', { name: 'Default model instance' })).toHaveTextContent('muse · port 8124')
  })

  it('preserves and saves the default goal when changing composition', async () => {
    definitionState.value.save.mockImplementation(async (value) => value)
    render(<AgentStudioPage />)
    fireEvent.click(screen.getByRole('button', { name: 'Create agent' }))
    fireEvent.change(await screen.findByLabelText('Default goal'), {
      target: { value: 'Run existing performance tests and report timings.' },
    })
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Write, edit, or delete files' }))
    await user.click(screen.getByRole('menuitemradio', { name: 'Block' }))
    await user.click(screen.getByRole('button', { name: 'Run shell commands' }))
    await user.click(screen.getByRole('menuitemradio', { name: 'Ask every time' }))
    fireEvent.click(screen.getByRole('button', { name: /Goal Loop/i }))
    expect(screen.getByLabelText('Default goal')).toHaveValue('Run existing performance tests and report timings.')
    fireEvent.click(screen.getByRole('button', { name: 'Save definition' }))
    await waitFor(() => expect(definitionState.value.save).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'goal_loop', defaultGoal: 'Run existing performance tests and report timings.', permissions: { fileWrite: 'deny', shell: 'ask' } })
    ))
  })

  it('keeps required tool steps empty while editing and saves typed steps before blur', async () => {
    definitionState.value.save.mockImplementation(async (value) => value)
    await renderSavedAgents()
    const user = userEvent.setup()
    const steps = screen.getByLabelText('Maximum tool steps')

    await user.clear(steps)
    expect(steps).toHaveProperty('value', '')
    await user.type(steps, '12')
    expect(steps).toHaveProperty('value', '12')
    expect(steps).toHaveFocus()
    fireEvent.click(screen.getByRole('button', { name: 'Save definition' }))

    await waitFor(() => expect(definitionState.value.save).toHaveBeenCalledWith(
      expect.objectContaining({ id: firstAgent.id, maxSteps: 12 })
    ))
    fireEvent.blur(steps)
    expect(steps).toHaveProperty('value', '12')
  })

  it('normalizes typed Goal Loop limits on blur and saves numeric values', async () => {
    definitionState.value.save.mockImplementation(async (value) => value)
    definitionState.value.definitions = [{
      ...firstAgent,
      kind: 'goal_loop',
      maxCycles: 3,
      successCriteria: 'A verified answer.',
      evaluatorInstructions: 'Check the answer.',
      evaluatorModelInstanceId: null,
      evaluatorReasoningEffort: null,
    }]
    render(<AgentStudioPage />)
    const cycles = await screen.findByLabelText('Maximum cycles')
    const steps = screen.getByLabelText('Maximum tool steps per cycle')
    const user = userEvent.setup()

    await user.clear(cycles)
    expect(cycles).toHaveProperty('value', '')
    // userEvent canonicalizes leading zeroes on number inputs; native editing keeps them.
    fireEvent.change(cycles, { target: { value: '04' } })
    expect(cycles).toHaveProperty('value', '04')
    fireEvent.blur(cycles)
    expect(cycles).toHaveProperty('value', '4')
    await user.clear(steps)
    expect(steps).toHaveProperty('value', '')
    await user.type(steps, '12')
    expect(steps).toHaveProperty('value', '12')
    fireEvent.click(screen.getByRole('button', { name: 'Save definition' }))

    await waitFor(() => expect(definitionState.value.save).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'goal_loop', maxCycles: 4, maxSteps: 12 })
    ))
    await user.clear(cycles)
    expect(cycles).toHaveProperty('value', '')
    fireEvent.blur(cycles)
    expect(cycles).toHaveProperty('value', '0')
  })

  it.each(['workflow', 'coordinator'] as const)(
    'keeps %s role-step edits empty until typed and saves numeric limits',
    async (kind) => {
      const role = {
        id: 'research', name: 'Research', instructions: 'Research the request.',
        skills: [], maxSteps: 12, modelInstanceId: null, reasoningEffort: null,
      }
      const definition: AgentDefinition = kind === 'workflow'
        ? {
            ...firstAgent, kind, nodes: [{ ...role, workspace: 'shared' }], edges: [],
          }
        : {
            ...firstAgent, kind, maxParallel: 1,
            coordinatorInstructions: 'Plan the work.',
            synthesisInstructions: 'Combine the findings.',
            synthesisModelInstanceId: null, synthesisReasoningEffort: null,
            workers: [role, { ...role, id: 'review', name: 'Review', maxSteps: 20 }],
          }
      definitionState.value.save.mockImplementation(async (value) => value)
      definitionState.value.definitions = [definition]
      render(<AgentStudioPage />)
      await screen.findByDisplayValue(firstAgent.name)
      const user = userEvent.setup()

      if (kind === 'coordinator') {
        const parallel = screen.getByLabelText('Maximum parallel workers')
        await user.clear(parallel)
        expect(parallel).toHaveProperty('value', '')
        fireEvent.change(parallel, { target: { value: '02' } })
        expect(parallel).toHaveProperty('value', '02')
        fireEvent.blur(parallel)
        expect(parallel).toHaveProperty('value', '2')
      }
      const steps = screen.getAllByLabelText('Maximum tool steps')[0]
      await user.clear(steps)
      expect(steps).toHaveProperty('value', '')
      fireEvent.change(steps, { target: { value: '09' } })
      expect(steps).toHaveProperty('value', '09')
      expect(steps).toHaveFocus()
      fireEvent.click(screen.getByRole('button', { name: 'Save definition' }))

      await waitFor(() => expect(definitionState.value.save).toHaveBeenCalledWith(
        expect.objectContaining(kind === 'workflow'
          ? { kind, nodes: [expect.objectContaining({ id: role.id, maxSteps: 9 })] }
          : {
              kind, maxParallel: 2,
              workers: [
                expect.objectContaining({ id: role.id, maxSteps: 9 }),
                expect.objectContaining({ id: 'review', maxSteps: 20 }),
              ],
            })
      ))
      fireEvent.blur(steps)
      expect(steps).toHaveProperty('value', '9')
      if (kind === 'coordinator') {
        const parallel = screen.getByLabelText('Maximum parallel workers')
        await user.clear(parallel)
        fireEvent.change(parallel, { target: { value: '02' } })
        expect(parallel).toHaveProperty('value', '02')
        fireEvent.click(screen.getAllByTitle('Remove specialist')[1])
        expect(parallel).toHaveProperty('value', '1')
      }
    }
  )

  it('resets temporary numeric text when selecting another saved agent with the same limit', async () => {
    definitionState.value.definitions = [firstAgent, { ...secondAgent, maxSteps: 12 }]
    render(<AgentStudioPage />)
    await screen.findByDisplayValue(firstAgent.name)
    const user = userEvent.setup()
    const steps = screen.getByLabelText('Maximum tool steps')

    await user.clear(steps)
    fireEvent.change(steps, { target: { value: '012' } })
    expect(steps).toHaveProperty('value', '012')
    // Selection replaces the draft even if its numeric value has not changed.
    fireEvent.click(screen.getByRole('button', { name: /Research assistant/ }))
    expect(screen.getByLabelText('Maximum tool steps')).toHaveProperty('value', '12')
    fireEvent.click(screen.getByRole('button', { name: /Review assistant/ }))
    expect(screen.getByLabelText('Maximum tool steps')).toHaveProperty('value', '25')
  })

  it('saves a new coordinator with valid default parallelism and allows more specialists', async () => {
    definitionState.value.save.mockImplementation(async (value) => value)
    render(<AgentStudioPage />)
    fireEvent.click(screen.getByRole('button', { name: 'Create agent' }))
    await screen.findByLabelText('Name')
    fireEvent.click(screen.getByRole('button', { name: /Coordinator Team/i }))

    expect(screen.getByLabelText('Maximum parallel workers')).toHaveValue(1)
    expect(screen.getAllByLabelText('Specialist ID')).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: 'Save definition' }))

    await waitFor(() => expect(definitionState.value.save).toHaveBeenCalledOnce())
    expect(definitionState.value.save).toHaveBeenLastCalledWith(
      expect.objectContaining({
        kind: 'coordinator',
        maxParallel: 1,
        workers: [expect.objectContaining({ id: 'researcher' })],
      })
    )
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save definition' })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: 'Add specialist' }))
    fireEvent.change(screen.getByLabelText('Maximum parallel workers'), {
      target: { value: '2' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save definition' }))

    await waitFor(() => expect(definitionState.value.save).toHaveBeenCalledTimes(2))
    expect(definitionState.value.save).toHaveBeenLastCalledWith(
      expect.objectContaining({
        maxParallel: 2,
        workers: [
          expect.objectContaining({ id: 'researcher' }),
          expect.objectContaining({ id: 'specialist-2' }),
        ],
      })
    )
  })

  it.each([
    { kind: 'workflow', manualCollision: false },
    { kind: 'coordinator', manualCollision: false },
    { kind: 'workflow', manualCollision: true },
    { kind: 'coordinator', manualCollision: true },
  ] as const)('appends a unique $kind role after middle removal (manual collision: $manualCollision)', async ({ kind, manualCollision }) => {
    const prefix = kind === 'workflow' ? 'stage' : 'specialist'
    const label = kind === 'workflow' ? 'Stage ID' : 'Specialist ID'
    const roleName = kind === 'workflow' ? 'Stage' : 'Specialist'
    const role = (id: string, name: string) => ({
      id, name, instructions: `Preserve ${id} instructions.`, skills: [],
      maxSteps: 17, modelInstanceId: 'qwen', reasoningEffort: null,
    })
    const roles = [
      role(kind === 'workflow' ? 'deliver' : 'researcher', 'Original lead'),
      role(`${prefix}-2`, 'Removed middle'),
      role(`${prefix}-3`, 'Original third'),
    ]
    const definition: AgentDefinition = kind === 'workflow'
      ? {
        ...editableDraft, id: 'append-roles', name: 'Append roles workflow', kind,
        nodes: roles.map((node, index) => ({
          ...node, workspace: index === 0 ? 'shared' as const : 'isolated' as const,
        })),
        edges: [
          { from: 'stage-2', to: 'deliver' },
          { from: 'stage-3', to: 'deliver' },
        ],
      }
      : {
        ...editableDraft, id: 'append-roles', name: 'Append roles team', kind,
        workers: roles, maxParallel: 2,
        coordinatorInstructions: 'Plan', synthesisInstructions: 'Combine',
        synthesisModelInstanceId: null, synthesisReasoningEffort: null,
      }
    const originalRoles = definition.kind === 'workflow' ? definition.nodes : definition.workers
    definitionState.value.definitions = [definition]
    definitionState.value.save.mockImplementation(async (value) => value)
    render(<AgentStudioPage />)
    await screen.findByDisplayValue(definition.name)

    fireEvent.click(screen.getAllByTitle(`Remove ${prefix}`)[1])
    const firstId = manualCollision ? `${prefix}-4` : originalRoles[0].id
    if (manualCollision) {
      const firstIdentifier = screen.getAllByLabelText(label)[0]
      fireEvent.change(firstIdentifier, { target: { value: firstId } })
      fireEvent.blur(firstIdentifier)
    }
    fireEvent.click(screen.getByRole('button', { name: `Add ${prefix}` }))

    const next = manualCollision ? 5 : 4
    const appendedId = `${prefix}-${next}`
    expect(screen.getAllByLabelText(label).map((input) => (input as HTMLInputElement).value))
      .toEqual([firstId, `${prefix}-3`, appendedId])
    expect(screen.getAllByLabelText('Display name').map((input) => (input as HTMLInputElement).value))
      .toEqual(['Original lead', 'Original third', `${roleName} ${next}`])
    if (kind === 'workflow') {
      const dependencies = screen.getAllByLabelText('Depends on stage IDs')
      expect(dependencies[0]).toHaveValue('stage-3')
      expect(dependencies[1]).toHaveValue('')
      expect(dependencies[2]).toHaveValue('')
      fireEvent.change(dependencies[0], {
        target: { value: `stage-3, ${appendedId}` },
      })
    }
    fireEvent.click(screen.getByRole('button', { name: 'Save definition' }))

    await waitFor(() => expect(definitionState.value.save).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        kind,
        [kind === 'workflow' ? 'nodes' : 'workers']: [
          { ...originalRoles[0], id: firstId },
          originalRoles[2],
          expect.objectContaining({
            id: appendedId, name: `${roleName} ${next}`,
            ...(kind === 'workflow' ? { workspace: 'isolated' } : {}),
          }),
        ],
        ...(kind === 'workflow'
          ? { edges: [
            { from: 'stage-3', to: firstId },
            { from: appendedId, to: firstId },
          ] }
          : { maxParallel: 2 }),
      })
    ))
  })

  it.each([
    ['Off', 'none'], ['Minimal', 'minimal'], ['Low', 'low'], ['Medium', 'medium'],
    ['High', 'high'], ['Extra high', 'xhigh'], ['Maximum', 'max'], ['Model default', null],
  ] as const)('offers every GInfer reasoning effort and saves %s', async (label, value) => {
    definitionState.value.createDraft.mockResolvedValue({
      ...editableDraft,
      reasoningEffort: value === null ? 'max' : null,
    })
    definitionState.value.save.mockImplementation(async (definition) => definition)
    render(<AgentStudioPage />)
    fireEvent.click(screen.getByRole('button', { name: 'Create agent' }))

    const user = userEvent.setup()
    const selector = await screen.findByRole('button', { name: 'Default reasoning effort' })
    await user.click(selector)
    expect(screen.getAllByRole('menuitemradio').map((option) => option.textContent)).toEqual([
      'Model default', 'Off', 'Minimal', 'Low', 'Medium', 'High', 'Extra high', 'Maximum',
    ])
    await user.click(screen.getByRole('menuitemradio', { name: label }))
    expect(selector).toHaveTextContent(label)
    await user.click(screen.getByRole('button', { name: 'Save definition' }))
    await waitFor(() => expect(definitionState.value.save).toHaveBeenLastCalledWith(
      expect.objectContaining({ reasoningEffort: value })
    ))
  })

  it.each([
    ['Workflow', 'Stage ID', 'Add stage', 'Remove stage', 'nodes'],
    ['Coordinator Team', 'Specialist ID', 'Add specialist', 'Remove specialist', 'workers'],
  ] as const)('keeps %s role IDs focused while typing and after removing a role', async (composition, label, add, remove, collection) => {
    definitionState.value.save.mockImplementation(async (value) => value)
    render(<AgentStudioPage />)
    fireEvent.click(screen.getByRole('button', { name: 'Create agent' }))
    await screen.findByLabelText('Name')
    fireEvent.click(screen.getByRole('button', { name: new RegExp(composition) }))

    const identifier = screen.getByLabelText(label)
    identifier.focus()
    for (let length = 1; length <= 'risk-reviewer'.length; length++) {
      const value = 'risk-reviewer'.slice(0, length)
      fireEvent.change(identifier, { target: { value } })
      expect(screen.getByLabelText(label)).toBe(identifier)
      expect(identifier).toHaveFocus()
      expect(identifier).toHaveValue(value)
    }
    fireEvent.change(identifier, { target: { value: 'risk-reviewer-' } })
    expect(identifier).toHaveValue('risk-reviewer-')
    fireEvent.blur(identifier)
    expect(identifier).toHaveValue('risk-reviewer')

    fireEvent.click(screen.getByRole('button', { name: add }))
    fireEvent.change(screen.getAllByLabelText(label)[1], { target: { value: 'final-review' } })
    fireEvent.change(screen.getAllByLabelText('Display name')[1], { target: { value: 'Final Review' } })
    fireEvent.click(screen.getAllByTitle(remove)[0])
    const remaining = screen.getByLabelText(label)
    expect(remaining).toHaveValue('final-review')
    expect(screen.getByLabelText('Display name')).toHaveValue('Final Review')
    remaining.focus()
    fireEvent.change(remaining, { target: { value: 'final-reviewer' } })
    expect(remaining).toHaveFocus()
    fireEvent.blur(remaining)
    fireEvent.click(screen.getByRole('button', { name: 'Save definition' }))

    await waitFor(() => expect(definitionState.value.save).toHaveBeenCalledWith(
      expect.objectContaining({
        [collection]: [expect.objectContaining({ id: 'final-reviewer', name: 'Final Review' })],
      })
    ))
  })

  it('keeps workflow dependencies connected while typing a stage ID', async () => {
    definitionState.value.save.mockImplementation(async (value) => value)
    render(<AgentStudioPage />)
    fireEvent.click(screen.getByRole('button', { name: 'Create agent' }))
    await screen.findByLabelText('Name')
    fireEvent.click(screen.getByRole('button', { name: /Workflow/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Add stage' }))
    fireEvent.change(screen.getAllByLabelText('Depends on stage IDs')[1], {
      target: { value: 'deliver' },
    })

    const identifier = screen.getAllByLabelText('Stage ID')[0]
    identifier.focus()
    for (let length = 1; length <= 'review-stage'.length; length++) {
      const value = 'review-stage'.slice(0, length)
      fireEvent.change(identifier, { target: { value } })
      expect(identifier).toHaveFocus()
      expect(screen.getAllByLabelText('Depends on stage IDs')[1]).toHaveValue(value)
    }
    fireEvent.change(identifier, { target: { value: 'review-stage-' } })
    fireEvent.blur(identifier)
    expect(screen.getAllByLabelText('Depends on stage IDs')[1]).toHaveValue('review-stage')
    fireEvent.click(screen.getByRole('button', { name: 'Save definition' }))

    await waitFor(() => expect(definitionState.value.save).toHaveBeenCalledWith(
      expect.objectContaining({ edges: [{ from: 'review-stage', to: 'stage-2' }] })
    ))
  })

  it('retains dependency punctuation and focus while typing and saves both incoming edges', async () => {
    definitionState.value.save.mockImplementation(async (value) => value)
    const { dependencies, saveButton } = await renderThreeStageWorkflow()
    const text = 'deliver, stage-2'
    dependencies.focus()
    for (let length = 1; length <= text.length; length++) {
      const value = text.slice(0, length)
      fireEvent.change(dependencies, { target: { value } })
      expect(dependencies.isConnected).toBe(true)
      expect(dependencies).toHaveFocus()
      expect(dependencies).toHaveValue(value)
    }
    expect(screen.getAllByLabelText('Depends on stage IDs')[2]).toBe(dependencies)

    // Saving must use the current parsed edges even before a blur commits formatting.
    fireEvent.click(saveButton)
    const edges = [
      { from: 'deliver', to: 'stage-3' },
      { from: 'stage-2', to: 'stage-3' },
    ]
    await waitFor(() => expect(definitionState.value.save).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ kind: 'workflow', edges })
    ))
  })

  it('normalizes trailing dependency punctuation on blur without changing the saved edges', async () => {
    definitionState.value.save.mockImplementation(async (value) => value)
    const { dependencies, saveButton } = await renderThreeStageWorkflow()
    const text = 'deliver, stage-2'
    dependencies.focus()
    fireEvent.change(dependencies, { target: { value: `${text}-` } })
    expect(dependencies).toHaveValue(`${text}-`)
    expect(dependencies).toHaveFocus()
    fireEvent.blur(dependencies)
    expect(dependencies).toHaveValue(text)
    dependencies.focus()
    fireEvent.change(dependencies, { target: { value: `${text}, ` } })
    expect(dependencies).toHaveValue(`${text}, `)
    fireEvent.blur(dependencies)
    expect(dependencies).toHaveValue(text)
    fireEvent.click(saveButton)

    await waitFor(() => expect(definitionState.value.save).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ edges: [
        { from: 'deliver', to: 'stage-3' },
        { from: 'stage-2', to: 'stage-3' },
      ] })
    ))
  })

  it('refreshes dependency text after removing a stage and selecting another workflow', async () => {
    const role = {
      instructions: '', skills: [], maxSteps: 12,
      modelInstanceId: null, reasoningEffort: null,
    }
    const workflow: AgentDefinition = {
      ...editableDraft,
      id: 'first-dependency-workflow',
      name: 'First dependency workflow',
      kind: 'workflow',
      nodes: [
        { ...role, id: 'research', name: 'Research', workspace: 'isolated' },
        { ...role, id: 'review-stage', name: 'Review', workspace: 'isolated' },
        { ...role, id: 'deliver', name: 'Deliver', workspace: 'shared' },
      ],
      edges: [
        { from: 'research', to: 'deliver' },
        { from: 'review-stage', to: 'deliver' },
      ],
    }
    const otherWorkflow: AgentDefinition = {
      ...workflow,
      id: 'second-dependency-workflow',
      name: 'Second dependency workflow',
      edges: [{ from: 'research', to: 'deliver' }],
    }
    definitionState.value.definitions = [workflow, otherWorkflow]
    render(<AgentStudioPage />)
    await screen.findByDisplayValue(workflow.name)

    const dependencies = screen.getAllByLabelText('Depends on stage IDs')[2]
    dependencies.focus()
    fireEvent.change(dependencies, {
      target: { value: 'research, review-stage, ' },
    })
    expect(dependencies).toHaveValue('research, review-stage, ')
    fireEvent.blur(dependencies)
    fireEvent.click(screen.getAllByTitle('Remove stage')[0])

    expect(screen.getAllByLabelText('Stage ID').map((input) => (input as HTMLInputElement).value))
      .toEqual(['review-stage', 'deliver'])
    expect(screen.getAllByLabelText('Depends on stage IDs').map((input) => (input as HTMLInputElement).value))
      .toEqual(['', 'review-stage'])

    fireEvent.click(screen.getByRole('button', { name: /Second dependency workflow/ }))
    expect(screen.getAllByLabelText('Depends on stage IDs').map((input) => (input as HTMLInputElement).value))
      .toEqual(['', '', 'research'])
    fireEvent.click(screen.getByRole('button', { name: /First dependency workflow/ }))
    expect(screen.getAllByLabelText('Depends on stage IDs').map((input) => (input as HTMLInputElement).value))
      .toEqual(['', '', 'research, review-stage'])
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

    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'Synthesizer model instance' }))
    await user.click(screen.getByRole('menuitemradio', { name: 'muse · port 8124' }))
    await user.click(screen.getByRole('button', { name: 'Model instance' }))
    await user.click(screen.getByRole('menuitemradio', { name: 'qwen · port 8123' }))

    expect(screen.getByRole('button', { name: 'Synthesizer model instance' })).toHaveTextContent('muse · port 8124')
    expect(screen.getByRole('button', { name: 'Model instance' })).toHaveTextContent('qwen · port 8123')
  })
  it('ties every editor field label to its control', async () => {
    render(<AgentStudioPage />)
    fireEvent.click(screen.getByRole('button', { name: 'Create agent' }))

    const identifier = await screen.findByLabelText('Identifier')
    expect(identifier).toHaveAttribute('placeholder', 'created-from-name')
    expect(screen.getByLabelText('Description')).toBeInstanceOf(HTMLInputElement)
    const contract = screen.getByLabelText('Output contract')
    expect(contract).toBeInstanceOf(HTMLTextAreaElement)
    expect(contract).toHaveAccessibleDescription(/Optional/)
    expect(screen.getByLabelText('Name')).toBeInstanceOf(HTMLInputElement)
  })
})

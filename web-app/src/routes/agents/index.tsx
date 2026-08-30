import { useEffect, useState } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import {
  IconAlertTriangle,
  IconBolt,
  IconFileText,
  IconGitBranch,
  IconHistory,
  IconDotsVertical,
  IconPlayerPlay,
  IconPlus,
  IconRepeat,
  IconRefresh,
  IconTemplate,
  IconTrash,
  IconUsers,
} from '@tabler/icons-react'
import { toast } from 'sonner'
import HeaderPage from '@/containers/HeaderPage'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { TEMPORARY_CHAT_ID } from '@/constants/chat'
import { route } from '@/constants/routes'
import { useAgentDefinitions } from '@/hooks/useAgentDefinitions'
import { useAgentMode } from '@/hooks/useAgentMode'
import { useAgentSkills } from '@/hooks/useAgentSkills'
import {
  deleteAgentRun,
  listAgentModelInstances,
  listAgentRuns,
  listAgentTemplates,
} from '@/services/agent/definitions'
import type {
  AgentDefinition,
  AgentModelInstance,
  AgentReasoningEffort,
  AgentRole,
  AgentRunRecord,
  AgentStrategyKind,
  AgentTemplate,
  AgentWorkflowNode,
} from '@/types/agent'
import { cn } from '@/lib/utils'
import {
  aggregateAgentMetrics,
  formatTokensPerSecond,
} from '@/lib/agent-metrics'
import { resetAgentSession } from '@/services/agent/tauri'
import { useInitialMessage } from '@/hooks/useInitialMessage'
import { useMessages } from '@/hooks/useMessages'
import { useAgentRun } from '@/hooks/useAgentRun'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const Route = createFileRoute(route.agents.index as any)({
  component: AgentStudioPage,
})

type StudioView = 'definitions' | 'templates' | 'runs'

const KIND_META: Record<
  AgentStrategyKind,
  {
    label: string
    description: string
    explainer: string
    example: string
    icon: typeof IconBolt
  }
> = {
  standard: {
    label: 'Standard Agent',
    description: 'One autonomous role using the trusted tool loop.',
    explainer:
      'Use one agent when a single role can own the task from start to finish. It can inspect, use tools, iterate, and return a result without a separate review stage.',
    example:
      'A local research assistant that reads a folder of notes, compares the evidence, and produces a cited summary.',
    icon: IconBolt,
  },
  goal_loop: {
    label: 'Goal Loop',
    description: 'Execute, evaluate, and revise until the criteria pass.',
    explainer:
      'Use a goal loop when quality can be judged against explicit criteria and the first result may need revision. An executor does the work; an independent evaluator either passes it or sends concrete feedback into the next cycle.',
    example:
      'An implementation agent that edits code and runs tests, then revises until a reviewer confirms the feature and acceptance criteria are complete.',
    icon: IconRepeat,
  },
  coordinator: {
    label: 'Coordinator Team',
    description: 'Plan, dispatch bounded parallel specialists, then synthesize.',
    explainer:
      'Use a coordinator team when the task benefits from several distinct perspectives or independent workstreams. A planner assigns work, specialists run in parallel, and a synthesizer resolves their reports into one answer.',
    example:
      'A product investigation with separate market, technical, and risk specialists whose findings become one decision memo.',
    icon: IconUsers,
  },
  workflow: {
    label: 'Workflow',
    description: 'An explicit acyclic pipeline with parallel branches.',
    explainer:
      'Use a workflow when the stages and handoffs should be predictable every time. Dependencies control execution order; independent stages can run in parallel, and exactly one final stage produces the result.',
    example:
      'A repeatable analyze → implement → review → deliver pipeline, with implementation writing to the main workspace and review isolated from it.',
    icon: IconGitBranch,
  },
}

const EVALUATOR_MAX_STEPS = 6

const EDITOR_COPY: Record<
  AgentStrategyKind,
  {
    instructionsLabel: string
    instructionsHelp: string
    instructionsPlaceholder: string
    outputHelp: string
    outputPlaceholder: string
    skillsHelp: string
  }
> = {
  standard: {
    instructionsLabel: 'Agent role and operating instructions',
    instructionsHelp:
      'Define the agent’s job, preferred method, boundaries, and what it should verify before replying. Write durable behavior here; the user supplies the task when the run starts.',
    instructionsPlaceholder:
      'Example:\nYou are a careful local research assistant. Inspect the available sources before drawing conclusions. Cite the file or URL behind each material claim. Do not modify files. Before replying, check that every part of the user’s request is answered.',
    outputHelp:
      'Optional. Describe the exact shape or artifact a successful final reply must provide.',
    outputPlaceholder:
      'Example: Return a concise Markdown report with Summary, Findings, Sources, and Recommended next steps.',
    skillsHelp:
      'Skills add reusable instructions and tool knowledge to this agent. Select only capabilities it needs regularly; tools remain subject to the run’s approval policy.',
  },
  goal_loop: {
    instructionsLabel: 'Executor role and operating instructions',
    instructionsHelp:
      'Tell the executor how to produce and revise the result. Include its role, method, boundaries, and the checks it should perform before handing work to the evaluator. The evaluator is configured separately below.',
    instructionsPlaceholder:
      'Example:\nYou are an implementation agent. Inspect the existing code before editing, make the smallest coherent change that satisfies the goal, and run focused tests. When revising, address every evaluator finding. Return the changed files, verification result, and any remaining limitation.',
    outputHelp:
      'Define what the executor must hand to the evaluator on every cycle. Make it concrete enough to judge against the success criteria below.',
    outputPlaceholder:
      'Example: Return a completed implementation, a short changed-files summary, tests run with outcomes, and any known limitation.',
    skillsHelp:
      'These skills are available to the executor on every cycle. The evaluator receives the result and criteria but does not use executor skills.',
  },
  coordinator: {
    instructionsLabel: 'Final synthesizer role and operating instructions',
    instructionsHelp:
      'Define the judgment, boundaries, and quality bar used when combining specialist reports into the final result. Planning and each specialist have their own instructions below.',
    instructionsPlaceholder:
      'Example:\nAct as the senior owner of the final answer. Reconcile conflicting specialist claims, prefer directly supported evidence, identify unresolved uncertainty, and produce one cohesive response rather than concatenating reports.',
    outputHelp:
      'Define the final synthesized deliverable. Specialist reports use an internal report contract and are not shown directly as the final answer.',
    outputPlaceholder:
      'Example: Return one decision memo with Recommendation, Evidence, Risks, and an ordered Action plan.',
    skillsHelp:
      'Shared skills are available to the planner, every specialist, and the synthesizer. Each specialist can add role-specific skills in its card below.',
  },
  workflow: {
    instructionsLabel: 'Shared workflow instructions',
    instructionsHelp:
      'Define rules every stage must follow, such as evidence standards, file boundaries, or verification requirements. Put stage-specific ownership in each stage card below.',
    instructionsPlaceholder:
      'Example:\nUse the existing workspace as the source of truth. Preserve unrelated work. Every stage must pass forward concrete evidence, call out uncertainty, and verify any files it changes.',
    outputHelp:
      'Define the handoff shape used by every stage. The single final stage’s handoff becomes the user-visible result.',
    outputPlaceholder:
      'Example: Return Outcome, Evidence, Files changed, Verification, and Remaining risks. Use “None” when a section has no entries.',
    skillsHelp:
      'Shared skills are available to every workflow stage. Add stage-only skills inside a stage card when that capability should not be loaded everywhere.',
  },
}

function executionBudget(definition: AgentDefinition): {
  maxStages: number
  maxModelSteps: number
  formula: string
} {
  switch (definition.kind) {
    case 'standard':
      return {
        maxStages: 1,
        maxModelSteps: definition.maxSteps,
        formula: `${definition.maxSteps} decisions before a final reply is required`,
      }
    case 'goal_loop':
      return {
        maxStages: definition.maxCycles * 2,
        maxModelSteps:
          definition.maxCycles *
          (definition.maxSteps + EVALUATOR_MAX_STEPS),
        formula: `${definition.maxCycles} cycles × (${definition.maxSteps} executor + ${EVALUATOR_MAX_STEPS} evaluator)`,
      }
    case 'coordinator': {
      const plannerSteps = Math.min(definition.maxSteps, 8)
      const workerSteps = definition.workers.reduce(
        (total, worker) => total + worker.maxSteps,
        0
      )
      return {
        maxStages: definition.workers.length + 2,
        maxModelSteps: plannerSteps + workerSteps + definition.maxSteps,
        formula: `${plannerSteps} planner + ${workerSteps} worker + ${definition.maxSteps} synthesis`,
      }
    }
    case 'workflow': {
      const nodeSteps = definition.nodes.reduce(
        (total, node) => total + node.maxSteps,
        0
      )
      return {
        maxStages: definition.nodes.length,
        maxModelSteps: nodeSteps,
        formula: `${nodeSteps} across ${definition.nodes.length} configured stages`,
      }
    }
  }
}

function runStatusLabel(run: AgentRunRecord): string {
  if (
    run.finishReason === 'max_steps' ||
    run.stages.some((stage) => stage.status === 'max_steps')
  ) {
    return 'step limit reached'
  }
  if (run.finishReason === 'max_cycles') return 'revision limit reached'
  return run.status
}

function stageStatusLabel(status: string): string {
  if (status === 'reply') return 'completed'
  if (status === 'finish') return 'finished session'
  if (status === 'max_steps') return 'step limit reached'
  if (status === 'max_cycles') return 'revision limit reached'
  return status
}

function runStatusTone(run: AgentRunRecord): string {
  const label = runStatusLabel(run)
  if (label.includes('limit')) {
    return 'border-amber-500/30 bg-amber-500/10 text-amber-800 dark:text-amber-200'
  }
  if (run.status === 'failed') {
    return 'border-destructive/30 bg-destructive/10 text-destructive'
  }
  if (run.status === 'cancelled') {
    return 'border-muted-foreground/30 bg-muted text-muted-foreground'
  }
  return 'border-primary/25 bg-primary/10 text-primary'
}

function withKind(
  base: Omit<AgentDefinition, 'kind'>,
  kind: AgentStrategyKind
): AgentDefinition {
  switch (kind) {
    case 'standard':
      return { ...base, kind }
    case 'goal_loop':
      return {
        ...base,
        kind,
        maxCycles: 3,
        successCriteria:
          'The requested outcome is complete, correct, and directly usable.',
        evaluatorInstructions:
          'Evaluate the result against every success criterion. Return PASS only when all are met; otherwise return REVISE with concrete corrective feedback.',
        evaluatorModelInstanceId: null,
        evaluatorReasoningEffort: null,
      }
    case 'coordinator':
      return {
        ...base,
        kind,
        maxParallel: 2,
        coordinatorInstructions:
          'Decompose the goal into concise, non-overlapping assignments.',
        synthesisInstructions:
          'Reconcile the specialist reports and deliver one coherent result.',
        synthesisModelInstanceId: null,
        synthesisReasoningEffort: null,
        workers: [newRole('researcher', 'Researcher')],
      }
    case 'workflow':
      return {
        ...base,
        kind,
        nodes: [newNode('deliver', 'Deliver', 'shared')],
        edges: [],
      }
  }
}

function newRole(id: string, name: string): AgentRole {
  return {
    id,
    name,
    instructions: '',
    skills: [],
    maxSteps: 12,
    modelInstanceId: null,
    reasoningEffort: null,
  }
}

function newNode(
  id: string,
  name: string,
  workspace: 'isolated' | 'shared' = 'isolated'
): AgentWorkflowNode {
  return { ...newRole(id, name), workspace }
}

function cloneDefinition(definition: AgentDefinition): AgentDefinition {
  return structuredClone(definition)
}

function slug(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 52)
}

export function AgentStudioPage() {
  const navigate = useNavigate()
  const { definitions, loading, error, load, save, remove, createDraft } =
    useAgentDefinitions()
  const { skills } = useAgentSkills()
  const [view, setView] = useState<StudioView>('definitions')
  const [draft, setDraft] = useState<AgentDefinition | null>(null)
  const [templates, setTemplates] = useState<AgentTemplate[]>([])
  const [runs, setRuns] = useState<AgentRunRecord[]>([])
  const [modelInstances, setModelInstances] = useState<AgentModelInstance[]>([])
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [creating, setCreating] = useState(false)

  useEffect(() => {
    if (!draft && definitions.length > 0) {
      setDraft(cloneDefinition(definitions[0]))
    }
  }, [definitions, draft])

  useEffect(() => {
    void Promise.all([listAgentTemplates(), listAgentRuns()])
      .then(([nextTemplates, nextRuns]) => {
        setTemplates(nextTemplates)
        setRuns(nextRuns)
        setSelectedRunId((current) => current ?? nextRuns[0]?.id ?? null)
      })
      .catch((reason) => toast.error(String(reason)))
  }, [])

  useEffect(() => {
    if (view !== 'definitions') return
    void listAgentModelInstances()
      .then(setModelInstances)
      .catch((reason) => toast.error(`Could not refresh model instances: ${String(reason)}`))
  }, [view])

  const selectedRun = runs.find((run) => run.id === selectedRunId) ?? null

  const createAgent = async () => {
    setCreating(true)
    try {
      setDraft(await createDraft())
      setView('definitions')
    } catch (reason) {
      toast.error(String(reason))
    } finally {
      setCreating(false)
    }
  }

  const edit = (definition: AgentDefinition) => {
    setDraft(cloneDefinition(definition))
    setView('definitions')
  }

  const startFrom = (definition: AgentDefinition) => {
    const copy = cloneDefinition(definition)
    copy.builtIn = false
    copy.id = ''
    copy.name = `${copy.name} Copy`
    setDraft(copy)
    setView('definitions')
  }

  const saveDraft = async (showToast = true): Promise<AgentDefinition | null> => {
    if (!draft) return null
    const candidate = {
      ...draft,
      id: draft.id || slug(draft.name),
      builtIn: false,
    }
    if (!candidate.id) {
      toast.error('Give the agent a name before saving.')
      return null
    }
    setSaving(true)
    try {
      const saved = await save(candidate)
      setDraft(cloneDefinition(saved))
      if (showToast) toast.success('Agent definition saved')
      return saved
    } catch (reason) {
      toast.error(String(reason))
      return null
    } finally {
      setSaving(false)
    }
  }

  const deleteDraft = async () => {
    if (!draft) return
    if (!draft.id) {
      setDraft(null)
      return
    }
    try {
      await remove(draft.id)
      setDraft(null)
      toast.success('Agent definition deleted')
    } catch (reason) {
      toast.error(String(reason))
    }
  }

  const tryInChat = async (definition: AgentDefinition) => {
    const saved = definition === draft ? await saveDraft(false) : definition
    if (!saved) return
    useAgentMode.getState().setSidebarMode('agent')
    useAgentMode.getState().setAgentMode(TEMPORARY_CHAT_ID, true)
    void navigate({
      to: route.home,
      search: { agentDefinition: saved.id },
    })
  }

  const rerun = async (run: AgentRunRecord) => {
    if (!run.userMessage.trim()) {
      toast.error('This older run does not contain a reusable task prompt.')
      return
    }
    try {
      await resetAgentSession(TEMPORARY_CHAT_ID)
      useMessages.getState().setMessages(TEMPORARY_CHAT_ID, [])
      useAgentRun.getState().clearRun(TEMPORARY_CHAT_ID)
      useAgentMode.getState().setSidebarMode('agent')
      useAgentMode.getState().setAgentMode(TEMPORARY_CHAT_ID, true)
      useInitialMessage.getState().set(TEMPORARY_CHAT_ID, {
        text: run.userMessage,
        agentDefinitionId: run.definitionId,
      })
      await navigate({
        to: route.threadsDetail,
        params: { threadId: TEMPORARY_CHAT_ID },
      })
    } catch (reason) {
      toast.error(`Could not re-run task: ${String(reason)}`)
    }
  }

  const deleteRun = async (run: AgentRunRecord) => {
    try {
      await deleteAgentRun(run.id)
      const remaining = runs.filter((candidate) => candidate.id !== run.id)
      setRuns(remaining)
      setSelectedRunId((current) =>
        current === run.id ? remaining[0]?.id ?? null : current
      )
      toast.success('Run deleted')
    } catch (reason) {
      toast.error(`Could not delete run: ${String(reason)}`)
    }
  }

  return (
    <div className="grid h-svh min-w-0 grid-rows-[auto_minmax(0,1fr)]">
      <HeaderPage>
        <div className="flex w-full items-center justify-between gap-3">
          <div>
            <div className="font-studio text-base font-semibold">
              Agent Studio
            </div>
            <div className="text-xs text-muted-foreground">
              Build agents, evaluative loops, coordinated teams, workflows,
              and reusable skills.
            </div>
          </div>
          <div className="flex items-center gap-1 rounded-lg border bg-muted/30 p-1">
            <StudioTab
              active={view === 'definitions'}
              onClick={() => setView('definitions')}
              icon={IconBolt}
              label="Agents & flows"
            />
            <StudioTab
              active={view === 'templates'}
              onClick={() => setView('templates')}
              icon={IconTemplate}
              label="Templates"
            />
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void navigate({ to: route.skills.index })}
            >
              <IconFileText className="size-4" />
              Skills
            </Button>
            <StudioTab
              active={view === 'runs'}
              onClick={() => {
                setView('runs')
                void listAgentRuns()
                  .then((nextRuns) => {
                    setRuns(nextRuns)
                    setSelectedRunId((current) => current ?? nextRuns[0]?.id ?? null)
                  })
                  .catch((reason) => toast.error(`Could not refresh runs: ${String(reason)}`))
              }}
              icon={IconHistory}
              label="Runs"
            />
          </div>
        </div>
      </HeaderPage>

      {view === 'definitions' && !draft && definitions.length === 0 ? (
        <div className="flex min-h-0 items-center justify-center">
          {!loading && !error && (
            <Button
              size="lg"
              disabled={creating}
              onClick={() => void createAgent()}
            >
              <IconPlus /> {creating ? 'Creating…' : 'Create agent'}
            </Button>
          )}
          {!loading && error && (
            <div className="text-center">
              <p className="text-sm text-destructive">{error}</p>
              <Button
                className="mt-3"
                variant="outline"
                onClick={() => void load()}
              >
                Retry
              </Button>
            </div>
          )}
        </div>
      ) : view === 'definitions' ? (
        <div className="grid min-h-0 grid-cols-[250px_minmax(360px,1fr)_280px] xl:grid-cols-[280px_minmax(420px,1fr)_300px]">
          <aside className="min-h-0 overflow-y-auto border-r p-3">
            <div className="mb-3 flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                Library
              </span>
              <Button
                size="icon-sm"
                variant="ghost"
                title="New agent"
                disabled={creating}
                onClick={() => void createAgent()}
              >
                <IconPlus />
              </Button>
            </div>
            {loading && (
              <p className="p-2 text-sm text-muted-foreground">Loading…</p>
            )}
            {error && <p className="p-2 text-sm text-destructive">{error}</p>}
            <div className="space-y-2">
              {definitions.map((definition) => {
                const meta = KIND_META[definition.kind]
                const KindIcon = meta.icon
                return (
                  <button
                    key={definition.id}
                    type="button"
                    className={cn(
                      'w-full rounded-xl border p-3 text-left transition hover:bg-accent/60',
                      draft?.id === definition.id && 'border-primary bg-accent'
                    )}
                    onClick={() => edit(definition)}
                  >
                    <div className="flex items-center gap-2">
                      <KindIcon className="size-4 text-primary" />
                      <span className="min-w-0 flex-1 truncate font-medium">
                        {definition.name}
                      </span>
                    </div>
                    <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                      {definition.description || meta.description}
                    </p>
                    <div className="mt-2 flex items-center gap-2 text-[10px] uppercase tracking-wider text-muted-foreground">
                      <span>{meta.label}</span>
                    </div>
                  </button>
                )
              })}
            </div>
          </aside>

          <main className="min-h-0 overflow-y-auto p-5">
            {draft ? (
              <DefinitionEditor
                draft={draft}
                modelInstances={modelInstances}
                skills={skills
                  .filter((skill) => skill.enabled && skill.compatible)
                  .map((skill) => skill.name)}
                onChange={setDraft}
              />
            ) : null}
          </main>

          <aside className="min-h-0 overflow-y-auto border-l bg-muted/15 p-4">
            {draft && (
              <DefinitionInspector
                draft={draft}
                saving={saving}
                onSave={() => void saveDraft()}
                onDelete={() => void deleteDraft()}
                onTry={() => void tryInChat(draft)}
                saved={definitions.some(
                  (definition) => definition.id === draft.id
                )}
              />
            )}
          </aside>
        </div>
      ) : null}

      {view === 'templates' && (
        <div className="min-h-0 overflow-y-auto p-6">
          <div className="mx-auto grid max-w-6xl gap-4 md:grid-cols-2 xl:grid-cols-3">
            {templates.map((template) => {
              const meta = KIND_META[template.definition.kind]
              const KindIcon = meta.icon
              return (
                <article
                  key={template.id}
                  className="flex min-h-56 flex-col rounded-2xl border bg-card p-5"
                >
                  <div className="mb-4 flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
                    <KindIcon />
                  </div>
                  <h2 className="font-studio text-lg font-semibold">
                    {template.name}
                  </h2>
                  <p className="mt-2 flex-1 text-sm text-muted-foreground">
                    {template.description}
                  </p>
                  <Button
                    className="mt-5"
                    onClick={() => startFrom(template.definition)}
                  >
                    Use template
                  </Button>
                </article>
              )
            })}
          </div>
        </div>
      )}

      {view === 'runs' && (
        <RunInspector
          runs={runs}
          selected={selectedRun}
          onSelect={setSelectedRunId}
          onRerun={(run) => void rerun(run)}
          onDelete={(run) => void deleteRun(run)}
          onRefresh={() => {
            void listAgentRuns()
              .then((nextRuns) => {
                setRuns(nextRuns)
                setSelectedRunId((current) =>
                  nextRuns.some((run) => run.id === current)
                    ? current
                    : nextRuns[0]?.id ?? null
                )
              })
              .catch((reason) => toast.error(`Could not refresh runs: ${String(reason)}`))
          }}
        />
      )}
    </div>
  )
}

function StudioTab({
  active,
  onClick,
  icon: Icon,
  label,
}: {
  active: boolean
  onClick: () => void
  icon: typeof IconBolt
  label: string
}) {
  return (
    <Button variant={active ? 'secondary' : 'ghost'} size="sm" onClick={onClick}>
      <Icon className="size-4" />
      {label}
    </Button>
  )
}

function DefinitionEditor({
  draft,
  skills,
  modelInstances,
  onChange,
}: {
  draft: AgentDefinition
  skills: string[]
  modelInstances: AgentModelInstance[]
  onChange: (definition: AgentDefinition) => void
}) {
  const common = (patch: Partial<AgentDefinition>) =>
    onChange({ ...draft, ...patch } as AgentDefinition)
  const copy = EDITOR_COPY[draft.kind]

  return (
    <div className="mx-auto max-w-4xl space-y-6 pb-10">
      <section>
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-primary">
          Definition
        </p>
        <div className="mt-2 grid gap-4 md:grid-cols-[1fr_0.8fr]">
          <Field label="Name">
            <Input
              value={draft.name}
              onChange={(event) => common({ name: event.target.value })}
            />
          </Field>
          <Field label="Identifier">
            <Input
              value={draft.id}
              placeholder="created-from-name"
              onChange={(event) => common({ id: slug(event.target.value) })}
            />
          </Field>
        </div>
        <Field label="Description" className="mt-4">
          <Input
            value={draft.description}
            onChange={(event) => common({ description: event.target.value })}
          />
        </Field>
      </section>

      <section>
        <Label className="mb-2 block">Composition</Label>
        <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
          {(Object.keys(KIND_META) as AgentStrategyKind[]).map((kind) => {
            const meta = KIND_META[kind]
            const KindIcon = meta.icon
            return (
              <button
                key={kind}
                type="button"
                className={cn(
                  'rounded-xl border p-3 text-left transition hover:bg-accent',
                  draft.kind === kind && 'border-primary bg-primary/5'
                )}
                onClick={() =>
                  onChange(
                    withKind(
                      {
                        schemaVersion: draft.schemaVersion,
                        id: draft.id,
                        name: draft.name,
                        description: draft.description,
                        instructions: draft.instructions,
                        skills: draft.skills,
                        maxSteps: draft.maxSteps,
                        outputContract: draft.outputContract,
                        modelInstanceId: draft.modelInstanceId,
                        reasoningEffort: draft.reasoningEffort,
                        builtIn: draft.builtIn,
                      },
                      kind
                    )
                  )
                }
              >
                <KindIcon className="mb-2 size-4 text-primary" />
                <div className="text-sm font-medium">{meta.label}</div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {meta.description}
                </div>
              </button>
            )
          })}
        </div>
        {(() => {
          const selected = KIND_META[draft.kind]
          const SelectedIcon = selected.icon
          return (
            <div className="mt-3 rounded-xl border border-primary/20 bg-primary/5 p-4">
              <div className="flex items-start gap-3">
                <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <SelectedIcon className="size-4" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground">
                    {selected.label}
                  </p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {selected.explainer}
                  </p>
                  <p className="mt-2 text-xs text-muted-foreground">
                    <span className="font-medium text-foreground">Example:</span>{' '}
                    {selected.example}
                  </p>
                </div>
              </div>
            </div>
          )
        })()}
      </section>

      <section>
        <div className="grid gap-4 md:grid-cols-2">
          <ModelInstanceSelect
            label="Default model instance"
            value={draft.modelInstanceId}
            instances={modelInstances}
            inheritLabel="Active chat model at run start"
            onChange={(modelInstanceId) => common({ modelInstanceId })}
          />
          <ReasoningEffortSelect
            label="Default reasoning effort"
            value={draft.reasoningEffort}
            inheritLabel="Model default"
            onChange={(reasoningEffort) => common({ reasoningEffort })}
          />
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          Every stage inherits this instance unless that role has an explicit
          override. Assigned instances must already be loaded when a run starts.
        </p>
      </section>

      <section className="grid gap-5">
        <Field label={copy.instructionsLabel} help={copy.instructionsHelp}>
          <Textarea
            rows={8}
            value={draft.instructions}
            placeholder={copy.instructionsPlaceholder}
            onChange={(event) => common({ instructions: event.target.value })}
          />
        </Field>
        {draft.kind !== 'workflow' ? (
          <div className="grid gap-3 md:grid-cols-[220px_1fr] md:items-start">
            <Field
              label={
                draft.kind === 'goal_loop'
                  ? 'Maximum tool steps per cycle'
                  : draft.kind === 'coordinator'
                    ? 'Maximum coordinator steps'
                    : 'Maximum tool steps'
              }
              help="Sets the maximum number of think → act → observe rounds before the role must return its answer. One round can run a batch of independent tools."
            >
              <Input
                type="number"
                min={1}
                max={25}
                value={draft.maxSteps}
                onChange={(event) =>
                  common({ maxSteps: Number(event.target.value) })
                }
              />
            </Field>
            <div className="rounded-xl border bg-muted/15 p-3 text-xs text-muted-foreground">
              <p className="font-medium text-foreground">How the limit behaves</p>
              <p className="mt-1">
                Finishing normally requires the role to call Reply. If it uses
                every step first, the run is preserved and marked incomplete so
                the trace can be inspected. Raise the limit for useful ongoing
                work; change the instructions when the role is repeating itself.
              </p>
            </div>
          </div>
        ) : (
          <div className="rounded-xl border bg-muted/15 p-3 text-xs text-muted-foreground">
            Workflow step limits are configured separately on each stage below,
            because different stages may need very different amounts of work.
          </div>
        )}
        <Field label="Output contract" help={copy.outputHelp}>
          <Textarea
            rows={4}
            value={draft.outputContract}
            placeholder={copy.outputPlaceholder}
            onChange={(event) => common({ outputContract: event.target.value })}
          />
        </Field>
        <SkillPicker
          available={skills}
          selected={draft.skills}
          onChange={(next) => common({ skills: next })}
          help={copy.skillsHelp}
        />
      </section>

      {draft.kind === 'standard' && <StandardAgentGuide draft={draft} />}

      {draft.kind === 'goal_loop' && (
        <GoalLoopEditor
          draft={draft}
          onChange={onChange}
          modelInstances={modelInstances}
        />
      )}
      {draft.kind === 'coordinator' && (
        <CoordinatorEditor
          draft={draft}
          onChange={onChange}
          skills={skills}
          modelInstances={modelInstances}
        />
      )}
      {draft.kind === 'workflow' && (
        <WorkflowEditor
          draft={draft}
          onChange={onChange}
          skills={skills}
          modelInstances={modelInstances}
        />
      )}
    </div>
  )
}

function StandardAgentGuide({ draft }: { draft: AgentDefinition }) {
  return (
    <section className="space-y-3 rounded-2xl border bg-muted/15 p-4">
      <SectionTitle
        title="Standard agent execution"
        body="One role owns the whole task. This is the simplest composition and the best place to start when no independent review or fixed handoff is required."
      />
      <div className="grid gap-2 text-xs sm:grid-cols-[1fr_auto_1fr_auto_1fr] sm:items-center">
        <GuideStep
          title="1. Receive the task"
          body="The user’s run prompt is combined with the role instructions above."
        />
        <GuideArrow />
        <GuideStep
          title="2. Work autonomously"
          body={`Reason, inspect, and use tools for up to ${draft.maxSteps} rounds.`}
        />
        <GuideArrow />
        <GuideStep
          title="3. Reply"
          body="Return one result that follows the output contract."
        />
      </div>
    </section>
  )
}

function GuideStep({ title, body }: { title: string; body: string }) {
  return (
    <div className="h-full rounded-lg border bg-background p-3">
      <p className="font-medium text-foreground">{title}</p>
      <p className="mt-1 text-muted-foreground">{body}</p>
    </div>
  )
}

function GuideArrow() {
  return <span className="hidden text-muted-foreground sm:block">→</span>
}

function GoalLoopEditor({
  draft,
  onChange,
  modelInstances,
}: {
  draft: Extract<AgentDefinition, { kind: 'goal_loop' }>
  onChange: (definition: AgentDefinition) => void
  modelInstances: AgentModelInstance[]
}) {
  return (
    <section className="space-y-4 rounded-2xl border bg-muted/15 p-4">
      <SectionTitle
        title="Evaluator loop"
        body="The executor produces the deliverable. A separate evaluator judges that result against explicit success criteria and either accepts it or sends focused feedback into the next cycle."
      />
      <div className="grid gap-2 text-xs sm:grid-cols-[1fr_auto_1fr_auto_1fr] sm:items-center">
        <GuideStep
          title="1. Execute"
          body={`Create or revise the result in up to ${draft.maxSteps} rounds.`}
        />
        <GuideArrow />
        <GuideStep
          title="2. Evaluate"
          body={`Return PASS or REVISE in up to ${EVALUATOR_MAX_STEPS} rounds.`}
        />
        <GuideArrow />
        <GuideStep
          title="3. Stop or revise"
          body={`PASS returns the result; REVISE starts the next of ${draft.maxCycles} cycles.`}
        />
      </div>
      <div className="grid gap-3 md:grid-cols-[220px_1fr] md:items-start">
        <Field
          label="Maximum cycles"
          help="One cycle is one executor result plus one evaluator decision."
        >
          <Input
            type="number"
            min={1}
            max={8}
            value={draft.maxCycles}
            onChange={(event) =>
              onChange({ ...draft, maxCycles: Number(event.target.value) })
            }
          />
        </Field>
        <div className="rounded-xl border bg-background p-3 text-xs text-muted-foreground">
          <p className="font-medium text-foreground">Choosing a cycle limit</p>
          <p className="mt-1">
            Start with 2–3 cycles for work that can be judged clearly. More
            cycles increase the worst-case runtime and are useful only when
            evaluator feedback is likely to produce meaningful improvement.
          </p>
        </div>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <ModelInstanceSelect
          label="Evaluator model instance"
          value={draft.evaluatorModelInstanceId}
          instances={modelInstances}
          inheritLabel="Agent default"
          onChange={(evaluatorModelInstanceId) =>
            onChange({ ...draft, evaluatorModelInstanceId })
          }
        />
        <ReasoningEffortSelect
          label="Evaluator reasoning effort"
          value={draft.evaluatorReasoningEffort}
          inheritLabel="Agent default"
          onChange={(evaluatorReasoningEffort) =>
            onChange({ ...draft, evaluatorReasoningEffort })
          }
        />
      </div>
      <p className="text-xs text-muted-foreground">
        The evaluator can use the same loaded model as the executor or a
        different registered instance. It evaluates the submitted result in an
        isolated stage and does not edit the executor’s workspace.
      </p>
      <Field
        label="Success criteria"
        help="List observable conditions that can be answered yes or no. Avoid vague goals such as “make it good”; describe what must be present, correct, and verified."
      >
        <Textarea
          rows={5}
          value={draft.successCriteria}
          placeholder={
            'Example:\n- The requested behavior is implemented.\n- Focused tests pass.\n- Existing supported behavior is not regressed.\n- The final response names changed files and verification results.'
          }
          onChange={(event) =>
            onChange({ ...draft, successCriteria: event.target.value })
          }
        />
      </Field>
      <Field
        label="Evaluator instructions"
        help="Tell the evaluator how to inspect the result and prioritize findings. GChat handles the PASS/REVISE response protocol; these instructions should define the review method and evidence bar."
      >
        <Textarea
          rows={6}
          value={draft.evaluatorInstructions}
          placeholder={
            'Example:\nReview the executor result against every success criterion. Check claimed files and test outcomes rather than accepting unsupported statements. Return PASS only if all criteria are satisfied. Otherwise identify the smallest concrete changes needed, ordered by severity.'
          }
          onChange={(event) =>
            onChange({ ...draft, evaluatorInstructions: event.target.value })
          }
        />
      </Field>
      <p className="rounded-lg border border-amber-500/25 bg-amber-500/10 p-3 text-xs text-amber-800 dark:text-amber-200">
        A step limit does not count as a result. The run stops as incomplete.
        If every cycle returns a result but none passes evaluation, the last
        result is preserved with a revision-limit status.
      </p>
    </section>
  )
}

function CoordinatorEditor({
  draft,
  onChange,
  skills,
  modelInstances,
}: {
  draft: Extract<AgentDefinition, { kind: 'coordinator' }>
  onChange: (definition: AgentDefinition) => void
  skills: string[]
  modelInstances: AgentModelInstance[]
}) {
  const updateWorker = (index: number, worker: AgentRole) =>
    onChange({
      ...draft,
      workers: draft.workers.map((current, candidate) =>
        candidate === index ? worker : current
      ),
    })

  return (
    <section className="space-y-4 rounded-2xl border bg-muted/15 p-4">
      <SectionTitle
        title="Coordinator team"
        body="A coordinator creates the plan, named specialists complete distinct assignments in isolated workspaces, and a synthesizer turns their reports into one final result."
      />
      <div className="grid gap-2 text-xs sm:grid-cols-[1fr_auto_1fr_auto_1fr] sm:items-center">
        <GuideStep
          title="1. Plan"
          body="Break the user goal into useful, non-overlapping assignments."
        />
        <GuideArrow />
        <GuideStep
          title="2. Investigate in parallel"
          body={`${draft.workers.length} specialists run with at most ${draft.maxParallel} active at once.`}
        />
        <GuideArrow />
        <GuideStep
          title="3. Synthesize"
          body="Reconcile the reports and write one answer in the main workspace."
        />
      </div>
      <Field
        label="Coordinator instructions"
        help="Explain how the planner should divide work among the specialist roles below. Ask for independent assignments with clear ownership; the planner does not complete the specialist work itself."
      >
        <Textarea
          rows={5}
          value={draft.coordinatorInstructions}
          placeholder={
            'Example:\nRead the goal and assign each specialist one distinct question that matches its role. Avoid duplicate research. Identify dependencies explicitly, and make every assignment narrow enough to finish independently.'
          }
          onChange={(event) =>
            onChange({
              ...draft,
              coordinatorInstructions: event.target.value,
            })
          }
        />
      </Field>
      <Field
        label="Synthesis instructions"
        help="Explain how the final stage should combine reports, resolve disagreements, and handle missing evidence. These instructions supplement the synthesizer role and output contract above."
      >
        <Textarea
          rows={5}
          value={draft.synthesisInstructions}
          placeholder={
            'Example:\nCompare the specialist reports, resolve conflicts using the strongest evidence, state any uncertainty that cannot be resolved, and produce one cohesive decision memo. Do not simply concatenate reports.'
          }
          onChange={(event) =>
            onChange({ ...draft, synthesisInstructions: event.target.value })
          }
        />
      </Field>
      <div className="grid gap-4 md:grid-cols-2">
        <ModelInstanceSelect
          label="Synthesizer model instance"
          value={draft.synthesisModelInstanceId}
          instances={modelInstances}
          inheritLabel="Agent default"
          onChange={(synthesisModelInstanceId) =>
            onChange({ ...draft, synthesisModelInstanceId })
          }
        />
        <ReasoningEffortSelect
          label="Synthesizer reasoning effort"
          value={draft.synthesisReasoningEffort}
          inheritLabel="Agent default"
          onChange={(synthesisReasoningEffort) =>
            onChange({ ...draft, synthesisReasoningEffort })
          }
        />
      </div>
      <p className="text-xs text-muted-foreground">
        The synthesizer can inherit the team default or use another loaded model
        instance and reasoning level. Specialists configure their own overrides
        below.
      </p>
      <div className="grid gap-3 md:grid-cols-[220px_1fr] md:items-start">
        <Field
          label="Maximum parallel workers"
          help="Limits how many specialist model instances can work at the same time."
        >
          <Input
            type="number"
            min={1}
            max={Math.max(1, draft.workers.length)}
            value={draft.maxParallel}
            onChange={(event) =>
              onChange({ ...draft, maxParallel: Number(event.target.value) })
            }
          />
        </Field>
        <div className="rounded-xl border bg-background p-3 text-xs text-muted-foreground">
          Set this to the number of specialists that may run concurrently, up
          to the worker count. Parallel roles should use different loaded model
          instances when one server instance cannot service both at the desired
          concurrency.
        </div>
      </div>
      <SectionTitle
        title="Specialist roles"
        body="Give each specialist one durable area of responsibility. The coordinator supplies the task-specific assignment at run time."
      />
      <div className="space-y-3">
        {draft.workers.map((worker, index) => (
          <RoleEditor
            key={`${worker.id}-${index}`}
            role={worker}
            roleKind="specialist"
            skills={skills}
            modelInstances={modelInstances}
            onChange={(next) => updateWorker(index, next)}
            onDelete={() =>
              onChange({
                ...draft,
                maxParallel: Math.min(
                  draft.maxParallel,
                  Math.max(1, draft.workers.length - 1)
                ),
                workers: draft.workers.filter((_, candidate) => candidate !== index),
              })
            }
          />
        ))}
      </div>
      <Button
        variant="outline"
        disabled={draft.workers.length >= 8}
        onClick={() => {
          const next = draft.workers.length + 1
          onChange({
            ...draft,
            workers: [
              ...draft.workers,
              newRole(`specialist-${next}`, `Specialist ${next}`),
            ],
          })
        }}
      >
        <IconPlus /> Add specialist
      </Button>
    </section>
  )
}

function WorkflowEditor({
  draft,
  onChange,
  skills,
  modelInstances,
}: {
  draft: Extract<AgentDefinition, { kind: 'workflow' }>
  onChange: (definition: AgentDefinition) => void
  skills: string[]
  modelInstances: AgentModelInstance[]
}) {
  const updateNode = (index: number, node: AgentWorkflowNode) => {
    const previousId = draft.nodes[index].id
    onChange({
      ...draft,
      nodes: draft.nodes.map((current, candidate) =>
        candidate === index ? node : current
      ),
      edges:
        previousId === node.id
          ? draft.edges
          : draft.edges.map((edge) => ({
              from: edge.from === previousId ? node.id : edge.from,
              to: edge.to === previousId ? node.id : edge.to,
            })),
    })
  }

  return (
    <section className="space-y-4 rounded-2xl border bg-muted/15 p-4">
      <SectionTitle
        title="Workflow graph"
        body="Define a repeatable set of stages and explicit handoffs. Stages with no dependency between them can run in parallel; exactly one final stage must receive the completed work."
      />
      <div className="grid gap-2 text-xs sm:grid-cols-[1fr_auto_1fr_auto_1fr] sm:items-center">
        <GuideStep
          title="1. Define stages"
          body="Give each stage one clear job, step budget, model, and workspace."
        />
        <GuideArrow />
        <GuideStep
          title="2. Connect handoffs"
          body="List the earlier stage IDs whose outputs a stage needs."
        />
        <GuideArrow />
        <GuideStep
          title="3. Finish once"
          body="One final stage combines the upstream handoffs into the result."
        />
      </div>
      <div className="rounded-xl border bg-background p-3 text-xs text-muted-foreground">
        <span className="font-medium text-foreground">Example:</span> an
        <span className="font-mono"> analyze</span> stage feeds
        <span className="font-mono"> implement</span>, which feeds
        <span className="font-mono"> review</span>, which feeds one shared
        <span className="font-mono"> deliver</span> stage. Two independent
        research stages could both feed the same final deliver stage and run in
        parallel.
      </div>
      <div className="space-y-3">
        {draft.nodes.map((node, index) => {
          const dependencies = draft.edges
            .filter((edge) => edge.to === node.id)
            .map((edge) => edge.from)
            .join(', ')
          return (
            <div key={`${node.id}-${index}`} className="rounded-xl border bg-background p-4">
              <RoleEditor
                role={node}
                roleKind="stage"
                skills={skills}
                modelInstances={modelInstances}
                onChange={(next) => updateNode(index, { ...node, ...next })}
                onDelete={() =>
                  onChange({
                    ...draft,
                    nodes: draft.nodes.filter((_, candidate) => candidate !== index),
                    edges: draft.edges.filter(
                      (edge) => edge.from !== node.id && edge.to !== node.id
                    ),
                  })
                }
              />
              <div className="mt-3 grid gap-3 md:grid-cols-2">
                <Field
                  label="Depends on stage IDs"
                  help="Comma-separate the IDs of stages that must finish before this one starts. Leave empty for an entry stage."
                >
                  <Input
                    value={dependencies}
                    placeholder="Example: research, review"
                    onChange={(event) => {
                      const from = event.target.value
                        .split(',')
                        .map(slug)
                        .filter(Boolean)
                      onChange({
                        ...draft,
                        edges: [
                          ...draft.edges.filter((edge) => edge.to !== node.id),
                          ...from.map((source) => ({ from: source, to: node.id })),
                        ],
                      })
                    }}
                  />
                </Field>
                <Field
                  label="Workspace"
                  help="Isolated stages can safely run in parallel and receive the source workspace read-only. A main-workspace stage can edit the user’s files and must be the only writer at its level."
                >
                  <select
                    className="h-9 w-full rounded-md border bg-background px-3 text-sm"
                    value={node.workspace}
                    onChange={(event) =>
                      updateNode(index, {
                        ...node,
                        workspace: event.target.value as 'isolated' | 'shared',
                      })
                    }
                  >
                    <option value="isolated">Isolated (parallel-safe)</option>
                    <option value="shared">Main workspace (single writer)</option>
                  </select>
                </Field>
              </div>
            </div>
          )
        })}
      </div>
      <Button
        variant="outline"
        disabled={draft.nodes.length >= 8}
        onClick={() => {
          const next = draft.nodes.length + 1
          onChange({
            ...draft,
            nodes: [
              ...draft.nodes,
              newNode(`stage-${next}`, `Stage ${next}`),
            ],
          })
        }}
      >
        <IconPlus /> Add stage
      </Button>
    </section>
  )
}

function RoleEditor({
  role,
  roleKind,
  skills,
  modelInstances,
  onChange,
  onDelete,
}: {
  role: AgentRole
  roleKind: 'specialist' | 'stage'
  skills: string[]
  modelInstances: AgentModelInstance[]
  onChange: (role: AgentRole) => void
  onDelete: () => void
}) {
  const isSpecialist = roleKind === 'specialist'
  return (
    <div className="rounded-xl border bg-background p-4">
      <div className="grid gap-3 md:grid-cols-[0.8fr_1fr_auto]">
        <Field
          label={`${isSpecialist ? 'Specialist' : 'Stage'} ID`}
          help={
            isSpecialist
              ? 'A short stable name the coordinator uses when assigning work.'
              : 'A short stable name used by dependency fields in other stages.'
          }
        >
          <Input
            value={role.id}
            placeholder={isSpecialist ? 'risk-reviewer' : 'analyze'}
            onChange={(event) => onChange({ ...role, id: slug(event.target.value) })}
          />
        </Field>
        <Field
          label="Display name"
          help="The human-readable role name shown in the live monitor and run history."
        >
          <Input
            value={role.name}
            placeholder={isSpecialist ? 'Risk Reviewer' : 'Analyze'}
            onChange={(event) => onChange({ ...role, name: event.target.value })}
          />
        </Field>
        <Button
          className="mt-6"
          size="icon-sm"
          variant="ghost"
          title={`Remove ${isSpecialist ? 'specialist' : 'stage'}`}
          onClick={onDelete}
        >
          <IconTrash />
        </Button>
      </div>
      <div className="mt-4 grid gap-3 md:grid-cols-[180px_1fr] md:items-start">
        <Field
          label="Maximum tool steps"
          help="The most think → act → observe rounds this role may use."
        >
          <Input
            type="number"
            min={1}
            max={25}
            value={role.maxSteps}
            onChange={(event) =>
              onChange({ ...role, maxSteps: Number(event.target.value) })
            }
          />
        </Field>
        <div className="rounded-xl border bg-muted/15 p-3 text-xs text-muted-foreground">
          Give a larger budget to roles that inspect many sources or perform
          several tool actions. If this role reaches the limit repeatedly,
          first check whether its instructions and ownership are specific
          enough.
        </div>
      </div>
      <Field
        label={`${isSpecialist ? 'Specialist' : 'Stage'} instructions`}
        help={
          isSpecialist
            ? 'Define this specialist’s enduring expertise and boundaries. The coordinator supplies a task-specific assignment at run time.'
            : 'Define exactly what this stage does with the user goal and any upstream handoffs, including what it must verify before replying.'
        }
        className="mt-4"
      >
        <Textarea
          rows={5}
          value={role.instructions}
          placeholder={
            isSpecialist
              ? 'Example:\nOwn technical-risk analysis. Challenge unsupported assumptions, inspect relevant implementation evidence, and return prioritized risks with severity, evidence, and a concrete mitigation. Do not duplicate the market or product analysis.'
              : 'Example:\nInspect the goal and upstream analysis, implement the approved changes in the main workspace, and run focused verification. Return changed files, test results, and any unresolved issue for the next stage.'
          }
          onChange={(event) => onChange({ ...role, instructions: event.target.value })}
        />
      </Field>
      <div className="grid gap-4 md:grid-cols-2">
        <ModelInstanceSelect
          label="Model instance"
          value={role.modelInstanceId}
          instances={modelInstances}
          inheritLabel="Agent default"
          onChange={(modelInstanceId) => onChange({ ...role, modelInstanceId })}
        />
        <ReasoningEffortSelect
          label="Reasoning effort"
          value={role.reasoningEffort}
          inheritLabel="Agent default"
          onChange={(reasoningEffort) => onChange({ ...role, reasoningEffort })}
        />
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        Keep the inherited defaults unless this role benefits from a different
        loaded model instance or a distinct reasoning budget.
      </p>
      <SkillPicker
        available={skills}
        selected={role.skills}
        onChange={(next) => onChange({ ...role, skills: next })}
        help={
          isSpecialist
            ? 'Role skills are added to the team-wide skills selected above.'
            : 'Stage skills are added to the workflow-wide skills selected above.'
        }
      />
    </div>
  )
}

function ModelInstanceSelect({
  label,
  value,
  instances,
  inheritLabel,
  onChange,
}: {
  label: string
  value: string | null
  instances: AgentModelInstance[]
  inheritLabel: string
  onChange: (value: string | null) => void
}) {
  const selectedIsUnavailable =
    value !== null && !instances.some((instance) => instance.id === value)
  return (
    <Field label={label} className="mt-3">
      <select
        aria-label={label}
        className="h-9 w-full rounded-md border bg-background px-3 text-sm"
        value={value ?? ''}
        onChange={(event) => onChange(event.target.value || null)}
      >
        <option value="">{inheritLabel}</option>
        {selectedIsUnavailable && (
          <option value={value ?? ''}>{value} (not loaded)</option>
        )}
        {instances.map((instance) => (
          <option key={instance.id} value={instance.id}>
            {instance.modelId} · port {instance.port}
          </option>
        ))}
      </select>
      {instances.length === 0 && (
        <p className="mt-1 text-xs text-muted-foreground">
          No GInfer model instances are loaded.
        </p>
      )}
    </Field>
  )
}

const REASONING_OPTIONS: Array<{
  value: AgentReasoningEffort
  label: string
}> = [
  { value: 'none', label: 'Off' },
  { value: 'minimal', label: 'Minimal' },
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'xhigh', label: 'Extra high' },
  { value: 'max', label: 'Maximum' },
]

function ReasoningEffortSelect({
  label,
  value,
  inheritLabel,
  onChange,
}: {
  label: string
  value: AgentReasoningEffort | null
  inheritLabel: string
  onChange: (value: AgentReasoningEffort | null) => void
}) {
  return (
    <Field label={label} className="mt-3">
      <select
        aria-label={label}
        className="h-9 w-full rounded-md border bg-background px-3 text-sm"
        value={value ?? ''}
        onChange={(event) =>
          onChange((event.target.value as AgentReasoningEffort) || null)
        }
      >
        <option value="">{inheritLabel}</option>
        {REASONING_OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </Field>
  )
}

function SkillPicker({
  available,
  selected,
  onChange,
  help,
}: {
  available: string[]
  selected: string[]
  onChange: (skills: string[]) => void
  help?: string
}) {
  return (
    <div className="mt-3">
      <Label className="mb-2 block">Skills</Label>
      {available.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          No enabled compatible skills. Author or enable them from the Skills tab.
        </p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {available.map((skill) => {
            const active = selected.includes(skill)
            return (
              <button
                key={skill}
                type="button"
                disabled={!active && selected.length >= 6}
                className={cn(
                  'rounded-full border px-3 py-1 text-xs transition',
                  active && 'border-primary bg-primary/10 text-primary'
                )}
                onClick={() =>
                  onChange(
                    active
                      ? selected.filter((candidate) => candidate !== skill)
                      : [...selected, skill]
                  )
                }
              >
                {skill}
              </button>
            )
          })}
        </div>
      )}
      {help && <p className="mt-2 text-xs text-muted-foreground">{help}</p>}
    </div>
  )
}

function DefinitionInspector({
  draft,
  saving,
  onSave,
  onDelete,
  onTry,
  saved,
}: {
  draft: AgentDefinition
  saving: boolean
  onSave: () => void
  onDelete: () => void
  onTry: () => void
  saved: boolean
}) {
  const meta = KIND_META[draft.kind]
  const budget = executionBudget(draft)
  const explicitModels = new Set<string>()
  if (draft.modelInstanceId) explicitModels.add(draft.modelInstanceId)
  if (draft.kind === 'goal_loop' && draft.evaluatorModelInstanceId) {
    explicitModels.add(draft.evaluatorModelInstanceId)
  }
  if (draft.kind === 'coordinator') {
    if (draft.synthesisModelInstanceId) {
      explicitModels.add(draft.synthesisModelInstanceId)
    }
    draft.workers.forEach((worker) => {
      if (worker.modelInstanceId) explicitModels.add(worker.modelInstanceId)
    })
  }
  if (draft.kind === 'workflow') {
    draft.nodes.forEach((node) => {
      if (node.modelInstanceId) explicitModels.add(node.modelInstanceId)
    })
  }
  return (
    <div className="space-y-5">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          Execution contract
        </p>
        <h2 className="mt-2 font-studio text-lg font-semibold">{meta.label}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{meta.description}</p>
      </div>
      <dl className="grid grid-cols-2 gap-3 text-sm">
        <Stat label="Maximum stages" value={String(budget.maxStages)} />
        <Stat label="Skills" value={String(draft.skills.length)} />
        <Stat label="Maximum model steps" value={String(budget.maxModelSteps)} />
        <Stat
          label="Model routing"
          value={explicitModels.size === 0 ? 'Active model' : `${explicitModels.size} fixed`}
        />
      </dl>
      <div className="rounded-xl border border-primary/20 bg-primary/5 p-3">
        <p className="text-xs font-medium text-foreground">Execution budget</p>
        <p className="mt-1 text-xs text-muted-foreground">{budget.formula}</p>
        <p className="mt-2 text-xs text-muted-foreground">
          A successful role ends with Reply. A step or revision limit preserves
          the run and any best available output, but marks it incomplete.
        </p>
      </div>
      <div className="rounded-xl border p-3 text-xs text-muted-foreground">
        The active chat model is the default unless this definition fixes one.
        Evaluators, workers, synthesizers, and workflow nodes can override it.
        Every assigned instance is validated before execution; cancellation and
        approval policy still cascade from the parent run.
      </div>
      <div className="grid gap-2">
        <Button disabled={!draft.name.trim()} onClick={onTry}>
          <IconPlayerPlay /> Save &amp; run
        </Button>
        <Button variant="outline" disabled={saving} onClick={onSave}>
          {saving ? 'Saving…' : 'Save definition'}
        </Button>
        <Button variant="ghost" className="text-destructive" onClick={onDelete}>
          <IconTrash /> {saved ? 'Delete' : 'Discard'}
        </Button>
      </div>
    </div>
  )
}

function RunInspector({
  runs,
  selected,
  onSelect,
  onRefresh,
  onRerun,
  onDelete,
}: {
  runs: AgentRunRecord[]
  selected: AgentRunRecord | null
  onSelect: (id: string) => void
  onRefresh: () => void
  onRerun: (run: AgentRunRecord) => void
  onDelete: (run: AgentRunRecord) => void
}) {
  const instanceMetrics = aggregateAgentMetrics(
    selected?.stages.map((stage) => ({
      modelInstanceId: stage.modelInstanceId,
      modelId: stage.modelId,
      inference: stage.inference,
    })) ?? []
  )
  const limitStage = selected?.stages.find(
    (stage) => stage.status === 'max_steps'
  )
  const finishReason =
    selected?.finishReason || (limitStage ? 'max_steps' : undefined)
  return (
    <div className="grid min-h-0 grid-cols-[340px_1fr]">
      <aside className="min-h-0 overflow-y-auto border-r p-3">
        <div className="mb-3 flex items-center justify-between px-1">
          <span className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Run history
          </span>
          <Button
            size="icon-sm"
            variant="ghost"
            title="Refresh runs"
            onClick={onRefresh}
          >
            <IconRefresh />
          </Button>
        </div>
        {runs.length === 0 && (
          <p className="p-3 text-sm text-muted-foreground">
            Completed Agent Studio runs will appear here.
          </p>
        )}
        <div className="space-y-2">
          {runs.map((run) => (
            <div
              key={run.id}
              className={cn(
                'flex w-full items-start rounded-xl border hover:bg-accent',
                selected?.id === run.id && 'border-primary bg-accent'
              )}
            >
              <button
                type="button"
                className="min-w-0 flex-1 p-3 text-left"
                onClick={() => onSelect(run.id)}
              >
                <div className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate font-medium">
                    {run.definitionName}
                  </span>
                  <span
                    className={cn(
                      'rounded-full border px-1.5 py-0.5 text-[9px] uppercase tracking-wide',
                      runStatusTone(run)
                    )}
                  >
                    {runStatusLabel(run)}
                  </span>
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {new Date(run.startedAtMs).toLocaleString()} · {run.totalSteps}{' '}
                  steps
                </div>
              </button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    className="m-1.5 shrink-0"
                    aria-label={`Actions for ${run.definitionName}`}
                  >
                    <IconDotsVertical />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem
                    disabled={!run.userMessage.trim()}
                    onSelect={() => onRerun(run)}
                  >
                    <IconRepeat /> Re-run
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    className="text-destructive focus:text-destructive"
                    onSelect={() => onDelete(run)}
                  >
                    <IconTrash /> Delete
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          ))}
        </div>
      </aside>
      <main className="min-h-0 overflow-y-auto p-6">
        {selected ? (
          <div className="mx-auto max-w-4xl space-y-5">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-primary">
                {KIND_META[selected.kind].label}
              </p>
              <h2 className="mt-1 font-studio text-2xl font-semibold">
                {selected.definitionName}
              </h2>
              <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                <span
                  className={cn(
                    'rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide',
                    runStatusTone(selected)
                  )}
                >
                  {runStatusLabel(selected)}
                </span>
                <span>{selected.totalSteps} model steps</span>
                <span>·</span>
                <span>
                  {Math.max(0, selected.finishedAtMs - selected.startedAtMs)} ms
                </span>
              </div>
              <p className="mt-1 font-mono text-xs text-muted-foreground">
                default: {selected.defaultModelInstanceId}
              </p>
            </div>
            {(finishReason === 'max_steps' || finishReason === 'max_cycles') && (
              <section className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4">
                <div className="flex items-start gap-3">
                  <IconAlertTriangle className="mt-0.5 size-5 shrink-0 text-amber-600 dark:text-amber-300" />
                  <div>
                    <h3 className="font-medium text-amber-900 dark:text-amber-100">
                      {finishReason === 'max_steps'
                        ? 'A stage used its full step budget'
                        : 'The loop used every revision cycle'}
                    </h3>
                    <p className="mt-1 text-sm text-amber-800 dark:text-amber-200">
                      {finishReason === 'max_steps'
                        ? `${limitStage?.name ?? 'The agent'} reached ${limitStage?.stepCount ?? selected.maxSteps ?? 'its configured'} model steps without returning a completed result. The run and trace were preserved so you can inspect where it stalled.`
                        : `The evaluator never returned PASS within ${selected.maxCycles ?? 'the configured'} cycles. The last executor result is preserved below as the best available output.`}
                    </p>
                  </div>
                </div>
              </section>
            )}
            {(selected.maxSteps || selected.maxCycles) && (
              <dl className="grid gap-3 text-sm sm:grid-cols-3">
                <Stat
                  label="Primary step limit"
                  value={selected.maxSteps ? String(selected.maxSteps) : 'Legacy run'}
                />
                <Stat
                  label="Cycle limit"
                  value={selected.maxCycles ? String(selected.maxCycles) : 'Not applicable'}
                />
                <Stat label="Steps used" value={String(selected.totalSteps)} />
              </dl>
            )}
            {instanceMetrics.length > 0 && (
              <section>
                <h3 className="mb-2 font-medium">Model-instance throughput</h3>
                <div className="grid gap-3 sm:grid-cols-2">
                  {instanceMetrics.map((metrics) => (
                    <article
                      key={metrics.modelInstanceId}
                      className="rounded-xl border bg-muted/10 p-4"
                    >
                      <p className="truncate font-mono text-xs" title={metrics.modelInstanceId}>
                        {metrics.modelInstanceId}
                      </p>
                      <div className="mt-3 grid grid-cols-2 gap-3">
                        <Metric
                          label="Generation t/s"
                          value={formatTokensPerSecond(
                            metrics.generatedTokens,
                            metrics.generationMs
                          )}
                        />
                        <Metric
                          label="Prompt t/s"
                          value={formatTokensPerSecond(
                            metrics.promptTokens,
                            metrics.promptMs
                          )}
                        />
                      </div>
                      <p className="mt-3 text-[11px] text-muted-foreground">
                        {metrics.stageCount}{' '}
                        {metrics.stageCount === 1 ? 'stage' : 'stages'} ·{' '}
                        {metrics.generatedTokens.toFixed(0)} generated ·{' '}
                        {metrics.promptTokens.toFixed(0)} prefilled
                      </p>
                    </article>
                  ))}
                </div>
                <p className="mt-2 text-[11px] text-muted-foreground">
                  Rates use GInfer engine timing and are aggregated by registered
                  model instance.
                </p>
              </section>
            )}
            {selected.stages.length > 0 && (
              <section className="space-y-2">
                <h3 className="font-medium">Stage trace</h3>
                {selected.stages.map((stage) => (
                  <article key={stage.stageId} className="rounded-xl border p-4">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{stage.name}</span>
                      <span className="rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                        {stageStatusLabel(stage.status)}
                      </span>
                      <span className="ml-auto text-xs text-muted-foreground">
                        {stage.stepCount} steps · {stage.durationMs} ms
                      </span>
                    </div>
                    <p className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">
                      {stage.summary}
                    </p>
                    <p className="mt-2 font-mono text-[11px] text-muted-foreground">
                      {stage.modelInstanceId}
                      {stage.reasoningEffort
                        ? ` · reasoning ${stage.reasoningEffort}`
                        : ' · model-default reasoning'}
                    </p>
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      Generation{' '}
                      {formatTokensPerSecond(
                        stage.inference.generatedTokens,
                        stage.inference.generationMs
                      )}{' '}
                      t/s · Prompt{' '}
                      {formatTokensPerSecond(
                        stage.inference.promptTokens,
                        stage.inference.promptMs
                      )}{' '}
                      t/s
                    </p>
                  </article>
                ))}
              </section>
            )}
            <section>
              <h3 className="mb-2 font-medium">
                {finishReason === 'max_cycles'
                  ? 'Best available output'
                  : finishReason === 'max_steps'
                    ? 'Terminal message'
                    : 'Final output'}
              </h3>
              <pre className="whitespace-pre-wrap rounded-xl border bg-muted/20 p-4 font-sans text-sm">
                {selected.finalReply || 'No output was returned.'}
              </pre>
            </section>
          </div>
        ) : (
          <EmptyPanel
            title="No run selected"
            body="Run an Agent Studio definition to inspect its stages and result."
          />
        )}
      </main>
    </div>
  )
}

function Field({
  label,
  help,
  children,
  className,
}: {
  label: string
  help?: React.ReactNode
  children: React.ReactNode
  className?: string
}) {
  return (
    <div className={className}>
      <Label className="mb-1.5 block">{label}</Label>
      {help && (
        <div className="mb-2 text-xs leading-relaxed text-muted-foreground">
          {help}
        </div>
      )}
      {children}
    </div>
  )
}

function SectionTitle({ title, body }: { title: string; body: string }) {
  return (
    <div>
      <h2 className="font-studio text-base font-semibold">{title}</h2>
      <p className="mt-1 text-xs text-muted-foreground">{body}</p>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border bg-background p-3">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-1 font-medium">{value}</dd>
    </div>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="font-studio text-xl font-semibold text-foreground">
        {value}
      </div>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
    </div>
  )
}

function EmptyPanel({
  title,
  body,
  action,
  onAction,
}: {
  title: string
  body: string
  action?: string
  onAction?: () => void
}) {
  return (
    <div className="flex min-h-80 items-center justify-center">
      <div className="max-w-sm text-center">
        <h2 className="font-studio text-xl font-semibold">{title}</h2>
        <p className="mt-2 text-sm text-muted-foreground">{body}</p>
        {action && onAction && (
          <Button className="mt-4" onClick={onAction}>
            {action}
          </Button>
        )}
      </div>
    </div>
  )
}

import { useEffect, useState } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import {
  IconBolt,
  IconFileText,
  IconGitBranch,
  IconHistory,
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
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { TEMPORARY_CHAT_ID } from '@/constants/chat'
import { route } from '@/constants/routes'
import { useAgentDefinitions } from '@/hooks/useAgentDefinitions'
import { useAgentMode } from '@/hooks/useAgentMode'
import { useAgentSkills } from '@/hooks/useAgentSkills'
import {
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const Route = createFileRoute(route.agents.index as any)({
  component: AgentStudioPage,
})

type StudioView = 'definitions' | 'templates' | 'runs'

const KIND_META: Record<
  AgentStrategyKind,
  { label: string; description: string; icon: typeof IconBolt }
> = {
  standard: {
    label: 'Standard Agent',
    description: 'One autonomous role using the trusted tool loop.',
    icon: IconBolt,
  },
  goal_loop: {
    label: 'Goal Loop',
    description: 'Execute, evaluate, and revise until the criteria pass.',
    icon: IconRepeat,
  },
  coordinator: {
    label: 'Coordinator Team',
    description: 'Plan, dispatch bounded parallel specialists, then synthesize.',
    icon: IconUsers,
  },
  workflow: {
    label: 'Workflow',
    description: 'An explicit acyclic pipeline with parallel branches.',
    icon: IconGitBranch,
  },
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

      <section className="grid gap-4">
        <Field label="Role and operating instructions">
          <Textarea
            rows={7}
            value={draft.instructions}
            placeholder="Define what this agent owns, how it should reason, and the boundaries it must respect."
            onChange={(event) => common({ instructions: event.target.value })}
          />
        </Field>
        <div className="grid gap-4 md:grid-cols-[160px_1fr]">
          <Field label="Maximum tool steps">
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
          <Field label="Output contract">
            <Input
              value={draft.outputContract}
              placeholder="Optional: required structure, artifact, or acceptance format"
              onChange={(event) => common({ outputContract: event.target.value })}
            />
          </Field>
        </div>
        <SkillPicker
          available={skills}
          selected={draft.skills}
          onChange={(next) => common({ skills: next })}
        />
      </section>

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
      <SectionTitle title="Evaluator loop" body="The executor uses the main workspace; the evaluator checks its result in an isolated stage." />
      <Field label="Maximum cycles">
        <Input
          className="max-w-40"
          type="number"
          min={1}
          max={8}
          value={draft.maxCycles}
          onChange={(event) =>
            onChange({ ...draft, maxCycles: Number(event.target.value) })
          }
        />
      </Field>
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
      <Field label="Success criteria">
        <Textarea
          rows={4}
          value={draft.successCriteria}
          onChange={(event) =>
            onChange({ ...draft, successCriteria: event.target.value })
          }
        />
      </Field>
      <Field label="Evaluator instructions">
        <Textarea
          rows={5}
          value={draft.evaluatorInstructions}
          onChange={(event) =>
            onChange({ ...draft, evaluatorInstructions: event.target.value })
          }
        />
      </Field>
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
      <SectionTitle title="Coordinator team" body="Planning and specialist work stay isolated; synthesis owns final writes to the main workspace." />
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Coordinator instructions">
          <Textarea
            rows={4}
            value={draft.coordinatorInstructions}
            onChange={(event) =>
              onChange({
                ...draft,
                coordinatorInstructions: event.target.value,
              })
            }
          />
        </Field>
        <Field label="Synthesis instructions">
          <Textarea
            rows={4}
            value={draft.synthesisInstructions}
            onChange={(event) =>
              onChange({ ...draft, synthesisInstructions: event.target.value })
            }
          />
        </Field>
      </div>
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
      <Field label="Maximum parallel workers">
        <Input
          className="max-w-40"
          type="number"
          min={1}
          max={Math.max(1, draft.workers.length)}
          value={draft.maxParallel}
          onChange={(event) =>
            onChange({ ...draft, maxParallel: Number(event.target.value) })
          }
        />
      </Field>
      <div className="space-y-3">
        {draft.workers.map((worker, index) => (
          <RoleEditor
            key={`${worker.id}-${index}`}
            role={worker}
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
      <SectionTitle title="Workflow graph" body="Dependencies form an acyclic graph with exactly one final node. Parallel stages must use isolated workspaces." />
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
                <Field label="Depends on node IDs">
                  <Input
                    value={dependencies}
                    placeholder="research, review"
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
                <Field label="Workspace">
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
  skills,
  modelInstances,
  onChange,
  onDelete,
}: {
  role: AgentRole
  skills: string[]
  modelInstances: AgentModelInstance[]
  onChange: (role: AgentRole) => void
  onDelete: () => void
}) {
  return (
    <div className="rounded-xl border bg-background p-4">
      <div className="grid gap-3 md:grid-cols-[0.8fr_1fr_80px_auto]">
        <Field label="ID">
          <Input
            value={role.id}
            onChange={(event) => onChange({ ...role, id: slug(event.target.value) })}
          />
        </Field>
        <Field label="Name">
          <Input
            value={role.name}
            onChange={(event) => onChange({ ...role, name: event.target.value })}
          />
        </Field>
        <Field label="Steps">
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
        <Button
          className="mt-6"
          size="icon-sm"
          variant="ghost"
          title="Remove role"
          onClick={onDelete}
        >
          <IconTrash />
        </Button>
      </div>
      <Field label="Instructions" className="mt-3">
        <Textarea
          rows={3}
          value={role.instructions}
          onChange={(event) => onChange({ ...role, instructions: event.target.value })}
        />
      </Field>
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
      <SkillPicker
        available={skills}
        selected={role.skills}
        onChange={(next) => onChange({ ...role, skills: next })}
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
}: {
  available: string[]
  selected: string[]
  onChange: (skills: string[]) => void
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
  const stageCount =
    draft.kind === 'coordinator'
      ? draft.workers.length + 2
      : draft.kind === 'workflow'
        ? draft.nodes.length
        : draft.kind === 'goal_loop'
          ? draft.maxCycles * 2
          : 1
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
        <Stat label="Stages" value={String(stageCount)} />
        <Stat label="Skills" value={String(draft.skills.length)} />
        <Stat label="Max steps" value={String(draft.maxSteps)} />
        <Stat
          label="Model routing"
          value={explicitModels.size === 0 ? 'Active model' : `${explicitModels.size} fixed`}
        />
      </dl>
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
}: {
  runs: AgentRunRecord[]
  selected: AgentRunRecord | null
  onSelect: (id: string) => void
  onRefresh: () => void
}) {
  const instanceMetrics = aggregateAgentMetrics(
    selected?.stages.map((stage) => ({
      modelInstanceId: stage.modelInstanceId,
      modelId: stage.modelId,
      inference: stage.inference,
    })) ?? []
  )
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
            <button
              key={run.id}
              type="button"
              className={cn(
                'w-full rounded-xl border p-3 text-left hover:bg-accent',
                selected?.id === run.id && 'border-primary bg-accent'
              )}
              onClick={() => onSelect(run.id)}
            >
              <div className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate font-medium">
                  {run.definitionName}
                </span>
                <span className="text-[10px] uppercase text-muted-foreground">
                  {run.status}
                </span>
              </div>
              <div className="mt-1 text-xs text-muted-foreground">
                {new Date(run.startedAtMs).toLocaleString()} · {run.totalSteps}{' '}
                steps
              </div>
            </button>
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
              <p className="mt-1 text-sm text-muted-foreground">
                {selected.status} · {selected.totalSteps} tool steps ·{' '}
                {Math.max(0, selected.finishedAtMs - selected.startedAtMs)} ms
              </p>
              <p className="mt-1 font-mono text-xs text-muted-foreground">
                default: {selected.defaultModelInstanceId}
              </p>
            </div>
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
                        {stage.status}
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
              <h3 className="mb-2 font-medium">Final output</h3>
              <pre className="whitespace-pre-wrap rounded-xl border bg-muted/20 p-4 font-sans text-sm">
                {selected.finalReply}
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
  children,
  className,
}: {
  label: string
  children: React.ReactNode
  className?: string
}) {
  return (
    <div className={className}>
      <Label className="mb-1.5 block">{label}</Label>
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

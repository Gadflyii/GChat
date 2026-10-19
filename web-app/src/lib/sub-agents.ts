import { jsonSchema, type Tool } from 'ai'
import type {
  AgentRunState,
  AgentRunStatus,
  SubAgentAttribution,
} from '@/types/agent'

/**
 * Chat sub-agent dispatch. One `agent_dispatch` call starts one General Agent
 * worker per brief through the existing `agent_spawn` capability, waits for
 * every worker through `agent_wait`, and returns each worker's result to the
 * parent model. The design record is docs/agent-runtime/README.md
 * ("Chat sub-agents").
 */
export const SUBAGENT_DISPATCH_TOOL = 'agent_dispatch'
export const MAX_SUBAGENTS = 8

export type SubAgentBrief = { title: string; task: string }

export type { SubAgentAttribution }

export type SubAgentOutcome = 'done' | 'stopped' | 'failed' | 'not_finished'

export type SubAgentResult = {
  title: string
  runId?: string
  status: SubAgentOutcome
  result?: string
  error?: string
}

export function buildSubAgentDispatchTool(): Record<string, Tool> {
  return {
    [SUBAGENT_DISPATCH_TOOL]: {
      description:
        'Dispatch one or more sub-agents that work on separate tasks at the same time, wait for all of them, and return each result. ' +
        'Use this whenever the user asks you to dispatch, delegate to, or use agents or sub-agents, or when a request splits into independent parts. ' +
        "Each sub-agent is a General Agent with this conversation's model, tools, permissions and folders. " +
        'A sub-agent cannot see this conversation, so each task must be complete on its own: include file names, details and the expected answer. ' +
        'The user sees every sub-agent working in the chat and can stop any of them.',
      inputSchema: jsonSchema({
        type: 'object',
        properties: {
          agents: {
            type: 'array',
            minItems: 1,
            maxItems: MAX_SUBAGENTS,
            items: {
              type: 'object',
              properties: {
                title: {
                  type: 'string',
                  description:
                    'A short name the user sees, for example "Summarize notes.txt".',
                },
                task: {
                  type: 'string',
                  description:
                    'The complete instructions for this sub-agent.',
                },
              },
              required: ['title', 'task'],
              additionalProperties: false,
            },
          },
        },
        required: ['agents'],
        additionalProperties: false,
      }),
    } as Tool,
  }
}

/** Validates model arguments before any worker starts. */
export function parseSubAgentBriefs(input: unknown): SubAgentBrief[] {
  const agents = (input as { agents?: unknown } | undefined)?.agents
  if (!Array.isArray(agents) || agents.length === 0) {
    throw new Error('agents must list at least one sub-agent task')
  }
  if (agents.length > MAX_SUBAGENTS) {
    throw new Error(`Dispatch at most ${MAX_SUBAGENTS} sub-agents at once`)
  }
  return agents.map((agent, index) => {
    const value = agent as { title?: unknown; task?: unknown } | undefined
    const task = typeof value?.task === 'string' ? value.task.trim() : ''
    if (!task) throw new Error(`Sub-agent ${index + 1} needs a task`)
    const title =
      typeof value?.title === 'string' && value.title.trim()
        ? value.title.trim()
        : `Sub-agent ${index + 1}`
    return { title, task }
  })
}

/** Briefs as shown on cards; tolerant of partially streamed arguments. */
export function displaySubAgentBriefs(input: unknown): SubAgentBrief[] {
  const agents = (input as { agents?: unknown } | undefined)?.agents
  if (!Array.isArray(agents)) return []
  return agents.slice(0, MAX_SUBAGENTS).map((agent, index) => {
    const value = agent as { title?: unknown; task?: unknown } | undefined
    return {
      title:
        typeof value?.title === 'string' && value.title.trim()
          ? value.title.trim()
          : `Sub-agent ${index + 1}`,
      task: typeof value?.task === 'string' ? value.task : '',
    }
  })
}

export function savedSubAgentResults(output: unknown): SubAgentResult[] {
  const agents = (output as { agents?: unknown } | undefined)?.agents
  if (!Array.isArray(agents)) return []
  return agents.flatMap((agent) => {
    const value = agent as Partial<SubAgentResult> | undefined
    if (!value || typeof value.status !== 'string') return []
    return [
      {
        title: typeof value.title === 'string' ? value.title : '',
        ...(typeof value.runId === 'string' ? { runId: value.runId } : {}),
        status: value.status,
        ...(typeof value.result === 'string' ? { result: value.result } : {}),
        ...(typeof value.error === 'string' ? { error: value.error } : {}),
      },
    ]
  })
}

export function subAgentOutcome(
  status: AgentRunStatus | string | undefined
): SubAgentOutcome {
  if (status === 'finished') return 'done'
  if (status === 'cancelled') return 'stopped'
  if (status === 'failed') return 'failed'
  return 'not_finished'
}

export type SubAgentPhase =
  | 'starting'
  | 'waiting'
  | 'working'
  | 'approval'
  | 'folder'
  | SubAgentOutcome

export function liveSubAgentPhase(run: AgentRunState): SubAgentPhase {
  switch (run.status) {
    case 'awaiting_approval':
      return 'approval'
    case 'awaiting_folder_access':
      return 'folder'
    case 'running':
    case 'idle': {
      const stage = run.trace.stages.at(-1)
      if (!stage) return 'starting'
      return stage.status === 'queued' ? 'waiting' : 'working'
    }
    default:
      return subAgentOutcome(run.status)
  }
}

export const SUBAGENT_PHASE_LABELS: Record<SubAgentPhase, string> = {
  starting: 'Starting',
  waiting: 'Waiting for a free model slot',
  working: 'Working',
  approval: 'Waiting for your approval',
  folder: 'Waiting for folder access',
  done: 'Done',
  stopped: 'Stopped',
  failed: 'Failed',
  not_finished: 'Did not finish',
}

export function isActiveSubAgentPhase(phase: SubAgentPhase): boolean {
  return (
    phase === 'starting' ||
    phase === 'waiting' ||
    phase === 'working' ||
    phase === 'approval' ||
    phase === 'folder'
  )
}

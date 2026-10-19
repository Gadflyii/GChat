import { generateId, type UIMessage } from 'ai'
import { useConversationPolicy } from '@/hooks/useConversationPolicy'
import { chatWorkerRunKey, useAgentRun } from '@/hooks/useAgentRun'
import { useToolAvailable } from '@/hooks/useToolAvailable'
import { useThreads } from '@/hooks/useThreads'
import type { CapabilitiesService } from '@/services/capabilities/types'
import type {
  AgentAttachment,
  AgentRunRecord,
  SubAgentAttribution,
} from '@/types/agent'
import { useChatSessions } from '@/stores/chat-session-store'
import {
  buildAgentRecordSummary,
  buildAgentRunSummary,
} from './agent-run-message'
import { useAppState } from '@/hooks/useAppState'
import { capabilitySchema, capabilitySearchResults } from './custom-chat-transport-helpers'
import {
  parseSubAgentBriefs,
  STOPPED_BY_USER_NOTE,
  SUBAGENT_DISPATCH_TOOL,
  subAgentOutcome,
  type SubAgentBrief,
  type SubAgentResult,
} from './sub-agents'

type ChatCapabilityOptions = {
  service: CapabilitiesService
  threadId: string
  modelId?: string
  toolName: string
  arguments: object
  signal: AbortSignal
  /** The model's tool call; names the sub-agent cards of a dispatch. */
  toolCallId?: string
  /** Set only by sub-agent dispatch for the worker it spawns. */
  subAgent?: SubAgentAttribution
}

export async function executeChatCapability({
  service, threadId, modelId, toolName, arguments: input, signal, toolCallId, subAgent,
}: ChatCapabilityOptions): Promise<{ content: unknown; error?: string }> {
  if (signal.aborted) throw new DOMException('Cancelled', 'AbortError')
  if (toolName === SUBAGENT_DISPATCH_TOOL) {
    return dispatchSubAgents({ service, threadId, modelId, toolName, arguments: input, signal, toolCallId })
  }
  const disabledTools = useToolAvailable.getState().getDisabledToolsForThread(threadId)
  if (toolName === 'gchat_capability_search') {
    const query = (input as { query?: unknown }).query
    if (typeof query !== 'string' || !query.trim()) throw new Error('Search query is required')
    return { content: capabilitySearchResults(useAppState.getState().tools, disabledTools, query) }
  }
  if (toolName === 'gchat_capability_read') {
    const name = (input as { name?: unknown }).name
    if (typeof name !== 'string' || !name) throw new Error('Capability name is required')
    const schema = capabilitySchema(useAppState.getState().tools, disabledTools, name)
    if (!schema) throw new Error(`Capability '${name}' is unavailable or disabled`)
    return { content: schema }
  }
  if (toolName === 'gchat_capability_call') {
    const call = input as { name?: unknown; arguments?: unknown }
    if (typeof call.name !== 'string' || !call.name || !call.arguments || typeof call.arguments !== 'object' || Array.isArray(call.arguments)) {
      throw new Error('Capability name and object arguments are required')
    }
    if (!capabilitySchema(useAppState.getState().tools, disabledTools, call.name)) {
      throw new Error(`Capability '${call.name}' is unavailable or disabled`)
    }
    return executeChatCapability({
      service, threadId, modelId, toolName: call.name,
      arguments: call.arguments as object, signal,
    })
  }
  const runId = `capability-${generateId()}`
  const spawning = toolName === 'agent_spawn'
  const messages =
    useChatSessions.getState().sessions[threadId]?.chat.messages ?? []
  const parentRunId =
    messages.findLast((message) => message.role === 'user')?.id ?? runId
  const stateKey = spawning ? chatWorkerRunKey(threadId, runId) : threadId
  const policy = useConversationPolicy.getState()
  const workspace = policy.getWorkspace(threadId)
  const markDelegation = () => {
    const thread = useThreads.getState().threads[threadId]
    if (thread && !thread.metadata?.has_agent_activity) {
      useThreads.getState().updateThread(threadId, {
        metadata: { ...thread.metadata, has_agent_activity: true },
      })
    }
    if (toolName === 'agent_run' &&
      useConversationPolicy.getState().activeDefinitions[threadId] === (input as { definitionId?: string }).definitionId) {
      useConversationPolicy.getState().setActiveDefinition(threadId)
    }
  }
  useAgentRun.getState().startRun(
    stateKey, runId,
    spawning
      ? { originSessionId: threadId, parentRunId, ...(subAgent ? { subAgent } : {}) }
      : undefined
  )
  const ownsRun = () => useAgentRun.getState().getRun(stateKey).runId === runId
  const cancel = () => { void service.cancel(runId).catch(console.error) }
  signal.addEventListener('abort', cancel)
  let completed = false
  try {
    const result = await service.execute({
      run_id: runId,
      session_id: threadId,
      parent_run_id: parentRunId,
      model_id: modelId,
      tool_name: toolName,
      arguments: input as Record<string, unknown>,
      working_dir: workspace.primaryRoot?.path,
      external_roots: workspace.externalRoots.map((root) => ({
        path: root.path, can_edit: root.canEdit,
      })),
      auto_approve: policy.getApprovalMode(threadId) === 'skip',
      selected_skill: policy.activeSkills[threadId],
      disabled_tools: useToolAvailable.getState().getDisabledToolsForThread(threadId),
      ...(['agent_run', 'agent_spawn', 'skill_invoke'].includes(toolName) ? {
        attachments: conversationAttachments(messages),
      } : {}),
    }, (event) => {
      // Stop can precede backend registration; retry when the call starts.
      if (signal.aborted && event.type === 'turn_started') cancel()
      if (!ownsRun() || (signal.aborted && event.type !== 'turn_finished')) return
      if (event.type === 'orchestration_started') markDelegation()
      useAgentRun.getState().applyEvent(stateKey, event)
      if (spawning && event.type === 'turn_finished')
        signal.removeEventListener('abort', cancel)
    })
    if (signal.aborted) throw new DOMException('Cancelled', 'AbortError')
    if (result.run || spawning) {
      markDelegation()
    }
    completed = !result.error
    const current = useAgentRun.getState().getRun(stateKey)
    if (result.run && ownsRun() && current.finishedAtMs === undefined) {
      // The invoke result may arrive before the final Channel callback.
      useAgentRun.getState().applyEvent(stateKey, {
        type: 'turn_finished',
        reason: result.run.reason,
        step_count: result.run.stepCount,
      })
    }
    const run = useAgentRun.getState().getRun(stateKey)
    const record = ['agent_monitor', 'agent_wait'].includes(toolName)
      ? (result.content as { record?: AgentRunRecord } | undefined)?.record
      : undefined
    return {
      ...result,
      error: result.run ? undefined : result.error,
      content:
        result.run && ownsRun()
          ? {
              result: result.content,
              ...(result.error !== undefined ? { error: result.error } : {}),
              agent_run: buildAgentRunSummary(run),
            }
          : record
            ? {
                ...(result.content as object),
                agent_run: buildAgentRecordSummary(record),
              }
            : spawning && completed && ownsRun()
              ? {
                  ...(result.content as object),
                  agent_run: buildAgentRunSummary(run),
                }
              : result.content,
    }
  } finally {
    const run = useAgentRun.getState().getRun(stateKey)
    if (!spawning || !completed || run.finishedAtMs !== undefined)
      signal.removeEventListener('abort', cancel)
    if (ownsRun() && run.finishedAtMs === undefined &&
      (!spawning || !completed)
    ) {
      useAgentRun.getState().applyEvent(stateKey, {
        type: 'turn_finished',
        reason: signal.aborted ? 'cancelled' : completed ? 'reply' : 'failed',
        step_count: run.trace.stepCount ?? 0,
      })
    }
  }
}

/**
 * Start one General Agent worker per brief with the existing spawn capability,
 * wait for all of them, and return every result in brief order. Workers run
 * concurrently; the shared native allocator admits them within the Host's
 * concurrency and queues the rest. A worker that fails or is stopped reports
 * that outcome without stopping its siblings. Stop on the parent cancels all.
 */
async function dispatchSubAgents(
  options: ChatCapabilityOptions
): Promise<{ content: { agents: SubAgentResult[] } }> {
  const briefs = parseSubAgentBriefs(options.arguments)
  const dispatchId = options.toolCallId || `dispatch-${generateId()}`
  const agents = await Promise.all(
    briefs.map((brief, index) => runSubAgent(options, brief, { dispatchId, index, ...brief }))
  )
  if (options.signal.aborted) throw new DOMException('Cancelled', 'AbortError')
  return { content: { agents } }
}

async function runSubAgent(
  { service, threadId, modelId, signal }: ChatCapabilityOptions,
  brief: SubAgentBrief,
  subAgent: SubAgentAttribution
): Promise<SubAgentResult> {
  let runId: string | undefined
  try {
    const spawned = await executeChatCapability({
      service, threadId, modelId, signal, subAgent,
      toolName: 'agent_spawn',
      arguments: { task: brief.task },
    })
    runId = (spawned.content as { runId?: unknown } | undefined)?.runId as string | undefined
    if (spawned.error || typeof runId !== 'string' || !runId) {
      return { title: brief.title, status: 'failed', error: spawned.error ?? 'The sub-agent did not start' }
    }
    const waited = await waitForSubAgent(service, threadId, runId, signal)
    const live = useAgentRun.getState().getRun(chatWorkerRunKey(threadId, runId))
    const collected = waited.content as { record?: AgentRunRecord; error?: unknown } | undefined
    const record = collected?.record
    const status = subAgentOutcome(record?.status ?? live.status)
    const result = record?.finalReply || live.trace.assistantText
    const error =
      waited.error ??
      (typeof collected?.error === 'string' ? collected.error : undefined) ??
      (status === 'failed' ? live.trace.error?.message : undefined)
    return {
      title: brief.title, runId, status,
      ...(result ? { result } : {}),
      ...(error ? { error } : {}),
      // Only the user's per-card Stop ends one sub-agent while its parent runs.
      ...(status === 'stopped' ? { note: STOPPED_BY_USER_NOTE } : {}),
    }
  } catch (error) {
    if (signal.aborted || (error as Error).name === 'AbortError') throw error
    return {
      title: brief.title,
      ...(runId ? { runId } : {}),
      status: 'failed',
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

async function waitForSubAgent(
  service: CapabilitiesService,
  threadId: string,
  runId: string,
  signal: AbortSignal
) {
  if (signal.aborted) throw new DOMException('Cancelled', 'AbortError')
  // The wait has its own cancellation identity; cancelling it never stops
  // the worker. Stop on the parent cancels the worker through its spawn.
  const waitId = `${runId}-wait`
  let onAbort: () => void = () => undefined
  const aborted = new Promise<never>((_, reject) => {
    onAbort = () => {
      void service.cancel(waitId).catch(() => undefined)
      reject(new DOMException('Cancelled', 'AbortError'))
    }
  })
  signal.addEventListener('abort', onAbort)
  const collected = service.execute({
    run_id: waitId,
    session_id: threadId,
    tool_name: 'agent_wait',
    arguments: { runId },
    external_roots: [],
    auto_approve: false,
    disabled_tools: useToolAvailable.getState().getDisabledToolsForThread(threadId),
  }, () => undefined)
  // Stop answers at once; a wait that settles later must not surface unhandled.
  collected.catch(() => undefined)
  try {
    return await Promise.race([collected, aborted])
  } finally {
    signal.removeEventListener('abort', onAbort)
  }
}

export function conversationAttachments(messages: UIMessage[]): AgentAttachment[] {
  const user = messages.findLast((message) => message.role === 'user')
  if (!user) return []
  const images: AgentAttachment[] = user.parts.flatMap((part, index) =>
    part.type === 'file' && part.mediaType.startsWith('image/')
      ? [{ kind: 'image', name: part.filename ?? `image-${index + 1}`, media_type: part.mediaType, data_url: part.url }]
      : [])
  const metadata = user.metadata as { file_attachments?: Array<{ name?: string; path?: string; mediaType?: string }> } | undefined
  const files: AgentAttachment[] = (metadata?.file_attachments ?? []).flatMap((file) =>
    file.name && file.path ? [{ kind: 'file', name: file.name, path: file.path, ...(file.mediaType ? { media_type: file.mediaType } : {}) }] : [])
  return [...images, ...files]
}

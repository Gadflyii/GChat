import { generateId, type UIMessage } from 'ai'
import { useConversationPolicy } from '@/hooks/useConversationPolicy'
import { chatWorkerRunKey, useAgentRun } from '@/hooks/useAgentRun'
import { useToolAvailable } from '@/hooks/useToolAvailable'
import { useThreads } from '@/hooks/useThreads'
import type { CapabilitiesService } from '@/services/capabilities/types'
import type { AgentAttachment, AgentRunRecord, AgentRunSummary } from '@/types/agent'
import { useChatSessions } from '@/stores/chat-session-store'
import {
  buildAgentRecordSummary,
  buildAgentRunSummary,
} from './agent-run-message'
import { useAppState } from '@/hooks/useAppState'
import { capabilitySchema, capabilitySearchResults } from './custom-chat-transport-helpers'

export async function executeChatCapability({
  service, threadId, modelId, toolName, arguments: input, signal,
}: {
  service: CapabilitiesService
  threadId: string
  modelId?: string
  toolName: string
  arguments: object
  signal: AbortSignal
}) {
  if (signal.aborted) throw new DOMException('Cancelled', 'AbortError')
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
    spawning ? { originSessionId: threadId, parentRunId } : undefined
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

// Keep delegated activity with its SDK tool output when a conversation reopens.
export function chatCapabilityRun(message: UIMessage): AgentRunSummary | undefined {
  for (const part of [...message.parts].reverse()) {
    if (!('output' in part) || !part.output || typeof part.output !== 'object') continue
    const summary = (part.output as { agent_run?: AgentRunSummary }).agent_run
    if (summary?.run_id) return summary
  }
  return undefined
}

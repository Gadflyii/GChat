import { generateId, type UIMessage } from 'ai'
import { useConversationPolicy } from '@/hooks/useConversationPolicy'
import { useAgentRun } from '@/hooks/useAgentRun'
import { useToolAvailable } from '@/hooks/useToolAvailable'
import { useThreads } from '@/hooks/useThreads'
import type { CapabilitiesService } from '@/services/capabilities/types'
import type { AgentAttachment, AgentRunSummary } from '@/types/agent'
import { useChatSessions } from '@/stores/chat-session-store'
import { buildAgentRunSummary } from './agent-run-message'

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
  const runId = `capability-${generateId()}`
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
  useAgentRun.getState().startRun(threadId, runId)
  const ownsRun = () => useAgentRun.getState().getRun(threadId).runId === runId
  const cancel = () => { void service.cancel(runId).catch(console.error) }
  signal.addEventListener('abort', cancel)
  let completed = false
  try {
    const result = await service.execute({
      run_id: runId,
      session_id: threadId,
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
      ...(['agent_run', 'skill_invoke'].includes(toolName) ? {
        attachments: conversationAttachments(useChatSessions.getState().sessions[threadId]?.chat.messages ?? []),
      } : {}),
    }, (event) => {
      // Stop can precede backend registration; retry when the call starts.
      if (signal.aborted && event.type === 'turn_started') cancel()
      if (!ownsRun() || (signal.aborted && event.type !== 'turn_finished')) return
      if (event.type === 'orchestration_started') markDelegation()
      useAgentRun.getState().applyEvent(threadId, event)
    })
    if (signal.aborted) throw new DOMException('Cancelled', 'AbortError')
    if (result.run) {
      markDelegation()
    }
    completed = !result.error
    const current = useAgentRun.getState().getRun(threadId)
    if (result.run && ownsRun() && current.finishedAtMs === undefined) {
      // The invoke result may arrive before the final Channel callback.
      useAgentRun.getState().applyEvent(threadId, {
        type: 'turn_finished',
        reason: result.run.reason,
        step_count: result.run.stepCount,
      })
    }
    const run = useAgentRun.getState().getRun(threadId)
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
          : result.content,
    }
  } finally {
    signal.removeEventListener('abort', cancel)
    const run = useAgentRun.getState().getRun(threadId)
    if (ownsRun() && run.finishedAtMs === undefined) {
      useAgentRun.getState().applyEvent(threadId, {
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

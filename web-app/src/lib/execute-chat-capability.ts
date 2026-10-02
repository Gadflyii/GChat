import { generateId, type UIMessage } from 'ai'
import { useAgentMode } from '@/hooks/useAgentMode'
import { useAgentRun } from '@/hooks/useAgentRun'
import { useToolAvailable } from '@/hooks/useToolAvailable'
import type { CapabilitiesService } from '@/services/capabilities/types'
import type { AgentRunSummary } from '@/types/agent'
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
  const mode = useAgentMode.getState()
  const workspace = mode.getWorkspace(threadId)
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
      auto_approve: mode.getApprovalMode(threadId) === 'skip',
      selected_skill: mode.activeSkills[threadId],
      disabled_tools: useToolAvailable.getState().getDisabledToolsForThread(threadId),
    }, (event) => {
      // Stop can precede backend registration; retry when the call starts.
      if (signal.aborted && event.type === 'turn_started') cancel()
      if (!ownsRun() || (signal.aborted && event.type !== 'turn_finished')) return
      useAgentRun.getState().applyEvent(threadId, event)
    })
    if (signal.aborted) throw new DOMException('Cancelled', 'AbortError')
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

// Keep delegated activity with its SDK tool output when a conversation reopens.
export function chatCapabilityRun(message: UIMessage): AgentRunSummary | undefined {
  for (const part of [...message.parts].reverse()) {
    if (!('output' in part) || !part.output || typeof part.output !== 'object') continue
    const summary = (part.output as { agent_run?: AgentRunSummary }).agent_run
    if (summary?.run_id) return summary
  }
  return undefined
}

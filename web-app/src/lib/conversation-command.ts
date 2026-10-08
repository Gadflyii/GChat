import type { UIMessage } from 'ai'
import type { AgentRunState } from '@/types/agent'
import type { ManualContextCompactionResult } from './smart-context'

export function isCompactCommand(text: string): boolean {
  return text.trim().toLowerCase() === '/compact'
}

export type ConversationCompactionResult = ManualContextCompactionResult | {
  status: 'queued'
  workers: number
}

/** Compact the context the conversation is using, without submitting a turn. */
export async function compactConversation({
  messages, run, busy, compactChat, queueWorker,
}: {
  messages: UIMessage[]
  run: AgentRunState
  busy: boolean
  compactChat: (messages: UIMessage[]) => Promise<ManualContextCompactionResult>
  queueWorker: (contextId: string) => Promise<unknown>
}): Promise<ConversationCompactionResult> {
  if (['running', 'awaiting_approval', 'awaiting_folder_access'].includes(run.status)) {
    const contexts = [...new Set(run.trace.stages
      .filter((stage) => stage.status === 'running' && stage.context)
      .map((stage) => stage.context!.context_id))]
    if (!contexts.length) {
      throw new Error('Wait until the active worker has a context boundary, then run /compact again.')
    }
    // Only contexts reported by this conversation's current running stages.
    // The native worker consumes the flag after its complete tool batch.
    await Promise.all(contexts.map((id) => queueWorker(id)))
    return { status: 'queued', workers: contexts.length }
  }
  if (busy) throw new Error('Wait for the current response to finish, then run /compact again.')
  if (!messages.length) return { status: 'nothing_to_compact' }
  return compactChat(messages)
}

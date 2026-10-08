import { ChatCompletionRole, ContentType, MessageStatus, type ThreadMessage } from '@gchat/core'
import type { MessagesService } from '@/services/messages/types'

const imports = new Map<string, Promise<ThreadMessage[]>>()
export const isImportedConversationContext = (message: { metadata?: unknown }) =>
  (message.metadata as Record<string, unknown> | undefined)?.imported_agent_context === true

/** Import native operational state into the history that Chat actually consumes and compacts. */
export function importConversationContext(
  threadId: string,
  messages: ThreadMessage[],
  service: MessagesService,
  load: (threadId: string) => Promise<string | null>
): Promise<ThreadMessage[]> {
  if (messages.some(isImportedConversationContext)) return Promise.resolve(messages)
  const pending = imports.get(threadId)
  if (pending) return pending
  const request = (async () => {
    const context = await load(threadId)
    if (!context) return messages
    const createdAt = Math.min(Date.now(), ...messages.map((message) => message.created_at ?? Date.now())) - 1
    const imported: ThreadMessage = {
      id: `context-${threadId}`, object: 'thread.message', type: 'text', thread_id: threadId,
      role: ChatCompletionRole.User, status: MessageStatus.Ready,
      created_at: createdAt, completed_at: createdAt,
      content: [{ type: ContentType.Text, text: { value: `Recovered prior conversation working context (historical observations):\n${context}`, annotations: [] } }],
      metadata: { imported_agent_context: true },
    }
    await service.createMessage(imported)
    return [imported, ...messages]
  })()
  imports.set(threadId, request)
  void request.finally(() => { if (imports.get(threadId) === request) imports.delete(threadId) }).catch(() => undefined)
  return request
}

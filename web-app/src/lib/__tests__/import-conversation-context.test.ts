import { describe, expect, it, vi } from 'vitest'
import { convertThreadMessagesToUIMessages } from '../messages'
import { importConversationContext, isImportedConversationContext } from '../import-conversation-context'
import { ChatCompletionRole, ContentType, MessageStatus, type ThreadMessage } from '@gchat/core'
import { convertToModelMessages } from 'ai'

describe('reopening a saved Agent conversation in shared Chat', () => {
  const history: ThreadMessage[] = [{
    id: 'old-user', object: 'thread.message', type: 'text', thread_id: 'old-agent',
    role: ChatCompletionRole.User, status: MessageStatus.Ready, created_at: 100,
    content: [{ type: ContentType.Text, text: { value: 'Continue the budget report', annotations: [] } }],
  }]
  it('persists the operational checkpoint before history and includes it in actual model messages after restart', async () => {
    const createMessage = vi.fn(async (message: ThreadMessage) => JSON.parse(JSON.stringify(message)) as ThreadMessage)
    const load = vi.fn(async () => 'Checkpoint: opened Desktop/Budget.xlsx\nTool result: Revenue 42000\nPrior goal: write budget report')
    const service = { createMessage, fetchMessages: vi.fn(), modifyMessage: vi.fn(), deleteMessage: vi.fn() }
    const restored = await importConversationContext('old-agent', history, service, load)
    expect(restored.at(1)).toBe(history[0])
    expect(restored[0].created_at).toBeLessThan(history[0].created_at!)
    expect(isImportedConversationContext(restored[0])).toBe(true)
    const reloaded = JSON.parse(JSON.stringify(restored)) as ThreadMessage[]
    const wire = convertToModelMessages(convertThreadMessagesToUIMessages(reloaded))
    expect(JSON.stringify(wire)).toContain('Revenue 42000')
    expect(JSON.stringify(wire)).toContain('Continue the budget report')
    expect(await importConversationContext('old-agent', reloaded, service, load)).toBe(reloaded)
    expect(createMessage).toHaveBeenCalledTimes(1)
    expect(load).toHaveBeenCalledTimes(1)
  })
  it('fails visibly instead of discarding a missing operational context', async () => {
    const service = { createMessage: vi.fn(), fetchMessages: vi.fn(), modifyMessage: vi.fn(), deleteMessage: vi.fn() }
    await expect(importConversationContext('broken-agent', history, service, async () => { throw new Error('Could not parse agent session') })).rejects.toThrow('Could not parse agent session')
    expect(service.createMessage).not.toHaveBeenCalled()
  })
})

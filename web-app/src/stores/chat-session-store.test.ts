import type { Chat, UIMessage } from '@ai-sdk/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CustomChatTransport } from '@/lib/custom-chat-transport'
import { isSessionBusy, useChatSessions } from '@/stores/chat-session-store'

function createChat(messages: UIMessage[]): Chat<UIMessage> {
  return {
    messages,
    status: 'ready',
    stop: vi.fn(),
  } as unknown as Chat<UIMessage>
}

describe('chat session message routing', () => {
  beforeEach(() => {
    useChatSessions.getState().clearSessions()
  })

  it('updates only the addressed thread session', () => {
    const threadAMessage: UIMessage = {
      id: 'thread-a-user',
      role: 'user',
      parts: [{ type: 'text', text: 'Thread A' }],
    }
    const threadBMessage: UIMessage = {
      id: 'thread-b-user',
      role: 'user',
      parts: [{ type: 'text', text: 'Thread B' }],
    }
    const agentMessage: UIMessage = {
      id: 'agent-run-a',
      role: 'assistant',
      parts: [{ type: 'text', text: 'Finished in thread A' }],
    }
    const transport = {} as CustomChatTransport
    const chatA = createChat([threadAMessage])
    const chatB = createChat([threadBMessage])

    useChatSessions
      .getState()
      .ensureSession('thread-a', transport, () => chatA)
    useChatSessions
      .getState()
      .ensureSession('thread-b', transport, () => chatB)

    useChatSessions.getState().upsertMessage('thread-a', agentMessage)

    expect(chatA.messages).toEqual([threadAMessage, agentMessage])
    expect(chatB.messages).toEqual([threadBMessage])
  })

  it('releases a finished chat after an earlier tool batch drains', () => {
    const transport = {} as CustomChatTransport
    const chat = createChat([])
    useChatSessions.getState().ensureSession('thread-a', transport, () => chat)
    useChatSessions.getState().updateStatus('thread-a', 'submitted')
    const data = useChatSessions.getState().getSessionData('thread-a')
    const call = { toolCallId: 'search-1', toolName: 'search', input: {} }
    data.tools.push(call)

    const batch = useChatSessions.getState().claimToolBatch('thread-a')
    expect(batch?.calls).toEqual([call])
    expect(data.tools).toEqual([])

    // A final response can arrive while the previous batch is still cleaning up.
    expect(useChatSessions.getState().claimToolBatch('thread-a')).toBeNull()
    useChatSessions.getState().updateStatus('thread-a', 'ready')
    expect(isSessionBusy(useChatSessions.getState().sessions['thread-a'])).toBe(true)

    useChatSessions.getState().endToolBatch('thread-a', batch!.id)
    expect(isSessionBusy(useChatSessions.getState().sessions['thread-a'])).toBe(false)
  })

  it('clears a stopped batch only in its own session', () => {
    const transport = {} as CustomChatTransport
    useChatSessions.getState().ensureSession('thread-a', transport, () => createChat([]))
    useChatSessions.getState().ensureSession('thread-b', transport, () => createChat([]))
    const batches = new Map<string, symbol>()
    for (const id of ['thread-a', 'thread-b']) {
      useChatSessions.getState().getSessionData(id).tools.push({ toolCallId: id })
      batches.set(id, useChatSessions.getState().claimToolBatch(id)!.id)
    }

    useChatSessions.getState().clearToolBatches('thread-a')
    useChatSessions.getState().endToolBatch('thread-a', batches.get('thread-a')!)

    expect(isSessionBusy(useChatSessions.getState().sessions['thread-a'])).toBe(false)
    expect(isSessionBusy(useChatSessions.getState().sessions['thread-b'])).toBe(true)
  })

  it('does not let a cancelled batch settle the next turn', () => {
    const transport = {} as CustomChatTransport
    useChatSessions.getState().ensureSession('thread-a', transport, () => createChat([]))
    const data = useChatSessions.getState().getSessionData('thread-a')
    data.tools.push({ toolCallId: 'old' })
    const oldBatch = useChatSessions.getState().claimToolBatch('thread-a')!

    useChatSessions.getState().clearToolBatches('thread-a')
    data.tools.push({ toolCallId: 'new' })
    const newBatch = useChatSessions.getState().claimToolBatch('thread-a')!

    useChatSessions.getState().endToolBatch('thread-a', oldBatch.id)
    expect(isSessionBusy(useChatSessions.getState().sessions['thread-a'])).toBe(true)
    expect(data.pendingToolBatches.has(newBatch.id)).toBe(true)

    useChatSessions.getState().endToolBatch('thread-a', newBatch.id)
    expect(isSessionBusy(useChatSessions.getState().sessions['thread-a'])).toBe(false)
  })
})

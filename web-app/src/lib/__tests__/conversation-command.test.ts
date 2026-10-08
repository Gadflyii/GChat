import { describe, expect, it, vi } from 'vitest'
import { compactConversation, isCompactCommand } from '../conversation-command'
import { createAgentRunState } from '@/hooks/useAgentRun'
import type { AgentRunState } from '@/types/agent'
import type { UIMessage } from 'ai'

const messages: UIMessage[] = [{ id: 'user', role: 'user', parts: [{ type: 'text', text: 'Continue the task' }] }]

describe('reserved conversation compaction', () => {
  it.each([' /compact ', '/COMPACT', '\n/compact\n'])('recognizes the exact command %s', (command) => {
    expect(isCompactCommand(command)).toBe(true)
    expect(isCompactCommand('/compact explain this')).toBe(false)
  })

  it('returns a new conversation no-op without invoking a model', async () => {
    const compactChat = vi.fn()
    const queueWorker = vi.fn()
    expect(await compactConversation({ messages: [], run: createAgentRunState(), busy: false, compactChat, queueWorker }))
      .toEqual({ status: 'nothing_to_compact' })
    expect(compactChat).not.toHaveBeenCalled()
    expect(queueWorker).not.toHaveBeenCalled()
  })

  it('compacts the current SDK messages without altering the transcript', async () => {
    const original = structuredClone(messages)
    const compactChat = vi.fn().mockResolvedValue({ status: 'compacted' })
    expect(await compactConversation({ messages, run: createAgentRunState(), busy: false, compactChat, queueWorker: vi.fn() }))
      .toEqual({ status: 'compacted' })
    expect(compactChat).toHaveBeenCalledWith(messages)
    expect(messages).toEqual(original)
  })

  it('queues only live contexts of the current run while its tool batch executes', async () => {
    const run: AgentRunState = {
      ...createAgentRunState(), status: 'running',
      trace: { ...createAgentRunState().trace, stages: [
        { id: 'active', name: 'Worker', role: 'worker', status: 'running', modelInstanceId: 'model', context: {
          type: 'context_status', context_id: 'current-context', input_tokens: 8000,
          context_tokens: 16000, reserved_tokens: 4000, compactions: 0, status: 'ready', archive_path: null,
        } },
        { id: 'old', name: 'Completed', role: 'worker', status: 'finished', modelInstanceId: 'model', context: {
          type: 'context_status', context_id: 'completed-context', input_tokens: 8000,
          context_tokens: 16000, reserved_tokens: 4000, compactions: 0, status: 'ready', archive_path: null,
        } },
      ] },
    }
    const compactChat = vi.fn()
    const queueWorker = vi.fn().mockResolvedValue({ queued: true })
    expect(await compactConversation({ messages, run, busy: true, compactChat, queueWorker }))
      .toEqual({ status: 'queued', workers: 1 })
    expect(queueWorker).toHaveBeenCalledExactlyOnceWith('current-context')
    expect(compactChat).not.toHaveBeenCalled()
    expect(run.trace.stages[0].context?.compactions).toBe(0)
  })

  it('reports an active ordinary response and preserves compaction failures', async () => {
    const compactChat = vi.fn().mockRejectedValue(new Error('Checkpoint failed'))
    const options = { messages, run: createAgentRunState(), compactChat, queueWorker: vi.fn() }
    await expect(compactConversation({ ...options, busy: true })).rejects.toThrow('Wait for the current response')
    expect(compactChat).not.toHaveBeenCalled()
    await expect(compactConversation({ ...options, busy: false })).rejects.toThrow('Checkpoint failed')
  })
})

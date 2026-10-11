import { Chat, type UIMessage } from '@ai-sdk/react'
import { MessageStatus, type ThreadMessage } from '@gchat/core'
import { convertToModelMessages } from 'ai'
import { describe, expect, it, vi } from 'vitest'

import { executeChatToolCalls } from './execute-chat-tool-calls'
import {
  convertThreadMessageToUIMessage,
  convertUIMessageToThreadMessage,
  extractContentPartsFromUIMessage,
} from './messages'

const input = { path: '/workspace/report.md' }

function toolMessage(part: Record<string, unknown>): UIMessage {
  return {
    id: 'assistant-1',
    role: 'assistant',
    parts: [
      { type: 'text', text: 'Reading the report.' },
      {
        type: 'tool-os_fs_read',
        toolCallId: 'read-1',
        input,
        ...part,
      },
    ],
  } as UIMessage
}

function persistAndReopen(message: UIMessage) {
  const saved: ThreadMessage = {
    id: message.id,
    object: 'thread.message',
    thread_id: 'thread-1',
    role: message.role as ThreadMessage['role'],
    status: MessageStatus.Ready,
    created_at: 1,
    completed_at: 1,
    content: extractContentPartsFromUIMessage(message),
  }
  // The native thread file store writes and reads complete JSON values.
  const persisted = JSON.parse(JSON.stringify(saved)) as ThreadMessage
  return { persisted, reopened: convertThreadMessageToUIMessage(persisted) }
}

describe('Chat tool history', () => {
  it('reopens an existing completed tool result stored in message metadata', () => {
    const saved: ThreadMessage = {
      id: 'assistant-1',
      object: 'thread.message',
      thread_id: 'thread-1',
      role: 'assistant' as ThreadMessage['role'],
      status: MessageStatus.Ready,
      created_at: 1,
      completed_at: 1,
      content: [],
      metadata: {
        tool_calls: [{
          tool: {
            id: 'read-1',
            type: 'function',
            function: {
              name: 'os_fs_read',
              arguments: JSON.stringify(input),
            },
          },
          state: 'completed',
          response: { content: [{ type: 'text', text: 'Saved document text' }] },
        }],
      },
    }
    const reopened = convertThreadMessageToUIMessage(JSON.parse(JSON.stringify(saved)))
    expect(reopened.parts).toEqual([{
      type: 'tool-os_fs_read',
      toolCallId: 'read-1',
      input,
      state: 'output-available',
      output: 'Saved document text',
    }])
    expect(convertToModelMessages([reopened])).toContainEqual({
      role: 'tool',
      content: [{
        type: 'tool-result',
        toolCallId: 'read-1',
        toolName: 'os_fs_read',
        output: { type: 'text', value: 'Saved document text' },
      }],
    })
  })

  it('retains a rejected execution as the exact terminal error after save and reopen', async () => {
    const reason = 'Tool execution denied by user\nFolder: /workspace'
    const errorText = `Error: ${reason}`
    const chat = new Chat<UIMessage>({
      messages: [toolMessage({ state: 'input-available' })],
    })
    await executeChatToolCalls({
      threadId: 'thread-1',
      toolCalls: [{ toolCallId: 'read-1', toolName: 'os_fs_read', input }],
      signal: new AbortController().signal,
      ragToolNames: new Set(),
      capabilityToolNames: new Set(['os_fs_read']),
      callCapability: vi.fn().mockResolvedValue({ error: reason }),
      callRagTool: vi.fn(),
      getProjectId: vi.fn(),
      processOutput: vi.fn(async (content) => content),
      addToolOutput: (output) => chat.addToolOutput(output),
    })

    const terminal = {
      type: 'tool-os_fs_read',
      toolCallId: 'read-1',
      input,
      state: 'output-error',
      errorText,
    }
    expect(chat.messages[0].parts).toContainEqual(expect.objectContaining(terminal))
    const { persisted, reopened } = persistAndReopen(chat.messages[0])
    expect(persisted.content[1]).toEqual({
      type: 'tool_call',
      tool_call_id: 'read-1',
      tool_name: 'os_fs_read',
      input,
      state: 'output-error',
      errorText,
    })
    expect(reopened.parts).toEqual([
      { type: 'text', text: 'Reading the report.' },
      terminal,
    ])
    expect(convertUIMessageToThreadMessage(chat.messages[0], 'thread-1').content)
      .toEqual(persisted.content)
    const wire = convertToModelMessages([reopened])
    expect(wire).toContainEqual({
      role: 'tool',
      content: [{
        type: 'tool-result',
        toolCallId: 'read-1',
        toolName: 'os_fs_read',
        output: { type: 'error-text', value: errorText },
      }],
    })
  })

  it.each([
    { output: 'Document text' },
    { output: [{ type: 'text', text: 'Document text' }] },
    { output: { rows: 3 } },
    { output: '' },
    { output: false },
    { output: 0 },
    { output: null },
  ])('preserves successful output $output', ({ output }) => {
    const message = toolMessage({ state: 'output-available', output })
    const { reopened } = persistAndReopen(message)
    expect(reopened.parts).toEqual(message.parts)
    expect(convertToModelMessages([reopened])).toContainEqual({
      role: 'tool',
      content: [{
        type: 'tool-result',
        toolCallId: 'read-1',
        toolName: 'os_fs_read',
        output: {
          type: typeof output === 'string' ? 'text' : 'json',
          value: output,
        },
      }],
    })
  })

  it.each(['input-streaming', 'input-available'] as const)(
    'keeps %s pending after save and reopen',
    (state) => {
      const message = toolMessage({ state })
      const { persisted, reopened } = persistAndReopen(message)
      expect(reopened.parts).toEqual(message.parts)
      expect(persisted.content[1]).not.toHaveProperty('output')
      expect(persisted.content[1]).not.toHaveProperty('errorText')
      expect(convertToModelMessages([reopened], { ignoreIncompleteToolCalls: true }))
        .not.toContainEqual(expect.objectContaining({ role: 'tool' }))
    }
  )
})

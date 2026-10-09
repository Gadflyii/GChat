import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  executeChatToolCalls,
  executeClaimedChatToolBatch,
  shouldSendToolFollowUp,
  type ChatToolCall,
  type ChatToolOutput,
} from '../execute-chat-tool-calls'
import { Chat, type UIMessage } from '@ai-sdk/react'
import type { ChatTransport, UIMessageChunk } from 'ai'
import type { CustomChatTransport } from '@/lib/custom-chat-transport'
import { isSessionBusy, useChatSessions } from '@/stores/chat-session-store'

const calls: ChatToolCall[] = [
  { toolCallId: 'call-1', toolName: 'search', input: { query: 'alpha' } },
  { toolCallId: 'call-2', toolName: 'search', input: { query: 'beta' } },
]

const baseOptions = () => ({
  threadId: 'thread-1',
  ragToolNames: new Set<string>(),
  capabilityToolNames: new Set(['search']),
  callRagTool: vi.fn(),
  getProjectId: vi.fn(),
  processOutput: vi.fn(async (content) => content),
  onError: vi.fn(),
})

describe('executeChatToolCalls', () => {
  it('dispatches compact discovery tools through the shared capability executor', async () => {
    const callCapability = vi.fn().mockResolvedValue({ content: [{ name: 'os_fs_read', description: 'Read files' }] })
    const outputs: ChatToolOutput[] = []
    await executeChatToolCalls({
      ...baseOptions(),
      capabilityToolNames: new Set(),
      toolCalls: [{ toolCallId: 'discover', toolName: 'gchat_capability_search', input: { query: 'read files' } }],
      signal: new AbortController().signal,
      callCapability,
      addToolOutput: (output) => { outputs.push(output) },
    })
    expect(callCapability).toHaveBeenCalledWith({ toolName: 'gchat_capability_search', arguments: { query: 'read files' } })
    expect(outputs).toEqual([{
      tool: 'gchat_capability_search',
      toolCallId: 'discover',
      output: [{ name: 'os_fs_read', description: 'Read files' }],
    }])
  })

  it('executes shared capability calls in order and adds output for continuation', async () => {
    const events: string[] = []
    const callCapability = vi.fn(async ({ arguments: input }) => {
      events.push(`call:${(input as { query: string }).query}`)
      return { content: [{ type: 'text', text: 'result' }] }
    })
    const outputs: ChatToolOutput[] = []
    const addToolOutput = vi.fn((output: ChatToolOutput) => {
      events.push(`output:${output.toolCallId}`)
      outputs.push(output)
    })

    await executeChatToolCalls({
      ...baseOptions(),
      toolCalls: calls,
      signal: new AbortController().signal,
      callCapability,
      addToolOutput,
    })

    expect(events).toEqual([
      'call:alpha',
      'output:call-1',
      'call:beta',
      'output:call-2',
    ])
    expect(outputs).toEqual([
      {
        tool: 'search',
        toolCallId: 'call-1',
        output: [{ type: 'text', text: 'result' }],
      },
      {
        tool: 'search',
        toolCallId: 'call-2',
        output: [{ type: 'text', text: 'result' }],
      },
    ])
  })

  it('stops before the next tool when aborted after adding output', async () => {
    const controller = new AbortController()
    const completedToolCalls: string[] = []
    const callCapability = vi
      .fn()
      .mockResolvedValue({ content: [{ type: 'text', text: 'result' }] })
    const addToolOutput = vi.fn((output: ChatToolOutput) => {
      completedToolCalls.push(output.toolCallId)
      controller.abort()
    })

    await executeChatToolCalls({
      ...baseOptions(),
      toolCalls: calls,
      signal: controller.signal,
      callCapability,
      addToolOutput,
    })

    expect(completedToolCalls).toEqual(['call-1'])
  })

  it('reports denial without calling a service', async () => {
    const options = baseOptions()
    const callCapability = vi.fn().mockResolvedValue({ error: 'Tool execution denied by user' })
    const outputs: ChatToolOutput[] = []
    const addToolOutput = vi.fn((output: ChatToolOutput) =>
      outputs.push(output)
    )

    await executeChatToolCalls({
      ...options,
      toolCalls: [calls[0]],
      signal: new AbortController().signal,
      callCapability,
      addToolOutput,
    })

    expect(callCapability).toHaveBeenCalledOnce()
    expect(outputs).toEqual([
      {
        state: 'output-error',
        tool: 'search',
        toolCallId: 'call-1',
        errorText: 'Error: Tool execution denied by user',
      },
    ])
  })
})

describe('claimed chat tool batches', () => {
  beforeEach(() => {
    useChatSessions.getState().clearSessions()
  })

  it('keeps a final answer busy until the preceding tool batch settles', async () => {
    const chat = { messages: [], status: 'ready', stop: vi.fn() } as unknown as Chat<UIMessage>
    useChatSessions.getState().ensureSession(
      'thread-1',
      {} as CustomChatTransport,
      () => chat
    )
    const sessionData = useChatSessions.getState().getSessionData('thread-1')
    sessionData.tools.push(calls[0])
    useChatSessions.getState().updateStatus('thread-1', 'streaming')
    const options = {
      ...baseOptions(),
      signal: new AbortController().signal,
      callCapability: vi.fn().mockResolvedValue({ content: 'result' }),
      addToolOutput: vi.fn(() => {
        // addToolOutput can launch the follow-up before this batch's finally runs.
        useChatSessions.getState().updateStatus('thread-1', 'ready')
        expect(executeClaimedChatToolBatch(options)).toBeUndefined()
        expect(isSessionBusy(useChatSessions.getState().sessions['thread-1'])).toBe(true)
      }),
    }

    const execution = executeClaimedChatToolBatch(options)
    expect(execution).toBeDefined()
    expect(sessionData.tools).toEqual([])
    await execution

    expect(options.addToolOutput).toHaveBeenCalledOnce()
    expect(isSessionBusy(useChatSessions.getState().sessions['thread-1'])).toBe(false)
  })

  it('waits for SDK output admission before ending the batch', async () => {
    const chat = { messages: [], status: 'ready', stop: vi.fn() } as unknown as Chat<UIMessage>
    useChatSessions.getState().ensureSession(
      'thread-1',
      {} as CustomChatTransport,
      () => chat
    )
    useChatSessions.getState().getSessionData('thread-1').tools.push(calls[0])
    let admitOutput!: () => void
    const admission = new Promise<void>((resolve) => { admitOutput = resolve })
    const options = {
      ...baseOptions(),
      signal: new AbortController().signal,
      callCapability: vi.fn().mockResolvedValue({ content: 'result' }),
      addToolOutput: vi.fn(() => admission),
    }

    const execution = executeClaimedChatToolBatch(options)!
    await vi.waitFor(() => expect(options.addToolOutput).toHaveBeenCalledOnce())
    expect(isSessionBusy(useChatSessions.getState().sessions['thread-1'])).toBe(true)

    admitOutput()
    await execution
    expect(isSessionBusy(useChatSessions.getState().sessions['thread-1'])).toBe(false)
  })

  it('settles after SDK rejects tool output admission', async () => {
    const chat = { messages: [], status: 'ready', stop: vi.fn() } as unknown as Chat<UIMessage>
    useChatSessions.getState().ensureSession(
      'thread-1',
      {} as CustomChatTransport,
      () => chat
    )
    useChatSessions.getState().getSessionData('thread-1').tools.push(calls[0])
    const options = {
      ...baseOptions(),
      signal: new AbortController().signal,
      callCapability: vi.fn().mockResolvedValue({ content: 'result' }),
      addToolOutput: vi.fn().mockRejectedValue(new Error('admission failed')),
    }

    await executeClaimedChatToolBatch(options)

    expect(options.addToolOutput).toHaveBeenCalledOnce()
    expect(options.onError).toHaveBeenCalledOnce()
    expect(isSessionBusy(useChatSessions.getState().sessions['thread-1'])).toBe(false)
  })

  it('keeps cancellation scoped to each cached session', () => {
    const chat = () => ({ messages: [], status: 'ready', stop: vi.fn() }) as unknown as Chat<UIMessage>
    const transport = {} as CustomChatTransport
    useChatSessions.getState().ensureSession('thread-a', transport, chat)
    useChatSessions.getState().ensureSession('thread-b', transport, chat)
    const sessionA = useChatSessions.getState().getSessionData('thread-a')
    const sessionB = useChatSessions.getState().getSessionData('thread-b')
    const controllerA = useChatSessions.getState().getToolCallController('thread-a')
    const controllerB = useChatSessions.getState().getToolCallController('thread-b')

    useChatSessions.getState().abortToolCalls('thread-b')

    expect(controllerA.signal.aborted).toBe(false)
    expect(controllerB.signal.aborted).toBe(true)
    expect(sessionA.toolCallAbortController.signal.aborted).toBe(false)
    expect(sessionB.toolCallAbortController).toBeNull()
  })

  it('finishes a cached SDK Chat after a tool call and final text response', async () => {
    const threadId = 'thread-1'
    const sessionData = useChatSessions.getState().getSessionData(threadId)
    let requests = 0
    const chunks: UIMessageChunk[][] = [
      [
        { type: 'start' },
        { type: 'start-step' },
        { type: 'tool-input-available', toolCallId: 'call-1', toolName: 'search', input: { query: 'weather' }, dynamic: true },
        { type: 'finish-step' },
        { type: 'finish', finishReason: 'tool-calls' },
      ],
      [
        { type: 'start' },
        { type: 'start-step' },
        { type: 'text-start', id: 'text-1' },
        { type: 'text-delta', id: 'text-1', delta: 'Tomorrow is clear.' },
        { type: 'text-end', id: 'text-1' },
        { type: 'finish-step' },
        { type: 'finish', finishReason: 'stop' },
      ],
    ]
    const transport = {
      sendMessages: vi.fn(async () => {
        const response = chunks[requests++]
        if (!response) throw new Error('unexpected SDK request')
        return new ReadableStream<UIMessageChunk>({
          start(controller) {
            response.forEach((chunk) => controller.enqueue(chunk))
            controller.close()
          },
        })
      }),
    } as unknown as ChatTransport<UIMessage>
    let chat!: Chat<UIMessage>
    chat = new Chat<UIMessage>({
      transport,
      onToolCall: ({ toolCall }) => { sessionData.tools.push(toolCall) },
      onFinish: () => {
        if (sessionData.tools.length === 0) return
        const signal = useChatSessions.getState().getToolCallController(threadId).signal
        void executeClaimedChatToolBatch({
          ...baseOptions(),
          signal,
          callCapability: vi.fn().mockResolvedValue({ content: 'Clear skies' }),
          addToolOutput: (output) => chat.addToolOutput(output),
        })
      },
      sendAutomaticallyWhen: ({ messages }) =>
        shouldSendToolFollowUp(messages, sessionData.toolCallAbortController),
    })
    useChatSessions.getState().ensureSession(
      threadId,
      transport as CustomChatTransport,
      () => chat
    )

    await chat.sendMessage({ text: 'What about tomorrow?' })
    await vi.waitFor(() => {
      expect(requests).toBe(2)
      expect(chat.status).toBe('ready')
      expect(chat.messages.at(-1)?.parts).toContainEqual(
        expect.objectContaining({ type: 'text', text: 'Tomorrow is clear.' })
      )
      expect(isSessionBusy(useChatSessions.getState().sessions[threadId])).toBe(false)
    })

    const createAnotherChat = vi.fn()
    expect(useChatSessions.getState().ensureSession(
      threadId,
      transport as CustomChatTransport,
      createAnotherChat
    )).toBe(chat)
    expect(createAnotherChat).not.toHaveBeenCalled()
    expect(isSessionBusy(useChatSessions.getState().sessions[threadId])).toBe(false)
  })
})

describe('shouldSendToolFollowUp', () => {
  const completedToolMessage = {
    id: 'assistant-1',
    role: 'assistant',
    parts: [
      {
        type: 'tool-search',
        toolCallId: 'call-1',
        state: 'output-available',
        input: { query: 'alpha' },
        output: { ok: true },
      },
    ],
  } as UIMessage

  it('continues after complete tool output while the loop is active', () => {
    expect(
      shouldSendToolFollowUp([completedToolMessage], new AbortController())
    ).toBe(true)
  })

  it('does not continue after the tool loop is aborted', () => {
    const controller = new AbortController()
    controller.abort()

    expect(shouldSendToolFollowUp([completedToolMessage], controller)).toBe(
      false
    )
    expect(shouldSendToolFollowUp([completedToolMessage], null)).toBe(false)
  })
})

import { EngineManager, MessageStatus, type ThreadMessage } from '@gchat/core'
import { useContextUsage } from '@/hooks/useContextUsage'
import type { UIMessage } from '@ai-sdk/react'
import type { LanguageModel } from 'ai'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useConversationPolicy } from '@/hooks/useConversationPolicy'
import { useAgentRun } from '@/hooks/useAgentRun'
import { useAppState } from '@/hooks/useAppState'
import { useGeneralSetting } from '@/hooks/useGeneralSetting'
import { useModelProvider } from '@/hooks/useModelProvider'
import { useToolAvailable } from '@/hooks/useToolAvailable'
import { seedServiceHub } from '@/test/service-hub'
import { CustomChatTransport } from '../custom-chat-transport'
import { ModelFactory } from '../model-factory'
import { Chat } from '@ai-sdk/react'
import { executeChatCapability, chatCapabilityRun } from '../execute-chat-capability'
import { executeClaimedChatToolBatch, shouldSendToolFollowUp } from '../execute-chat-tool-calls'
import { isSessionBusy, useChatSessions } from '@/stores/chat-session-store'
import { convertThreadMessageToUIMessage, extractContentPartsFromUIMessage } from '../messages'
import type { GInferContextState } from '../smart-context'
import type { CapabilitiesService } from '@/services/capabilities/types'
import * as agentDefinitions from '@/services/agent/definitions'
import { conversationDocumentAccess, processAttachmentsForSend } from '../attachmentProcessing'
import { newUserThreadContent } from '../completion'
import { createDocumentAttachment } from '@/types/attachment'

type ModelStreamPart =
  | { type: 'stream-start'; warnings: [] }
  | { type: 'text-start'; id: string }
  | { type: 'text-delta'; id: string; delta: string }
  | { type: 'text-end'; id: string }
  | { type: 'tool-input-start'; id: string; toolName: string }
  | { type: 'tool-input-delta'; id: string; delta: string }
  | { type: 'tool-input-end'; id: string }
  | {
      type: 'tool-call'
      toolCallId: string
      toolName: string
      input: string
    }
  | {
      type: 'finish'
      finishReason: 'stop' | 'tool-calls'
      usage: {
        inputTokens: number
        outputTokens: number
        totalTokens: number
      }
    }

const fakeStreamingModel = (parts: ModelStreamPart[]): LanguageModel =>
  ({
    specificationVersion: 'v2',
    provider: 'fixture',
    modelId: 'fixture-model',
    supportedUrls: {},
    doGenerate: vi.fn(),
    doStream: vi.fn(async () => ({
      stream: new ReadableStream({
        start(controller) {
          parts.forEach((part) => controller.enqueue(part))
          controller.close()
        },
      }),
    })),
  }) as unknown as LanguageModel

const userMessage: UIMessage = {
  id: 'user-1',
  role: 'user',
  parts: [{ type: 'text', text: 'hello' }],
}

async function readChunks(
  stream: ReadableStream<Record<string, unknown>>
): Promise<Array<Record<string, unknown>>> {
  const chunks: Array<Record<string, unknown>> = []
  for await (const chunk of stream) chunks.push(chunk)
  return chunks
}

describe('CustomChatTransport production harness', () => {
  beforeEach(() => {
    useConversationPolicy.getState().clearAll()
    useAgentRun.getState().clearAll()
    useChatSessions.getState().clearSessions()
    seedServiceHub({
      rag: { getTools: vi.fn().mockResolvedValue([]) } as never,
    })
    useAppState.setState({
      tools: [],
      intentionallyStoppedModels: new Set(),
      ragToolNames: new Set(),
      capabilityToolNames: new Set(),
    })
    useToolAvailable.setState({
      disabledTools: {},
      defaultDisabledTools: [],
    })
    useModelProvider.setState({
      selectedProvider: 'ginfer',
      selectedModel: {
        id: 'fixture-model',
        capabilities: [],
        settings: {},
      } as never,
      providers: [
        {
          provider: 'ginfer',
          active: true,
          api_key: '',
          base_url: 'http://localhost',
          models: [],
          settings: [],
        },
      ] as never,
    })
  })

  it.each([
    { status: 'finished', reason: 'reply', error: undefined },
    { status: 'incomplete', reason: 'max_steps', error: undefined },
    { status: 'failed', reason: 'failed', error: 'Worker failed' },
  ] as const)(
    'continues streaming Chat after a $status delegated run and reopens its history',
    async (outcome) => {
      const threadId = 'delegated-chat'
      const service = seedServiceHub({
        rag: { getTools: vi.fn().mockResolvedValue([]) } as never,
        capabilities: {
          getCatalog: vi.fn(),
          cancel: vi.fn(),
          execute: vi.fn<CapabilitiesService['execute']>(
            async (request, event) => {
              event({
                type: 'turn_started',
                run_id: request.run_id,
                session_id: threadId,
              })
              event({
                type: 'orchestration_started',
                definition_id: 'team',
                definition_name: 'Team',
                kind: 'coordinator',
                default_model_instance_id: 'fixture-model',
              })
              for (const stageId of ['researcher', 'critic']) {
                event({
                  type: 'stage_started',
                  stage_id: stageId,
                  name: stageId,
                  role: 'worker',
                  cycle: null,
                  model_instance_id: 'fixture-model',
                  reasoning_effort: null,
                })
                event({
                  type: 'stage_finished',
                  stage_id: stageId,
                  name: stageId,
                  status: 'max_steps',
                  summary: 'Reached step limit',
                  step_count: 12,
                  duration_ms: 0,
                  model_instance_id: 'fixture-model',
                  model_id: 'fixture-model',
                  reasoning_effort: null,
                  inference: {
                    promptTokens: 0,
                    generatedTokens: 0,
                    promptMs: 0,
                    generationMs: 0,
                  },
                })
              }
              if (outcome.error)
                event({
                  type: 'step_error',
                  category: 'orchestration',
                  message: outcome.error,
                })
              event({
                type: 'turn_finished',
                reason: outcome.reason,
                step_count: 25,
              })
              return {
                content: { status: outcome.status, result: 'Task result' },
                ...(outcome.error ? { error: outcome.error } : {}),
                run: {
                  runId: request.run_id,
                  status: outcome.status,
                  reason: outcome.reason,
                  stepCount: 25,
                },
              }
            }
          ),
        },
      }).capabilities()
      useAppState.setState({
        tools: [
          {
            name: 'agent_run',
            server: 'gchat-native',
            description: 'Run agent',
            inputSchema: { type: 'object' },
          },
        ],
        capabilityToolNames: new Set(['agent_run']),
      })
      useModelProvider.setState((state) => ({
        selectedModel: {
          ...state.selectedModel,
          capabilities: ['tools'],
        } as never,
      }))
      const firstModel = fakeStreamingModel([
        { type: 'stream-start', warnings: [] },
        {
          type: 'tool-call',
          toolCallId: 'agent-call',
          toolName: 'agent_run',
          input: '{"definitionId":"team","task":"Work"}',
        },
        {
          type: 'finish',
          finishReason: 'tool-calls',
          usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
        },
      ])
      const model = fakeStreamingModel([
        { type: 'stream-start', warnings: [] },
        { type: 'text-start', id: 'answer' },
        {
          type: 'text-delta',
          id: 'answer',
          delta: 'Two workers reached their limits.',
        },
        { type: 'text-end', id: 'answer' },
        {
          type: 'finish',
          finishReason: 'stop',
          usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
        },
      ])
      vi.mocked(model.doStream).mockImplementationOnce(
        vi.mocked(firstModel.doStream)
      )
      vi.spyOn(ModelFactory, 'createModel').mockResolvedValue(model)
      const transport = new CustomChatTransport(undefined, threadId)
      const sessionData = useChatSessions.getState().getSessionData(threadId)
      const onError = vi.fn()
      let chat!: Chat<UIMessage>
      chat = new Chat<UIMessage>({
        id: threadId,
        transport,
        onError,
        onToolCall: ({ toolCall }) => {
          sessionData.tools.push(toolCall)
        },
        onFinish: () => {
          if (!sessionData.tools.length) return
          const signal = useChatSessions
            .getState()
            .getToolCallController(threadId).signal
          void executeClaimedChatToolBatch({
            threadId,
            signal,
            ragToolNames: new Set(),
            capabilityToolNames: new Set(['agent_run']),
            callRagTool: vi.fn(),
            getProjectId: () => undefined,
            processOutput: async (content) => content,
            callCapability: (call) =>
              executeChatCapability({ service, threadId, signal, ...call }),
            addToolOutput: (output) => chat.addToolOutput(output),
            onError,
          })
        },
        sendAutomaticallyWhen: ({ messages }) =>
          shouldSendToolFollowUp(messages, sessionData.toolCallAbortController),
      })
      useChatSessions.getState().ensureSession(threadId, transport, () => chat)

      await chat.sendMessage({ text: 'Run the team' })
      await vi.waitFor(() => {
        expect(chat.status).toBe('ready')
        expect(chat.messages.at(-1)?.parts).toContainEqual(
          expect.objectContaining({
            type: 'text',
            text: 'Two workers reached their limits.',
          })
        )
        expect(
          isSessionBusy(useChatSessions.getState().sessions[threadId])
        ).toBe(false)
      })
      expect(onError).not.toHaveBeenCalled()
      expect(model.doStream).toHaveBeenCalledTimes(2)
      const summary = chatCapabilityRun(chat.messages.at(-1)!)!
      expect(summary).toMatchObject({
        status: outcome.status,
        finish_reason: outcome.reason,
        step_count: 25,
        stages: [
          { id: 'researcher', status: 'incomplete', duration_ms: 0 },
          { id: 'critic', status: 'incomplete', duration_ms: 0 },
        ],
      })
      expect(summary.stages[0].inference).toEqual({
        prompt_tokens: 0,
        generated_tokens: 0,
        prompt_ms: 0,
        generation_ms: 0,
      })
      expect(summary.error).toEqual(
        outcome.error
          ? { category: 'orchestration', message: outcome.error }
          : undefined
      )
      const toolPrompt = vi
        .mocked(model.doStream)
        .mock.calls[1][0].prompt.find((message) => message.role === 'tool')!
      expect(toolPrompt.content).toContainEqual(
        expect.objectContaining({
          output: {
            type: 'json',
            value: expect.objectContaining({
              agent_run: summary,
              ...(outcome.error ? { error: outcome.error } : {}),
            }),
          },
        })
      )
      expect(summary).toStrictEqual(JSON.parse(JSON.stringify(summary)))
      const saved: ThreadMessage[] = chat.messages.map((message) => ({
        id: message.id,
        thread_id: threadId,
        object: 'thread.message',
        type: 'text',
        role: message.role as ThreadMessage['role'],
        status: MessageStatus.Ready,
        content: extractContentPartsFromUIMessage(message),
        created_at: 0,
        completed_at: 0,
        metadata: { agent_run: chatCapabilityRun(message) },
      }))
      const history = (
        JSON.parse(JSON.stringify(saved)) as ThreadMessage[]
      ).map(convertThreadMessageToUIMessage)
      expect(chatCapabilityRun(history.at(-1)!)).toEqual(summary)
      const reopened = new Chat<UIMessage>({
        id: threadId,
        transport: new CustomChatTransport(undefined, threadId),
        messages: history,
        onError,
      })
      await reopened.sendMessage({ text: 'Explain the result' })
      expect(reopened.status).toBe('ready')
      expect(reopened.messages.at(-1)?.parts).toContainEqual(
        expect.objectContaining({
          type: 'text',
          text: 'Two workers reached their limits.',
        })
      )
      expect(onError).not.toHaveBeenCalled()
      expect(model.doStream).toHaveBeenCalledTimes(3)
    }
  )

  it('uses loaded capacity and publishes exact request usage through finish metadata', async () => {
    const engine = vi.spyOn(EngineManager, 'instance').mockReturnValue({
      get: () => ({ getLoadedContext: async () => 131072 }),
    } as unknown as EngineManager)
    vi.spyOn(ModelFactory, 'createModel').mockImplementation(async (...args) => {
      const policy = args[4]!
      expect(policy.configuredContextTokens).toBe(131072)
      policy.onUsage?.({ inputTokens: 42158, contextTokens: 131072, reservedOutputTokens: 8192 })
      return fakeStreamingModel([
        { type: 'stream-start', warnings: [] },
        { type: 'finish', finishReason: 'stop', usage: {
          inputTokens: 42158, outputTokens: 234, totalTokens: 42392,
        } },
      ])
    })
    try {
      const chunks = await readChunks(await new CustomChatTransport().sendMessages({
        chatId: 'counted-chat', messages: [userMessage], abortSignal: undefined,
        trigger: 'submit-message', messageId: undefined,
      }) as ReadableStream<Record<string, unknown>>)
      const expected = {
        modelId: 'fixture-model', inputTokens: 42158, outputTokens: 234,
        contextTokens: 131072, reservedOutputTokens: 8192,
      }
      expect(useContextUsage.getState().requests['counted-chat']).toEqual(expected)
      expect(chunks).toContainEqual(expect.objectContaining({
        messageMetadata: expect.objectContaining({ contextUsage: expected }),
      }))
    } finally {
      engine.mockRestore()
    }
  })

  it('preserves delta order while stripping leaked MLX special tokens', async () => {
    vi.spyOn(ModelFactory, 'createModel').mockResolvedValue(
      fakeStreamingModel([
        { type: 'stream-start', warnings: [] },
        { type: 'text-start', id: 'text-1' },
        { type: 'text-delta', id: 'text-1', delta: 'Hello ' },
        { type: 'text-delta', id: 'text-1', delta: '<|eot_id|>' },
        { type: 'text-delta', id: 'text-1', delta: 'world' },
        { type: 'text-end', id: 'text-1' },
        {
          type: 'finish',
          finishReason: 'stop',
          usage: { inputTokens: 1, outputTokens: 3, totalTokens: 4 },
        },
      ])
    )
    const transport = new CustomChatTransport()

    const chunks = await readChunks(
      (await transport.sendMessages({
        chatId: 'chat-1',
        messages: [userMessage],
        abortSignal: undefined,
        trigger: 'submit-message',
        messageId: undefined,
      })) as ReadableStream<Record<string, unknown>>
    )

    expect(
      chunks
        .filter((chunk) => chunk.type === 'text-delta')
        .map((chunk) => chunk.delta)
    ).toEqual(['Hello ', ' ', 'world'])
  })

  it('advertises native skills with the real system instructions and keeps the owning model', async () => {
    useAppState.setState({
      tools: [{ name: 'skill_list', server: 'gchat-native', description: 'List skills', inputSchema: { type: 'object' } }],
      capabilityToolNames: new Set(['skill_list']),
    })
    useModelProvider.setState((state) => ({ selectedModel: { ...state.selectedModel, capabilities: ['tools'] } as never }))
    const model = fakeStreamingModel([{ type: 'finish', finishReason: 'stop', usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } }])
    vi.spyOn(ModelFactory, 'createModel').mockResolvedValue(model)
    const transport = new CustomChatTransport('Use my assistant instructions.', 'chat-a')
    await readChunks(await transport.sendMessages({ chatId: 'chat-a', messages: [userMessage], trigger: 'submit-message', messageId: undefined, abortSignal: undefined }) as ReadableStream<Record<string, unknown>>)
    const request = vi.mocked(model.doStream).mock.calls[0][0]
    expect(request.tools).toContainEqual(expect.objectContaining({ name: 'skill_list' }))
    expect(request.prompt[0]).toMatchObject({ role: 'system', content: expect.stringContaining('Use my assistant instructions.') })
    expect(request.prompt[0]).toMatchObject({ content: expect.stringContaining('skill_list') })
    useModelProvider.setState({ selectedModel: { id: 'other-model' } as never })
    expect(transport.requestModelId).toBe('fixture-model')
  })

  it('uses the selected skill shortcut once then allows a normal streaming follow-up', async () => {
    useAppState.setState({ tools: [{ name: 'skill_invoke', server: 'gchat-native', description: 'Invoke skill', inputSchema: { type: 'object' } }], capabilityToolNames: new Set(['skill_invoke']) })
    useModelProvider.setState((state) => ({ selectedModel: { ...state.selectedModel, capabilities: ['tools'] } as never }))
    useConversationPolicy.getState().setActiveSkill('chat-a', 'agent-builder')
    const model = fakeStreamingModel([{ type: 'finish', finishReason: 'stop', usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } }])
    vi.spyOn(ModelFactory, 'createModel').mockResolvedValue(model)
    const transport = new CustomChatTransport(undefined, 'chat-a')
    const options = { chatId: 'chat-a', trigger: 'submit-message' as const, messageId: undefined, abortSignal: undefined }
    await readChunks(await transport.sendMessages({ ...options, messages: [userMessage] }) as ReadableStream<Record<string, unknown>>)
    expect(vi.mocked(model.doStream).mock.calls[0][0].toolChoice).toEqual({ type: 'tool', toolName: 'skill_invoke' })
    const assistant: UIMessage = { id: 'tool-reply', role: 'assistant', parts: [{ type: 'tool-skill_invoke', toolCallId: 'call', state: 'output-available', input: { name: 'agent-builder', task: 'Build' }, output: 'Saved definition' }] }
    await readChunks(await transport.sendMessages({ ...options, messages: [userMessage, assistant] }) as ReadableStream<Record<string, unknown>>)
    expect(vi.mocked(model.doStream).mock.calls[1][0].toolChoice).toEqual({ type: 'auto' })
  })

  it('dispatches the explicitly selected saved agent through shared capabilities and continues normally', async () => {
    useAppState.setState({ tools: [{ name: 'agent_run', server: 'gchat-native', description: 'Invoke saved agent', inputSchema: { type: 'object' } }], capabilityToolNames: new Set(['agent_run']) })
    useModelProvider.setState((state) => ({ selectedModel: { ...state.selectedModel, capabilities: ['tools'] } as never }))
    useConversationPolicy.getState().setActiveDefinition('chat-agent', 'researcher')
    const model = fakeStreamingModel([{ type: 'finish', finishReason: 'stop', usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } }])
    vi.spyOn(ModelFactory, 'createModel').mockResolvedValue(model)
    const transport = new CustomChatTransport(undefined, 'chat-agent')
    const options = { chatId: 'chat-agent', trigger: 'submit-message' as const, messageId: undefined, abortSignal: undefined }
    await readChunks(await transport.sendMessages({ ...options, messages: [userMessage] }) as ReadableStream<Record<string, unknown>>)
    const request = vi.mocked(model.doStream).mock.calls[0][0]
    expect(request.toolChoice).toEqual({ type: 'tool', toolName: 'agent_run' })
    expect(request.tools).toContainEqual(expect.objectContaining({ name: 'agent_run', inputSchema: expect.objectContaining({ properties: expect.objectContaining({ definitionId: { type: 'string', enum: ['researcher'] } }) }) }))
    const output: UIMessage = { id: 'delegate', role: 'assistant', parts: [{ type: 'tool-agent_run', toolCallId: 'run', state: 'output-available', input: { definitionId: 'researcher', task: 'Work' }, output: 'Report' }] }
    await readChunks(await transport.sendMessages({ ...options, messages: [userMessage, output] }) as ReadableStream<Record<string, unknown>>)
    expect(vi.mocked(model.doStream).mock.calls[1][0].toolChoice).toEqual({ type: 'auto' })
    useConversationPolicy.getState().setActiveDefinition('chat-agent')
    await readChunks(await transport.sendMessages({ ...options, messages: [userMessage, output, { ...userMessage, id: 'next' }] }) as ReadableStream<Record<string, unknown>>)
    expect(vi.mocked(model.doStream).mock.calls[2][0].toolChoice).toEqual({ type: 'auto' })
  })

  it('receives Excel document text and metadata through ordinary streaming Chat and completes its SDK follow-up', async () => {
    const threadId = 'ordinary-excel-chat'
    const toolName = 'os_fs_read_document'
    const path = 'C:\\Users\\Ron\\Desktop\\Quarterly budget.xlsx'
    // Matches the native executor's independently verified real-XLSX result.
    const documentOutput = { summary: 'Sheet: Budget\nRevenue\t42000\nExpenses\t12000', details: { path, originalChars: 54, truncated: false } }
    const execute = vi.fn<CapabilitiesService['execute']>(async (request, event) => {
      event({ type: 'turn_started', run_id: request.run_id, session_id: request.session_id })
      event({ type: 'turn_finished', reason: 'reply', step_count: 1 })
      return { content: documentOutput }
    })
    const ingestFileAttachment = vi.fn().mockRejectedValue(new Error('GInfer embeddings unavailable'))
    const parseDocumentMock = vi.fn().mockRejectedValue(new Error('Native folder approval owns reading'))
    const serviceHub = seedServiceHub({
      capabilities: { getCatalog: vi.fn(), execute, cancel: vi.fn() },
      uploads: { ingestFileAttachment } as never, rag: { parseDocument: parseDocumentMock } as never,
    })
    const service = serviceHub.capabilities()
    useConversationPolicy.getState().setApprovalMode(threadId, 'manual')
    useConversationPolicy.getState().addExternalRoot(threadId, { rootId: 'desktop', path: 'C:\\Users\\Ron\\Desktop', name: 'Desktop', canEdit: false })
    useAppState.setState({ tools: [{ name: toolName, server: 'gchat-native', description: 'Extract Excel document content', inputSchema: { type: 'object' } }], capabilityToolNames: new Set([toolName]) })
    useModelProvider.setState((state) => ({ selectedModel: { ...state.selectedModel, capabilities: ['tools'] } as never }))
    const prepared = await processAttachmentsForSend({
      attachments: [createDocumentAttachment({ name: 'Quarterly budget.xlsx', path, fileType: 'xlsx', parseMode: 'auto' })],
      threadId, serviceHub, parsePreference: 'auto',
      documentAccess: conversationDocumentAccess(true, useAppState.getState().tools, [], undefined),
    })
    const savedUser = newUserThreadContent(threadId, 'Summarize the attached budget.', prepared.processedAttachments)
    const attachmentMessage = convertThreadMessageToUIMessage(JSON.parse(JSON.stringify(savedUser)))
    expect(ingestFileAttachment).not.toHaveBeenCalled()
    expect(parseDocumentMock).not.toHaveBeenCalled()
    expect(prepared.hasEmbeddedDocuments).toBe(false)
    const first = fakeStreamingModel([
      { type: 'stream-start', warnings: [] },
      { type: 'tool-call', toolCallId: 'excel-read', toolName, input: JSON.stringify({ path }) },
      { type: 'finish', finishReason: 'tool-calls', usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } },
    ])
    const model = fakeStreamingModel([
      { type: 'stream-start', warnings: [] }, { type: 'text-start', id: 'answer' },
      { type: 'text-delta', id: 'answer', delta: 'The budget lists revenue of 42000 and expenses of 12000.' },
      { type: 'text-end', id: 'answer' },
      { type: 'finish', finishReason: 'stop', usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } },
    ])
    vi.mocked(model.doStream).mockImplementationOnce(vi.mocked(first.doStream))
    vi.spyOn(ModelFactory, 'createModel').mockResolvedValue(model)
    const transport = new CustomChatTransport(undefined, threadId)
    const session = useChatSessions.getState().getSessionData(threadId)
    const onError = vi.fn()
    let chat!: Chat<UIMessage>
    chat = new Chat<UIMessage>({
      id: threadId, transport, onError,
      onToolCall: ({ toolCall }) => { session.tools.push(toolCall) },
      onFinish: () => {
        if (!session.tools.length) return
        const signal = useChatSessions.getState().getToolCallController(threadId).signal
        void executeClaimedChatToolBatch({ threadId, signal,
          ragToolNames: new Set(), capabilityToolNames: new Set([toolName]),
          callRagTool: vi.fn(), getProjectId: () => undefined, processOutput: async (content) => content,
          callCapability: (call) => executeChatCapability({ service, threadId, signal, ...call }),
          addToolOutput: (output) => chat.addToolOutput(output), onError,
        })
      },
      sendAutomaticallyWhen: ({ messages }) => shouldSendToolFollowUp(messages, session.toolCallAbortController),
    })
    useChatSessions.getState().ensureSession(threadId, transport, () => chat)
    await chat.sendMessage({ id: attachmentMessage.id, parts: attachmentMessage.parts, metadata: attachmentMessage.metadata })
    await vi.waitFor(() => {
      expect(chat.status).toBe('ready')
      expect(chat.messages.at(-1)?.parts).toContainEqual(expect.objectContaining({ type: 'text', text: 'The budget lists revenue of 42000 and expenses of 12000.' }))
      expect(isSessionBusy(useChatSessions.getState().sessions[threadId])).toBe(false)
    })
    expect(onError).not.toHaveBeenCalled()
    expect(execute.mock.calls[0][0]).toMatchObject({ tool_name: toolName, auto_approve: false, external_roots: [{ path: 'C:\\Users\\Ron\\Desktop', can_edit: false }] })
    const request = vi.mocked(model.doStream).mock.calls[1][0]
    expect(JSON.stringify(request.prompt)).toContain('Revenue')
    expect(JSON.stringify(request.prompt)).toContain('42000')
    expect(JSON.stringify(request.prompt)).toContain('12000')
    expect(request.prompt[0]).toMatchObject({ role: 'system', content: expect.stringContaining('os_fs_read_document') })
    expect(request.prompt[0]).toMatchObject({ role: 'system', content: expect.stringContaining(JSON.stringify(path)) })
    expect(useConversationPolicy.getState().legacyAgentThreads[threadId]).toBeUndefined()
    const savedHistory = JSON.parse(JSON.stringify(chat.messages)) as UIMessage[]
    const reopened = new Chat<UIMessage>({ id: threadId, transport: new CustomChatTransport(undefined, threadId), messages: savedHistory, onError })
    await reopened.sendMessage({ text: 'Where was that attachment stored?' })
    expect(reopened.status).toBe('ready')
    const continuedPrompt = vi.mocked(model.doStream).mock.calls[2][0].prompt
    expect(continuedPrompt).toContainEqual(expect.objectContaining({ role: 'user', content: expect.arrayContaining([
      expect.objectContaining({ type: 'text', text: expect.stringContaining(JSON.stringify(path)) }),
    ]) }))
    expect(chat.messages[0].parts[0]).toMatchObject({ type: 'text', text: expect.not.stringContaining('Attached local document references:') })
  })

  it('repairs malformed streamed tool input through the production boundary', async () => {
    useAppState.setState({
      tools: [
        {
          name: 'search',
          server: 'fixture',
          description: 'Search',
          inputSchema: {
            type: 'object',
            properties: { query: { type: 'string' } },
            required: ['query'],
          },
        },
      ],
      capabilityToolNames: new Set(['search']),
    })
    useModelProvider.setState((state) => ({
      selectedModel: {
        ...state.selectedModel!,
        capabilities: ['tools'],
      },
    }))
    vi.spyOn(ModelFactory, 'createModel').mockResolvedValue(
      fakeStreamingModel([
        { type: 'stream-start', warnings: [] },
        {
          type: 'tool-call',
          toolCallId: 'call-1',
          toolName: 'search',
          input: '{"query":"alpha"',
        },
        {
          type: 'finish',
          finishReason: 'tool-calls',
          usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
        },
      ])
    )
    const transport = new CustomChatTransport()

    const chunks = await readChunks(
      (await transport.sendMessages({
        chatId: 'chat-1',
        messages: [userMessage],
        abortSignal: undefined,
        trigger: 'submit-message',
        messageId: undefined,
      })) as ReadableStream<Record<string, unknown>>
    )

    expect(chunks).toContainEqual(
      expect.objectContaining({
        type: 'tool-input-available',
        toolCallId: 'call-1',
        toolName: 'search',
        input: { query: 'alpha' },
      })
    )
  })

  it('maps ginfer reasoning state to the OpenAI-compatible reasoning_effort field', async () => {
    const createModel = vi
      .spyOn(ModelFactory, 'createModel')
      .mockImplementation(
        async () =>
          fakeStreamingModel([
            { type: 'stream-start', warnings: [] },
            {
              type: 'finish',
              finishReason: 'stop',
              usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
            },
          ])
      )
    const transport = new CustomChatTransport()
    const send = async () =>
      readChunks(
        (await transport.sendMessages({
          chatId: 'chat-1',
          messages: [userMessage],
          abortSignal: undefined,
          trigger: 'submit-message',
          messageId: undefined,
        })) as ReadableStream<Record<string, unknown>>
      )

    useGeneralSetting.setState({
      disableReasoning: false,
      reasoningBudget: 'low',
    })
    await send()
    expect(createModel.mock.calls[0]?.[3]).toEqual({
      reasoning_effort: 'low',
    })

    useGeneralSetting.setState({ reasoningBudget: 'high' })
    await send()
    expect(createModel.mock.calls[1]?.[3]).toEqual({
      reasoning_effort: 'high',
    })

    // unlimited → no override; the artifact template default applies
    useGeneralSetting.setState({ reasoningBudget: 'unlimited' })
    await send()
    expect(createModel.mock.calls[2]?.[3]).toBeUndefined()

    // off in either control → ginfer's `none` (direct response)
    useGeneralSetting.setState({ reasoningBudget: 'medium' })
    useGeneralSetting.setState({ disableReasoning: true })
    await send()
    expect(createModel.mock.calls[3]?.[3]).toEqual({
      reasoning_effort: 'none',
    })
  })

  it('runs manual compaction as a hidden request and drains its response', async () => {
    const transport = new CustomChatTransport()
    const contextState = (
      transport as unknown as { contextState: GInferContextState }
    ).contextState
    const send = vi.spyOn(transport, 'sendMessages').mockImplementation(
      async () =>
        new ReadableStream({
          start(controller) {
            contextState.manualCompactionResult = {
              status: 'compacted',
              report: {
                inputTokensBefore: 4_000,
                inputTokensAfter: 1_000,
                summarizedMessages: 4,
                retainedMessages: 3,
                reusedCheckpoint: false,
              },
            }
            controller.enqueue({ type: 'finish' })
            controller.close()
          },
        }) as never
    )

    await expect(
      transport.compactContext('chat-1', [userMessage])
    ).resolves.toMatchObject({
      status: 'compacted',
      report: { inputTokensBefore: 4_000, inputTokensAfter: 1_000 },
    })
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        chatId: 'chat-1',
        messages: [userMessage],
      })
    )
    expect(contextState.manualCompactionRequested).toBe(false)
  })

  it('rejects manual compaction without GInfer', async () => {
    useModelProvider.setState({ selectedProvider: 'openai' })
    const transport = new CustomChatTransport()

    await expect(
      transport.compactContext('chat-1', [userMessage])
    ).rejects.toThrow('/compact is available only for a loaded GInfer model.')
  })

  it('does not serialize a blank context or restart a stopped model for compaction', async () => {
    const transport = new CustomChatTransport()
    const send = vi.spyOn(transport, 'sendMessages')
    useModelProvider.setState({ selectedProvider: 'openai' })
    await expect(transport.compactContext('chat-1', [])).resolves.toEqual({ status: 'nothing_to_compact' })
    expect(send).not.toHaveBeenCalled()
    useModelProvider.setState({ selectedProvider: 'ginfer' })
    const modelId = useModelProvider.getState().selectedModel!.id
    useAppState.setState({ intentionallyStoppedModels: new Set([`ginfer::${modelId}`]) })
    await expect(transport.compactContext('chat-1', [userMessage])).rejects.toThrow('Start the selected model')
    expect(send).not.toHaveBeenCalled()
  })

  it('uses the matched paired instance loaded context for manual compaction', async () => {
    const alias = 'ginfer/paired-host/ready-instance'
    const provider = { provider: 'ginfer-lan', active: true, api_key: '', base_url: 'http://127.0.0.1:1337/v1', models: [], settings: [] } as never
    useModelProvider.setState({ selectedProvider: 'ginfer-lan', selectedModel: { id: alias, capabilities: [], settings: {} } as never, providers: [provider] })
    seedServiceHub({
      rag: { getTools: vi.fn().mockResolvedValue([]) } as never,
      app: { getServerStatus: vi.fn().mockResolvedValue(true) } as never,
    })
    const instances = vi.spyOn(agentDefinitions, 'listAgentModelInstances').mockResolvedValue([
      { id: 'ginfer/other-host/other-instance', modelId: 'muse', maxContext: 131072 },
      { id: alias, modelId: 'muse', maxContext: 32768 },
    ] as never)
    const factory = vi.spyOn(ModelFactory, 'createModel').mockImplementation(async (modelId, selectedProvider, _params, _override, policy) => {
      expect(modelId).toBe(alias)
      expect(selectedProvider.provider).toBe('ginfer-lan')
      expect(policy?.configuredContextTokens).toBe(32768)
      policy!.state!.manualCompactionResult = { status: 'compacted' }
      return fakeStreamingModel([{ type: 'stream-start', warnings: [] }, { type: 'finish', finishReason: 'stop', usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 } }])
    })
    try {
      await expect(new CustomChatTransport().compactContext('paired-thread', [userMessage])).resolves.toEqual({ status: 'compacted' })
      expect(instances).toHaveBeenCalledOnce()
      expect(factory).toHaveBeenCalledOnce()
    } finally {
      instances.mockRestore()
      factory.mockRestore()
    }
  })

  it('keeps a stopped facade stopped when compacting a paired-host conversation', async () => {
    const alias = 'ginfer/paired-host/ready-instance'
    useModelProvider.setState({
      selectedProvider: 'ginfer-lan', selectedModel: { id: alias } as never,
      providers: [{ provider: 'ginfer-lan', active: true, api_key: '', base_url: 'http://127.0.0.1:1337/v1', models: [], settings: [] }] as never,
    })
    seedServiceHub({ app: { getServerStatus: vi.fn().mockResolvedValue(false) } as never })
    const factory = vi.spyOn(ModelFactory, 'createModel')
    try {
      await expect(new CustomChatTransport().compactContext('paired-thread', [userMessage])).rejects.toThrow('Start the local API facade')
      expect(factory).not.toHaveBeenCalled()
    } finally {
      factory.mockRestore()
    }
  })

  it.each([undefined, 0])('refuses paired compaction without a reported loaded capacity (%s)', async (capacity) => {
    const alias = 'ginfer/paired-host/ready-instance'
    useModelProvider.setState({
      selectedProvider: 'ginfer-lan', selectedModel: { id: alias, settings: { ctx_len: { controller_props: { value: 131072 } } } } as never,
      providers: [{ provider: 'ginfer-lan', active: true, api_key: '', base_url: 'http://127.0.0.1:1337/v1', models: [], settings: [] }] as never,
    })
    seedServiceHub({ app: { getServerStatus: vi.fn().mockResolvedValue(true) } as never })
    const instances = vi.spyOn(agentDefinitions, 'listAgentModelInstances').mockResolvedValue(
      capacity === undefined ? [] : [{ id: alias, maxContext: capacity }] as never
    )
    const factory = vi.spyOn(ModelFactory, 'createModel')
    try {
      await expect(new CustomChatTransport().compactContext('paired-thread', [userMessage])).rejects.toThrow('did not report its loaded context capacity')
      expect(factory).not.toHaveBeenCalled()
    } finally {
      instances.mockRestore()
      factory.mockRestore()
    }
  })
})

import type { UIMessage } from '@ai-sdk/react'
import { Chat } from '@ai-sdk/react'
import type { LanguageModel } from 'ai'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { chatWorkerRunKey, useAgentRun } from '@/hooks/useAgentRun'
import { useAppState } from '@/hooks/useAppState'
import { useConversationPolicy } from '@/hooks/useConversationPolicy'
import { useModelProvider } from '@/hooks/useModelProvider'
import { useToolAvailable } from '@/hooks/useToolAvailable'
import type { CapabilitiesService } from '@/services/capabilities/types'
import { isSessionBusy, useChatSessions } from '@/stores/chat-session-store'
import { seedServiceHub } from '@/test/service-hub'
import type { AgentEvent, AgentRunRecord } from '@/types/agent'
import { CustomChatTransport } from '../custom-chat-transport'
import { executeChatCapability } from '../execute-chat-capability'
import {
  executeClaimedChatToolBatch,
  shouldSendToolFollowUp,
} from '../execute-chat-tool-calls'
import { ModelFactory } from '../model-factory'
import { savedSubAgentResults } from '../sub-agents'

type StreamPart = Record<string, unknown>

const streamingModel = (...responses: StreamPart[][]): LanguageModel => {
  const doStream = vi.fn()
  for (const parts of responses) {
    doStream.mockImplementationOnce(async () => ({
      stream: new ReadableStream({
        start(controller) {
          parts.forEach((part) => controller.enqueue(part))
          controller.close()
        },
      }),
    }))
  }
  return {
    specificationVersion: 'v2',
    provider: 'fixture',
    modelId: 'fixture-model',
    supportedUrls: {},
    doGenerate: vi.fn(),
    doStream,
  } as unknown as LanguageModel
}

const usage = { inputTokens: 1, outputTokens: 1, totalTokens: 2 }
const briefs = [1, 2, 3].map((n) => ({
  title: `Summarize notes-${n}.txt`,
  task: `Read notes-${n}.txt in the workspace and summarize it in one sentence.`,
}))

function record(runId: string, status: string, finalReply: string): AgentRunRecord {
  return {
    schemaVersion: 3, id: runId, runId, sessionId: `worker-${runId}`,
    originSessionId: 'parent', parentRunId: 'user-1', definitionId: 'general',
    definitionName: 'General Agent', kind: 'standard', userMessage: '',
    status: status as AgentRunRecord['status'], finishReason: status === 'finished' ? 'reply' : status,
    startedAtMs: 1, finishedAtMs: 2, totalSteps: 2, finalReply,
    defaultModelInstanceId: 'fixture-model', stages: [],
  }
}

/**
 * A capability service that behaves like the native runtime: spawn returns
 * once the worker registers and keeps streaming its events; wait returns the
 * durable record. `finishWorker` decides each worker's terminal outcome.
 */
function fakeRuntime(finishWorker: (task: string, emit: (event: AgentEvent) => void) => AgentRunRecord['status']) {
  const events = new Map<string, (event: AgentEvent) => void>()
  const tasks = new Map<string, string>()
  let spawned = 0
  let releaseWaits!: () => void
  const allSpawned = new Promise<void>((resolve) => { releaseWaits = resolve })
  const execute = vi.fn<CapabilitiesService['execute']>(async (request, event) => {
    if (request.tool_name === 'agent_spawn') {
      const task = String(request.arguments.task)
      events.set(request.run_id, event)
      tasks.set(request.run_id, task)
      event({ type: 'turn_started', run_id: request.run_id, session_id: `worker-${request.run_id}` })
      event({ type: 'stage_queued', stage_id: 'agent', name: 'General Agent', reason: 'Waiting for an available instance with a free worker slot' })
      spawned += 1
      if (spawned === briefs.length) releaseWaits()
      return { content: { runId: request.run_id, sessionId: `worker-${request.run_id}`, originSessionId: request.session_id, parentRunId: request.parent_run_id, status: 'running' } }
    }
    if (request.tool_name === 'agent_wait') {
      // Every worker must be started before any result is collected.
      await allSpawned
      const runId = String(request.arguments.runId)
      const emit = events.get(runId)!
      const task = tasks.get(runId)!
      emit({ type: 'stage_started', stage_id: 'agent', name: 'General Agent', role: 'agent', cycle: null, model_instance_id: 'fixture-model', reasoning_effort: null })
      emit({ type: 'tool_call_parsed', call: { tool: 'os.fs.read', args: { path: task.split(' ')[1] } }, batch_index: 0, batch_size: 1 })
      const status = finishWorker(task, emit)
      const reply = status === 'finished' ? `Summary of ${task.split(' ')[1]}` : ''
      if (reply) emit({ type: 'assistant_reply', text: reply })
      emit({ type: 'turn_finished', reason: status === 'finished' ? 'reply' : status, step_count: 2 })
      return { content: { runId, active: false, events: null, record: record(runId, status, reply), error: null } }
    }
    throw new Error(`unexpected capability ${request.tool_name}`)
  })
  return { execute, events }
}

describe('Chat sub-agent dispatch', () => {
  beforeEach(() => {
    useConversationPolicy.getState().clearAll()
    useAgentRun.getState().clearAll()
    useChatSessions.getState().clearSessions()
    useToolAvailable.setState({ disabledTools: {}, defaultDisabledTools: [] })
    useAppState.setState({
      tools: ['agent_spawn', 'agent_wait'].map((name) => ({
        name, server: 'gchat-native', description: name, inputSchema: { type: 'object' },
      })),
      ragToolNames: new Set(),
      capabilityToolNames: new Set(['agent_spawn', 'agent_wait']),
      intentionallyStoppedModels: new Set(),
    })
    useModelProvider.setState({
      selectedProvider: 'ginfer',
      selectedModel: { id: 'fixture-model', capabilities: ['tools'], settings: {} } as never,
      providers: [{ provider: 'ginfer', active: true, api_key: '', base_url: 'http://localhost', models: [], settings: [] }] as never,
    })
  })

  it('runs three concurrent sub-agents from one Chat request and continues with every result', async () => {
    const threadId = 'parent'
    const runtime = fakeRuntime(() => 'finished')
    const cancel = vi.fn().mockResolvedValue(undefined)
    const service = seedServiceHub({
      rag: { getTools: vi.fn().mockResolvedValue([]) } as never,
      capabilities: { getCatalog: vi.fn(), execute: runtime.execute, cancel },
    }).capabilities()
    const model = streamingModel(
      [
        { type: 'stream-start', warnings: [] },
        { type: 'tool-call', toolCallId: 'dispatch-call', toolName: 'agent_dispatch', input: JSON.stringify({ agents: briefs }) },
        { type: 'finish', finishReason: 'tool-calls', usage },
      ],
      [
        { type: 'stream-start', warnings: [] },
        { type: 'text-start', id: 'answer' },
        { type: 'text-delta', id: 'answer', delta: 'All three files are summarized.' },
        { type: 'text-end', id: 'answer' },
        { type: 'finish', finishReason: 'stop', usage },
      ]
    )
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
        void executeClaimedChatToolBatch({
          threadId, signal,
          ragToolNames: new Set(), capabilityToolNames: useAppState.getState().capabilityToolNames,
          callRagTool: vi.fn(), getProjectId: () => undefined, processOutput: async (content) => content,
          callCapability: (call) => executeChatCapability({ service, threadId, signal, ...call }),
          addToolOutput: (output) => chat.addToolOutput(output), onError,
        })
      },
      sendAutomaticallyWhen: ({ messages }) => shouldSendToolFollowUp(messages, session.toolCallAbortController),
    })
    useChatSessions.getState().ensureSession(threadId, transport, () => chat)

    await chat.sendMessage({ id: 'user-1', parts: [{ type: 'text', text: 'Dispatch 3 agents to each summarize one of these files.' }] })
    await vi.waitFor(() => {
      expect(chat.status).toBe('ready')
      expect(chat.messages.at(-1)?.parts).toContainEqual(expect.objectContaining({ type: 'text', text: 'All three files are summarized.' }))
      expect(isSessionBusy(useChatSessions.getState().sessions[threadId])).toBe(false)
    })
    expect(onError).not.toHaveBeenCalled()

    const first = vi.mocked(model.doStream).mock.calls[0][0]
    expect(first.tools?.map((tool) => tool.name)).toContain('agent_dispatch')
    expect(first.prompt[0]).toMatchObject({ role: 'system', content: expect.stringContaining('call agent_dispatch once') })

    const spawns = runtime.execute.mock.calls.filter(([request]) => request.tool_name === 'agent_spawn')
    expect(spawns.map(([request]) => request.arguments.task)).toEqual(briefs.map(({ task }) => task))
    for (const [request] of spawns) {
      expect(request).toMatchObject({ session_id: threadId, parent_run_id: 'user-1', auto_approve: false })
    }

    const dispatch = chat.messages.at(-1)!.parts.find((part) => part.type === 'tool-agent_dispatch') as { state: string; output: unknown }
    expect(dispatch.state).toBe('output-available')
    const results = savedSubAgentResults(JSON.parse(JSON.stringify(dispatch.output)))
    expect(results.map(({ title, status, result }) => ({ title, status, result }))).toEqual(
      briefs.map(({ title }, index) => ({ title, status: 'done', result: `Summary of notes-${index + 1}.txt` }))
    )
    const followUp = JSON.stringify(vi.mocked(model.doStream).mock.calls[1][0].prompt)
    for (const n of [1, 2, 3]) expect(followUp).toContain(`Summary of notes-${n}.txt`)

    // Each worker is attributed to its card in the dispatching message.
    for (const [index, { runId }] of results.entries()) {
      expect(useAgentRun.getState().getRun(chatWorkerRunKey(threadId, runId!))).toMatchObject({
        status: 'finished',
        originSessionId: threadId,
        subAgent: { dispatchId: 'dispatch-call', index, title: briefs[index].title, task: briefs[index].task },
        trace: { assistantText: `Summary of notes-${index + 1}.txt` },
      })
    }
    expect(cancel).not.toHaveBeenCalled()
  })

  it('reports a failed and a stopped sub-agent without stopping their siblings', async () => {
    useChatSessions.getState().ensureSession('parent', new CustomChatTransport(undefined, 'parent'), () => new Chat({ id: 'parent' }))
    const runtime = fakeRuntime((task, emit) => {
      if (task.includes('notes-2')) {
        emit({ type: 'step_error', message: 'notes-2.txt was not found', category: 'tool' })
        return 'failed'
      }
      return task.includes('notes-3') ? 'cancelled' : 'finished'
    })
    const service = seedServiceHub({
      capabilities: { getCatalog: vi.fn(), execute: runtime.execute, cancel: vi.fn() },
    }).capabilities()

    const result = await executeChatCapability({
      service, threadId: 'parent', toolName: 'agent_dispatch', toolCallId: 'call',
      arguments: { agents: briefs }, signal: new AbortController().signal,
    })

    expect(result.error).toBeUndefined()
    expect(savedSubAgentResults(result.content).map(({ status, result, error }) => ({ status, result, error }))).toEqual([
      { status: 'done', result: 'Summary of notes-1.txt', error: undefined },
      { status: 'failed', result: undefined, error: 'notes-2.txt was not found' },
      { status: 'stopped', result: undefined, error: undefined },
    ])
  })

  it('Stop on the parent cancels every running sub-agent', async () => {
    useChatSessions.getState().ensureSession('parent', new CustomChatTransport(undefined, 'parent'), () => new Chat({ id: 'parent' }))
    const runIds: string[] = []
    const execute = vi.fn<CapabilitiesService['execute']>(async (request, event) => {
      if (request.tool_name === 'agent_spawn') {
        runIds.push(request.run_id)
        event({ type: 'turn_started', run_id: request.run_id, session_id: 'worker' })
        return { content: { runId: request.run_id, status: 'running' } }
      }
      return new Promise(() => undefined)
    })
    const cancel = vi.fn().mockResolvedValue(undefined)
    const service = seedServiceHub({ capabilities: { getCatalog: vi.fn(), execute, cancel } }).capabilities()
    const stop = new AbortController()

    const pending = executeChatCapability({
      service, threadId: 'parent', toolName: 'agent_dispatch', toolCallId: 'call',
      arguments: { agents: briefs.slice(0, 2) }, signal: stop.signal,
    })
    await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(4))
    expect(runIds).toHaveLength(2)
    stop.abort()

    await expect(pending).rejects.toThrow('Cancelled')
    expect(cancel.mock.calls.map(([id]) => id).sort()).toEqual(
      [...runIds, ...runIds.map((id) => `${id}-wait`)].sort()
    )
  })

  it.each([
    [{ agents: [] }, 'at least one sub-agent'],
    [{ agents: Array.from({ length: 9 }, (_, n) => ({ title: `${n}`, task: 'x' })) }, 'at most 8'],
    [{ agents: [{ title: 'Empty', task: '  ' }] }, 'Sub-agent 1 needs a task'],
  ])('rejects invalid dispatch %# before starting any worker', async (input, message) => {
    const execute = vi.fn<CapabilitiesService['execute']>()
    const service = seedServiceHub({ capabilities: { getCatalog: vi.fn(), execute, cancel: vi.fn() } }).capabilities()
    await expect(executeChatCapability({
      service, threadId: 'parent', toolName: 'agent_dispatch', arguments: input, signal: new AbortController().signal,
    })).rejects.toThrow(message)
    expect(execute).not.toHaveBeenCalled()
  })

  it('offers dispatch only while both spawn and wait are enabled', async () => {
    seedServiceHub({ rag: { getTools: vi.fn().mockResolvedValue([]) } as never })
    const transport = new CustomChatTransport(undefined, 'parent')
    await transport.refreshTools(true)
    expect(Object.keys(transport.getTools())).toContain('agent_dispatch')
    useToolAvailable.getState().setToolDisabledForThread('parent', 'gchat-native', 'agent_wait', false)
    await transport.refreshTools(true)
    expect(Object.keys(transport.getTools())).not.toContain('agent_dispatch')
    expect(Object.keys(transport.getTools())).toContain('agent_spawn')
  })
})

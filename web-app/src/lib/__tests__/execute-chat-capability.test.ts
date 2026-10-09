import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useConversationPolicy } from '@/hooks/useConversationPolicy'
import { useAgentRun } from '@/hooks/useAgentRun'
import { useToolAvailable } from '@/hooks/useToolAvailable'
import { useThreads } from '@/hooks/useThreads'
import { seedServiceHub } from '@/test/service-hub'
import { executeChatCapability, chatCapabilityRun, conversationAttachments } from '../execute-chat-capability'
import type { CapabilitiesService } from '@/services/capabilities/types'
import type { AgentEvent } from '@/types/agent'
import { newUserThreadContent } from '../completion'
import { convertThreadMessageToUIMessage } from '../messages'
import { createImageAttachment, createDocumentAttachment } from '@/types/attachment'
import { Chat } from '@ai-sdk/react'
import { CustomChatTransport } from '../custom-chat-transport'
import { useChatSessions } from '@/stores/chat-session-store'
import { useAppState } from '@/hooks/useAppState'
import { useInitialMessage } from '@/hooks/useInitialMessage'
import { conversationDocumentAccess, processAttachmentsForSend } from '../attachmentProcessing'

describe('Chat capability execution', () => {
  beforeEach(() => {
    useConversationPolicy.getState().clearAll()
    useAgentRun.getState().clearAll()
    useChatSessions.getState().clearSessions()
    useThreads.setState({ threads: {} })
    useToolAvailable.setState({ disabledTools: {}, defaultDisabledTools: [] })
  })

  it('forwards original image names and document paths from production saved history to the delegated stage', async () => {
    const ingestFileAttachment = vi.fn().mockRejectedValue(new Error('GInfer embeddings unavailable'))
    const parseDocumentMock = vi.fn().mockRejectedValue(new Error('A native read must own folder approval'))
    const execute = vi.fn<CapabilitiesService['execute']>(async () => ({ content: 'Images staged' }))
    const serviceHub = seedServiceHub({
      uploads: { ingestImage: vi.fn().mockResolvedValue({ id: 'image-id' }), ingestFileAttachment } as never,
      rag: { parseDocument: parseDocumentMock } as never,
      capabilities: { execute, cancel: vi.fn(), getCatalog: vi.fn() },
    })
    useInitialMessage.getState().set('a', {
      text: 'Compare before.png and after.png against Budget.xlsx', agentDefinitionId: 'reviewer',
      files: ['before.png', 'after.png'].map((name) => ({ name, type: 'file', mediaType: 'image/png', url: 'data:image/png;base64,CURRENT' })),
      documents: [{ ...createDocumentAttachment({ name: 'Budget.xlsx', path: 'C:\\Users\\Ron\\Desktop\\Budget.xlsx', parseMode: 'auto' }), mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }],
    })
    const initial = useInitialMessage.getState().consume('a')!
    const processed = await processAttachmentsForSend({
      threadId: 'a', serviceHub, parsePreference: 'auto',
      documentAccess: conversationDocumentAccess(true, [{ server: 'gchat-native', name: 'agent_run' }], [], 'agent_run'),
      attachments: [...initial.files!.map((file) => createImageAttachment({ name: file.name, mimeType: file.mediaType, base64: file.url.split(',')[1], dataUrl: file.url, size: 5 })), ...initial.documents!],
    })
    const saved = newUserThreadContent('a', initial.text, processed.processedAttachments)
    expect(ingestFileAttachment).not.toHaveBeenCalled()
    expect(parseDocumentMock).not.toHaveBeenCalled()
    expect(processed.hasEmbeddedDocuments).toBe(false)
    const current = convertThreadMessageToUIMessage(JSON.parse(JSON.stringify(saved)))
    expect(current.parts[0]).toMatchObject({ type: 'text', text: expect.stringContaining('before.png and after.png') })
    const messages = [
      { id: 'older', role: 'user', parts: [{ type: 'file', mediaType: 'image/png', url: 'data:image/png;base64,OLD' }] },
      current,
      { id: 'call', role: 'assistant', parts: [] },
    ] as typeof current[]
    const expected = [
      { kind: 'image', name: 'before.png', media_type: 'image/png', data_url: 'data:image/png;base64,CURRENT' },
      { kind: 'image', name: 'after.png', media_type: 'image/png', data_url: 'data:image/png;base64,CURRENT' },
      { kind: 'file', name: 'Budget.xlsx', path: 'C:\\Users\\Ron\\Desktop\\Budget.xlsx', media_type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
    ]
    expect(conversationAttachments(messages)).toEqual(expected)
    const transport = new CustomChatTransport(undefined, 'a')
    useChatSessions.getState().ensureSession('a', transport, () => new Chat({ id: 'a', transport, messages }))
    await executeChatCapability({ service: serviceHub.capabilities(), threadId: 'a', toolName: 'agent_run', arguments: { definitionId: initial.agentDefinitionId }, signal: new AbortController().signal })
    expect(execute.mock.calls[0][0].attachments).toEqual(expected)
  })

  it('persists actual delegated activity on the saved conversation without marking native tools as agents', async () => {
    const updateThread = vi.fn().mockResolvedValue(undefined)
    const execute = vi.fn<CapabilitiesService['execute']>(async (request) => request.tool_name === 'agent_run'
      ? { content: 'Report', run: { runId: request.run_id, status: 'finished', reason: 'reply', stepCount: 2 } }
      : { content: 'Spreadsheet cells' })
    const service = seedServiceHub({ threads: { updateThread } as never, capabilities: { execute, cancel: vi.fn(), getCatalog: vi.fn() } }).capabilities()
    useThreads.setState({ threads: { saved: { id: 'saved', title: 'Budget', metadata: { project: { id: 'project', name: 'Work' } } } as Thread } })
    const options = { service, threadId: 'saved', arguments: { definitionId: 'researcher' }, signal: new AbortController().signal }
    await executeChatCapability({ ...options, toolName: 'os_fs_read_document' })
    expect(useThreads.getState().threads.saved.metadata?.has_agent_activity).toBeUndefined()
    useConversationPolicy.getState().setActiveDefinition('saved', 'researcher')
    await executeChatCapability({ ...options, toolName: 'agent_run' })
    expect(useConversationPolicy.getState().activeDefinitions.saved).toBeUndefined()
    expect(updateThread).toHaveBeenCalledWith(expect.objectContaining({ metadata: { has_agent_activity: true, project: { id: 'project', name: 'Work' } } }))
    const saved = JSON.parse(JSON.stringify(useThreads.getState().threads.saved)) as Thread
    useThreads.getState().setThreads([saved])
    expect(useThreads.getState().threads.saved.metadata?.has_agent_activity).toBe(true)
  })

  it('passes owning conversation permissions and folders and retains delegated progress', async () => {
    useConversationPolicy.getState().setApprovalMode('a', 'skip')
    useConversationPolicy.getState().setWorkingDir('a', '/workspace')
    useConversationPolicy.getState().addExternalRoot('a', { rootId: 'external', name: 'Reference', path: '/reference', canEdit: false })
    useToolAvailable.getState().setToolDisabledForThread('a', 'tools', 'write', false)
    const execute = vi.fn<CapabilitiesService['execute']>(async (request, event) => {
      event({ type: 'turn_started', run_id: request.run_id, session_id: 'a' })
      event({ type: 'turn_finished', reason: 'reply', step_count: 2 })
      return { content: 'Saved result', run: { runId: request.run_id, status: 'finished', reason: 'reply', stepCount: 2 } }
    })
    const service = seedServiceHub({ capabilities: { execute, cancel: vi.fn(), getCatalog: vi.fn() } }).capabilities()
    const result = await executeChatCapability({ service, threadId: 'a', modelId: 'a-model', toolName: 'agent_run', arguments: { definitionId: 'team', task: 'Work' }, signal: new AbortController().signal })
    expect(execute.mock.calls[0][0]).toMatchObject({ session_id: 'a', model_id: 'a-model', auto_approve: true, working_dir: '/workspace', external_roots: [{ path: '/reference', can_edit: false }], disabled_tools: ['tools::write'] })
    expect(result.content).toMatchObject({ result: 'Saved result', agent_run: { status: 'finished', step_count: 2 } })
    expect(chatCapabilityRun({ id: 'reply', role: 'assistant', parts: [{ type: 'tool-agent_run', toolCallId: 'call', state: 'output-available', input: {}, output: result.content }] })).toMatchObject({ status: 'finished', step_count: 2 })
  })

  it('invokes an exact discovered capability through the original policy-aware executor', async () => {
    const execute = vi.fn<CapabilitiesService['execute']>(async () => ({ content: 'Document text' }))
    const service = seedServiceHub({ capabilities: { execute, cancel: vi.fn(), getCatalog: vi.fn() } }).capabilities()
    useAppState.setState({ tools: [{
      name: 'os_fs_read_document', server: 'gchat-native',
      description: 'Extract document contents', inputSchema: { type: 'object', required: ['path'] },
    }] })
    await executeChatCapability({
      service, threadId: 'a', toolName: 'gchat_capability_call',
      arguments: { name: 'os_fs_read_document', arguments: { path: '/workspace/report.xlsx' } },
      signal: new AbortController().signal,
    })
    expect(execute).toHaveBeenCalledOnce()
    expect(execute.mock.calls[0][0]).toMatchObject({
      tool_name: 'os_fs_read_document', arguments: { path: '/workspace/report.xlsx' }, session_id: 'a',
    })
  })

  it('cancels a registration race, suppresses late progress, and settles the owning run', async () => {
    const controller = new AbortController()
    let emit!: (event: AgentEvent) => void
    let finish!: () => void
    const cancel = vi.fn().mockResolvedValue(undefined)
    const execute = vi.fn<CapabilitiesService['execute']>(async (_request, event) => {
      emit = event
      await new Promise<void>((resolve) => { finish = resolve })
      return { content: 'late' }
    })
    const service = seedServiceHub({ capabilities: { execute, cancel, getCatalog: vi.fn() } }).capabilities()
    const result = executeChatCapability({ service, threadId: 'a', toolName: 'skill_invoke', arguments: {}, signal: controller.signal })
    controller.abort()
    emit({ type: 'turn_started', run_id: execute.mock.calls[0][0].run_id, session_id: 'a' })
    emit({ type: 'assistant_text', text: 'late', step: 1 })
    finish()
    await expect(result).rejects.toMatchObject({ name: 'AbortError' })
    expect(cancel).toHaveBeenCalledTimes(2)
    expect(useAgentRun.getState().getRun('a')).toMatchObject({ status: 'cancelled', trace: { assistantText: '' } })
  })

  it('retains failed delegated stages as a task outcome for the SDK follow-up', async () => {
    const execute = vi.fn<CapabilitiesService['execute']>(async (_request, event) => {
      event({ type: 'step_error', category: 'orchestration', message: 'Worker failed' })
      event({ type: 'turn_finished', reason: 'failed', step_count: 3 })
      return { content: { status: 'failed' }, error: 'Worker failed', run: { runId: _request.run_id, status: 'failed', reason: 'failed', stepCount: 3 } }
    })
    const service = seedServiceHub({ capabilities: { execute, cancel: vi.fn(), getCatalog: vi.fn() } }).capabilities()
    const result = await executeChatCapability({ service, threadId: 'a', toolName: 'agent_run', arguments: {}, signal: new AbortController().signal })
    expect(result.error).toBeUndefined()
    expect(result.content).toMatchObject({ error: 'Worker failed', agent_run: { status: 'failed', step_count: 3 } })
  })

  it('uses the authoritative result when the terminal Channel event is delayed', async () => {
    const execute = vi.fn<CapabilitiesService['execute']>(async (request) => ({ content: 'Reached step limit', run: { runId: request.run_id, status: 'incomplete', reason: 'max_steps', stepCount: 12 } }))
    const service = seedServiceHub({ capabilities: { execute, cancel: vi.fn(), getCatalog: vi.fn() } }).capabilities()
    const result = await executeChatCapability({ service, threadId: 'a', toolName: 'agent_run', arguments: {}, signal: new AbortController().signal })
    expect(result.content).toMatchObject({ agent_run: { status: 'incomplete', finish_reason: 'max_steps', step_count: 12 } })
    expect(useAgentRun.getState().getRun('a').status).toBe('incomplete')
  })

  it('settles IPC failures instead of leaving Chat working', async () => {
    const service = seedServiceHub({ capabilities: { execute: vi.fn().mockRejectedValue(new Error('Instance stopped')), cancel: vi.fn(), getCatalog: vi.fn() } }).capabilities()
    await expect(executeChatCapability({ service, threadId: 'a', toolName: 'agent_run', arguments: {}, signal: new AbortController().signal })).rejects.toThrow('Instance stopped')
    expect(useAgentRun.getState().getRun('a').status).toBe('failed')
  })
})

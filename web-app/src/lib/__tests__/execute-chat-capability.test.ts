import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useAgentMode } from '@/hooks/useAgentMode'
import { useAgentRun } from '@/hooks/useAgentRun'
import { useToolAvailable } from '@/hooks/useToolAvailable'
import { seedServiceHub } from '@/test/service-hub'
import { executeChatCapability, chatCapabilityRun } from '../execute-chat-capability'
import type { CapabilitiesService } from '@/services/capabilities/types'
import type { AgentEvent } from '@/types/agent'

describe('Chat capability execution', () => {
  beforeEach(() => {
    useAgentMode.getState().clearAll()
    useAgentRun.getState().clearAll()
    useToolAvailable.setState({ disabledTools: {}, defaultDisabledTools: [] })
  })

  it('passes owning conversation permissions and folders and retains delegated progress', async () => {
    useAgentMode.getState().setApprovalMode('a', 'skip')
    useAgentMode.getState().setWorkingDir('a', '/workspace')
    useAgentMode.getState().addExternalRoot('a', { rootId: 'external', name: 'Reference', path: '/reference', canEdit: false })
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

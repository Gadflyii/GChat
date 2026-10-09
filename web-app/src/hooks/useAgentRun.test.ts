import { invoke } from '@tauri-apps/api/core'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createAgentRunState,
  reduceAgentRunState,
  useAgentRun,
} from '@/hooks/useAgentRun'
import type { AgentEvent } from '@/types/agent'
import { runAgentTurn } from '@/services/agent/tauri'
import { aggregateAgentMetrics, tokensPerSecond } from '@/lib/agent-metrics'
import { buildAgentRunSummary } from '@/lib/agent-run-message'

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
  Channel: class {
    onmessage: ((event: AgentEvent) => void) | undefined
  },
}))

const parsed: AgentEvent = {
  type: 'tool_call_parsed',
  call: { tool: 'os.fs.read', args: { path: '/tmp/a' } },
  batch_index: 0,
  batch_size: 1,
}

describe('useAgentRun', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useAgentRun.getState().clearAll()
  })

  it('keeps run state isolated by thread', () => {
    useAgentRun.getState().startRun('thread-a', 'run-a')
    useAgentRun.getState().startRun('thread-b', 'run-b')
    useAgentRun.getState().applyEvent('thread-a', parsed)

    expect(useAgentRun.getState().getRun('thread-a').trace.tools).toHaveLength(
      1
    )
    expect(useAgentRun.getState().getRun('thread-b').trace.tools).toHaveLength(
      0
    )
  })

  it('replaces a parsed call with its executed result', () => {
    const parsedState = reduceAgentRunState(createAgentRunState(), parsed)
    const executedState = reduceAgentRunState(parsedState, {
      type: 'tool_call_executed',
      result: {
        call: parsed.call,
        outcome: { status: 'ok', summary: 'Read file' },
        batch_index: 0,
        batch_size: 1,
      },
    })

    expect(executedState.trace.tools).toEqual([
      {
        call: parsed.call,
        outcome: { status: 'ok', summary: 'Read file' },
        batchIndex: 0,
        batchSize: 1,
      },
    ])
  })

  it('tracks the full agent run duration from start to terminal event', () => {
    const running = reduceAgentRunState(
      createAgentRunState(),
      {
        type: 'turn_started',
        run_id: 'run-a',
        session_id: 'thread-a',
      },
      1_000
    )
    const finished = reduceAgentRunState(
      running,
      {
        type: 'turn_finished',
        reason: 'reply',
        step_count: 2,
      },
      4_250
    )

    expect(finished.startedAtMs).toBe(1_000)
    expect(finished.finishedAtMs).toBe(4_250)
  })

  it('tracks the model instance assigned to every live stage', () => {
    const orchestrated = reduceAgentRunState(createAgentRunState(), {
      type: 'orchestration_started',
      definition_id: 'team',
      definition_name: 'Team',
      kind: 'coordinator',
      default_model_instance_id: 'coordinator-model',
    })
    const running = reduceAgentRunState(orchestrated, {
      type: 'stage_started',
      stage_id: 'researcher',
      name: 'Researcher',
      role: 'worker',
      cycle: null,
      model_instance_id: 'research-model',
      reasoning_effort: 'high',
    })

    expect(running.trace.definition?.modelInstanceId).toBe(
      'coordinator-model'
    )
    expect(running.trace.stages[0].modelInstanceId).toBe('research-model')
    expect(running.trace.stages[0].reasoningEffort).toBe('high')

    const measured = reduceAgentRunState(running, {
      type: 'stage_activity',
      stage_id: 'researcher',
      event: {
        type: 'inference_measured',
        inference: {
          promptTokens: 120,
          generatedTokens: 60,
          promptMs: 12,
          generationMs: 150,
        },
      },
    })
    expect(measured.trace.stages[0].inference?.generatedTokens).toBe(60)

    const finished = reduceAgentRunState(measured, {
      type: 'stage_finished',
      stage_id: 'researcher',
      name: 'Researcher',
      status: 'reply',
      summary: 'done',
      step_count: 2,
      duration_ms: 500,
      model_instance_id: 'research-model',
      model_id: 'qwen',
      reasoning_effort: 'high',
      inference: {
        promptTokens: 200,
        generatedTokens: 100,
        promptMs: 20,
        generationMs: 250,
      },
    })
    expect(finished.trace.stages[0].inference?.generatedTokens).toBe(100)
    const metrics = aggregateAgentMetrics(finished.trace.stages)
    expect(tokensPerSecond(metrics[0].generatedTokens, metrics[0].generationMs)).toBe(400)
    expect(buildAgentRunSummary(finished).stages[0].inference).toEqual({
      prompt_tokens: 200,
      generated_tokens: 100,
      prompt_ms: 20,
      generation_ms: 250,
    })
  })

  it('clears a pending approval on execution, error, and terminal events', () => {
    const approval: AgentEvent = {
      type: 'approval_requested',
      run_id: 'run-a',
      approval_id: 'approval-a',
      tool: 'os.fs.write',
      reason: 'Filesystem write',
      preview: { path: '/tmp/a' },
      affected_resources: [],
      can_remember: true,
    }
    const awaiting = reduceAgentRunState(createAgentRunState(), approval)
    expect(awaiting.status).toBe('awaiting_approval')

    const executed = reduceAgentRunState(awaiting, {
      type: 'tool_call_executed',
      result: {
        call: parsed.call,
        outcome: { status: 'denied', summary: 'Denied' },
        batch_index: 0,
        batch_size: 1,
      },
    })
    expect(executed.pendingApproval).toBeUndefined()

    const errored = reduceAgentRunState(awaiting, {
      type: 'step_error',
      category: 'tool',
      message: 'Denied',
    })
    expect(errored.pendingApproval).toBeUndefined()
    expect(errored.status).toBe('failed')

    const finished = reduceAgentRunState(awaiting, {
      type: 'turn_finished',
      reason: 'cancelled',
      step_count: 1,
    })
    expect(finished.pendingApproval).toBeUndefined()
    expect(finished.status).toBe('cancelled')
  })

  it.each(['max_steps', 'loop_detected'] as const)(
    'keeps completed synthesis and distinct stage outcomes when the run ends %s',
    (reason) => {
      let state = reduceAgentRunState(createAgentRunState(), {
        type: 'turn_started', run_id: 'run', session_id: 'thread',
      })
      for (const [stageId, outcome] of [['worker', reason], ['synthesize', 'reply']]) {
        state = reduceAgentRunState(state, {
          type: 'stage_started', stage_id: stageId, name: stageId, role: 'worker', cycle: null,
          model_instance_id: 'model', reasoning_effort: null,
        })
        state = reduceAgentRunState(state, {
          type: 'stage_finished', stage_id: stageId, name: stageId, status: outcome,
          summary: 'preserved', step_count: 1, duration_ms: 10, model_instance_id: 'model',
          model_id: 'model', reasoning_effort: null,
          inference: { promptTokens: 1, generatedTokens: 1, promptMs: 1, generationMs: 1 },
        })
      }
      state = reduceAgentRunState(state, { type: 'assistant_reply', text: 'completed synthesis' })
      state = reduceAgentRunState(state, { type: 'turn_finished', reason, step_count: 2 })
      expect(state.status).toBe('incomplete')
      expect(state.trace.assistantText).toBe('completed synthesis')
      const saved = JSON.parse(JSON.stringify(buildAgentRunSummary(state)))
      expect(saved.status).toBe('incomplete')
      expect(saved.finish_reason).toBe(reason)
      expect(saved.stages.map((stage: { status: string }) => stage.status)).toEqual(['incomplete', 'finished'])
    }
  )

  it('tracks folder access separately from ordinary approvals', () => {
    const awaiting = reduceAgentRunState(createAgentRunState(), {
      type: 'folder_access_requested',
      run_id: 'run-a',
      access_id: 'access-a',
      tool: 'os.fs.write',
      path: '/Users/test/Desktop',
      display_name: 'Desktop',
      root_id: 'desktop-root',
      reason: 'Folder access is required',
    })

    expect(awaiting.status).toBe('awaiting_folder_access')
    expect(awaiting.pendingFolderAccess).toEqual({
      type: 'folder_access_requested',
      run_id: 'run-a',
      access_id: 'access-a',
      tool: 'os.fs.write',
      path: '/Users/test/Desktop',
      display_name: 'Desktop',
      root_id: 'desktop-root',
      reason: 'Folder access is required',
    })
    expect(awaiting.pendingApproval).toBeUndefined()

    const finished = reduceAgentRunState(awaiting, {
      type: 'turn_finished',
      reason: 'cancelled',
      step_count: 1,
    })
    expect(finished.pendingFolderAccess).toBeUndefined()
    expect(finished.status).toBe('cancelled')
  })

  it('forwards the thread-bound session id to the agent command', async () => {
    vi.mocked(invoke).mockResolvedValue(undefined)
    const request = {
      run_id: 'run-a',
      session_id: 'thread-a',
      model_id: 'model-a',
      user_message: 'continue',
      working_dir: '/tmp',
      auto_approve: false,
    }

    await runAgentTurn(request, () => undefined)

    expect(invoke).toHaveBeenCalledWith('agent_run_turn', {
      request,
      onEvent: expect.anything(),
    })
  })

  it('accepts recovery diagnostics without changing run lifecycle state', () => {
    const running = reduceAgentRunState(createAgentRunState(), {
      type: 'turn_started',
      run_id: 'run-a',
      session_id: 'thread-a',
    })
    const afterRetry = reduceAgentRunState(running, {
      type: 'parse_retry',
      step_index: 1,
      reason: 'invalid terminal position',
    })
    const afterTrim = reduceAgentRunState(afterRetry, {
      type: 'batch_trimmed',
      step_index: 1,
      reason: 'approval-gated tools must run solo',
      kept_tool: 'os.fs.write',
      dropped_tools: ['os.fs.edit'],
    })

    expect(afterRetry).toBe(running)
    expect(afterTrim).toBe(running)
    expect(afterTrim.status).toBe('running')
    expect(afterTrim.trace.tools).toEqual([])
  })
})

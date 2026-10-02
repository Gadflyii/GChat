import { describe, expect, it } from 'vitest'
import {
  buildAgentRunSummary,
  buildAgentUIMessage,
  claimAgentRunPersistence,
} from '@/lib/agent-run-message'
import type { AgentRunState } from '@/types/agent'
import { createAgentRunState } from '@/hooks/useAgentRun'

function finishedRun(): AgentRunState {
  return {
    runId: 'run-1',
    startedAtMs: 1_000,
    finishedAtMs: 3_500,
    status: 'finished',
    approvalResolving: false,
    folderAccessResolving: false,
    trace: {
      stages: [
        {
          id: 'agent',
          name: 'Agent',
          role: 'agent',
          status: 'finished',
          modelInstanceId: 'qwen',
          modelId: 'qwen',
          reasoningEffort: 'medium',
          inference: {
            promptTokens: 200,
            generatedTokens: 100,
            promptMs: 20,
            generationMs: 250,
          },
        },
      ],
      handoffs: [],
      reasoning: { 1: 'second', 0: 'first' },
      assistantText: 'Done',
      tools: [
        {
          call: { tool: 'os.fs.read', args: { path: '/workspace/a' } },
          outcome: { status: 'ok', summary: 'Read file' },
          batchIndex: 0,
          batchSize: 1,
        },
      ],
      loops: [],
      finishReason: 'reply',
      stepCount: 2,
    },
  }
}

describe('agent run message projection', () => {
  it('omits absent fields from JSON summaries while retaining zero counters', () => {
    const state = createAgentRunState()
    state.runId = 'run-0'
    state.startedAtMs = 0
    state.finishedAtMs = 0
    state.trace.stepCount = 0
    state.trace.stages = [
      {
        id: 'queued',
        name: 'Queued',
        role: 'worker',
        status: 'queued',
        modelInstanceId: '',
        stepCount: 0,
        durationMs: 0,
      },
    ]
    state.trace.tools = [
      { call: { tool: 'os.fs.read', args: {} }, batchIndex: 0, batchSize: 1 },
    ]

    const summary = buildAgentRunSummary(state)

    expect(summary).toStrictEqual(JSON.parse(JSON.stringify(summary)))
    expect(summary).toMatchObject({
      step_count: 0,
      duration_ms: 0,
      stages: [{ step_count: 0, duration_ms: 0 }],
      tools: [{ tool: 'os.fs.read', batch_index: 0 }],
    })
  })

  it('persists only the compact terminal summary in metadata', () => {
    const state = finishedRun()
    state.pendingApproval = {
      type: 'approval_requested',
      run_id: 'run-1',
      approval_id: 'approval-1',
      tool: 'os.fs.write',
      reason: 'Write file',
      preview: { secret: 'must-not-persist' },
      affected_resources: [],
      can_remember: true,
    }

    const message = buildAgentUIMessage(state)

    expect(message.metadata).toEqual({
      agent_run: buildAgentRunSummary(state),
    })
    expect(buildAgentRunSummary(state).duration_ms).toBe(2_500)
    expect(JSON.stringify(message.metadata)).not.toContain('must-not-persist')
    expect(message.parts).toEqual(
      expect.arrayContaining([
        { type: 'reasoning', text: 'firstsecond' },
        { type: 'text', text: 'Done' },
      ])
    )
  })

  it('bounds loop and error text in the persisted summary', () => {
    const state = finishedRun()
    state.trace.loops = [
      {
        level: 'warn',
        detector: 'generic_repeat',
        message: 'x'.repeat(600),
      },
    ]
    state.trace.error = { category: 'tool', message: 'y'.repeat(1_200) }

    const summary = buildAgentRunSummary(state)

    expect(summary.loops[0].message.length).toBeLessThanOrEqual(501)
    expect(summary.error?.message.length).toBeLessThanOrEqual(1_001)
  })

  it('keeps terminal tools in metadata but hides them from activity rows', () => {
    const state = finishedRun()
    state.trace.tools.push({
      call: { tool: 'reply', args: { text: 'Done' } },
      outcome: { status: 'ok', summary: 'Replied' },
      batchIndex: 0,
      batchSize: 1,
    })

    const message = buildAgentUIMessage(state)

    expect(buildAgentRunSummary(state).tools).toHaveLength(2)
    expect(message.parts).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ type: 'tool-reply' })])
    )
  })

  it('claims terminal persistence exactly once per run', () => {
    const persisted = new Set<string>()

    expect(claimAgentRunPersistence(persisted, 'run-1')).toBe(true)
    expect(claimAgentRunPersistence(persisted, 'run-1')).toBe(false)
    expect(claimAgentRunPersistence(persisted, undefined)).toBe(false)
  })
})

import { describe, expect, it } from 'vitest'
import type { UIMessage } from 'ai'
import type { AgentRunRecord, AgentRunSummary } from '@/types/agent'
import { createAgentRunState } from '@/hooks/useAgentRun'
import { chatCapabilityRuns, projectChatRunActivity } from './agent-run-message'
import { buildTraceBlocks } from './tools/message-trace-parts'
import { convertThreadMessageToUIMessage, convertUIMessageToThreadMessage, extractContentPartsFromUIMessage } from './messages'

const summary = (id: string, status: AgentRunSummary['status'] = 'finished'): AgentRunSummary => ({
  run_id: id, status, stages: [], tools: [], loops: [],
})
const message = (id: string, runs: AgentRunSummary[]): UIMessage => ({
  id, role: 'assistant', parts: [
    ...runs.map((run, index) => ({
      type: 'tool-agent_wait' as const, toolCallId: `${id}-${index}`,
      state: 'output-available' as const, input: { runId: run.run_id },
      output: { result: `${run.run_id} answer`, agent_run: run },
    })),
    { type: 'text', text: 'Both results collected.' },
  ],
})

const agentIds = (ui: UIMessage, runs: readonly AgentRunSummary[]) =>
  buildTraceBlocks(ui, false, { agentRuns: runs })
    .flatMap((block) => block.kind === 'activity' && block.agentSummary ? [block.agentSummary.run_id] : [])

const record = (id: string, status: AgentRunRecord['status'] = 'cancelled'): AgentRunRecord => ({
  schemaVersion: 3, id: `record-${id}`, runId: id, sessionId: `worker-${id}`,
  originSessionId: 'parent', parentRunId: 'parent-turn',
  definitionId: 'general', definitionName: 'General Agent', kind: 'standard',
  userMessage: 'Read the fixture', status, startedAtMs: 1_000, finishedAtMs: 2_000,
  totalSteps: 1, finalReply: '', defaultModelInstanceId: 'selected-model', stages: [],
})
const restore = (ui: UIMessage): UIMessage => convertThreadMessageToUIMessage(
  JSON.parse(JSON.stringify(convertUIMessageToThreadMessage(ui, 'parent')))
)
const savedNativeSpawn = (runId: string): UIMessage => restore({
  id: 'spawn', role: 'assistant', parts: [
    {
      type: 'tool-agent_spawn', toolCallId: 'spawn-call', state: 'output-available',
      input: { task: 'Read the fixture' },
      output: {
        runId, sessionId: `worker-${runId}`, originSessionId: 'parent',
        parentRunId: 'parent-turn', status: 'running',
      },
    },
    { type: 'text', text: 'The worker is running.' },
  ],
})

describe('Chat worker activity restoration', () => {
  it('restores both workers from production saved history with an empty live store', () => {
    const original = message('saved', [summary('first'), summary('second')])
    const restored = convertThreadMessageToUIMessage(JSON.parse(JSON.stringify({
      id: original.id, role: 'assistant', content: extractContentPartsFromUIMessage(original), metadata: {},
    })))
    const projection = projectChatRunActivity([restored], {})
    expect(agentIds(restored, projection.byMessageId.get('saved')!)).toEqual(['first', 'second'])
    expect(chatCapabilityRuns(restored)).toEqual([summary('first'), summary('second')])
    expect(restored.parts).toEqual(original.parts)
  })

  it.each(['cancelled', 'incomplete'] as const)(
    'restores an uncollected native spawn as %s from runtime history with an empty live store',
    (status) => {
      const restored = savedNativeSpawn('uncollected')
      expect(chatCapabilityRuns(restored)).toEqual([{
        run_id: 'uncollected', origin_session_id: 'parent', parent_run_id: 'parent-turn',
        status: 'running', stages: [], tools: [], loops: [],
      }])

      const projection = projectChatRunActivity([restored], {}, [record('uncollected', status)])
      const runs = projection.byMessageId.get(restored.id)!
      expect(runs).toEqual([expect.objectContaining({
        run_id: 'uncollected', origin_session_id: 'parent', parent_run_id: 'parent-turn', status,
        definition: {
          id: 'general', name: 'General Agent', kind: 'standard', model_instance_id: 'selected-model',
        },
        step_count: 1, duration_ms: 1_000,
      })])
      expect(agentIds(restored, runs)).toEqual(['uncollected'])
      expect(buildTraceBlocks(restored, false, { agentRuns: runs })).toEqual(expect.arrayContaining([
        expect.objectContaining({ agentSummary: expect.objectContaining({ run_id: 'uncollected', status }) }),
      ]))
      expect([...projection.runIds]).toEqual(['uncollected'])
    }
  )

  it.each(['awaiting_approval', 'awaiting_folder_access'] as const)(
    'prefers the persisted runtime outcome to stale live %s state',
    (status) => {
      const worker = createAgentRunState()
      worker.runId = 'uncollected'
      worker.originSessionId = 'parent'
      worker.parentRunId = 'parent-turn'
      worker.status = status
      const restored = savedNativeSpawn('uncollected')
      const projection = projectChatRunActivity([restored], { worker }, [record('uncollected')])
      expect(projection.byMessageId.get(restored.id)).toEqual([expect.objectContaining({
        run_id: 'uncollected', origin_session_id: 'parent', parent_run_id: 'parent-turn',
        status: 'cancelled', duration_ms: 1_000,
      })])
      expect(worker.status).toBe(status)
    }
  )

  it('only reconciles runs already saved in this Chat, even when other runtime records share its parent', () => {
    const restored = savedNativeSpawn('visible')
    const records = [
      record('unrelated-same-parent'),
      record('visible'),
      { ...record('unrelated-other-chat'), originSessionId: 'other-chat' },
    ]
    const projection = projectChatRunActivity([restored], {}, records)
    expect([...projection.runIds]).toEqual(['visible'])
    expect([...projection.byMessageId.keys()]).toEqual([restored.id])
    expect(agentIds(restored, projection.byMessageId.get(restored.id)!)).toEqual(['visible'])
    const empty = projectChatRunActivity([], {}, records)
    expect(empty.runIds.size).toBe(0)
    expect(empty.byMessageId.size).toBe(0)
  })

  it('preserves a collected terminal summary with tool and inference details over a less detailed runtime record', () => {
    const collected: AgentRunSummary = {
      ...summary('collected'), origin_session_id: 'parent', parent_run_id: 'parent-turn',
      finish_reason: 'reply', step_count: 3, duration_ms: 2_000,
      stages: [{
        id: 'general', name: 'General Agent', role: 'worker', status: 'finished',
        model_instance_id: 'selected-model', step_count: 3, duration_ms: 2_000,
        inference: { prompt_tokens: 120, generated_tokens: 30, prompt_ms: 10, generation_ms: 100 },
      }],
      tools: [{ tool: 'os.fs.read', status: 'ok', batch_index: 0, batch_size: 1 }],
      loops: [{ level: 'warn', detector: 'no_progress', message: 'Repeated read avoided.' }],
    }
    const restored = restore(message('collected-result', [collected]))
    const projection = projectChatRunActivity([restored], {}, [record('collected', 'finished')])
    expect(projection.byMessageId.get(restored.id)).toEqual([collected])
    expect(agentIds(restored, projection.byMessageId.get(restored.id)!)).toEqual(['collected'])
  })

  it('uses the latest saved observation once across spawn, monitor and wait messages', () => {
    const messages = [message('spawn', [summary('first', 'running'), summary('second', 'running')]),
      message('monitor', [summary('first', 'awaiting_approval')]),
      message('wait', [summary('first'), summary('second')])]
    const projection = projectChatRunActivity(messages, {})
    expect([...projection.byMessageId.values()].flat()).toEqual([summary('first'), summary('second')])
    expect(messages.flatMap((ui) => agentIds(ui, projection.byMessageId.get(ui.id)!))).toEqual(['first', 'second'])
  })

  it('merges live worker progress and completion without replacing a newer durable terminal result', () => {
    const worker = createAgentRunState()
    worker.runId = 'first'
    worker.status = 'awaiting_folder_access'
    const messages = [message('spawn', [summary('first', 'running'), summary('second')])]
    let projection = projectChatRunActivity(messages, { worker })
    expect(projection.byMessageId.get('spawn')?.map((run) => run.status)).toEqual(['awaiting_folder_access', 'finished'])
    expect(projection.runIds.has(worker.runId)).toBe(true)
    worker.status = 'cancelled'
    projection = projectChatRunActivity(messages, { worker })
    expect(projection.byMessageId.get('spawn')?.[0].status).toBe('cancelled')
    messages.push(message('wait', [summary('first', 'finished')]))
    expect(projectChatRunActivity(messages, { worker }).byMessageId.get('spawn')?.[0].status).toBe('finished')
  })

  it('restores a saved standalone agent and ignores obsolete running metadata when a tool has finished', () => {
    const ui = message('legacy', [summary('first')])
    ui.metadata = { agent_run: summary('first', 'running') }
    expect(chatCapabilityRuns(ui)).toEqual([summary('first')])
    const standalone: UIMessage = { id: 'agent', role: 'assistant', parts: [], metadata: { agent_run: summary('standalone') } }
    expect(agentIds(standalone, projectChatRunActivity([standalone], {}).byMessageId.get('agent')!)).toEqual(['standalone'])
  })
})

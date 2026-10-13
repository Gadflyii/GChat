import { describe, expect, it } from 'vitest'
import type { UIMessage } from 'ai'
import type { AgentRunSummary } from '@/types/agent'
import { createAgentRunState } from '@/hooks/useAgentRun'
import { chatCapabilityRuns, projectChatRunActivity } from './agent-run-message'
import { buildTraceBlocks } from './tools/message-trace-parts'
import { convertThreadMessageToUIMessage, extractContentPartsFromUIMessage } from './messages'

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

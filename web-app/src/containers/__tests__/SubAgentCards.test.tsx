import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { UIMessage } from 'ai'
import { MessageItem } from '../MessageItem'
import {
  chatWorkerRunKey,
  createAgentRunState,
  reduceAgentRunState,
  useAgentRun,
} from '@/hooks/useAgentRun'
import {
  convertThreadMessageToUIMessage,
  convertUIMessageToThreadMessage,
} from '@/lib/messages'
import { seedServiceHub } from '@/test/service-hub'
import type { AgentEvent, AgentRunState } from '@/types/agent'

vi.mock('@/i18n/react-i18next-compat', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))
vi.mock('@/hooks/useModelProvider', () => ({
  useModelProvider: (selector: (s: unknown) => unknown) =>
    selector({ selectedModel: { id: 'test-model' } }),
}))
vi.mock('@/hooks/useGeneralSetting', () => ({
  useGeneralSetting: (selector: (s: unknown) => unknown) =>
    selector({ disableReasoning: false }),
}))

const briefs = [
  { title: 'Summarize notes-1.txt', task: 'Read notes-1.txt and summarize it in one sentence.' },
  { title: 'Summarize notes-2.txt', task: 'Read notes-2.txt and summarize it in one sentence.' },
  { title: 'Summarize notes-3.txt', task: 'Read notes-3.txt and summarize it in one sentence.' },
]

function dispatchMessage(part: Record<string, unknown>): UIMessage {
  return {
    id: 'parent-reply',
    role: 'assistant',
    parts: [{
      type: 'tool-agent_dispatch',
      toolCallId: 'dispatch-call',
      input: { agents: briefs },
      ...part,
    }] as UIMessage['parts'],
  }
}

function worker(index: number, events: AgentEvent[]): AgentRunState {
  const runId = `worker-${index + 1}`
  const started: AgentRunState = {
    ...createAgentRunState(),
    runId,
    originSessionId: 'chat',
    parentRunId: 'user-turn',
    status: 'running',
    startedAtMs: 1,
    subAgent: { dispatchId: 'dispatch-call', index, ...briefs[index] },
  }
  return [
    { type: 'turn_started', run_id: runId, session_id: `session-${runId}` } as AgentEvent,
    ...events,
  ].reduce((state, event) => reduceAgentRunState(state, event, 5), started)
}

const queued: AgentEvent = { type: 'stage_queued', stage_id: 'agent', name: 'General Agent', reason: 'Waiting' }
const started: AgentEvent = { type: 'stage_started', stage_id: 'agent', name: 'General Agent', role: 'agent', cycle: null, model_instance_id: 'model', reasoning_effort: null }

function setWorkers(states: AgentRunState[]) {
  useAgentRun.setState({
    runs: Object.fromEntries(states.map((state) => [chatWorkerRunKey('chat', state.runId!), state])),
  })
}

const card = (title: string) => screen.getByRole('article', { name: new RegExp(`^${title}:`) })

beforeEach(() => {
  seedServiceHub()
  useAgentRun.getState().clearAll()
})

describe('Chat sub-agent cards', () => {
  it('shows each live sub-agent with its task, progress and a Stop button for that worker only', () => {
    setWorkers([
      worker(0, [queued]),
      worker(1, [queued, started, {
        type: 'tool_call_parsed', call: { tool: 'os.fs.read', args: { path: 'notes-2.txt' } }, batch_index: 0, batch_size: 1,
      }]),
      worker(2, [queued, started, {
        type: 'approval_requested', run_id: 'worker-3', approval_id: 'a', tool: 'os.fs.write', reason: 'Write', preview: {}, affected_resources: [], can_remember: false,
      }]),
    ])
    const onCancel = vi.fn()
    render(
      <MessageItem
        message={dispatchMessage({ state: 'input-available' })}
        onCancelAgentRun={onCancel}
        isFirstMessage={false}
        isLastMessage
        status="submitted"
        requestActive
      />
    )

    expect(screen.getByRole('region', { name: '3 sub-agents' })).toBeInTheDocument()
    expect(within(card(briefs[0].title)).getByRole('status')).toHaveTextContent('Waiting for a free model slot')
    expect(within(card(briefs[0].title)).getByText(briefs[0].task)).toBeInTheDocument()
    const working = card(briefs[1].title)
    expect(within(working).getByRole('status')).toHaveTextContent('Working · 1 step done')
    expect(within(working).getByRole('list', { name: 'Recent steps' })).toHaveTextContent('Reading file · notes-2.txt')
    expect(within(card(briefs[2].title)).getByRole('status')).toHaveTextContent('Waiting for your approval')
    // The parent placeholder spinner yields to the cards while they run.
    expect(screen.queryByText('activity.working')).not.toBeInTheDocument()

    fireEvent.click(within(working).getByRole('button', { name: `Stop ${briefs[1].title}` }))
    expect(onCancel).toHaveBeenCalledExactlyOnceWith('worker-2')
    expect(screen.getAllByRole('button', { name: /^Stop / })).toHaveLength(3)
  })

  it('updates a card live when its worker replies, then restores saved results after reopening', () => {
    setWorkers([worker(0, [queued, started]), worker(1, [queued]), worker(2, [queued])])
    const view = render(
      <MessageItem
        message={dispatchMessage({ state: 'input-available' })}
        onCancelAgentRun={vi.fn()}
        isFirstMessage={false}
        isLastMessage
        status="submitted"
        requestActive
      />
    )
    expect(within(card(briefs[0].title)).getByRole('status')).toHaveTextContent('Working')
    act(() => {
      const key = chatWorkerRunKey('chat', 'worker-1')
      useAgentRun.getState().applyEvent(key, { type: 'assistant_reply', text: 'Notes one cover the launch plan.' })
      useAgentRun.getState().applyEvent(key, { type: 'turn_finished', reason: 'reply', step_count: 2 })
    })
    expect(within(card(briefs[0].title)).getByRole('status')).toHaveTextContent('Done')
    expect(within(card(briefs[0].title)).getByText('Notes one cover the launch plan.')).toBeInTheDocument()
    expect(within(card(briefs[0].title)).queryByRole('button')).not.toBeInTheDocument()
    view.unmount()

    const finished = dispatchMessage({
      state: 'output-available',
      output: {
        agents: [
          { title: briefs[0].title, runId: 'worker-1', status: 'done', result: 'Notes one cover the launch plan.' },
          { title: briefs[1].title, runId: 'worker-2', status: 'stopped' },
          { title: briefs[2].title, runId: 'worker-3', status: 'failed', error: 'notes-3.txt was not found' },
        ],
      },
    })
    // Reopening the saved conversation has no live worker state.
    useAgentRun.getState().clearAll()
    const reopened = convertThreadMessageToUIMessage(
      JSON.parse(JSON.stringify(convertUIMessageToThreadMessage(finished, 'chat')))
    )
    render(
      <MessageItem
        message={reopened}
        onCancelAgentRun={vi.fn()}
        isFirstMessage={false}
        isLastMessage
        status="ready"
      />
    )
    expect(within(card(briefs[0].title)).getByRole('status')).toHaveTextContent('Done')
    expect(within(card(briefs[0].title)).getByText('Notes one cover the launch plan.')).toBeInTheDocument()
    expect(within(card(briefs[1].title)).getByRole('status')).toHaveTextContent('Stopped')
    expect(within(card(briefs[2].title)).getByRole('status')).toHaveTextContent('Failed')
    expect(within(card(briefs[2].title)).getByRole('alert')).toHaveTextContent('notes-3.txt was not found')
    expect(screen.queryByRole('button', { name: /^Stop / })).not.toBeInTheDocument()
  })

  it('marks sub-agents of an interrupted dispatch as not finished', () => {
    render(
      <MessageItem
        message={dispatchMessage({ state: 'input-available' })}
        isFirstMessage={false}
        isLastMessage
        status="ready"
        requestActive={false}
      />
    )
    for (const { title } of briefs) {
      expect(within(card(title)).getByRole('status')).toHaveTextContent('Did not finish')
    }
  })
})

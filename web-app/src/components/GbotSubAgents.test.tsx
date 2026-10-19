import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { Approval, Task } from '@/services/gbot'
import { gbotTopLevelTasks } from '@/lib/gbot-sub-agents'
import { GbotSubAgents } from './GbotSubAgents'

vi.mock('@/i18n/react-i18next-compat', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

afterEach(cleanup)

const identity = { workspace_id: 'bot', session_id: 'session' }

function task(id: string, patch: Partial<Task>): Task {
  return { id, identity, state: 'running', messages: [], help_requests: [], ...patch }
}

function child(index: number, title: string, patch: Partial<Task>): Task {
  const { messages = [], ...rest } = patch
  return task(`child-${index}`, {
    sub_agent: { parent: 'parent', call_id: 'dispatch-1', index, title },
    messages: [
      { role: 'system', content: 'You are a sub-agent.' },
      { role: 'user', content: `${title} on this computer` },
      ...messages,
    ],
    ...rest,
  })
}

const parent = task('parent', { messages: [{ role: 'user', content: 'Use three helpers' }] })
const tasks: Task[] = [
  parent,
  // Saved out of order: cards follow the dispatch order.
  child(2, 'Check the calendar', {
    state: 'waiting_for_human',
    help_requests: [{ id: 'question', question: 'Which calendar?', status: 'pending', response: null }],
  }),
  child(0, 'Open the report', {
    calls: [{ call_id: 'c1', name: 'click', reply: null }],
  }),
  child(1, 'Rename the file', {
    state: 'completed',
    calls: [{ call_id: 'c2', name: 'click', reply: { ok: true } }],
    messages: [{ role: 'assistant', content: 'Renamed report.txt to summary.txt.' }],
  }),
  child(3, 'Send the summary', { state: 'running' }),
]
const approvals: Approval[] = [{ id: 'approve', task_id: 'child-3', request: { operation: {} } }]

it('lists only top-level tasks and shows each sub-agent inside its parent', () => {
  expect(gbotTopLevelTasks(tasks).map(({ id }) => id)).toEqual(['parent'])
  const onStop = vi.fn()
  const onAnswer = vi.fn().mockResolvedValue(undefined)
  render(
    <GbotSubAgents
      parent={parent}
      tasks={tasks}
      approvals={approvals}
      busy={false}
      onStop={onStop}
      onAnswer={onAnswer}
    />
  )

  const region = screen.getByRole('region', { name: '4 sub-agents' })
  const cards = within(region).getAllByRole('article')
  expect(cards.map((card) => card.getAttribute('aria-label'))).toEqual([
    'Open the report: Working',
    'Rename the file: Done',
    'Check the calendar: Waiting for your answer',
    'Send the summary: Waiting for your approval',
  ])
  expect(within(cards[0]).getByText('Open the report on this computer')).toBeInTheDocument()
  expect(within(cards[0]).getByRole('list', { name: 'Recent steps' })).toHaveTextContent('Calling Click')
  expect(within(cards[1]).getByText('Renamed report.txt to summary.txt.')).toBeInTheDocument()
  expect(within(cards[1]).queryByRole('button', { name: /^Stop/ })).not.toBeInTheDocument()
  expect(within(cards[2]).getByText('Which calendar?')).toBeInTheDocument()

  fireEvent.click(within(cards[0]).getByRole('button', { name: 'Stop Open the report' }))
  expect(onStop).toHaveBeenCalledExactlyOnceWith('child-0')
  expect(within(region).getAllByRole('button', { name: /^Stop / })).toHaveLength(3)
})

it('explains sub-agents that stopped for review or did not finish', () => {
  render(
    <GbotSubAgents
      parent={parent}
      tasks={[
        parent,
        child(0, 'Uncertain click', { state: 'needs_review' }),
        child(1, 'Interrupted work', {
          state: 'interrupted',
          history: [{ state: 'interrupted', reason: 'Cua executor stopped before task completion', at: 1 }],
        }),
        child(2, 'Stopped work', { state: 'cancelled' }),
      ]}
      approvals={[]}
      busy={false}
      onStop={vi.fn()}
      onAnswer={vi.fn()}
    />
  )
  const [review, interrupted, stopped] = screen.getAllByRole('article')
  expect(within(review).getByRole('status')).toHaveTextContent('Failed')
  expect(within(review).getByRole('alert')).toHaveTextContent('tool result is uncertain')
  expect(within(interrupted).getByRole('status')).toHaveTextContent('Did not finish')
  expect(within(interrupted).getByRole('alert')).toHaveTextContent('Cua executor stopped')
  expect(within(stopped).getByRole('status')).toHaveTextContent('Stopped')
  expect(screen.queryByRole('button', { name: /^Stop / })).not.toBeInTheDocument()
})

it('renders nothing for a task without sub-agents', () => {
  const { container } = render(
    <GbotSubAgents parent={parent} tasks={[parent]} approvals={[]} busy={false} onStop={vi.fn()} onAnswer={vi.fn()} />
  )
  expect(container).toBeEmptyDOMElement()
})

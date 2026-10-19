import { describe, expect, it } from 'vitest'
import type { Approval, Task } from '@/services/gbot'
import { gbotAlerts, snapshotOf } from '../gbot-alerts'

const task = (id: string, state: string, text = 'Check the inbox'): Task => ({
  id,
  identity: { workspace_id: 'w', session_id: 's' },
  state,
  messages: [{ role: 'user', content: text }],
  help_requests: [],
})
const approval = (id: string, task_id: string): Approval => ({
  id,
  task_id,
  request: { operation: {} },
})

describe('Gbot alerts', () => {
  it('only records the first snapshot, so history is never replayed', () => {
    expect(gbotAlerts(null, [task('a', 'completed')], [approval('p', 'a')])).toEqual([])
  })

  it('alerts when a task finishes, needs review or waits for an answer', () => {
    const before = snapshotOf(
      [task('a', 'running'), task('b', 'running'), task('c', 'running')],
      []
    )
    const alerts = gbotAlerts(
      before,
      [task('a', 'completed'), task('b', 'needs_review'), task('c', 'waiting_for_human')],
      []
    )
    expect(alerts.map((alert) => alert.title)).toEqual([
      'Gbot finished a task',
      'Gbot needs you to review a task',
      'Gbot is waiting for your answer',
    ])
    expect(alerts[0].body).toBe('Check the inbox')
  })

  it('does not repeat an alert for an unchanged state or a running task', () => {
    const tasks = [task('a', 'completed'), task('b', 'running')]
    expect(gbotAlerts(snapshotOf(tasks, []), tasks, [])).toEqual([])
  })

  it('alerts once for a new approval and names the task', () => {
    const tasks = [task('a', 'running', 'Send the report')]
    const before = snapshotOf(tasks, [approval('p1', 'a')])
    const alerts = gbotAlerts(before, tasks, [approval('p1', 'a'), approval('p2', 'a')])
    expect(alerts).toEqual([
      { key: 'approval:p2', title: 'Gbot needs your approval', body: 'Send the report' },
    ])
  })

  it('shortens a long request and copes with a missing one', () => {
    const before = snapshotOf([task('a', 'running')], [])
    const long = gbotAlerts(before, [task('a', 'completed', 'x'.repeat(200))], [])
    expect(long[0].body).toHaveLength(80)
    const none = gbotAlerts(before, [{ ...task('a', 'completed'), messages: [] }], [])
    expect(none[0].body).toBe('Open Gbot to see the details.')
  })
})

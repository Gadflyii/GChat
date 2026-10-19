import { messageText, type Approval, type Task } from '@/services/gbot'

export type GbotAlert = { key: string; title: string; body: string }
export type GbotSnapshot = {
  states: Map<string, string>
  approvals: Set<string>
}

export function snapshotOf(tasks: Task[], approvals: Approval[]): GbotSnapshot {
  return {
    states: new Map(tasks.map((task) => [task.id, task.state])),
    approvals: new Set(approvals.map((approval) => approval.id)),
  }
}

function summary(task: Task | undefined): string {
  const first = task?.messages.find((message) => message.role === 'user')
  const text = first ? messageText(first.content).replace(/\s+/g, ' ').trim() : ''
  if (!text) return 'Open Gbot to see the details.'
  return text.length > 80 ? `${text.slice(0, 77)}...` : text
}

const TITLES: Record<string, string> = {
  completed: 'Gbot finished a task',
  needs_review: 'Gbot needs you to review a task',
  waiting_for_human: 'Gbot is waiting for your answer',
}

/**
 * What changed since the last snapshot that the person should hear about: a task
 * finished, needs review or is waiting for an answer, or a new approval is pending.
 * With no earlier snapshot the current state is only recorded, so reconnecting never
 * replays old history as alerts.
 */
export function gbotAlerts(
  previous: GbotSnapshot | null,
  tasks: Task[],
  approvals: Approval[]
): GbotAlert[] {
  if (!previous) return []
  const alerts: GbotAlert[] = []
  for (const task of tasks) {
    const title = TITLES[task.state]
    if (title && previous.states.get(task.id) !== task.state)
      alerts.push({
        key: `task:${task.id}:${task.state}`,
        title,
        body: summary(task),
      })
  }
  for (const approval of approvals) {
    if (!previous.approvals.has(approval.id))
      alerts.push({
        key: `approval:${approval.id}`,
        title: 'Gbot needs your approval',
        body: summary(tasks.find((task) => task.id === approval.task_id)),
      })
  }
  return alerts
}

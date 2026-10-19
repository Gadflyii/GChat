import type { SubAgentPhase } from '@/lib/sub-agents'
import type { Task } from '@/services/gbot'

/** Sub-agents appear inside their parent task, not as separate tasks. */
export function gbotTopLevelTasks(tasks: readonly Task[]): Task[] {
  return tasks.filter((task) => !task.sub_agent)
}

export function gbotSubAgentsOf(tasks: readonly Task[], parent: Task): Task[] {
  return tasks
    .filter((task) => task.sub_agent?.parent === parent.id)
    .sort((a, b) => a.sub_agent!.index - b.sub_agent!.index)
}

export function gbotSubAgentPhase(task: Task, approval: boolean): SubAgentPhase {
  if (approval) return 'approval'
  switch (task.state) {
    case 'ready':
      return 'starting'
    case 'running':
      return 'working'
    case 'waiting_for_human':
      return 'question'
    case 'completed':
      return 'done'
    case 'cancelled':
      return 'stopped'
    case 'needs_review':
      return 'failed'
    default:
      return 'not_finished'
  }
}

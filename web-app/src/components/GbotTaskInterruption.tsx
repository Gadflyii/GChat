import type { Task } from '@/services/gbot'

export default function GbotTaskInterruption({ task }: { task: Task }) {
  if (task.state !== 'interrupted') return null
  const reason = task.history
    ?.slice()
    .reverse()
    .find((event) => event.state === 'interrupted')?.reason
  return (
    <div className="space-y-2 text-sm text-muted-foreground">
      <p>
        This task stopped before it finished. Check the model and computer
        connections, then resume the task to try again.
      </p>
      {reason && (
        <details>
          <summary>Details</summary>
          <p className="whitespace-pre-wrap break-words">{reason}</p>
        </details>
      )}
    </div>
  )
}

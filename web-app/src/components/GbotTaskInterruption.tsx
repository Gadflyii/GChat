import type { Task } from '@/services/gbot'

export default function GbotTaskInterruption({ task }: { task: Task }) {
  if (task.state !== 'interrupted') return null
  const reason = task.history
    ?.slice()
    .reverse()
    .find((event) => event.state === 'interrupted')?.reason
  return reason ? (
    <p className="whitespace-pre-wrap break-words text-sm text-muted-foreground">
      {reason}
    </p>
  ) : null
}

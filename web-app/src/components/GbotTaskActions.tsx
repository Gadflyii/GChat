import { useRef, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'

type TaskAction = 'cancel' | 'resume'

export default function GbotTaskActions({
  taskState,
  busy,
  ready,
  botHasControl,
  onAction,
  stopLabel = 'Stop task',
  resumeLabel = 'Resume task',
  size = 'sm',
}: {
  taskState: string
  busy: boolean
  ready: boolean
  botHasControl: boolean
  onAction: (action: TaskAction) => Promise<void>
  stopLabel?: string
  resumeLabel?: string
  size?: 'sm' | 'default'
}) {
  const [pending, setPending] = useState<TaskAction>()
  const submitting = useRef(false)
  const available: TaskAction | undefined = [
    'running',
    'waiting_for_human',
  ].includes(taskState)
    ? 'cancel'
    : ['ready', 'paused', 'interrupted', 'cancelled'].includes(taskState)
      ? 'resume'
      : undefined
  const action = pending ?? available
  if (!action) return null
  const blocked = busy || (action === 'resume' && (!ready || !botHasControl))
  const perform = async () => {
    if (blocked || submitting.current || !available) return
    submitting.current = true
    setPending(available)
    try {
      await onAction(available)
    } catch (cause) {
      toast.error(String(cause))
    } finally {
      submitting.current = false
      setPending(undefined)
    }
  }
  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      {pending && (
        <span role="status" className="text-xs text-muted-foreground">
          {pending === 'cancel' ? 'Stopping this task…' : 'Resuming this task…'}
        </span>
      )}
      <Button
        type="button"
        variant="ghost"
        size={size}
        aria-busy={Boolean(pending)}
        disabled={blocked || Boolean(pending)}
        onClick={() => void perform()}
      >
        {pending
          ? pending === 'cancel'
            ? 'Stopping…'
            : 'Resuming…'
          : action === 'cancel'
            ? stopLabel
            : resumeLabel}
      </Button>
    </div>
  )
}

import { useRef, useState } from 'react'
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
  const [error, setError] = useState<{ action: TaskAction; message: string }>()
  const available: TaskAction[] = ['running', 'waiting_for_human'].includes(taskState)
    ? ['cancel']
    : ['ready', 'paused', 'interrupted'].includes(taskState)
      ? ['cancel', 'resume']
      : taskState === 'cancelled'
        ? ['resume']
        : []
  const actions = pending && !available.includes(pending)
    ? [...available, pending]
    : available
  if (!actions.length) return null
  const blocked = (action: TaskAction) =>
    busy || Boolean(pending) || (action === 'resume' && (!ready || !botHasControl))
  const perform = async (action: TaskAction) => {
    if (blocked(action) || submitting.current || !available.includes(action)) return
    submitting.current = true
    setPending(action)
    setError(undefined)
    try {
      await onAction(action)
    } catch (cause) {
      setError({
        action,
        message: cause instanceof Error ? cause.message : String(cause),
      })
    } finally {
      submitting.current = false
      setPending(undefined)
    }
  }
  return (
    <div className="min-w-0 space-y-2">
      <div className="flex flex-wrap items-center justify-end gap-2">
        {pending && (
          <span role="status" className="text-xs text-muted-foreground">
            {pending === 'cancel' ? 'Stopping this task…' : 'Resuming this task…'}
          </span>
        )}
        {actions.map((action) => (
          <Button
            key={action}
            type="button"
            variant="ghost"
            size={size}
            aria-busy={pending === action}
            disabled={blocked(action)}
            onClick={() => void perform(action)}
          >
            {pending === action
              ? action === 'cancel'
                ? 'Stopping…'
                : 'Resuming…'
              : action === 'cancel'
                ? stopLabel
                : resumeLabel}
          </Button>
        ))}
      </div>
      {error && (
        <div role="alert" className="space-y-1 text-sm text-foreground">
          <p>
            {error.action === 'cancel'
              ? 'Could not stop this task. Try again.'
              : 'Could not resume this task. Try again.'}
          </p>
          <details className="text-muted-foreground">
            <summary className="cursor-pointer">Details</summary>
            <p className="break-words">{error.message}</p>
          </details>
        </div>
      )}
    </div>
  )
}

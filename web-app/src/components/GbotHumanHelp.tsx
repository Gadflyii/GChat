import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import type { HelpRequest } from '@/services/gbot'

export default function GbotHumanHelp({
  request,
  taskState,
  busy,
  reply,
}: {
  request: HelpRequest
  taskState: string
  busy: boolean
  reply: (response: string | null) => Promise<void>
}) {
  const [answer, setAnswer] = useState('')
  const [pending, setPending] = useState<'reply' | 'decline' | null>(null)
  const pendingRef = useRef(false)
  const [error, setError] = useState<{
    action: 'reply' | 'decline'
    message: string
  } | null>(null)
  const disabled = busy || pending !== null

  useEffect(() => {
    if (error && request.status !== 'pending' && taskState !== 'interrupted') {
      setError(null)
    }
  }, [error, request.status, taskState])

  async function respond(response: string | null) {
    if (
      busy ||
      pendingRef.current ||
      request.status !== 'pending' ||
      (response !== null && !response.trim())
    ) {
      return
    }
    const action = response === null ? 'decline' : 'reply'
    pendingRef.current = true
    setPending(action)
    setError(null)
    try {
      await reply(response)
    } catch (cause) {
      setError({
        action,
        message: cause instanceof Error ? cause.message : String(cause),
      })
    } finally {
      pendingRef.current = false
      setPending(null)
    }
  }

  return (
    <div className="space-y-2 rounded-md border bg-muted/30 p-3">
      <p className="text-sm font-medium">Asking you for help</p>
      <p className="whitespace-pre-wrap text-sm">{request.question}</p>
      {request.status === 'pending' ? (
        <form
          className="space-y-2"
          onSubmit={(event) => {
            event.preventDefault()
            void respond(answer)
          }}
        >
          <textarea
            aria-label="Your reply"
            className="min-h-20 w-full rounded-md border bg-background p-2 text-sm"
            value={answer}
            disabled={disabled}
            onChange={(event) => setAnswer(event.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            Your reply continues this task. Other actions still need their own
            approval.
          </p>
          {pending && (
            <p role="status" className="text-sm text-muted-foreground">
              {pending === 'reply' ? 'Sending reply…' : 'Declining request…'}
            </p>
          )}
          <div className="flex gap-2">
            <Button disabled={disabled || !answer.trim()}>
              {pending === 'reply' ? 'Sending reply…' : 'Send reply'}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={disabled}
              onClick={() => void respond(null)}
            >
              {pending === 'decline' ? 'Declining…' : 'Decline'}
            </Button>
          </div>
        </form>
      ) : (
        <p className="whitespace-pre-wrap text-sm text-muted-foreground">
          {request.status === 'completed'
            ? `Your reply: ${request.response}`
            : request.status === 'declined'
              ? 'Request declined'
              : 'Request cancelled'}
        </p>
      )}
      {error && (
        <div role="alert" className="space-y-1 text-sm text-destructive">
          {request.status === 'completed' || request.status === 'declined' ? (
            <p>
              Your response was saved, but this task could not continue. Check
              the model and computer connections, then resume the task.
            </p>
          ) : request.status === 'pending' ? (
            <p>
              {error.action === 'reply'
                ? 'Could not confirm your reply. Your draft is still here. If this task is still asking for help, choose Send reply to try again.'
                : 'Could not confirm that the request was declined. Your draft is still here. If this task is still asking for help, choose Decline to try again.'}
            </p>
          ) : (
            <p>
              Could not confirm your response. This help request is no longer
              open. Check the task status.
            </p>
          )}
          <details className="text-muted-foreground">
            <summary>Details</summary>
            <p className="whitespace-pre-wrap break-words">{error.message}</p>
          </details>
        </div>
      )}
    </div>
  )
}

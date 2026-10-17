import { useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import type { HelpRequest } from '@/services/gbot'

export default function GbotHumanHelp({
  request,
  busy,
  reply,
}: {
  request: HelpRequest
  busy: boolean
  reply: (response: string | null) => Promise<void>
}) {
  const [answer, setAnswer] = useState('')
  const [pending, setPending] = useState<'reply' | 'decline' | null>(null)
  const pendingRef = useRef(false)
  const [error, setError] = useState('')
  const disabled = busy || pending !== null

  async function respond(response: string | null) {
    if (
      busy ||
      pendingRef.current ||
      request.status !== 'pending' ||
      (response !== null && !response.trim())
    ) {
      return
    }
    pendingRef.current = true
    setPending(response === null ? 'decline' : 'reply')
    setError('')
    try {
      await reply(response)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
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
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
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
    </div>
  )
}

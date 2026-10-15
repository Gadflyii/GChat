import { useState } from 'react'
import { Button } from '@/components/ui/button'
import type { HelpRequest } from '@/services/gbot'

export default function GbotHumanHelp({
  request,
  busy,
  reply,
}: {
  request: HelpRequest
  busy: boolean
  reply: (response: string | null) => void
}) {
  const [answer, setAnswer] = useState('')
  return (
    <div className="space-y-2 rounded-md border bg-muted/30 p-3">
      <p className="text-sm font-medium">Asking you for help</p>
      <p className="whitespace-pre-wrap text-sm">{request.question}</p>
      {request.status === 'pending' ? (
        <form
          className="space-y-2"
          onSubmit={(event) => {
            event.preventDefault()
            if (answer.trim()) reply(answer)
          }}
        >
          <textarea
            aria-label="Your reply"
            className="min-h-20 w-full rounded-md border bg-background p-2 text-sm"
            value={answer}
            disabled={busy}
            onChange={(event) => setAnswer(event.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            Your reply continues this task. Other actions still need their own
            approval.
          </p>
          <div className="flex gap-2">
            <Button disabled={busy || !answer.trim()}>Send reply</Button>
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => reply(null)}
            >
              Decline
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

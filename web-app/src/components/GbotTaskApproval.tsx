import { useRef, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import type { Approval } from '@/services/gbot'

export default function GbotTaskApproval({
  approval,
  busy,
  reply,
}: {
  approval: Approval
  busy: boolean
  reply: (allow: boolean) => Promise<void>
}) {
  const [pending, setPending] = useState<boolean>()
  const submitting = useRef(false)
  const decide = async (allow: boolean) => {
    if (busy || submitting.current) return
    submitting.current = true
    setPending(allow)
    try {
      await reply(allow)
    } catch (cause) {
      toast.error(String(cause))
    } finally {
      submitting.current = false
      setPending(undefined)
    }
  }
  return (
    <article
      aria-label="Bot permission request"
      aria-busy={pending !== undefined}
      className="space-y-2 rounded-lg border p-3"
    >
      <p className="text-sm font-medium">Bot requests permission</p>
      <pre className="overflow-x-auto whitespace-pre-wrap break-words text-xs">
        {JSON.stringify(approval.request.operation, null, 2)}
      </pre>
      {pending !== undefined && (
        <p role="status" className="text-sm text-muted-foreground">
          {pending ? 'Allowing this action…' : 'Denying this action…'}
        </p>
      )}
      <div className="flex gap-2">
        <Button
          type="button"
          disabled={busy || pending !== undefined}
          onClick={() => void decide(true)}
        >
          {pending === true ? 'Allowing…' : 'Allow'}
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={busy || pending !== undefined}
          onClick={() => void decide(false)}
        >
          {pending === false ? 'Denying…' : 'Deny'}
        </Button>
      </div>
    </article>
  )
}

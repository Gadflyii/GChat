import { useRef, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import type { Approval } from '@/services/gbot'

function describeAction(operation: unknown): { summary: string; target?: string } {
  if (operation && typeof operation === 'object') {
    const action = operation as Record<string, unknown>
    const target = (field: string) => {
      const value = action[field]
      return typeof value === 'string' ? value : undefined
    }
    switch (action.kind) {
      case 'exec':
        return {
          summary: 'Run a program on the bot computer',
          target: target('program'),
        }
      case 'read':
        return {
          summary: 'Read a file on the bot computer',
          target: target('path'),
        }
      case 'write':
        return {
          summary: 'Write to a file on the bot computer',
          target: target('path'),
        }
      case 'desktop':
        return { summary: 'Use the bot desktop', target: target('tool') }
    }
    if (
      typeof action.name === 'string' &&
      typeof action.account_id === 'string' &&
      action.write === true
    ) {
      return {
        summary: 'Change data in a connected account',
        target: `${action.name} · Account: ${action.account_id}`,
      }
    }
  }
  return { summary: 'Review this action before allowing it' }
}

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
  const { summary, target } = describeAction(approval.request.operation)
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
      <p className="text-sm">{summary}</p>
      {target && <p className="break-words text-sm font-medium">{target}</p>}
      <p className="text-sm text-muted-foreground">
        Allow permits this action once. Deny prevents this action. Review the
        action details before deciding.
      </p>
      <details className="text-sm">
        <summary className="cursor-pointer">Action details</summary>
        <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words text-xs">
          {JSON.stringify(approval.request.operation, null, 2)}
        </pre>
      </details>
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

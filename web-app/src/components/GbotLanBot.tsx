import { useId, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { confirmAction } from '@/lib/confirm'
import { gbot } from '@/services/gbot'

/** Rename or remove a saved LAN bot. Removing never touches the computer itself. */
export default function GbotLanBot({
  id,
  name,
  busy,
  connected,
  perform,
  removed,
}: {
  id: string
  name: string
  busy: boolean
  connected: boolean
  perform: (action: () => Promise<unknown>, propagateError?: boolean) => Promise<void>
  removed: () => void
}) {
  const [renaming, setRenaming] = useState(false)
  const [draft, setDraft] = useState(name)
  const [error, setError] = useState('')
  const reasonId = useId()
  const errorId = useId()
  const trimmed = draft.trim()
  return (
    <div className="space-y-2">
      {renaming ? (
        <form
          aria-label="Rename bot"
          className="flex flex-wrap items-end gap-2"
          onSubmit={(event) => {
            event.preventDefault()
            if (!trimmed || trimmed === name) return
            setError('')
            void perform(
              async () => {
                await gbot('workspaces/ssh/rename', { workspace_id: id, name: trimmed })
                setRenaming(false)
              },
              true
            ).catch((cause) => {
              setError(cause instanceof Error ? cause.message : String(cause))
            })
          }}
        >
          <label className="space-y-1 text-sm">
            Bot name
            <Input
              autoFocus
              disabled={busy}
              aria-describedby={error ? errorId : undefined}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
            />
          </label>
          <Button disabled={busy || !trimmed || trimmed === name}>Save name</Button>
          <Button
            type="button"
            variant="ghost"
            disabled={busy}
            onClick={() => {
              setError('')
              setRenaming(false)
            }}
          >
            Cancel
          </Button>
        </form>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => {
              setDraft(name)
              setRenaming(true)
            }}
          >
            Rename bot
          </Button>
          <Button
            variant="outline"
            disabled={busy || connected}
            aria-describedby={connected ? reasonId : undefined}
            onClick={() =>
              void confirmAction({
                title: `Remove ${name}?`,
                message: `Remove ${name} from GChat? Its saved connection key is deleted. The computer itself is not changed, and you can add it again later.`,
                confirmLabel: 'Remove bot',
                destructive: true,
              }).then((accepted) => {
                if (!accepted) return
                void perform(async () => {
                  await gbot('workspaces/ssh/remove', { workspace_id: id })
                  removed()
                })
              })
            }
          >
            Remove bot
          </Button>
        </div>
      )}
      {error && (
        <div id={errorId} role="alert" className="space-y-1 text-sm">
          <p>Could not save this bot’s name. Try Save name again.</p>
          <details className="text-muted-foreground">
            <summary className="cursor-pointer">Details</summary>
            <p className="break-words">{error}</p>
          </details>
        </div>
      )}
      {connected && (
        <p id={reasonId} className="text-xs text-muted-foreground">
          Disconnect this bot before removing it. A bot with unfinished tasks,
          active schedules or linked accounts cannot be removed.
        </p>
      )}
    </div>
  )
}

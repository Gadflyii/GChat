import { useCallback, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { gbot } from '@/services/gbot'

type Fact = { id: string; text: string; by: 'person' | 'bot'; at: number }

export default function GbotMemory({ workspaceId }: { workspaceId: string }) {
  return <WorkspaceMemory key={workspaceId} workspaceId={workspaceId} />
}

function WorkspaceMemory({ workspaceId }: { workspaceId: string }) {
  const [facts, setFacts] = useState<Fact[]>()
  const [draft, setDraft] = useState('')
  const [editing, setEditing] = useState<{ id: string; text: string }>()
  const [busy, setBusy] = useState(true)
  const [error, setError] = useState<string>()

  const run = useCallback(async (route: string, body: Record<string, unknown>) => {
    setBusy(true)
    setError(undefined)
    try {
      const value = await gbot<{ facts: Fact[] }>(route, { workspace_id: workspaceId, ...body })
      setFacts(value.facts)
      return true
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
      return false
    } finally {
      setBusy(false)
    }
  }, [workspaceId])

  useEffect(() => {
    void run('memory/get', {})
  }, [run])

  return (
    <details className="rounded-lg border p-3">
      <summary className="cursor-pointer text-sm">Memory</summary>
      <p className="my-3 text-xs text-muted-foreground">
        Things this bot remembers about you. It reads them at the start of every task. You can add,
        change or delete any of them. The bot can ask to remember something new, and you approve it
        first. Do not store passwords here.
      </p>
      {facts?.length === 0 && (
        <p className="mb-3 text-sm text-muted-foreground">This bot does not remember anything yet.</p>
      )}
      <ul className="space-y-2">
        {facts?.map((fact) => (
          <li key={fact.id} className="flex flex-wrap items-center gap-2 text-sm">
            {editing?.id === fact.id ? (
              <>
                <Input
                  aria-label="Edit memory"
                  className="min-w-0 flex-1"
                  value={editing.text}
                  onChange={(event) => setEditing({ id: fact.id, text: event.target.value })}
                />
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  onClick={async () => {
                    if (await run('memory/edit', { id: fact.id, text: editing.text })) setEditing(undefined)
                  }}
                >
                  Save change
                </Button>
                <Button variant="outline" size="sm" disabled={busy} onClick={() => setEditing(undefined)}>
                  Cancel
                </Button>
              </>
            ) : (
              <>
                <span className="min-w-0 flex-1 break-words">
                  {fact.text}
                  <span className="block text-xs text-muted-foreground">
                    {fact.by === 'bot' ? 'Added by the bot, approved by you' : 'Added by you'}
                  </span>
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  aria-label={`Edit memory: ${fact.text}`}
                  disabled={busy}
                  onClick={() => setEditing({ id: fact.id, text: fact.text })}
                >
                  Edit
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  aria-label={`Delete memory: ${fact.text}`}
                  disabled={busy}
                  onClick={() => void run('memory/delete', { id: fact.id })}
                >
                  Delete
                </Button>
              </>
            )}
          </li>
        ))}
      </ul>
      <form
        className="mt-3 flex flex-wrap gap-2"
        onSubmit={async (event) => {
          event.preventDefault()
          if (!draft.trim()) return
          if (await run('memory/add', { text: draft })) setDraft('')
        }}
      >
        <Input
          aria-label="Add a memory"
          className="min-w-0 flex-1"
          placeholder="For example: I prefer metric units"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
        />
        <Button variant="outline" disabled={busy || !draft.trim()}>
          Remember this
        </Button>
      </form>
      {error !== undefined && (
        <p role="alert" className="mt-3 text-sm text-destructive">
          {error}
        </p>
      )}
    </details>
  )
}

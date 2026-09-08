import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { memoryCommand, type SavedMemory } from '@/lib/memory'
import { WorkspacePicker } from './WorkspacePicker'

type Draft = Pick<
  SavedMemory,
  'title' | 'content' | 'workspace' | 'pinned' | 'enabled'
> &
  Partial<SavedMemory>
const blank = (): Draft => ({
  title: '',
  content: '',
  workspace: null,
  pinned: false,
  enabled: true,
})

export function MemoryLibrary() {
  const [entries, setEntries] = useState<SavedMemory[]>([])
  const [draft, setDraft] = useState<Draft | null>(null)
  const [query, setQuery] = useState('')
  const [visibleCount, setVisibleCount] = useState(50)
  const [scope, setScope] = useState('all')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [workspace, setWorkspace] = useState('')
  const [instructions, setInstructions] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<string | null>(null)
  const refresh = async () =>
    setEntries(await memoryCommand<SavedMemory[]>('list'))
  useEffect(() => {
    void refresh().catch((e) => setError(String(e)))
  }, [])
  const act = async (operation: () => Promise<void>) => {
    setBusy(true)
    setError('')
    try {
      await operation()
    } catch (e) {
      setError(String(e))
    } finally {
      setBusy(false)
    }
  }
  const filtered = entries.filter(
    (m) =>
      (scope === 'all' ||
        (scope === 'personal' ? !m.workspace : !!m.workspace)) &&
      `${m.title} ${m.content} ${m.workspace ?? ''}`
        .toLowerCase()
        .includes(query.toLowerCase())
  )
  return (
    <div className="mx-auto w-full max-w-5xl space-y-5 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-medium">Memory</h1>
          <p className="text-sm text-muted-foreground">
            Facts and decisions you choose to keep across conversations.
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => void act(refresh)}
          >
            Refresh
          </Button>
          <Button
            disabled={busy}
            onClick={() => {
              setDraft(blank())
              setError('')
            }}
          >
            New memory
          </Button>
        </div>
      </div>
      <p className="text-sm text-muted-foreground">
        Personal memories can be recalled in GChat chat and agents. Workspace
        memories are limited to agents in that exact workspace. Relevant enabled
        entries are sent to the selected inference host. Do not store secrets.
        Terminal integrations keep their own memory.
      </p>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <div className="flex gap-3">
        <Input
          aria-label="Search memories"
          placeholder="Search memories…"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setVisibleCount(50)
          }}
        />
        <select
          aria-label="Memory scope"
          className="rounded-md border bg-background px-3"
          value={scope}
          onChange={(e) => setScope(e.target.value)}
        >
          <option value="all">All scopes</option>
          <option value="personal">Personal</option>
          <option value="workspace">Workspaces</option>
        </select>
      </div>
      {draft && (
        <form
          className="space-y-3 rounded-lg border bg-card p-4"
          onSubmit={(e) => {
            e.preventDefault()
            void act(async () => {
              await memoryCommand('save', draft)
              await refresh()
              setDraft(null)
            })
          }}
        >
          <h2 className="font-medium">
            {draft.id ? 'Edit memory' : 'New memory'}
          </h2>
          <label className="block text-sm">
            Title
            <Input
              required
              maxLength={120}
              value={draft.title}
              onChange={(e) => setDraft({ ...draft, title: e.target.value })}
            />
          </label>
          <label className="block text-sm">
            Memory
            <Textarea
              required
              maxLength={2000}
              rows={4}
              placeholder="A durable fact or decision, with enough context to use it correctly. Example: This project uses pnpm; run pnpm test before handing off changes."
              value={draft.content}
              onChange={(e) => setDraft({ ...draft, content: e.target.value })}
            />
          </label>
          <WorkspacePicker
            personalWhenEmpty
            value={draft.workspace ?? ''}
            onChange={(path) => setDraft({ ...draft, workspace: path || null })}
          />
          <div className="flex gap-5 text-sm">
            <label>
              <input
                type="checkbox"
                checked={draft.enabled}
                onChange={(e) =>
                  setDraft({ ...draft, enabled: e.target.checked })
                }
              />{' '}
              Enabled
            </label>
            <label>
              <input
                type="checkbox"
                checked={draft.pinned}
                onChange={(e) =>
                  setDraft({ ...draft, pinned: e.target.checked })
                }
              />{' '}
              Pin for priority recall
            </label>
          </div>
          <p className="text-xs text-muted-foreground">
            Recall is bounded. Pinning prioritizes a memory but does not
            guarantee it fits every request.
          </p>
          <div className="flex gap-2">
            <Button disabled={busy} type="submit">
              Save memory
            </Button>
            <Button
              disabled={busy}
              type="button"
              variant="outline"
              onClick={() => setDraft(null)}
            >
              Cancel
            </Button>
          </div>
        </form>
      )}
      {!filtered.length && (
        <p className="rounded-lg border border-dashed p-8 text-center text-muted-foreground">
          {entries.length
            ? 'No matching memories.'
            : 'No saved memories yet. Create one above, or ask an agent to remember a fact and review its approval request.'}
        </p>
      )}
      <div className="space-y-3">
        {filtered.slice(0, visibleCount).map((m) => (
          <article key={m.id} className="rounded-lg border bg-card p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="font-medium">{m.title}</h2>
                <p className="break-all text-xs text-muted-foreground">
                  {m.workspace ?? 'Personal'} ·{' '}
                  {m.enabled ? 'Enabled' : 'Disabled'}
                  {m.pinned ? ' · Pinned' : ''}
                </p>
              </div>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() => setDraft({ ...m })}
                >
                  Edit
                </Button>
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() => setDeleting(m.id)}
                >
                  Delete
                </Button>
              </div>
            </div>
            <p className="mt-3 whitespace-pre-wrap break-words text-sm">
              {m.content}
            </p>
            <p className="mt-3 text-xs text-muted-foreground">
              {m.origin ?? m.source} · Updated{' '}
              {new Date(m.updatedAt).toLocaleString()} · Revision {m.revision}
            </p>
            {deleting === m.id && (
              <div className="mt-3 flex items-center gap-3 text-sm">
                <span>Delete this memory permanently?</span>
                <Button
                  disabled={busy}
                  variant="destructive"
                  onClick={() =>
                    void act(async () => {
                      await memoryCommand('delete', {
                        id: m.id,
                        revision: m.revision,
                      })
                      await refresh()
                      setDeleting(null)
                      if (draft?.id === m.id) setDraft(null)
                    })
                  }
                >
                  Confirm delete
                </Button>
                <Button variant="outline" onClick={() => setDeleting(null)}>
                  Keep
                </Button>
              </div>
            )}
          </article>
        ))}
      </div>
      {filtered.length > visibleCount && (
        <Button
          variant="outline"
          onClick={() => setVisibleCount((n) => n + 50)}
        >
          Show more memories ({filtered.length - visibleCount} remaining)
        </Button>
      )}
      <details className="rounded-lg border p-4">
        <summary className="cursor-pointer font-medium">
          Workspace instructions · AGENTS.md
        </summary>
        <p className="my-3 text-sm text-muted-foreground">
          Optional instructions at the selected workspace root. Loaded for agent
          runs, separate from saved facts. GChat does not create or rewrite this
          file. Keep it short: purpose, conventions, commands, and boundaries.
          Maximum 16 KiB.
        </p>
        <div className="flex gap-2">
          <Input
            aria-label="Instruction workspace"
            placeholder="Workspace directory"
            value={workspace}
            onChange={(e) => {
              setWorkspace(e.target.value)
              setInstructions(null)
            }}
          />
          <Button
            disabled={busy || !workspace.trim()}
            variant="outline"
            onClick={() =>
              void act(async () => {
                const result = await memoryCommand<{ text: string }>(
                  'instructions',
                  { workspace }
                )
                setInstructions(result.text)
              })
            }
          >
            View instructions
          </Button>
        </div>
        {instructions !== null && (
          <pre className="mt-3 max-h-80 overflow-auto whitespace-pre-wrap break-words text-sm">
            {instructions ||
              'No AGENTS.md exists in this workspace. It is optional.'}
          </pre>
        )}
      </details>
    </div>
  )
}

import { useCallback, useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { gbot } from '@/services/gbot'

type SiteRules = { workspace_id: string; allowed: string[]; blocked: string[] }

const toLines = (text: string) =>
  text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)

export default function GbotSites({ workspaceId }: { workspaceId: string }) {
  return <WorkspaceSites key={workspaceId} workspaceId={workspaceId} />
}

function WorkspaceSites({ workspaceId }: { workspaceId: string }) {
  const [allowed, setAllowed] = useState('')
  const [blocked, setBlocked] = useState('')
  const [loaded, setLoaded] = useState(false)
  const [busy, setBusy] = useState<'load' | 'save' | null>('load')
  const [error, setError] = useState<string>()
  const [status, setStatus] = useState('')
  const dirty = useRef(false)

  const show = (rules: SiteRules) => {
    setAllowed(rules.allowed.join('\n'))
    setBlocked(rules.blocked.join('\n'))
  }

  const load = useCallback(async () => {
    setBusy('load')
    setError(undefined)
    try {
      const rules = await gbot<SiteRules>('sites/get', { workspace_id: workspaceId })
      if (!dirty.current) show(rules)
      setLoaded(true)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(null)
    }
  }, [workspaceId])

  useEffect(() => {
    void load()
  }, [load])

  async function save() {
    setBusy('save')
    setError(undefined)
    setStatus('')
    try {
      const rules = await gbot<SiteRules>('sites/save', {
        workspace_id: workspaceId,
        allowed: toLines(allowed),
        blocked: toLines(blocked),
      })
      show(rules)
      dirty.current = false
      setStatus(
        rules.allowed.length || rules.blocked.length
          ? 'Website rules saved. They apply to the bot’s next browser action.'
          : 'No website rules. The bot may open any website.'
      )
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(null)
    }
  }

  return (
    <details className="rounded-lg border p-3">
      <summary className="cursor-pointer text-sm">Websites</summary>
      <p className="my-3 text-xs text-muted-foreground">
        Choose which websites this bot may open in its browser. Leave both lists empty to let it use
        any website. If you list allowed websites, it may open only those. A blocked website is never
        opened, even if it is also allowed. Type one website per line, for example example.com; it
        covers that site and its sub-sites.
      </p>
      <p className="mb-3 text-xs text-muted-foreground">
        These rules apply to the bot’s browser tools: opening a page and reading or using it. They do
        not stop the bot from using other programs on its own computer, and they do not limit you
        when you take over.
      </p>
      {busy === 'load' && (
        <p role="status" className="mb-3 text-sm text-muted-foreground">
          Loading website rules…
        </p>
      )}
      {loaded && (
        <div className="space-y-3">
          <label className="block text-sm">
            Allowed websites (one per line)
            <textarea
              aria-label="Allowed websites"
              className="mt-1 block w-full rounded-md border bg-background p-2 text-sm"
              rows={4}
              value={allowed}
              disabled={busy !== null}
              onChange={(event) => {
                dirty.current = true
                setStatus('')
                setAllowed(event.target.value)
              }}
            />
          </label>
          <label className="block text-sm">
            Blocked websites (one per line)
            <textarea
              aria-label="Blocked websites"
              className="mt-1 block w-full rounded-md border bg-background p-2 text-sm"
              rows={4}
              value={blocked}
              disabled={busy !== null}
              onChange={(event) => {
                dirty.current = true
                setStatus('')
                setBlocked(event.target.value)
              }}
            />
          </label>
        </div>
      )}
      {error !== undefined && (
        <p role="alert" className="mt-3 text-sm text-destructive">
          {error}
        </p>
      )}
      {status && (
        <p role="status" className="mt-3 text-sm text-muted-foreground">
          {status}
        </p>
      )}
      <div className="mt-3 flex gap-2">
        <Button variant="outline" disabled={busy !== null} onClick={() => void load()}>
          Reload rules
        </Button>
        {loaded && (
          <Button variant="outline" disabled={busy !== null} onClick={() => void save()}>
            {busy === 'save' ? 'Saving…' : 'Save website rules'}
          </Button>
        )}
      </div>
    </details>
  )
}

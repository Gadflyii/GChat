import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { gbot, type BotConnectors } from '@/services/gbot'

export default function GbotConnectors({
  workspaceId,
}: {
  workspaceId: string
}) {
  const [settings, setSettings] = useState<BotConnectors>()
  const [linked, setLinked] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    let active = true
    gbot<BotConnectors>('connectors/get', { workspace_id: workspaceId }).then(
      (value) => {
        if (active) {
          setSettings(value)
          setLinked(value.account_ids)
        }
      },
      (cause) => {
        if (active) setError(String(cause))
      }
    )
    return () => {
      active = false
    }
  }, [workspaceId])

  async function save() {
    setBusy(true)
    setError('')
    try {
      const value = await gbot<BotConnectors>('connectors/save', {
        workspace_id: workspaceId,
        account_ids: linked,
      })
      setSettings(value)
      setLinked(value.account_ids)
    } catch (cause) {
      setError(String(cause))
    } finally {
      setBusy(false)
    }
  }

  return (
    <details className="rounded-lg border p-3">
      <summary className="cursor-pointer text-sm">Linked accounts</summary>
      <p className="my-3 text-xs text-muted-foreground">
        Link existing Google or Microsoft accounts to this bot. New bots start
        without accounts. Tools are available to new or resumed tasks, and write
        actions require approval.
      </p>
      {error && (
        <p role="alert" className="mb-3 text-sm text-destructive">
          {error}
        </p>
      )}
      {settings ? (
        <>
          {!settings.accounts.length && (
            <p className="text-sm text-muted-foreground">
              Connect an account in Settings → Workspace connections first.
            </p>
          )}
          <div className="space-y-3">
            {settings.accounts.map((account) => (
              <label
                key={account.id}
                className="flex items-start gap-2 text-sm"
              >
                <input
                  type="checkbox"
                  checked={linked.includes(account.id)}
                  disabled={busy}
                  onChange={(event) =>
                    setLinked((ids) =>
                      event.target.checked
                        ? [...ids, account.id]
                        : ids.filter((id) => id !== account.id)
                    )
                  }
                />
                <span>
                  {account.display_name || account.email || account.id}
                  <span className="block text-xs text-muted-foreground">
                    {account.provider === 'google' ? 'Google' : 'Microsoft'} ·{' '}
                    {account.access === 'read_write'
                      ? 'Read and write'
                      : 'Read only'}
                    {' · '}
                    {account.services.join(', ')}
                    {account.needs_reconnect &&
                      ' · Reconnect in Settings to use tools'}
                  </span>
                </span>
              </label>
            ))}
            {linked
              .filter(
                (id) => !settings.accounts.some((account) => account.id === id)
              )
              .map((id) => (
                <label key={id} className="flex items-start gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked
                    disabled={busy}
                    onChange={() =>
                      setLinked((ids) => ids.filter((value) => value !== id))
                    }
                  />
                  <span>Disconnected account ({id})</span>
                </label>
              ))}
          </div>
          <Button
            className="mt-3"
            variant="outline"
            disabled={busy}
            onClick={() => void save()}
          >
            {busy ? 'Saving…' : 'Save linked accounts'}
          </Button>
        </>
      ) : (
        !error && (
          <p className="text-sm text-muted-foreground">Loading accounts…</p>
        )
      )}
    </details>
  )
}

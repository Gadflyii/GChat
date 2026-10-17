import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { gbot, type BotConnectors } from '@/services/gbot'

export default function GbotConnectors({
  workspaceId,
}: {
  workspaceId: string
}) {
  return <WorkspaceConnectors key={workspaceId} workspaceId={workspaceId} />
}

function WorkspaceConnectors({ workspaceId }: { workspaceId: string }) {
  const [settings, setSettings] = useState<BotConnectors>()
  const [linked, setLinked] = useState<string[]>([])
  const [busy, setBusy] = useState<'refresh' | 'save' | null>('refresh')
  const [error, setError] = useState('')
  const [status, setStatus] = useState('')
  const setupHelpId = useId()
  const generation = useRef(0)
  const pending = useRef(false)
  const dirty = useRef(false)

  const refresh = useCallback(async () => {
    if (pending.current) return
    pending.current = true
    const request = ++generation.current
    setBusy('refresh')
    setError('')
    setStatus('')
    try {
      const value = await gbot<BotConnectors>('connectors/get', {
        workspace_id: workspaceId,
      })
      if (request !== generation.current) return
      setSettings(value)
      if (!dirty.current) setLinked(value.account_ids)
      setStatus(
        dirty.current
          ? 'Accounts refreshed. Your unsaved selections are unchanged.'
          : 'Accounts refreshed.'
      )
    } catch (cause) {
      if (request !== generation.current) return
      setError(
        `Could not refresh linked accounts. Try Refresh accounts again. ${String(cause)}`
      )
    } finally {
      if (request === generation.current) {
        pending.current = false
        setBusy(null)
      }
    }
  }, [workspaceId])

  useEffect(() => {
    void refresh()
    return () => {
      generation.current += 1
      pending.current = false
    }
  }, [refresh])

  async function save() {
    if (pending.current || !settings) return
    pending.current = true
    const request = ++generation.current
    setBusy('save')
    setError('')
    setStatus('')
    try {
      const value = await gbot<BotConnectors>('connectors/save', {
        workspace_id: workspaceId,
        account_ids: linked,
      })
      if (request !== generation.current) return
      setSettings(value)
      setLinked(value.account_ids)
      dirty.current = false
      setStatus('Linked accounts saved.')
    } catch (cause) {
      if (request !== generation.current) return
      setError(
        `Could not save linked accounts. Your selections are kept. ${String(cause)}`
      )
    } finally {
      if (request === generation.current) {
        pending.current = false
        setBusy(null)
      }
    }
  }

  return (
    <details className="rounded-lg border p-3">
      <summary className="cursor-pointer text-sm">Linked accounts</summary>
      <p className="my-3 text-xs text-muted-foreground">
        Choose which of your connected Google or Microsoft accounts this bot may
        use, then choose Save linked accounts. New bots start without accounts.
        The selection applies to new or resumed tasks; actions that change your
        account data still require approval.
      </p>
      <p id={setupHelpId} className="mb-3 text-xs text-muted-foreground">
        To add or reconnect an account, open Settings → Workspace connections,
        then refresh this list. Linking an account does not change its permissions.
      </p>
      {error && (
        <p role="alert" className="mb-3 text-sm text-destructive">
          {error}
        </p>
      )}
      {(busy || status) && (
        <p role="status" className="mb-3 text-sm text-muted-foreground">
          {busy === 'refresh'
            ? settings
              ? 'Refreshing accounts…'
              : 'Loading accounts…'
            : busy === 'save'
              ? 'Saving linked accounts…'
              : status}
        </p>
      )}
      {settings ? (
        <>
          {!settings.accounts.length && (
            <p className="text-sm text-muted-foreground">
              No accounts are connected to GChat yet.
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
                  disabled={busy !== null}
                  aria-describedby={setupHelpId}
                  onChange={(event) => {
                    dirty.current = true
                    setStatus('')
                    setLinked((ids) =>
                      event.target.checked
                        ? [...ids, account.id]
                        : ids.filter((id) => id !== account.id)
                    )
                  }}
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
                    disabled={busy !== null}
                    aria-describedby={setupHelpId}
                    onChange={() => {
                      dirty.current = true
                      setStatus('')
                      setLinked((ids) => ids.filter((value) => value !== id))
                    }}
                  />
                  <span>Disconnected account ({id})</span>
                </label>
              ))}
          </div>
        </>
      ) : null}
      <div className="mt-3 flex flex-wrap gap-2">
        <Button
          variant="outline"
          disabled={busy !== null}
          aria-describedby={setupHelpId}
          onClick={() => void refresh()}
        >
          Refresh accounts
        </Button>
        {settings && (
          <Button
            variant="outline"
            disabled={busy !== null}
            aria-describedby={setupHelpId}
            onClick={() => void save()}
          >
            {busy === 'save' ? 'Saving…' : 'Save linked accounts'}
          </Button>
        )}
      </div>
    </details>
  )
}

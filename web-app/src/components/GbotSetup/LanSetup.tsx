import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { gbot } from '@/services/gbot'
import type { BotConnection } from './index'

type PublicKey = { algorithm: string; public_key: string }
type Identity = { public_key: PublicKey; fingerprint: string }

export default function LanSetup({
  connection,
  change,
  ready,
  busy,
}: {
  connection: BotConnection
  change: (value: BotConnection) => void
  ready: (value: boolean) => void
  busy: (value: boolean) => void
}) {
  const [ids] = useState(() => ({
    id: crypto.randomUUID(),
    computerId: crypto.randomUUID(),
  }))
  const [importing, setImporting] = useState(false)
  const [identity, setIdentity] = useState<Identity>()
  const [verified, setVerified] = useState(false)
  const [working, setWorking] = useState(false)
  const [locked, setLocked] = useState(Boolean(connection.workspaceId))
  const [publicKey, setPublicKey] = useState('')
  const [error, setError] = useState('')
  const [checked, setChecked] = useState(false)
  const port = Number(connection.port)
  const validEndpoint = Boolean(
    connection.hostname.trim() &&
      connection.user.trim() &&
      Number.isInteger(port) &&
      port > 0 &&
      port <= 65535
  )
  const endpoint = {
    hostname: connection.hostname.trim(),
    port,
    user: connection.user.trim(),
  }
  const run = async (action: () => Promise<void>) => {
    setWorking(true)
    busy(true)
    setError('')
    try {
      await action()
    } catch (cause) {
      setError(String(cause instanceof Error ? cause.message : cause))
    } finally {
      setWorking(false)
      busy(false)
    }
  }
  const loadKey = async (id: string) => {
    const key = await gbot<PublicKey>('workspaces/ssh/key', {
      workspace_id: id,
    })
    setPublicKey(`${key.algorithm} ${key.public_key}`)
  }
  useEffect(() => {
    if (!connection.workspaceId) return
    let active = true
    void gbot<PublicKey>('workspaces/ssh/key', {
      workspace_id: connection.workspaceId,
    })
      .then((key) => {
        if (active) setPublicKey(`${key.algorithm} ${key.public_key}`)
      })
      .catch((cause) => {
        if (active) setError(String(cause))
      })
    return () => {
      active = false
    }
  }, [connection.workspaceId])
  const update = (field: keyof BotConnection, value: string) => {
    setError('')
    setIdentity(undefined)
    setVerified(false)
    ready(false)
    change({
      ...connection,
      [field]: value,
      ...(importing ||
      field === 'hostKey' ||
      field === 'key' ||
      field === 'passphrase'
        ? {}
        : { hostKey: '' }),
    })
  }
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Use a dedicated bot computer or VM with SSH enabled. GChat creates its
        own key and keeps the private key in your vault.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        {(['hostname', 'port', 'user'] as const).map((field) => (
          <label key={field} className="space-y-1 text-sm">
            {
              { hostname: 'SSH host', port: 'SSH port', user: 'SSH user' }[
                field
              ]
            }
            <Input
              required
              disabled={locked || working}
              type={field === 'port' ? 'number' : 'text'}
              min={field === 'port' ? 1 : undefined}
              max={field === 'port' ? 65535 : undefined}
              value={connection[field]}
              onChange={(event) => update(field, event.target.value)}
            />
          </label>
        ))}
      </div>
      {!locked && (
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="size-4 accent-primary"
            checked={importing}
            disabled={working}
            onChange={(event) => {
              setImporting(event.target.checked)
              ready(false)
              change({ ...connection, key: '', passphrase: '', hostKey: '' })
              setIdentity(undefined)
              setVerified(false)
            }}
          />
          Use an existing SSH key
        </label>
      )}
      {importing ? (
        <>
          <label className="block space-y-1 text-sm">
            SSH host public key
            <Input
              required
              value={connection.hostKey}
              onChange={(event) => update('hostKey', event.target.value)}
            />
          </label>
          <label className="block space-y-1 text-sm">
            SSH private key
            <textarea
              required
              autoComplete="off"
              className="min-h-24 w-full rounded-md border bg-background p-2 font-mono"
              value={connection.key}
              onChange={(event) => update('key', event.target.value)}
            />
          </label>
          <label className="block space-y-1 text-sm">
            Key passphrase
            <Input
              type="password"
              autoComplete="off"
              value={connection.passphrase}
              onChange={(event) => update('passphrase', event.target.value)}
            />
          </label>
          <p className="text-xs text-muted-foreground">
            Verify the host public key on the bot computer before continuing.
          </p>
        </>
      ) : (
        <>
          {!locked && (
            <Button
              type="button"
              variant="outline"
              disabled={working || !validEndpoint}
              onClick={() =>
                void run(async () => {
                  ready(false)
                  setVerified(false)
                  setIdentity(undefined)
                  const found = await gbot<Identity>('ssh/identity', endpoint)
                  setIdentity(found)
                  change({
                    ...connection,
                    hostKey: `${found.public_key.algorithm} ${found.public_key.public_key}`,
                  })
                })
              }
            >
              Check computer identity
            </Button>
          )}
          {identity && (
            <div className="space-y-2 rounded-md border p-3 text-sm">
              <p>
                On the bot computer, compare this fingerprint with its SSH host
                key using{' '}
                <code>ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub</code>{' '}
                (use the matching host-key file for another key type).
              </p>
              <p className="break-all font-mono">{identity.fingerprint}</p>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  className="size-4 accent-primary"
                  checked={verified}
                  onChange={(event) => setVerified(event.target.checked)}
                />
                I verified this fingerprint on the bot computer
              </label>
            </div>
          )}
          {!connection.workspaceId && (
            <Button
              type="button"
              disabled={working || !verified || !identity}
              onClick={() =>
                void run(async () => {
                  setLocked(true)
                  const created = await gbot<{ id: string }>('workspaces/ssh', {
                    id: ids.id,
                    name: connection.name.trim(),
                    service_pc: { kind: 'local' },
                    bot_pc: { kind: 'lan', computer_id: ids.computerId },
                    endpoint,
                    pinned_host_key: identity!.public_key,
                    private_key: null,
                    passphrase: null,
                  })
                  change({ ...connection, workspaceId: created.id })
                })
              }
            >
              {working ? 'Working…' : 'Create bot key'}
            </Button>
          )}
          {connection.workspaceId && (
            <div className="space-y-2 rounded-md border p-3 text-sm">
              <p>
                The bot is saved. Add this public key as one line in{' '}
                <code>~/.ssh/authorized_keys</code> for the SSH user on the bot
                computer. Keep <code>~/.ssh</code> at permissions 700 and{' '}
                <code>authorized_keys</code> at 600.
              </p>
              {publicKey ? (
                <textarea
                  aria-label="Bot SSH public key"
                  readOnly
                  className="min-h-20 w-full rounded-md border bg-background p-2 font-mono text-xs"
                  value={publicKey}
                />
              ) : (
                <Button
                  type="button"
                  variant="outline"
                  disabled={working}
                  onClick={() =>
                    void run(() => loadKey(connection.workspaceId!))
                  }
                >
                  Show bot public key
                </Button>
              )}
              <Button
                type="button"
                variant="outline"
                disabled={working || !publicKey}
                onClick={() =>
                  void run(async () => {
                    ready(false)
                    setChecked(false)
                    await gbot('workspaces/ssh/check', {
                      workspace_id: connection.workspaceId,
                    })
                    setChecked(true)
                    ready(true)
                  })
                }
              >
                Check SSH access
              </Button>
              {checked && (
                <p role="status">
                  SSH access verified. Desktop tools are checked when you
                  connect the bot.
                </p>
              )}
            </div>
          )}
        </>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  )
}

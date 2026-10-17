import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { gbot } from '@/services/gbot'
import type { BotConnection } from './index'
import LanTools from './LanTools'

type PublicKey = { algorithm: string; public_key: string }
type Identity = { public_key: PublicKey; fingerprint: string }

const actionLabels = {
  identity: 'Checking computer identity…',
  import: 'Importing bot key…',
  create: 'Creating bot key…',
  key: 'Loading bot public key…',
  access: 'Checking SSH access…',
} as const

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
  const [action, setAction] = useState<keyof typeof actionLabels>()
  const pending = useRef(false)
  const working = action !== undefined
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
  const create = async (importKey: boolean) => {
    const [algorithm, public_key] = connection.hostKey.trim().split(/\s+/)
    const created = await gbot<{ id: string }>('workspaces/ssh', {
      id: ids.id,
      name: connection.name.trim(),
      service_pc: { kind: 'local' },
      bot_pc: connection.cloud ?? { kind: 'lan', computer_id: ids.computerId },
      endpoint,
      pinned_host_key: importKey
        ? { algorithm, public_key }
        : identity!.public_key,
      private_key: importKey ? connection.key : null,
      passphrase: importKey ? connection.passphrase || null : null,
    })
    setLocked(true)
    setImporting(false)
    change({ ...connection, workspaceId: created.id, key: '', passphrase: '' })
  }
  const run = async (
    nextAction: keyof typeof actionLabels,
    perform: () => Promise<void>
  ) => {
    if (pending.current) return
    pending.current = true
    setAction(nextAction)
    busy(true)
    setError('')
    try {
      await perform()
    } catch (cause) {
      setError(String(cause instanceof Error ? cause.message : cause))
    } finally {
      pending.current = false
      setAction(undefined)
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
        Use a separate bot computer or virtual machine with SSH enabled. SSH is
        the secure connection GChat uses to reach it. Enter its network address,
        SSH port (usually 22) and user name below; ask the computer’s owner if
        you do not know them. GChat creates a connection key and protects its
        private part in secure storage.
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
          Use an existing SSH key (advanced)
        </label>
      )}
      {!locked && (
        <p className="text-xs text-muted-foreground">
          Leave the existing-key option off to let GChat create a new key for
          this bot. Only select it if you already have a private SSH key.
        </p>
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
          <Button
            type="button"
            disabled={
              working ||
              !validEndpoint ||
              !connection.key.trim() ||
              connection.hostKey.trim().split(/\s+/).length < 2
            }
            onClick={() => void run('import', () => create(true))}
          >
            {action === 'import' ? actionLabels.import : 'Import bot key'}
          </Button>
        </>
      ) : (
        <>
          {!locked && (
            <Button
              type="button"
              variant="outline"
              disabled={working || !validEndpoint}
              onClick={() =>
                void run('identity', async () => {
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
              {action === 'identity'
                ? actionLabels.identity
                : 'Check computer identity'}
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
              onClick={() => void run('create', () => create(false))}
            >
              {action === 'create' ? actionLabels.create : 'Create bot key'}
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
                    void run('key', () => loadKey(connection.workspaceId!))
                  }
                >
                  {action === 'key' ? actionLabels.key : 'Show bot public key'}
                </Button>
              )}
              <Button
                type="button"
                variant="outline"
                disabled={working || !publicKey}
                onClick={() =>
                  void run('access', async () => {
                    ready(false)
                    setChecked(false)
                    await gbot('workspaces/ssh/check', {
                      workspace_id: connection.workspaceId,
                    })
                    setChecked(true)
                    ready(false)
                  })
                }
              >
                {action === 'access' ? actionLabels.access : 'Check SSH access'}
              </Button>
              {checked && (
                <LanTools
                  workspaceId={connection.workspaceId}
                  ready={ready}
                  busy={busy}
                />
              )}
            </div>
          )}
        </>
      )}
      {action && (
        <p
          role="status"
          aria-live="polite"
          className="text-sm text-muted-foreground"
        >
          {actionLabels[action]}
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  )
}

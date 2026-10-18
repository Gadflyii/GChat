import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { gbot, type CloudReview, type SshIdentity } from '@/services/gbot'
import LanTools from './LanTools'

const actionLabels = {
  create: 'Creating cloud computer…',
  check: 'Checking cloud computer…',
  identity: 'Checking SSH identity…',
  access: 'Verifying SSH access…',
  connect: 'Connecting bot desktop…',
  delete: 'Deleting cloud computer…',
} as const

const failureMessages = {
  create:
    'Could not confirm the cloud computer was created. Cancel setup, then use Resume setup in the computer list to check its saved state before trying to create it again.',
  check:
    'Could not check the cloud computer. Choose Check progress to try again.',
  identity:
    'Could not check the SSH identity. Choose Check SSH identity to try again.',
  connect:
    'Could not connect the bot desktop. Choose Check progress to check the computer, then choose Connect bot desktop when the SSH and tool checks are complete.',
  delete:
    'Could not confirm the cloud computer was deleted. Provider charges may continue. Choose Check progress to check its state before trying Delete cloud computer again.',
}

export default function CloudComputer({
  review,
  updated,
  canCreate,
  disabled = false,
  canStart,
  busy,
  connected,
}: {
  review: CloudReview
  updated: (review: CloudReview) => void
  canCreate: boolean
  disabled?: boolean
  canStart?: () => boolean
  busy: (value: boolean) => void
  connected: (id: string) => Promise<void>
}) {
  const [sources, setSources] = useState(
    review.deployment?.source_cidrs.join('\n') ?? ''
  )
  const [billing, setBilling] = useState(false)
  const [remove, setRemove] = useState(false)
  const [working, setWorking] = useState(false)
  const blocked = working || disabled
  const [action, setAction] = useState<keyof typeof actionLabels>()
  const pending = useRef(false)
  const active = useRef(true)
  useEffect(() => {
    active.current = true
    return () => {
      active.current = false
    }
  }, [])
  const [error, setError] = useState<{
    action: keyof typeof failureMessages
    details: string
  }>()
  const [checkError, setCheckError] = useState('')
  const [accessError, setAccessError] = useState('')
  const [identity, setIdentity] = useState<SshIdentity>()
  const [verified, setVerified] = useState(false)
  const [authenticated, setAuthenticated] = useState(false)
  const [tools, setTools] = useState(false)
  const deployment = review.deployment
  const run = async (
    kind: keyof typeof actionLabels,
    operation: () => Promise<void>
  ) => {
    if (pending.current || disabled || (canStart && !canStart())) return
    pending.current = true
    setAction(kind)
    setWorking(true)
    busy(true)
    if (kind === 'check') setCheckError('')
    else setError((current) => (current?.action === kind ? undefined : current))
    if (kind === 'access') setAccessError('')
    try {
      await operation()
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause)
      if (kind === 'access') setAccessError(message)
      else if (kind === 'check') setCheckError(message)
      else setError({ action: kind, details: message })
    } finally {
      pending.current = false
      setAction(undefined)
      setWorking(false)
      busy(false)
    }
  }
  const update = (result: CloudReview) => {
    updated(result)
    if (result.deployment?.phase === 'deleted') {
      setBilling(false)
      setError(undefined)
      setCheckError('')
      setRemove(false)
    }
    if (result.deployment?.phase !== 'running') {
      setError((current) =>
        current?.action === 'identity' || current?.action === 'connect'
          ? undefined
          : current
      )
      setAccessError('')
      setIdentity(undefined)
      setVerified(false)
      setAuthenticated(false)
      setTools(false)
    }
  }
  return (
    <section
      aria-label="Cloud computer"
      className="space-y-3 rounded-md border p-3 text-sm"
    >
      {(!deployment || deployment.phase === 'deleted') && (
        <>
          <label className="block space-y-1">
            Allowed SSH source networks
            <textarea
              className="min-h-16 w-full rounded-md border bg-background p-2"
              value={sources}
              disabled={blocked}
              onChange={(event) => setSources(event.target.value)}
              placeholder="203.0.113.10/32"
            />
          </label>
          <p className="text-muted-foreground">
            Allow the public IP address of the network where your Gbot service
            runs. For one IPv4 address, add /32 after it (CIDR notation); use
            your real address, not the example. Ask your network administrator
            if unsure. Enter one network per line. Only the secure SSH
            connection is exposed; desktop viewing uses that same connection.
          </p>
          <label className="flex items-start gap-2">
            <input
              type="checkbox"
              className="mt-0.5 size-4 shrink-0 accent-primary"
              checked={billing}
              disabled={blocked}
              onChange={(event) => setBilling(event.target.checked)}
            />
            I authorize creating this computer and its provider charges at the
            reviewed prices.
          </label>
          <Button
            type="button"
            disabled={blocked || !canCreate || !billing || !sources.trim()}
            onClick={() =>
              void run('create', async () => {
                update(
                  await gbot<CloudReview>('setup/cloud/create', {
                    id: review.id,
                    quote_id: review.quote!.id,
                    consent: billing,
                    source_cidrs: sources
                      .split(/[\n,]+/)
                      .map((source) => source.trim())
                      .filter(Boolean),
                  })
                )
              })
            }
          >
            {action === 'create'
              ? actionLabels.create
              : 'Create cloud computer'}
          </Button>
        </>
      )}
      {deployment && deployment.phase !== 'deleted' && (
        <>
          <p role="status">
            Computer {deployment.phase.replaceAll('_', ' ')}. A running VM still
            needs SSH and desktop checks.
          </p>
          <ul className="space-y-1">
            {deployment.resources.map((resource) => (
              <li key={`${resource.kind}:${resource.id}`}>
                {resource.kind === 'ipv4' ? 'IPv4' : resource.kind} ·{' '}
                {resource.address ?? resource.name} ·{' '}
                {resource.ready ? 'Ready' : 'Pending'}
              </li>
            ))}
          </ul>
          {deployment.pending && (
            <p>
              Checking {deployment.pending.kind} operation before another
              provider request.
            </p>
          )}
          {deployment.issue && <p role="alert">{deployment.issue}</p>}
          <Button
            type="button"
            variant="outline"
            disabled={blocked}
            onClick={() =>
              void run('check', async () => {
                update(
                  await gbot<CloudReview>('setup/cloud/check', {
                    id: review.id,
                  })
                )
              })
            }
          >
            {action === 'check' ? actionLabels.check : 'Check progress'}
          </Button>
          {deployment.phase === 'running' && (
            <div className="space-y-2">
              <Button
                type="button"
                variant="outline"
                disabled={blocked}
                onClick={() =>
                  void run('identity', async () => {
                    setAccessError('')
                    setAuthenticated(false)
                    setTools(false)
                    setVerified(false)
                    setIdentity(undefined)
                    setIdentity(
                      await gbot<SshIdentity>('setup/cloud/identity', {
                        id: review.id,
                      })
                    )
                  })
                }
              >
                {action === 'identity'
                  ? actionLabels.identity
                  : 'Check SSH identity'}
              </Button>
              {identity && (
                <>
                  <p>
                    Confirm you are connecting to the right computer: compare
                    this SSH fingerprint with the provider’s console before
                    trusting it.
                  </p>
                  <code className="block break-all">
                    {identity.fingerprint}
                  </code>
                  <code className="block break-all">
                    ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub
                  </code>
                  <label className="flex items-start gap-2">
                    <input
                      type="checkbox"
                      className="mt-0.5 size-4 shrink-0 accent-primary"
                      checked={verified}
                      disabled={blocked || authenticated}
                      onChange={(event) => setVerified(event.target.checked)}
                    />
                    The fingerprint matches the computer’s console.
                  </label>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={blocked || !verified || authenticated}
                    onClick={() =>
                      void run('access', async () => {
                        await gbot('setup/cloud/attach', {
                          id: review.id,
                          pinned_host_key: identity.public_key,
                          verified,
                        })
                        await gbot('workspaces/ssh/check', {
                          workspace_id: review.id,
                        })
                        setAuthenticated(true)
                      })
                    }
                  >
                    {action === 'access'
                      ? actionLabels.access
                      : 'Verify SSH access'}
                  </Button>
                  {accessError && (
                    <div role="alert" className="space-y-2 text-destructive">
                      <p>
                        Could not verify SSH access. Try Verify SSH access again
                        before continuing.
                      </p>
                      <details className="text-xs">
                        <summary>Details</summary>
                        <p className="break-words">{accessError}</p>
                      </details>
                    </div>
                  )}
                </>
              )}
              {authenticated && (
                <LanTools
                  workspaceId={review.id}
                  cloud
                  disabled={blocked}
                  canStart={() => !pending.current && (!canStart || canStart())}
                  ready={setTools}
                  busy={(value) => {
                    pending.current = value
                    setWorking(value)
                    busy(value)
                  }}
                />
              )}
              <Button
                type="button"
                disabled={blocked || !tools}
                onClick={() =>
                  void run('connect', async () => {
                    await gbot('connect', {
                      workspace_id: review.id,
                      session_id: crypto.randomUUID(),
                    })
                    if (!active.current) return
                    await connected(review.id)
                  })
                }
              >
                {action === 'connect'
                  ? actionLabels.connect
                  : 'Connect bot desktop'}
              </Button>
            </div>
          )}
          <div className="space-y-2 border-t pt-3">
            <label className="flex items-start gap-2">
              <input
                type="checkbox"
                className="mt-0.5 size-4 shrink-0 accent-primary"
                checked={remove}
                disabled={blocked}
                onChange={(event) => setRemove(event.target.checked)}
              />
              Delete this setup’s cloud computer and owned resources, including
              its files.
            </label>
            <Button
              type="button"
              variant="outline"
              disabled={blocked || !remove}
              onClick={() =>
                void run('delete', async () => {
                  update(
                    await gbot<CloudReview>('setup/cloud/delete', {
                      id: review.id,
                      consent: remove,
                    })
                  )
                  setRemove(false)
                })
              }
            >
              {action === 'delete'
                ? actionLabels.delete
                : 'Delete cloud computer'}
            </Button>
          </div>
        </>
      )}
      {deployment?.phase === 'deleted' && (
        <p role="status">Computer and owned provider resources deleted.</p>
      )}
      {action && (
        <p role="status" aria-live="polite">
          {actionLabels[action]}
        </p>
      )}
      {[
        error,
        checkError
          ? { action: 'check' as const, details: checkError }
          : undefined,
      ].map((failure) =>
        failure ? (
          <div
            key={failure.action}
            role="alert"
            className="space-y-2 text-destructive"
          >
            <p>{failureMessages[failure.action]}</p>
            <details className="text-xs">
              <summary>Details</summary>
              <p className="whitespace-pre-wrap break-words">
                {failure.details}
              </p>
            </details>
          </div>
        ) : null
      )}
    </section>
  )
}

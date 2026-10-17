import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { gbot, type CloudReview, type SshIdentity } from '@/services/gbot'
import LanTools from './LanTools'

export default function CloudComputer({
  review,
  updated,
  canCreate,
  busy,
  connected,
}: {
  review: CloudReview
  updated: (review: CloudReview) => void
  canCreate: boolean
  busy: (value: boolean) => void
  connected: (id: string) => Promise<void>
}) {
  const [sources, setSources] = useState(
    review.deployment?.source_cidrs.join('\n') ?? ''
  )
  const [billing, setBilling] = useState(false)
  const [remove, setRemove] = useState(false)
  const [working, setWorking] = useState(false)
  const [error, setError] = useState('')
  const [identity, setIdentity] = useState<SshIdentity>()
  const [verified, setVerified] = useState(false)
  const [authenticated, setAuthenticated] = useState(false)
  const [tools, setTools] = useState(false)
  const deployment = review.deployment
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
  const update = (result: CloudReview) => {
    updated(result)
    if (result.deployment?.phase !== 'running') {
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
              disabled={working}
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
              disabled={working}
              onChange={(event) => setBilling(event.target.checked)}
            />
            I authorize creating this computer and its provider charges at the
            reviewed prices.
          </label>
          <Button
            type="button"
            disabled={working || !canCreate || !billing || !sources.trim()}
            onClick={() =>
              void run(async () => {
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
            Create cloud computer
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
            disabled={working}
            onClick={() =>
              void run(async () => {
                update(
                  await gbot<CloudReview>('setup/cloud/check', {
                    id: review.id,
                  })
                )
              })
            }
          >
            Check progress
          </Button>
          {deployment.phase === 'running' && (
            <div className="space-y-2">
              <Button
                type="button"
                variant="outline"
                disabled={working}
                onClick={() =>
                  void run(async () => {
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
                Check SSH identity
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
                      disabled={working || authenticated}
                      onChange={(event) => setVerified(event.target.checked)}
                    />
                    The fingerprint matches the computer’s console.
                  </label>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={working || !verified || authenticated}
                    onClick={() =>
                      void run(async () => {
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
                    Verify SSH access
                  </Button>
                </>
              )}
              {authenticated && (
                <LanTools
                  workspaceId={review.id}
                  cloud
                  ready={setTools}
                  busy={(value) => {
                    setWorking(value)
                    busy(value)
                  }}
                />
              )}
              <Button
                type="button"
                disabled={working || !tools}
                onClick={() =>
                  void run(async () => {
                    await gbot('connect', {
                      workspace_id: review.id,
                      session_id: crypto.randomUUID(),
                    })
                    await connected(review.id)
                  })
                }
              >
                Connect bot desktop
              </Button>
            </div>
          )}
          <div className="space-y-2 border-t pt-3">
            <label className="flex items-start gap-2">
              <input
                type="checkbox"
                className="mt-0.5 size-4 shrink-0 accent-primary"
                checked={remove}
                disabled={working}
                onChange={(event) => setRemove(event.target.checked)}
              />
              Delete this setup’s cloud computer and owned resources, including
              its files.
            </label>
            <Button
              type="button"
              variant="outline"
              disabled={working || !remove}
              onClick={() =>
                void run(async () => {
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
              Delete cloud computer
            </Button>
          </div>
        </>
      )}
      {deployment?.phase === 'deleted' && (
        <p role="status">Computer and owned provider resources deleted.</p>
      )}
      {error && (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}
    </section>
  )
}

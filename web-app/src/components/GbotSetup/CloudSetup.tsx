import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type {
  CloudProvider,
  CloudReview,
  GuidedCloudProvider,
} from '@/services/gbot'
import type { BotConnection } from './index'
import CloudCosts from './CloudCosts'
import LanSetup from './LanSetup'

const providers = [
  ['hetzner', 'Hetzner (automated)'],
  ['digital_ocean', 'DigitalOcean (automated)'],
  ['azure', 'Azure (guided)'],
  ['aws', 'AWS (guided)'],
  ['gcp', 'Google Cloud (guided)'],
] as const

export default function CloudSetup({
  name,
  initial,
  connection,
  change,
  ready,
  busy,
  reviewed,
  connected,
}: {
  name: string
  initial?: CloudReview
  connection: BotConnection
  change: (value: BotConnection) => void
  ready: (value: boolean) => void
  busy: (value: boolean) => void
  reviewed: () => Promise<void>
  connected: (id: string) => Promise<void>
}) {
  const [provider, setProvider] = useState<CloudProvider | GuidedCloudProvider>(
    initial?.provider ?? connection.cloud?.provider ?? 'hetzner'
  )
  const [resource, setResource] = useState(connection.cloud?.resource_id ?? '')
  const [confirmed, setConfirmed] = useState(false)
  const [working, setWorking] = useState(false)
  const pending = (value: boolean) => {
    setWorking(value)
    busy(value)
  }
  const automated = provider === 'hetzner' || provider === 'digital_ocean'
  const locked = Boolean(initial || connection.workspaceId)
  return (
    <section aria-label="Cloud computer setup" className="space-y-3">
      <fieldset className="grid gap-2 sm:grid-cols-2">
        <legend className="mb-2 text-sm font-medium">Cloud provider</legend>
        {providers.map(([id, label]) => (
          <label key={id} className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              name="cloud-provider"
              value={id}
              className="size-4 accent-primary"
              checked={provider === id}
              disabled={locked || working}
              onChange={() => {
                setProvider(id)
                setResource('')
                setConfirmed(false)
                ready(false)
                change({ ...connection, cloud: undefined })
              }}
            />
            {label}
          </label>
        ))}
      </fieldset>
      {automated ? (
        <CloudCosts
          key={provider}
          provider={provider}
          name={name}
          initial={initial}
          busy={pending}
          reviewed={reviewed}
          connected={connected}
        />
      ) : (
        <>
          <ol className="list-decimal space-y-2 pl-5 text-sm">
            <li>
              In your provider’s console, create a dedicated Debian 13 VM. Start
              with 2 vCPUs and 4 GB RAM; 2 GB RAM is the minimum.
            </li>
            <li>
              Review the current monthly cost, including disk, public IP and
              traffic, in that console before creating anything. Billing stays
              with your provider; removing this bot does not delete the VM.
            </li>
            <li>
              Enable SSH for a non-root user with administrator access and your
              initial SSH key. Restrict TCP port 22 to the service PC’s address.
              Do not expose VNC or RDP ports.
            </li>
            <li>
              Copy the VM’s resource ID below, then verify its SSH fingerprint.
              GChat saves its own key in your vault and prepares the pinned
              desktop tools with your explicit consent.
            </li>
          </ol>
          <label className="block space-y-1 text-sm">
            Cloud VM resource ID
            <Input
              value={resource}
              disabled={locked || working || Boolean(connection.cloud)}
              onChange={(event) => setResource(event.target.value)}
            />
          </label>
          {!connection.cloud && (
            <>
              <label className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  className="mt-1 size-4 accent-primary"
                  checked={confirmed}
                  onChange={(event) => setConfirmed(event.target.checked)}
                />
                I reviewed the provider’s live cost and created a dedicated VM
                with these SSH and memory settings.
              </label>
              <Button
                type="button"
                disabled={!confirmed || !resource.trim()}
                onClick={() =>
                  change({
                    ...connection,
                    cloud: {
                      kind: 'cloud',
                      provider: provider as GuidedCloudProvider,
                      resource_id: resource.trim(),
                    },
                  })
                }
              >
                Connect this VM
              </Button>
            </>
          )}
          {connection.cloud && (
            <LanSetup
              connection={connection}
              change={change}
              ready={ready}
              busy={pending}
            />
          )}
        </>
      )}
    </section>
  )
}

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import CloudComputer from './CloudComputer'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  gbot,
  type CloudAmount,
  type CloudProvider,
  type CloudReview,
} from '@/services/gbot'

function Choice({
  label,
  value,
  items,
  disabled,
  change,
}: {
  label: string
  value: string
  items: { id: string; name: string }[]
  disabled: boolean
  change: (value: string) => void
}) {
  return (
    <div className="space-y-1 text-sm">
      <p>{label}</p>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="outline"
            aria-label={label}
            disabled={disabled}
            className="w-full justify-start"
          >
            {items.find((item) => item.id === value)?.name ||
              `Choose ${label.toLowerCase()}`}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent className="max-h-64 overflow-y-auto">
          {items.map((item) => (
            <DropdownMenuItem key={item.id} onSelect={() => change(item.id)}>
              {item.name}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

export default function CloudCosts({
  name,
  initial,
  busy,
  reviewed,
  connected = async () => {},
}: {
  name: string
  initial?: CloudReview
  busy: (value: boolean) => void
  reviewed: () => Promise<void>
  connected?: (id: string) => Promise<void>
}) {
  const [id, setId] = useState(initial?.id ?? crypto.randomUUID())
  const [provider, setProvider] = useState<CloudProvider>(
    initial?.provider ?? 'hetzner'
  )
  const [token, setToken] = useState('')
  const [review, setReview] = useState(initial)
  const [region, setRegion] = useState(initial?.deployment?.plan.region ?? initial?.quote?.plan.region ?? '')
  const [plan, setPlan] = useState(initial?.deployment?.plan.id ?? initial?.quote?.plan.id ?? '')
  const [acknowledged, setAcknowledged] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const [expired, setExpired] = useState(false)
  const [refreshFailed, setRefreshFailed] = useState(false)
  useEffect(() => {
    if (!review) return
    const remaining = review.expires_at * 1000 - Date.now()
    setExpired(remaining <= 0)
    const timer = setTimeout(() => setExpired(true), Math.max(0, remaining))
    return () => clearTimeout(timer)
  }, [review])
  const perform = async (action: () => Promise<void>) => {
    if (pending) return
    setPending(true)
    busy(true)
    setError('')
    try {
      await action()
    } catch (cause) {
      setError(String(cause))
    } finally {
      setPending(false)
      busy(false)
    }
  }
  const read = () =>
    perform(async () => {
      setAcknowledged(false)
      setRefreshFailed(true)
      try {
        const result = await gbot<CloudReview>('setup/cloud/catalog', {
          id,
          name,
          provider,
          ...(token.trim() ? { api_token: token.trim() } : {}),
        })
        setReview(result)
        setRegion(result.deployment?.plan.region ?? '')
        setPlan(result.deployment?.plan.id ?? '')
        setRefreshFailed(false)
      } finally {
        setToken('')
      }
    })
  const quote = review?.quote
  const matches = quote?.plan.region === region && quote?.plan.id === plan
  const valid = Boolean(review && !expired && !refreshFailed)
  const deployed = Boolean(review?.deployment && review.deployment.phase !== 'deleted')
  const money = (amount: CloudAmount) =>
    `${review?.catalog.currency} ${amount.net} before tax${amount.gross === null ? '' : ` · ${review?.catalog.currency} ${amount.gross} including tax`}`
  return (
    <section aria-label="Cloud cost review" className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Connect your own provider account, review live prices, then create a
        dedicated bot computer with a separate billing confirmation.
      </p>
      <Choice
        label="Provider"
        value={provider}
        disabled={pending || Boolean(initial || review)}
        items={[
          { id: 'hetzner', name: 'Hetzner (low-cost recommendation)' },
          { id: 'digital_ocean', name: 'DigitalOcean' },
        ]}
        change={(value) => {
          setProvider(value as CloudProvider)
          setToken('')
          setId(crypto.randomUUID())
        }}
      />
      <p className="text-xs text-muted-foreground">
        Azure, AWS and GCP guided setup is not available yet.
      </p>
      <label className="block space-y-1 text-sm">
        Provider API token
        <Input
          type="password"
          autoComplete="off"
          value={token}
          disabled={pending}
          onChange={(event) => setToken(event.target.value)}
        />
      </label>
      <p className="text-xs text-muted-foreground">
        {provider === 'hetzner'
          ? 'Use a Hetzner read-write project token.'
          : 'Allow catalog reads and Droplet, firewall and tag creation, reads and deletion on your DigitalOcean token.'}{' '}
        Saved only in GChat’s vault.
        {review && ' Leave blank to reuse your saved token.'}
      </p>
      <Button
        type="button"
        variant="outline"
        disabled={pending || (!token.trim() && !review)}
        onClick={() => void read()}
      >
        {pending ? 'Working…' : review ? 'Refresh prices' : 'Load live prices'}
      </Button>
      {review && (
        <>
          <Choice
            label="Region"
            value={region}
            disabled={pending || !valid || deployed}
            items={review.catalog.regions.filter((r) =>
              review.catalog.plans.some((p) => p.region === r.id)
            )}
            change={(value) => {
              setRegion(value)
              setPlan('')
              setAcknowledged(false)
            }}
          />
          <Choice
            label="Plan"
            value={plan}
            disabled={pending || !valid || !region || deployed}
            items={review.catalog.plans
              .filter((p) => p.region === region)
              .map((p) => ({
                id: p.id,
                name: `${p.recommended ? 'Recommended · ' : ''}${p.name} · ${p.vcpus} vCPU · ${p.memory_mib / 1024} GiB`,
              }))}
            change={(value) => {
              setPlan(value)
              setAcknowledged(false)
            }}
          />
          <Button
            type="button"
            variant="outline"
            disabled={pending || !valid || !region || !plan}
            onClick={() =>
              void perform(async () => {
                setAcknowledged(false)
                setReview(
                  await gbot<CloudReview>('setup/cloud/select', {
                    id,
                    region,
                    plan,
                  })
                )
              })
            }
          >
            Review cost
          </Button>
          {expired && (
            <p role="status" className="text-sm">
              Prices expired. Refresh prices before continuing.
            </p>
          )}
        </>
      )}
      {review && quote && matches && valid && (
        <div className="space-y-2 rounded-md border p-3 text-sm">
          <h4 className="font-medium">Estimated cost</h4>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-2">
            <dt>Computer</dt>
            <dd>
              {quote.plan.name} · {quote.plan.region} · {quote.plan.disk_gb} GB
              disk
            </dd>
            <dt>Compute / month</dt>
            <dd>{money(quote.plan.compute.monthly)}</dd>
            <dt>IPv4 / month</dt>
            <dd>{money(quote.plan.ipv4.monthly)}</dd>
            <dt>Total / month</dt>
            <dd>{money(quote.total.monthly)}</dd>
            <dt>Total / hour</dt>
            <dd>{money(quote.total.hourly)}</dd>
            <dt>Included traffic</dt>
            <dd>{quote.plan.included_traffic_bytes / 1e12} TB</dd>
            {quote.plan.traffic_per_tb && (
              <>
                <dt>Extra traffic / TB</dt>
                <dd>{money(quote.plan.traffic_per_tb)}</dd>
              </>
            )}
          </dl>
          <p>{review.catalog.tax}</p>
          <p className="text-muted-foreground">
            Backups and extra volumes are off. This estimate is not a spending
            cap. Stopping a VM does not stop its provider billing; deletion is
            required. Prices valid until{' '}
            {new Date(quote.expires_at * 1000).toLocaleString()}.
          </p>
          {review.confirmed ? (
            <p role="status">{deployed ? 'Costs confirmed for this computer.' : 'Cost review saved. No VM has been created.'}</p>
          ) : (
            <>
              <label className="flex items-start gap-2">
                <input
                  type="checkbox"
                  checked={acknowledged}
                  disabled={pending}
                  onChange={(event) => setAcknowledged(event.target.checked)}
                  className="mt-0.5 size-4 shrink-0 accent-primary"
                />
                I reviewed these costs. Creating the computer will require a
                separate confirmation.
              </label>
              <Button
                type="button"
                disabled={pending || !acknowledged}
                onClick={() =>
                  void perform(async () => {
                    setReview(
                      await gbot<CloudReview>('setup/cloud/confirm', {
                        id,
                        quote_id: quote.id,
                      })
                    )
                    await reviewed()
                  })
                }
              >
                Save cost review
              </Button>
            </>
          )}
        </div>
      )}
      {review && (review.deployment || (review.confirmed && quote && matches)) && (
        <CloudComputer
          review={review}
          updated={setReview}
          canCreate={valid && Boolean(review.confirmed && quote && matches)}
          busy={(value) => { setPending(value); busy(value) }}
          connected={connected}
        />
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </section>
  )
}

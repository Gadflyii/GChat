import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { useEngineHosts } from '@/stores/engine-hosts-store'
import {
  gbotControlGrant,
  type GbotControlGrant,
  type ServiceTarget,
} from '@/services/gbot'

export default function ServiceSetup({
  target,
  change,
}: {
  target: ServiceTarget
  change: (target: ServiceTarget, ready: boolean) => void
}) {
  const hosts = useEngineHosts((state) => state.hosts)
  const errors = useEngineHosts((state) => state.errors)
  const refresh = useEngineHosts((state) => state.refresh)
  const [grant, setGrant] = useState<GbotControlGrant>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const hostId = target.kind === 'paired_host' ? target.host_id : ''
  const remote = hosts.filter((host) => !host.local)
  useEffect(() => {
    void refresh().catch((cause) => setError(String(cause)))
  }, [refresh])
  useEffect(() => {
    setGrant(undefined)
    setError('')
    if (!hostId) return
    let current = true
    void gbotControlGrant(hostId, 'status')
      .then((value) => {
        if (current) {
          setGrant(value)
          change(
            { kind: 'paired_host', host_id: hostId },
            value.status === 'approved' && value.service_configured === true
          )
        }
      })
      .catch((cause) => {
        if (current) setError(String(cause))
      })
    return () => {
      current = false
    }
  }, [hostId, change])
  const request = async (action: 'request' | 'status') => {
    setBusy(true)
    setError('')
    try {
      const value = await gbotControlGrant(hostId, action)
      setGrant(value)
      change(
        { kind: 'paired_host', host_id: hostId },
        value.status === 'approved' && value.service_configured === true
      )
    } catch (cause) {
      setError(String(cause))
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        The service keeps your bot's tasks and schedules running. Its computer
        is a separate choice in the next step.
      </p>
      <fieldset className="space-y-2" disabled={busy}>
        <legend className="mb-2 text-sm font-medium">
          Where should the Gbot service run?
        </legend>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="radio"
            name="service"
            checked={target.kind === 'local'}
            onChange={() => change({ kind: 'local' }, true)}
            className="size-4 accent-primary"
          />
          This PC (recommended)
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="radio"
            name="service"
            checked={target.kind === 'paired_host'}
            onChange={() => change({ kind: 'paired_host', host_id: '' }, false)}
            className="size-4 accent-primary"
          />
          Another PC on the LAN
        </label>
        {target.kind === 'paired_host' && (
          <label className="block space-y-1 text-sm">
            Paired service computer
            <select
              className="w-full rounded border bg-background p-2"
              value={hostId}
              onChange={(event) =>
                change(
                  { kind: 'paired_host', host_id: event.target.value },
                  false
                )
              }
            >
              <option value="">Choose a paired computer</option>
              {remote.map((host) => (
                <option
                  key={host.host_id}
                  value={host.host_id}
                  disabled={!!errors[host.host_id]}
                >
                  {host.name}
                  {errors[host.host_id] ? ' · Offline' : ''}
                </option>
              ))}
            </select>
          </label>
        )}
      </fieldset>
      {target.kind === 'local' ? (
        <p className="text-sm text-muted-foreground">
          The service continues after you close GChat. Tasks pause while this PC
          is asleep or turned off.
        </p>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">
            Pair the service computer in GInfer Hosts first. Switching services
            shows that computer's bots; existing bots stay on their original
            service.
          </p>
          {hostId && (
            <>
              <p role="status" className="text-sm">
                {grant?.status === 'approved'
                  ? 'Gbot control approved for this device.'
                  : grant?.status === 'pending'
                    ? 'Waiting for approval on the service computer.'
                    : grant?.status === 'revoked'
                      ? 'Gbot control was revoked. Request access again.'
                      : 'Gbot control needs separate approval from pairing.'}
              </p>
              {grant?.status !== 'approved' && (
                <p className="text-sm text-muted-foreground">
                  On that computer, open GInfer Hosts → This computer → Gbot
                  control and approve this device. The owner can revoke access
                  there.
                </p>
              )}
              {grant?.service_configured === false && (
                <p className="text-sm text-muted-foreground">
                  Enable and open Gbot once on the service computer to prepare
                  its runtime.
                </p>
              )}
              <Button
                type="button"
                variant="outline"
                disabled={busy || !!errors[hostId]}
                onClick={() =>
                  void request(
                    grant?.status === 'pending' || grant?.status === 'approved'
                      ? 'status'
                      : 'request'
                  )
                }
              >
                {busy
                  ? 'Checking…'
                  : grant?.status === 'pending' || grant?.status === 'approved'
                    ? 'Check approval'
                    : 'Request Gbot control'}
              </Button>
            </>
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

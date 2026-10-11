import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { EngineProfilePicker } from './EngineProfilePicker'
import { useEngineHosts } from '@/stores/engine-hosts-store'
import { engineAlias, engineCommand, hardwareProfileBusy } from '@/services/engines'
import type { BenchmarkSessionInfo } from '@/services/benchmark/tauri'
import { hostInstanceLabel, hostModelLabel } from '@/lib/engine-host-labels'
import { Button } from '@/components/ui/button'

export function BenchmarkServerSettings({ sessions, selected, select, disabled, refresh, onPendingChange }: {
  sessions: BenchmarkSessionInfo[]
  selected?: BenchmarkSessionInfo
  select: (id: string) => void
  disabled: boolean
  refresh: () => Promise<void>
  onPendingChange: (pending: boolean) => void
}) {
  const { hosts, snapshots, errors, refresh: refreshHosts } = useEngineHosts()
  const [busy, setBusy] = useState(false)
  const [generation, setGeneration] = useState(0)
  const [capacityPending, setCapacityPending] = useState(false)
  const [maxPerfChoice, setMaxPerfChoice] = useState<{ targetId: string; sessionId?: string | null; key: string } | null>(null)
  const host = hosts.find(host => snapshots[host.host_id]?.instances.some(instance =>
    engineAlias(host.host_id, instance.instance_id) === selected?.target_id))
  const snapshot = host && snapshots[host.host_id]
  const instance = snapshot?.instances.find(instance => engineAlias(host!.host_id, instance.instance_id) === selected?.target_id)
  const occupied = new Set(snapshot?.instances.filter(item => item.instance_id !== instance?.instance_id
    && ['starting', 'ready', 'stopping'].includes(item.status)).flatMap(item => item.configuration.gpu_uuids))
  const maxPerfChoices = (snapshot?.max_perf_profiles ?? []).flatMap(entry => entry.compatible_gpu_groups
    .filter(group => group.length === 1 && instance?.configuration.gpu_uuids.length === 1
      && group[0] === instance.configuration.gpu_uuids[0] && !occupied.has(group[0])
      && snapshot?.gpus.some(gpu => gpu.uuid === group[0]) && snapshot.models.some(model => model.id === entry.model_id))
    .map(group => ({ entry, group, key: JSON.stringify([entry.model_id, entry.profile.id, group]) })))
  const maxPerfKey = maxPerfChoice && maxPerfChoice.targetId === selected?.target_id && maxPerfChoice.sessionId === selected?.session_id
    ? maxPerfChoice.key : undefined
  const maxPerf = maxPerfChoices.find(item => item.key === maxPerfKey)
  const maxPerfPending = !!maxPerf
  useEffect(() => { onPendingChange(capacityPending || maxPerfPending) }, [capacityPending, maxPerfPending, onPendingChange])
  const apply = async (body: Record<string, unknown>) => {
    if (!host) return
    setBusy(true)
    try {
      await engineCommand('profile_launch', { host_id: host.host_id, body })
      await refreshHosts()
      await refresh()
      setGeneration(value => value + 1)
      setMaxPerfChoice(null)
      setCapacityPending(false)
      onPendingChange(false)
    } catch (error) { toast.error('Could not apply server settings', { description: String(error) }) }
    finally { setBusy(false) }
  }
  const selector = <label className="min-w-0 text-sm">Host / Instance
    <select className="mt-1 block w-full min-w-0 rounded border bg-background p-2" value={selected?.target_id ?? ''}
      disabled={disabled || busy} onChange={event => { setMaxPerfChoice(null); setCapacityPending(false); onPendingChange(false); select(event.target.value) }}>
      {!selected && <option value="">Choose an online instance</option>}
      {sessions.map(session => {
        for (const host of hosts) {
          const snapshot = snapshots[host.host_id]
          const instance = snapshot?.instances.find(instance => engineAlias(host.host_id, instance.instance_id) === session.target_id)
          if (instance) return <option key={session.target_id} value={session.target_id}>{host.name} · {hostInstanceLabel(instance, snapshot)}</option>
        }
        return <option key={session.target_id} value={session.target_id}>{session.display_name ?? session.model_id}</option>
      })}
    </select>
  </label>
  if (!host || !snapshot || !instance) return <div className="rounded-lg border p-4">{selector}<p className="mt-2 text-sm text-muted-foreground">Select a managed online instance to change its model or profile.</p></div>
  const maxPerfDisabled = disabled || busy || !!errors[host.host_id] || instance.status !== 'ready'
    || hardwareProfileBusy(snapshot.hardware_profile) || !selected?.session_id || selected.session_id !== instance.session_id
  return <div className="space-y-3">
    <div className="space-y-3 rounded-lg border p-4">
      <h3 className="font-medium">GBench Max Perf</h3>
      <p className="text-sm text-muted-foreground">The Standard Benchmark profile uses 8,181 context tokens, capacity for eight requests, TP1, and the release KV and draft settings. It is separate from capacity profiles and does not claim hardware qualification.</p>
      {selected?.benchmark_profile && <p className="text-sm">Running profile: GBench Max Perf v{selected.benchmark_profile.version}</p>}
      <label className="block text-sm">Max Perf profile
        <select className="mt-1 w-full min-w-0 rounded border bg-background p-2" disabled={maxPerfDisabled || capacityPending || !maxPerfChoices.length}
          value={maxPerf?.key ?? ''} onChange={event => {
            setMaxPerfChoice({ targetId: selected!.target_id, sessionId: selected!.session_id, key: event.target.value })
          }}>
          <option value="">Choose a Max Perf profile</option>
          {maxPerfChoices.map(({ entry, key }) => <option key={key} value={key}>
            {entry.profile.name} · {hostModelLabel(snapshot.models.find(model => model.id === entry.model_id)!)}
          </option>)}
        </select>
      </label>
      {!maxPerfChoices.length && <p className="text-sm text-muted-foreground">No Max Perf profile matches an installed release model on this instance’s available single GPU. Existing GPU groups are preserved.</p>}
      {maxPerf && <p role="alert" className="text-sm">Applying this profile drains current requests and restarts this server. Other clients are affected. Benchmarking remains paused until the new session is ready.</p>}
      <Button disabled={maxPerfDisabled || !maxPerf || capacityPending} onClick={() => {
        if (!maxPerf || maxPerfDisabled || capacityPending) return
        if (!window.confirm('Apply the GBench Max Perf profile and restart this server? Other clients using it will be affected.')) return
        void apply({ profile_id: maxPerf.entry.profile.id, model_id: maxPerf.entry.model_id,
          gpu_uuids: maxPerf.group, instance_id: instance.instance_id, expected_session_id: instance.session_id, force: false })
      }}>Apply Max Perf & Restart Server</Button>
      {maxPerf && <Button variant="outline" disabled={busy} onClick={() => setMaxPerfChoice(null)}>Keep running settings</Button>}
    </div>
    <EngineProfilePicker key={`${selected?.target_id}:${selected?.session_id}:${generation}`} snapshot={snapshot}
    instanceId={instance.instance_id} hostSelector={selector} currentSettings onPendingChange={setCapacityPending}
    disabled={disabled || busy || maxPerfPending || !!errors[host.host_id] || instance.status !== 'ready'}
    launch={apply} />
  </div>
}

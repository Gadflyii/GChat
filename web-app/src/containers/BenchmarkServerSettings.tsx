import { useState } from 'react'
import { toast } from 'sonner'
import { EngineProfilePicker } from './EngineProfilePicker'
import { useEngineHosts } from '@/stores/engine-hosts-store'
import { engineAlias, engineCommand } from '@/services/engines'
import type { BenchmarkSessionInfo } from '@/services/benchmark/tauri'
import { hostInstanceLabel } from '@/lib/engine-host-labels'

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
  const host = hosts.find(host => snapshots[host.host_id]?.instances.some(instance =>
    engineAlias(host.host_id, instance.instance_id) === selected?.target_id))
  const snapshot = host && snapshots[host.host_id]
  const instance = snapshot?.instances.find(instance => engineAlias(host!.host_id, instance.instance_id) === selected?.target_id)
  const selector = <label className="min-w-0 text-sm">Host / Instance
    <select className="mt-1 block w-full min-w-0 rounded border bg-background p-2" value={selected?.target_id ?? ''}
      disabled={disabled || busy} onChange={event => { onPendingChange(false); select(event.target.value) }}>
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
  return <EngineProfilePicker key={`${selected?.target_id}:${selected?.session_id}:${generation}`} snapshot={snapshot}
    instanceId={instance.instance_id} hostSelector={selector} currentSettings onPendingChange={onPendingChange}
    disabled={disabled || busy || !!errors[host.host_id] || instance.status !== 'ready'}
    launch={async body => {
      setBusy(true)
      try {
        await engineCommand('profile_launch', { host_id: host.host_id, body })
        await refreshHosts()
        await refresh()
        setGeneration(value => value + 1)
        onPendingChange(false)
      } catch (error) { toast.error('Could not apply server settings', { description: String(error) }) }
      finally { setBusy(false) }
    }} />
}

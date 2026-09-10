import { useState } from 'react'
import { Button } from '@/components/ui/button'
import type { EngineSnapshot } from '@/services/engines'

export function EngineProfilePicker({ snapshot, disabled, launch }: {
  snapshot: EngineSnapshot
  disabled: boolean
  launch: (body: Record<string, unknown>) => Promise<void>
}) {
  const [instanceId, setInstanceId] = useState('')
  const [choice, setChoice] = useState('')
  const occupied = new Set(snapshot.instances
    .filter(i => i.instance_id !== instanceId && ['starting', 'ready', 'stopping'].includes(i.status))
    .flatMap(i => i.configuration.gpu_uuids))
  const choices = (snapshot.launch_profiles ?? []).flatMap(entry => entry.compatible_gpu_groups
    .filter(group => group.every(gpu => !occupied.has(gpu)))
    .map(group => ({ entry, group, key: JSON.stringify([entry.model_id, entry.profile.id, group]) })))
  const selected = choices.find(item => item.key === choice)
  return <div className="space-y-3 rounded-lg border p-4">
    <h3 className="font-medium">Launch profiles</h3>
    <p className="text-sm text-muted-foreground">Choose a tested context and concurrency configuration. The host owns model settings and GPU assignments.</p>
    {snapshot.profile_error && <p role="alert" className="text-sm text-destructive">{snapshot.profile_error}</p>}
    <label className="block text-sm">Serving instance
      <select className="mt-1 w-full rounded border bg-background p-2" disabled={disabled} value={instanceId}
        onChange={e => { setInstanceId(e.target.value); setChoice('') }}>
        <option value="">New instance</option>
        {snapshot.instances.map(i => <option key={i.instance_id} value={i.instance_id}>{i.display_name} · {i.status}</option>)}
      </select>
    </label>
    <label className="block text-sm">Hardware profile
      <select className="mt-1 w-full rounded border bg-background p-2" disabled={disabled || !choices.length} value={selected ? choice : ''} onChange={e => setChoice(e.target.value)}>
        <option value="">Choose a profile</option>
        {choices.map(({ entry, group, key }) => <option key={key} value={key}>
          {entry.profile.name} · TP{entry.profile.tp} · C{entry.profile.concurrency} · {entry.profile.max_context.toLocaleString()} context · GPUs {group.map(g => snapshot.gpus.findIndex(gpu => gpu.uuid === g) + 1).join(', ')}
        </option>)}
      </select>
    </label>
    {!choices.length && <p className="text-sm text-muted-foreground">No qualified profiles match this host's platform, installed models, and available GPU groups.</p>}
    <Button disabled={disabled || !selected || (!!instanceId && !snapshot.instances.some(i => i.instance_id === instanceId))} onClick={() => {
      if (!selected) return
      if (instanceId && !window.confirm('Switch this instance to the selected model and profile? Serving restarts after its current requests drain.')) return
      void launch({ profile_id: selected.entry.profile.id, model_id: selected.entry.model_id,
        gpu_uuids: selected.group, instance_id: instanceId || null, force: false,
        ...(instanceId ? { expected_session_id: snapshot.instances.find(i => i.instance_id === instanceId)?.session_id } : {}) })
    }}>{instanceId ? 'Apply profile and restart' : 'Start profile'}</Button>
  </div>
}

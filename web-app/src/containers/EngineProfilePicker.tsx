import { useEffect, useState, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import type { EngineSnapshot } from '@/services/engines'
import { hostInstanceLabel, hostModelLabel } from '@/lib/engine-host-labels'

export function EngineProfilePicker({ snapshot, disabled, launch, instanceId: controlledInstanceId, labelPrefix, hostSelector, currentSettings = false, onPendingChange }: {
  snapshot: EngineSnapshot
  disabled: boolean
  launch: (body: Record<string, unknown>) => Promise<void>
  instanceId?: string
  labelPrefix?: string
  hostSelector?: ReactNode
  currentSettings?: boolean
  onPendingChange?: (pending: boolean) => void
}) {
  const [localInstanceId, setInstanceId] = useState('')
  const instanceId = controlledInstanceId ?? localInstanceId
  const instance = snapshot.instances.find(i => i.instance_id === instanceId)
  const restarting = instance?.status === 'ready'
  const [modelChoice, setModelChoice] = useState<{ instanceId: string; modelId: string } | null>(null)
  const modelId = modelChoice?.instanceId === instanceId ? modelChoice.modelId
    : instance?.profile?.model_id ?? snapshot.models[0]?.id ?? ''
  const [choice, setChoice] = useState('')
  const occupied = new Set(snapshot.instances
    .filter(i => i.instance_id !== instanceId && ['starting', 'ready', 'stopping'].includes(i.status))
    .flatMap(i => i.configuration.gpu_uuids))
  const matching = (snapshot.launch_profiles ?? []).filter(entry => entry.model_id === modelId && snapshot.models.some(model => model.id === modelId))
  const choices = matching.flatMap(entry => entry.compatible_gpu_groups
    .filter(group => group.every(gpu => !occupied.has(gpu) && snapshot.gpus.some(item => item.uuid === gpu))
      && (!instance || (group.length === instance.configuration.gpu_uuids.length
        && group.every(gpu => instance.configuration.gpu_uuids.includes(gpu)))))
    .map(group => ({ entry, group, key: JSON.stringify([entry.model_id, entry.profile.id, group]) })))
  choices.sort((a, b) => Number(b.entry.profile.options.vision) - Number(a.entry.profile.options.vision)
    || a.entry.profile.concurrency - b.entry.profile.concurrency)
  const selected = choices.find(item => item.key === choice)
    ?? (!currentSettings && !choice && !instanceId ? choices.find(item => item.entry.profile.options.vision) : undefined)
  const pending = currentSettings && (!!choice || (modelId !== (instance?.profile?.model_id ?? snapshot.models[0]?.id)))
  useEffect(() => { onPendingChange?.(pending) }, [pending, onPendingChange])
  return <div className="space-y-3 rounded-lg border p-4">
    <h3 className="font-medium">{currentSettings ? 'Benchmark server' : 'Launch Server Instance'}</h3>
    <p className="text-sm text-muted-foreground">Choose a model, then a profile for its compatible hardware. Existing instances keep their GPU group. Selections take effect only when you apply or start the profile.</p>
    {snapshot.profile_error && <p role="alert" className="text-sm text-destructive">{snapshot.profile_error}</p>}
    <div className={`grid min-w-0 gap-3 ${hostSelector || controlledInstanceId === undefined ? 'grid-cols-3' : 'grid-cols-2'}`}>
    {hostSelector}
    {controlledInstanceId === undefined && <label className="min-w-0 text-sm">Server Host
      <select className="mt-1 w-full rounded border bg-background p-2" disabled={disabled} value={instanceId}
        onChange={e => { setInstanceId(e.target.value); setModelChoice(null); setChoice('') }}>
        <option value="">{snapshot.display_name} · New instance</option>
        {snapshot.instances.map(i => <option key={i.instance_id} value={i.instance_id}>{snapshot.display_name} · {hostInstanceLabel(i, snapshot)} · {i.status}</option>)}
      </select>
    </label>}
    <label className="min-w-0 text-sm">Model
      <select aria-label={labelPrefix ? `${labelPrefix} model` : undefined} className="mt-1 w-full min-w-0 rounded border bg-background p-2" disabled={disabled} value={modelId}
        onChange={e => { setModelChoice({ instanceId, modelId: e.target.value }); setChoice('') }}>
        {!snapshot.models.some(model => model.id === modelId) && <option value={modelId}>{modelId ? 'Saved model unavailable' : 'Choose an installed model'}</option>}
        {snapshot.models.map(model => <option key={model.id} value={model.id}>{hostModelLabel(model)}</option>)}
      </select>
    </label>
    <label className="block text-sm">Hardware profile
      <select className="mt-1 w-full rounded border bg-background p-2" disabled={disabled || !choices.length} value={selected?.key ?? ''} onChange={e => setChoice(e.target.value)}>
        <option value="">{currentSettings && !pending ? `Current settings · C${instance?.configuration.concurrency ?? 1} · ${instance?.configuration.max_context.toLocaleString() ?? 'Automatic'} context` : 'Choose a profile'}</option>
        {choices.map(({ entry, group, key }) => <option key={key} value={key}>
          {entry.profile.name} · {entry.profile.options.vision ? 'Vision + text (default)' : 'Text only'} · TP{entry.profile.tp} · C{entry.profile.concurrency} · {entry.profile.max_context.toLocaleString()} context · {entry.profile.qualification.tier === 'full-context-tested' ? 'Full-context tested' : entry.profile.qualification.tier === 'calculated-startup-smoke' ? 'Calculated + startup/smoke checked' : 'Calculated — pending validation'} · GPUs {group.map(g => snapshot.gpus.findIndex(gpu => gpu.uuid === g) + 1).join(', ')}
        </option>)}
      </select>
    </label>
    </div>
    {pending && <p role="alert" className="rounded border border-amber-500/40 bg-amber-500/10 p-3 text-sm">Applying these settings unloads the current model and restarts this server instance. Other clients using it will be affected. Benchmarking is paused until the new instance is ready.</p>}
    {selected && <p className="text-sm text-muted-foreground">{selected.entry.profile.qualification.tier === 'full-context-tested'
      ? 'Tested with full-length requests at this concurrency.'
      : selected.entry.profile.qualification.tier === 'calculated-startup-smoke'
        ? 'Capacity calculated for the full context; startup and concurrent short requests checked. Full-length requests have not been tested.'
        : 'Pending validation: capacity is calculated only. Startup, memory margin and inference are unverified; this profile may fail to load until the required engine support is available.'}</p>}
    {!choices.length && <p className="text-sm text-muted-foreground">{
      !snapshot.models.length ? 'No installed models were found. Add a .ginfer model to this host’s model folder, then rescan.'
        : currentSettings ? 'No alternate profiles match this model and GPU group. You can benchmark the current running settings, or select another installed model with a compatible profile.'
        : matching.length ? 'No profiles are available for this model on the selected instance’s GPU group. Its GPUs may be reserved by another instance, or the profiles require different hardware. Select another instance or create a new one on compatible, available GPUs.'
          : 'No installed profile matches this host and its exact model artifacts. Check the model identity, quantization, draft format and TP degree—not just the filename. Install the matching model and profile catalog, then refresh. Custom launch settings remain available below.'
    }</p>}
    {(!currentSettings || pending) && <Button disabled={disabled || !selected || (!!instanceId && !snapshot.instances.some(i => i.instance_id === instanceId))} onClick={() => {
      if (!selected) return
      if (restarting && !window.confirm('Switch this instance to the selected model and profile? Serving restarts after its current requests drain.')) return
      void launch({ profile_id: selected.entry.profile.id, model_id: selected.entry.model_id,
        gpu_uuids: selected.group, instance_id: instanceId || null, force: false,
        ...(instanceId ? { expected_session_id: snapshot.instances.find(i => i.instance_id === instanceId)?.session_id } : {}) })
    }}>{currentSettings ? 'Apply & Restart Server' : restarting ? 'Apply profile and restart' : 'Start Server Instance'}</Button>}
    {pending && <Button variant="outline" disabled={disabled} onClick={() => { setModelChoice(null); setChoice('') }}>Keep running settings</Button>}
  </div>
}

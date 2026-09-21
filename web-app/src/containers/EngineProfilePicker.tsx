import { useEffect, useState, type CSSProperties, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import type { EngineSnapshot } from '@/services/engines'
import { hostInstanceLabel, hostModelLabel } from '@/lib/engine-host-labels'

const selectStyle: CSSProperties = {
  appearance: 'none',
  WebkitAppearance: 'none',
  backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Cpath fill='none' stroke='%238a9098' stroke-width='1.5' d='m4 6 4 4 4-4'/%3E%3C/svg%3E")`,
  backgroundRepeat: 'no-repeat',
  backgroundPosition: 'right 0.5rem center',
  backgroundSize: '1rem',
  paddingRight: '2rem',
}

export function EngineProfilePicker({ snapshot, disabled, launch, instanceId: controlledInstanceId, labelPrefix, hostSelector, currentSettings = false, hideHeading = false, onPendingChange }: {
  snapshot: EngineSnapshot
  disabled: boolean
  launch: (body: Record<string, unknown>) => Promise<void>
  instanceId?: string
  labelPrefix?: string
  hostSelector?: ReactNode
  hideHeading?: boolean
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
  const [gpuChoice, setGpuChoice] = useState<{ instanceId: string; key: string } | null>(null)
  const occupied = new Set(snapshot.instances
    .filter(i => i.instance_id !== instanceId && ['starting', 'ready', 'stopping'].includes(i.status))
    .flatMap(i => i.configuration.gpu_uuids))
  const matching = (snapshot.launch_profiles ?? []).filter(entry => entry.model_id === modelId && snapshot.models.some(model => model.id === modelId))
  const compatible = matching.flatMap(entry => entry.compatible_gpu_groups
    .filter(group => group.every(gpu => !occupied.has(gpu) && snapshot.gpus.some(item => item.uuid === gpu))
      && (!instance || (group.length === instance.configuration.gpu_uuids.length
        && group.every(gpu => instance.configuration.gpu_uuids.includes(gpu)))))
    .map(group => ({ entry, group, key: JSON.stringify([entry.model_id, entry.profile.id, group]) })))
  compatible.sort((a, b) => Number(b.entry.profile.options.vision) - Number(a.entry.profile.options.vision)
    || a.entry.profile.concurrency - b.entry.profile.concurrency)
  const groupKey = (group: string[]) => JSON.stringify([...group].sort())
  const groups = instance ? [instance.configuration.gpu_uuids] : [...new Map([
    ...snapshot.gpus.map(gpu => [gpu.uuid]),
    ...compatible.map(item => item.group),
  ].map(group => [groupKey(group), group])).values()]
  const chosenGpu = gpuChoice?.instanceId === instanceId ? gpuChoice.key : undefined
  const availableGroup = groups.find(group => group.every(gpu => !occupied.has(gpu)))
  const gpuKey = instance ? groupKey(instance.configuration.gpu_uuids)
    : groups.some(group => groupKey(group) === chosenGpu) ? chosenGpu
      : compatible[0] ? groupKey(compatible[0].group)
        : availableGroup ? groupKey(availableGroup) : undefined
  const choices = compatible.filter(item => groupKey(item.group) === gpuKey)
  const selected = choices.find(item => item.key === choice)
    ?? (!currentSettings && !choice && !instanceId ? choices.find(item => item.entry.profile.options.vision) : undefined)
  const pending = currentSettings && (!!choice || (modelId !== (instance?.profile?.model_id ?? snapshot.models[0]?.id)))
  useEffect(() => { onPendingChange?.(pending) }, [pending, onPendingChange])
  return <div className="space-y-3 rounded-lg border p-4">
    {!hideHeading && <h3 className="font-medium">{currentSettings ? 'Benchmark server' : 'Launch Server Instance'}</h3>}
    <p className="text-sm text-muted-foreground">Choose a model, GPU or GPU group, then a profile. Existing instances keep their GPU group. Selections take effect only when you apply or start the profile.</p>
    {snapshot.profile_error && <p role="alert" className="text-sm text-destructive">{snapshot.profile_error}</p>}
    <div className={`grid min-w-0 gap-3 ${hostSelector || controlledInstanceId === undefined ? 'sm:grid-cols-2 xl:grid-cols-4' : 'sm:grid-cols-3'}`}>
    {hostSelector}
    {controlledInstanceId === undefined && <label className="min-w-0 text-sm">Server Host
      <select style={selectStyle} className="mt-1 w-full rounded border bg-background p-2" disabled={disabled} value={instanceId}
        onChange={e => { setInstanceId(e.target.value); setModelChoice(null); setGpuChoice(null); setChoice('') }}>
        <option value="">{snapshot.display_name} · New instance</option>
        {snapshot.instances.map(i => <option key={i.instance_id} value={i.instance_id}>{snapshot.display_name} · {hostInstanceLabel(i, snapshot)} · {i.status}</option>)}
      </select>
    </label>}
    <label className="min-w-0 text-sm">Model
      <select style={selectStyle} aria-label={labelPrefix ? `${labelPrefix} model` : undefined} className="mt-1 w-full min-w-0 rounded border bg-background p-2" disabled={disabled} value={modelId}
        onChange={e => { setModelChoice({ instanceId, modelId: e.target.value }); setChoice('') }}>
        {!snapshot.models.some(model => model.id === modelId) && <option value={modelId}>{modelId ? 'Saved model unavailable' : 'Choose an installed model'}</option>}
        {snapshot.models.map(model => <option key={model.id} value={model.id}>{hostModelLabel(model)}</option>)}
      </select>
    </label>
    <label className="min-w-0 text-sm">GPU / GPU group
      <select style={selectStyle} className="mt-1 w-full min-w-0 rounded border bg-background p-2" disabled={disabled || !!instance || !groups.length} value={gpuKey ?? ''}
        onChange={e => { setGpuChoice({ instanceId, key: e.target.value }); setChoice('') }}>
        {!gpuKey && <option value="">No available GPUs</option>}
        {groups.map(group => <option key={groupKey(group)} value={groupKey(group)} disabled={group.some(gpu => occupied.has(gpu))}>
          {group.map(id => { const index = snapshot.gpus.findIndex(gpu => gpu.uuid === id); const gpu = snapshot.gpus[index]; return gpu ? `GPU ${index + 1}: ${gpu.display_name ?? gpu.name} · ${(gpu.memory_mib / 1024).toFixed(0)} GB` : 'Unavailable GPU' }).join(' + ')}
          {group.some(gpu => occupied.has(gpu)) ? ' · In use' : ''}
        </option>)}
      </select>
    </label>
    <label className="min-w-0 text-sm">Hardware profile
      <select style={selectStyle} className="mt-1 w-full min-w-0 rounded border bg-background p-2" disabled={disabled || !choices.length} value={selected?.key ?? ''} onChange={e => setChoice(e.target.value)}>
        <option value="">{currentSettings && !pending ? `Current settings · C${instance?.configuration.concurrency ?? 1} · ${instance?.configuration.max_context.toLocaleString() ?? 'Automatic'} context` : 'Choose a profile'}</option>
        {choices.map(({ entry, key }) => <option key={key} value={key}>
          {entry.profile.name} · {entry.profile.options.vision ? 'Vision + text (default)' : 'Text only'} · TP{entry.profile.tp} · C{entry.profile.concurrency} · {entry.profile.max_context.toLocaleString()} context · {entry.profile.qualification.tier === 'full-context-tested' ? 'Full-context tested' : entry.profile.qualification.tier === 'calculated-startup-smoke' ? 'Calculated + startup/smoke checked' : 'Calculated — pending validation'}
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
        : matching.length ? 'No profiles match this model on the selected GPU group. Select a compatible GPU group or install matching profiles. Existing instances keep their assigned GPUs; create a new instance to use another group.'
          : 'No installed profile matches this host and its exact model artifacts. Check the model identity, quantization, draft format and TP degree—not just the filename. Install the matching model and profile catalog, then refresh. Custom launch settings remain available below.'
    }</p>}
    {(!currentSettings || pending) && <Button disabled={disabled || !selected || (!!instanceId && !snapshot.instances.some(i => i.instance_id === instanceId))} onClick={() => {
      if (!selected) return
      if (restarting && !window.confirm('Switch this instance to the selected model and profile? Serving restarts after its current requests drain.')) return
      void launch({ profile_id: selected.entry.profile.id, model_id: selected.entry.model_id,
        gpu_uuids: selected.group, instance_id: instanceId || null, force: false,
        ...(instanceId ? { expected_session_id: snapshot.instances.find(i => i.instance_id === instanceId)?.session_id } : {}) })
    }}>{currentSettings ? 'Apply & Restart Server' : restarting ? 'Apply profile and restart' : 'Start Server Instance'}</Button>}
    {pending && <Button variant="outline" disabled={disabled} onClick={() => { setModelChoice(null); setGpuChoice(null); setChoice('') }}>Keep running settings</Button>}
  </div>
}

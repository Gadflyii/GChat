import { useEffect, useState, type ReactNode } from 'react'
import { ChoiceSelect } from '@/components/ui/choice-select'
import { confirmAction } from '@/lib/confirm'
import { Button } from '@/components/ui/button'
import { hardwareProfileBlocksLaunch, type EngineSnapshot } from '@/services/engines'
import { hostInstanceLabel, hostModelLabel } from '@/lib/engine-host-labels'
import { profileOptionLabel, profilePresentation } from '../../../src-tauri/ginfer-manager/ui/profile-presentation.js'

const instanceStatusLabels = { starting: 'Starting', ready: 'Ready to chat', stopping: 'Stopping', stopped: 'Stopped', failed: 'Could not start' } as const

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
  const controlsDisabled = disabled || hardwareProfileBlocksLaunch(snapshot.hardware_profile)
  const [choice, setChoice] = useState('')
  const [showAllProfiles, setShowAllProfiles] = useState(false)
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
  const { recommendedIndex, visibleIndices } = profilePresentation(
    choices.map(item => item.entry.profile), selected ? choices.indexOf(selected) : -1, showAllProfiles)
  const [structuredChoice, setStructuredChoice] = useState<{ instanceId: string; value: boolean } | null>(null)
  const structuredOutputs = structuredChoice?.instanceId === instanceId ? structuredChoice.value
    : instance?.profile?.structured_outputs ?? instance?.configuration.structured_outputs
      ?? true
  const changedStructured = selected && structuredOutputs !== (selected.entry.profile.options.structured_outputs ?? false)
  const pending = currentSettings && (!!choice || (modelId !== (instance?.profile?.model_id ?? snapshot.models[0]?.id)))
  useEffect(() => { onPendingChange?.(pending) }, [pending, onPendingChange])
  return <div className="space-y-3 rounded-lg border p-4">
    {!hideHeading && <h3 className="font-medium">{currentSettings ? 'Choose model settings to test' : 'Start a model'}</h3>}
    <p className="text-sm text-muted-foreground">Choose a model, graphics cards and saved settings. A running model keeps its cards. Your choices take effect only when you start or restart the model.</p>
    {snapshot.profile_error && <div role="alert" className="text-sm text-destructive"><p>Could not read the saved model settings. Refresh the model list and try again.</p><details><summary className="cursor-pointer">Saved settings technical details</summary><p className="whitespace-pre-wrap break-all">{snapshot.profile_error}</p></details></div>}
    <div className={`grid min-w-0 gap-3 ${hostSelector || controlledInstanceId === undefined ? 'sm:grid-cols-2 xl:grid-cols-4' : 'sm:grid-cols-3'}`}>
    {hostSelector}
    {controlledInstanceId === undefined && <label className="min-w-0 text-sm">Model server
      <ChoiceSelect aria-label="Model server" className="mt-1 w-full" disabled={controlsDisabled} value={instanceId}
        onValueChange={value => { setInstanceId(value); setModelChoice(null); setGpuChoice(null); setChoice(''); setShowAllProfiles(false) }}
        options={[{ value: '', label: `${snapshot.display_name} · Start another model` },
          ...snapshot.instances.map(i => ({ value: i.instance_id, label: `${snapshot.display_name} · ${hostInstanceLabel(i, snapshot)} · ${instanceStatusLabels[i.status]}` }))]} />
    </label>}
    <label className="min-w-0 text-sm">Model
      <ChoiceSelect aria-label={labelPrefix ? `${labelPrefix} model` : 'Model'} className="mt-1 w-full" disabled={controlsDisabled} value={modelId}
        onValueChange={value => { setModelChoice({ instanceId, modelId: value }); setChoice(''); setShowAllProfiles(false) }}
        options={[...(!snapshot.models.some(model => model.id === modelId) ? [{ value: modelId, label: modelId ? 'Saved model unavailable' : 'Choose an installed model' }] : []),
          ...snapshot.models.map(model => ({ value: model.id, label: hostModelLabel(model) }))]} />
    </label>
    <label className="min-w-0 text-sm">Graphics cards
      <ChoiceSelect aria-label="Graphics cards" className="mt-1 w-full" disabled={controlsDisabled || !!instance || !groups.length} value={gpuKey ?? ''}
        onValueChange={value => { setGpuChoice({ instanceId, key: value }); setChoice(''); setShowAllProfiles(false) }}
        options={[...(!gpuKey ? [{ value: '', label: 'No available graphics cards' }] : []),
          ...groups.map(group => ({ value: groupKey(group), disabled: group.some(gpu => occupied.has(gpu)),
            label: group.map(id => { const index = snapshot.gpus.findIndex(gpu => gpu.uuid === id); const gpu = snapshot.gpus[index]; return gpu ? `Graphics card ${index + 1}: ${gpu.display_name ?? gpu.name} · ${(gpu.memory_mib / 1024).toFixed(0)} GiB` : 'Graphics card unavailable' }).join(' + ') + (group.some(gpu => occupied.has(gpu)) ? ' · In use' : '') }))]} />
    </label>
    <div className="min-w-0 text-sm"><label>Saved model settings
      <ChoiceSelect aria-label="Saved model settings" className="mt-1 w-full" disabled={controlsDisabled || !choices.length} value={selected?.key ?? ''} onValueChange={setChoice}
        options={[{ value: '', label: currentSettings && !pending ? `Current settings · ${instance?.configuration.concurrency ?? 1} replies at once · ${instance?.configuration.max_context.toLocaleString() ?? 'Automatic'} tokens` : 'Choose saved settings' },
          ...visibleIndices.map(index => { const { entry, key } = choices[index]; return { value: key, label: profileOptionLabel(entry.profile, index === recommendedIndex) } })]} />
    </label>
    {(choices.length > visibleIndices.length || showAllProfiles) && <button type="button" className="mt-1 text-muted-foreground underline" disabled={controlsDisabled}
      aria-expanded={showAllProfiles} onClick={() => setShowAllProfiles(value => !value)}>{showAllProfiles ? 'Show fewer settings' : 'Show all settings'}</button>}
    {!!choices.length && recommendedIndex < 0 && <p className="mt-1 text-muted-foreground">No settings with full-length conversation tests are available for these cards.</p>}
    </div>
    </div>
    <label className="flex items-center gap-2 text-sm"><input type="checkbox"
      aria-label={labelPrefix ? `${labelPrefix} follow a response format` : undefined}
      checked={structuredOutputs} disabled={controlsDisabled || (currentSettings && !selected)}
      onChange={e => setStructuredChoice({ instanceId, value: e.target.checked })} />Follow a response format</label>
    <p className="text-xs text-muted-foreground">Lets apps request replies in a specific format, such as JSON.</p>
    {pending && <p role="alert" className="rounded border border-amber-500/40 bg-amber-500/10 p-3 text-sm">Applying these settings stops the current model and starts it again. Other people using it will be affected. Speed tests wait until the model is ready again.</p>}
    {changedStructured && <p className="text-sm text-muted-foreground">You changed the saved response-format choice. These settings have not been tested together.</p>}
    {selected && <p className="text-sm text-muted-foreground">{selected.entry.profile.qualification.tier === 'full-context-tested'
      ? 'Full-length conversations were tested with this many replies running at once.'
      : selected.entry.profile.qualification.tier === 'screened-startup'
        ? 'Starting the model and short conversations were tested. Full-length conversations and whether they fit in memory have not been tested.'
      : selected.entry.profile.qualification.tier === 'calculated-startup-smoke'
        ? 'Memory use was estimated for full-length conversations. Starting the model and short conversations running at once were tested. Full-length conversations have not been tested.'
        : 'Memory use has only been estimated. Starting the model, available memory and replies have not been tested. These settings may fail to start until the installed GInfer program supports them.'}</p>}
    {selected && <><p className="text-sm text-muted-foreground">These results apply to the saved settings and the GInfer version used for the tests. Changed settings or another GInfer version need their own tests.</p><details className="text-xs text-muted-foreground"><summary className="cursor-pointer">Saved settings technical details</summary><p>GInfer revision used for testing: {selected.entry.profile.qualification.engine_revision.slice(0, 8)}</p></details></>}
    {!choices.length && <p className="text-sm text-muted-foreground">{
      !snapshot.models.length ? 'No installed models were found on this computer. Add a .ginfer model file to its models folder, then refresh the model list.'
        : currentSettings ? 'No other saved settings match this model and these graphics cards. You can test the current running settings or choose another installed model.'
        : matching.length ? 'No saved settings fit this model on the selected graphics cards. Choose different cards or add matching saved settings. A running model keeps its cards; start another model to use different cards.'
          : 'No saved settings fit this model on this computer yet. Use Graphics-card setup to measure the cards, or add matching saved settings and refresh the model list. You can also choose the model settings below.'
    }</p>}
    {(!currentSettings || pending) && <Button disabled={controlsDisabled || !selected || (!!instanceId && !snapshot.instances.some(i => i.instance_id === instanceId))} onClick={async () => {
      if (!selected || controlsDisabled) return
      if (restarting && !await confirmAction({ title: 'Restart with these model settings?', message: 'The current model will finish its replies, then restart with your choices. It will be unavailable for new chats while restarting. Other people using it will be affected.', confirmLabel: 'Restart model' })) return
      void launch({ profile_id: selected.entry.profile.id, model_id: selected.entry.model_id,
        gpu_uuids: selected.group, instance_id: instanceId || null, force: false, structured_outputs: structuredOutputs,
        ...(instanceId ? { expected_session_id: snapshot.instances.find(i => i.instance_id === instanceId)?.session_id } : {}) })
    }}>{currentSettings || restarting ? 'Apply settings and restart' : 'Start model'}</Button>}
    {pending && <Button variant="outline" disabled={controlsDisabled} onClick={() => { setModelChoice(null); setGpuChoice(null); setChoice(''); setStructuredChoice(null) }}>Keep current settings</Button>}
  </div>
}

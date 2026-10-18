import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { hardwareProfileBusy, type EngineHardwareProfile as HardwareProfileStatus, type EngineHardwareProfileAction, type EngineDraftWidthCalibration } from '@/services/engines'
import type { ModelGpu } from '@/lib/model-release'

/** The Engine owns admission; this view explains its measured RAM shortfall. */
export function HardwareProfileError({ profile, label = 'Setup error details', retry = 'try again' }: {
  profile: Pick<HardwareProfileStatus, 'error' | 'host_memory_admission_failure'>
  label?: string
  retry?: string
}) {
  const failure = profile.host_memory_admission_failure
  if (!profile.error && !failure) return null
  const readableGb = (bytes: number) => `${(Math.ceil(bytes / 10_000_000) / 100).toFixed(2)} GB`
  return <div role="alert" className="space-y-2 text-sm text-destructive">
    {failure ? <>
      <p>Graphics-card setup needs more free system memory.</p>
      <p>Close apps to free at least {readableGb(failure.bytes_to_free)}, then retry. Select Continue setup to check available memory again.</p>
      <p>System-memory reserve: {readableGb(failure.reserve_bytes)}. Measurement buffers: {readableGb(failure.retained_buffer_bytes)}. Available: {readableGb(failure.available_bytes)}; required: {readableGb(failure.required_available_bytes)}.</p>
      <ul className="space-y-1">{failure.nodes.map(node => <li key={node.numa_node}>Memory node {node.numa_node}: {readableGb(node.available_bytes)} available; {readableGb(node.retained_buffer_bytes)} needed for measurement buffers. {node.bytes_to_free > 0 ? `Free at least ${readableGb(node.bytes_to_free)} on this node.` : 'Enough memory is available on this node.'}</li>)}</ul>
    </> : <p>Graphics-card setup could not finish. Check the connection, graphics driver and available memory, then {retry}.</p>}
    {profile.error && <details><summary className="cursor-pointer">{label}</summary><p className="whitespace-pre-wrap break-all">{profile.error}</p></details>}
  </div>
}

export function EngineHardwareProfile({ profile, gpus, offline, disabled, action, calibrations = [] }: {
  profile: HardwareProfileStatus; offline: boolean; disabled: boolean;
  gpus: ModelGpu[];
  calibrations?: EngineDraftWidthCalibration[];
  action: (action: EngineHardwareProfileAction, gpuUuids?: string[]) => Promise<unknown>
}) {
  const known = gpus.filter(gpu => gpu.name && gpu.compute_capability)
  const [choice, setChoice] = useState<string[] | null>(null)
  const selected = choice ?? []
  const selectedGpus = selected.map(uuid => known.find(gpu => gpu.uuid === uuid))
  const validGroup = [1, 2, 4].includes(selected.length) && selectedGpus.every(gpu => gpu &&
    gpu.name === selectedGpus[0]?.name && gpu.compute_capability === selectedGpus[0]?.compute_capability)
  const groupLabel = (group: string[]) => group.map(uuid => {
    const index = gpus.findIndex(gpu => gpu.uuid === uuid)
    return index < 0 ? 'Unavailable graphics card' : `Graphics card ${index + 1}: ${gpus[index].display_name ?? gpus[index].name}`
  }).join(' + ')
  const running = hardwareProfileBusy(profile)
  const resumable = profile.job_id !== null && profile.gpu_uuids.length > 0 && ['interrupted', 'cancelled', 'failed'].includes(profile.status)
  const end = profile.finished_unix_ms ?? (running && !offline ? Date.now() : null)
  const elapsed = profile.started_unix_ms === null || end === null ? null
    : Math.max(0, Math.floor((end - profile.started_unix_ms) / 1000))
  const blocked = disabled || offline
  const statusLabel = { idle: 'Not started', running: 'Measuring graphics cards', cancelling: 'Stopping setup', completed: 'Graphics-card settings ready', interrupted: 'Setup interrupted', cancelled: 'Setup stopped', failed: 'Setup could not finish' }[profile.status]
  const calibrationStatusLabels = { queued: 'Waiting', running: 'Tuning', cancelling: 'Stopping tuning', completed: 'Tuning finished', failed: 'Could not finish' } as const
  return <section aria-label="Graphics-card setup" className="rounded-lg border p-4 space-y-3">
    <h3 className="font-medium">Graphics-card setup</h3>
    <p className="text-sm text-muted-foreground">GInfer, the program that runs your models, measures your graphics cards and saves the results as a hardware profile. Reusing these results helps models load and switch faster. Run this setup before using your models, and measure again if your hardware changes.</p>
    <p role="status" className="text-sm">{statusLabel}{elapsed !== null && ` · ${elapsed.toLocaleString()} seconds elapsed`}{offline && ' · last reported; computer not reachable'}</p>
    {profile.gpu_uuids.length > 0 && <p className="text-sm">Graphics cards for this profile: {groupLabel(profile.gpu_uuids)}</p>}
    <details className="text-sm"><summary className="cursor-pointer">Technical details</summary><dl className="mt-2 space-y-1 break-all text-xs text-muted-foreground">
      {profile.gpu_uuids.length > 0 && <><dt>GPU identifiers</dt><dd>{profile.gpu_uuids.join(', ')}</dd></>}
      {profile.engine_path && <><dt>GInfer program</dt><dd>{profile.engine_path}</dd></>}
      {profile.profile_path && <><dt>Saved profile</dt><dd>{profile.profile_path}</dd></>}
    </dl></details>
    {profile.pending_gpu_groups.length > 0 && <div className="space-y-1 text-sm">
      <p>More groups of graphics cards are waiting for setup</p>
      <ul className="space-y-1">{profile.pending_gpu_groups.map(group => <li key={JSON.stringify([...group].sort())}>{groupLabel(group)}</li>)}</ul>
      <p className="text-muted-foreground">Stop setup stops work for all these groups. Continue setup resumes the saved work.</p>
    </div>}
    {profile.stale_groups.map(group => <section aria-label={`Graphics cards needing new settings: ${groupLabel(group.gpu_uuids)}`} className="rounded border p-3 space-y-2 text-sm" key={group.profile_path}>
      <p>Your hardware has changed. Measure these cards again. {group.expected_duration_ms === null
        ? 'Allow 10 minutes to an hour or longer, depending on your hardware.'
        : `Estimated time: ${Math.ceil(group.expected_duration_ms / 60000)} minutes.`}</p>
      <p>{groupLabel(group.gpu_uuids)}</p>
      <details><summary className="cursor-pointer">Saved profile details</summary><p className="text-xs text-muted-foreground break-all">{group.profile_path}</p></details>
      <Button variant="outline" disabled={blocked || running} onClick={() => setChoice([...group.gpu_uuids])}>Select these cards</Button>
    </section>)}
    {running && <progress aria-label="Graphics-card setup in progress" className="w-full" />}
    {profile.status !== 'completed' && <p className="text-sm text-muted-foreground">Allow 10 minutes to an hour or longer, depending on your graphics cards and chosen settings. You can close this window while setup continues. {profile.scope === 'complete_remaining_formats' ? 'Your selected model is ready to load. This optional work prepares other model types and pauses when you load a model. Stop setup keeps it stopped until you continue setup or prepare another model.' : 'Wait for setup to stop before starting a model.'}</p>}
    {profile.status === 'completed' && <p className="text-sm text-muted-foreground">Your graphics-card settings are ready. Each model still needs a memory check before starting; these settings do not guarantee that every model or conversation length will fit.</p>}
    {resumable && <p className="text-sm text-muted-foreground">{profile.checkpoint_available
      ? 'Some progress has been saved. Select Continue setup to check whether it can be reused. Measurements that no longer match your computer may need to run again.'
      : 'Select Continue setup to try again with your saved choices. GInfer checks any saved progress before reusing it.'}</p>}
    {!profile.available && !running && <p className="text-sm text-muted-foreground">Select your graphics cards below. GChat will check that the installed GInfer program can measure them.</p>}
    {calibrations.length > 0 && <section aria-label="Model speed tuning" className="space-y-2 text-sm">
      <p>Model speed tuning</p>
      <p className="text-muted-foreground">GInfer can tune how many words a model drafts ahead to improve its speed. This runs while models are stopped. Loading a model stops this tuning and uses the default settings until tuning finishes.</p>
      {calibrations.map(job => <div key={job.key}>
        <p role="status">{job.concurrency} requests at once · {job.max_context.toLocaleString()} tokens per conversation · {calibrationStatusLabels[job.status]}{offline ? ' · last reported; computer not reachable' : ''}</p>
        <p className="text-muted-foreground">{groupLabel(job.gpu_uuids)}</p>
        {job.error && <p role="alert" className="text-destructive">Speed tuning could not finish. The model can use its default settings. Check the details before trying tuning again.</p>}
        <details><summary className="cursor-pointer">Speed tuning technical details</summary><p className="break-all">Model identifier: {job.model_id}</p>{job.error && <p className="text-destructive whitespace-pre-wrap break-all">{job.error}</p>}{job.diagnostic_tail && <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all text-xs">{job.diagnostic_tail}</pre>}</details>
      </div>)}
    </section>}
    <HardwareProfileError profile={profile} />
    {profile.diagnostic_tail && <details><summary className="cursor-pointer text-sm">Setup technical log</summary><pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all text-xs">{profile.diagnostic_tail}</pre></details>}
    {!running && <fieldset disabled={blocked} className="space-y-2 text-sm">
      <legend className="font-medium">Choose graphics cards</legend>
      <p className="text-muted-foreground">GInfer supports groups of 1, 2 or 4 matching graphics cards. Each combination needs its own saved settings. Select the cards you want to use together, then select Measure graphics cards. If you have one card, select it below.</p>
      {[...new Set(known.map(gpu => gpu.compute_capability))].map(sm => <div key={sm} className="space-y-1">
        {known.filter(gpu => gpu.compute_capability === sm).map(gpu => <label className="flex items-center gap-2" key={gpu.uuid}>
          <input type="checkbox" checked={selected.includes(gpu.uuid)} disabled={!selected.includes(gpu.uuid) && !!selectedGpus[0] &&
            (gpu.name !== selectedGpus[0].name || gpu.compute_capability !== selectedGpus[0].compute_capability)}
            onChange={event => setChoice(event.target.checked ? [...selected, gpu.uuid] : selected.filter(uuid => uuid !== gpu.uuid))} />
          {groupLabel([gpu.uuid])}
        </label>)}
      </div>)}
      {selected.length > 0 && <p className="break-all">Selected cards: {groupLabel(selected)}</p>}
      {selected.length > 0 && <Button variant="outline" onClick={() => setChoice([])}>Clear card selection</Button>}
      {!known.length && <p className="text-muted-foreground">No supported graphics cards were found. Check that your NVIDIA driver is installed and your graphics card is supported.</p>}
      {!validGroup && known.length > 0 && <p className="text-muted-foreground">Select 1, 2 or 4 matching cards to continue. Cards of a different type cannot be combined.</p>}
    </fieldset>}
    <div className="flex flex-wrap gap-2">
      {profile.status === 'idle' && <Button variant="outline" disabled={blocked || !validGroup} onClick={() => void action('ensure', selected)}>Measure graphics cards</Button>}
      {profile.status !== 'idle' && !running && <Button variant="outline" disabled={blocked || !validGroup} onClick={() => void action('refresh', selected)}>Measure again</Button>}
      {resumable && <Button variant="outline" disabled={blocked} onClick={() => void action('resume')}>Continue setup</Button>}
      {running && <Button variant="outline" disabled={disabled || offline || profile.status === 'cancelling'} onClick={() => void action('cancel')}>{profile.status === 'cancelling' ? 'Stopping setup…' : profile.pending_gpu_groups.length ? 'Stop setup for all groups' : 'Stop setup'}</Button>}
    </div>
  </section>
}

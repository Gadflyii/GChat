import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { hardwareProfileBusy, type EngineHardwareProfile as HardwareProfileStatus, type EngineHardwareProfileAction, type EngineDraftWidthCalibration } from '@/services/engines'
import type { ModelGpu } from '@/lib/model-release'

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
    return index < 0 ? 'Unavailable graphics card' : `GPU ${index + 1}: ${gpus[index].display_name ?? gpus[index].name}`
  }).join(' + ')
  const running = hardwareProfileBusy(profile)
  const resumable = profile.job_id !== null && profile.gpu_uuids.length > 0 && ['interrupted', 'cancelled', 'failed'].includes(profile.status)
  const end = profile.finished_unix_ms ?? (running && !offline ? Date.now() : null)
  const elapsed = profile.started_unix_ms === null || end === null ? null
    : Math.max(0, Math.floor((end - profile.started_unix_ms) / 1000))
  const blocked = disabled || offline
  const statusLabel = { idle: 'Not started', running: 'Building profile', cancelling: 'Stopping profiling', completed: 'Profile ready', interrupted: 'Profiling interrupted', cancelled: 'Profiling cancelled', failed: 'Profiling could not finish' }[profile.status]
  return <section aria-label="Hardware profile" className="rounded-lg border p-4 space-y-3">
    <h3 className="font-medium">Hardware Profile</h3>
    <p className="text-sm text-muted-foreground">GInfer, the engine that runs your models, measures your computer’s performance and saves the results in a hardware profile. Reusing these results helps models load and switch faster. Build a profile during first setup, and rebuild it if your hardware changes.</p>
    <p role="status" className="text-sm">{statusLabel}{elapsed !== null && ` · ${elapsed.toLocaleString()} seconds elapsed`}{offline && ' · last reported, host offline'}</p>
    {profile.gpu_uuids.length > 0 && <p className="text-sm">Graphics cards for this profile: {groupLabel(profile.gpu_uuids)}</p>}
    <details className="text-sm"><summary className="cursor-pointer">Technical details</summary><dl className="mt-2 space-y-1 break-all text-xs text-muted-foreground">
      {profile.gpu_uuids.length > 0 && <><dt>GPU identifiers</dt><dd>{profile.gpu_uuids.join(', ')}</dd></>}
      {profile.engine_path && <><dt>GInfer program</dt><dd>{profile.engine_path}</dd></>}
      {profile.profile_path && <><dt>Saved profile</dt><dd>{profile.profile_path}</dd></>}
    </dl></details>
    {profile.pending_gpu_groups.length > 0 && <div className="space-y-1 text-sm">
      <p>More GPU groups waiting for a profile</p>
      <ul className="space-y-1">{profile.pending_gpu_groups.map(group => <li key={JSON.stringify([...group].sort())}>{groupLabel(group)}</li>)}</ul>
      <p className="text-muted-foreground">Cancel stops profiling for all these groups. Resume continues the saved work.</p>
    </div>}
    {profile.stale_groups.map(group => <section aria-label={`Stale GPU group ${groupLabel(group.gpu_uuids)}`} className="rounded border p-3 space-y-2 text-sm" key={group.profile_path}>
      <p>Hardware changed — rebuild this profile. {group.expected_duration_ms === null
        ? 'Allow 10 minutes to an hour or longer, depending on your hardware.'
        : `Estimated time: ${Math.ceil(group.expected_duration_ms / 60000)} minutes.`}</p>
      <p>{groupLabel(group.gpu_uuids)}</p>
      <details><summary className="cursor-pointer">Saved profile details</summary><p className="text-xs text-muted-foreground break-all">{group.profile_path}</p></details>
      <Button variant="outline" disabled={blocked || running} onClick={() => setChoice([...group.gpu_uuids])}>Select this group</Button>
    </section>)}
    {running && <progress aria-label="Hardware profiling in progress" className="w-full" />}
    <p className="text-sm text-muted-foreground">Allow 10 minutes to an hour or longer, depending on your hardware and the profile you select. You can close this window while profiling continues. {profile.scope === 'complete_remaining_formats' ? 'Your selected model is ready to load. This optional work prepares other model types and pauses when you load a model. Cancel keeps it stopped until you resume profiling or prepare another model.' : 'Wait for profiling to stop before loading a model.'}</p>
    {profile.status === 'completed' && <p className="text-sm text-muted-foreground">Your hardware profile is ready. Each model still needs a memory check before loading; this profile does not guarantee that every model or conversation length will fit.</p>}
    {resumable && <p className="text-sm text-muted-foreground">{profile.checkpoint_available
      ? 'Some progress has been saved. Select Resume profiling to check whether it can be reused and continue. Measurements that no longer match your setup may need to run again.'
      : 'Select Resume profiling to try again with your saved choices. GInfer checks any saved progress before reusing it.'}</p>}
    {!profile.available && !running && <p className="text-sm text-muted-foreground">Select your graphics cards below. GChat will check that the installed GInfer engine can build their profile.</p>}
    {calibrations.length > 0 && <section aria-label="Draft-width calibration" className="space-y-2 text-sm">
      <p>Model speed tuning</p>
      <p className="text-muted-foreground">GInfer can tune how many words a model drafts ahead to improve its speed. This runs while models are stopped. Loading a model stops this tuning and uses the default settings until tuning finishes.</p>
      {calibrations.map(job => <div key={job.key}>
        <p role="status">{job.model_id} · C{job.concurrency} · {job.max_context.toLocaleString()} tokens · {job.status}{offline ? ' · last reported, host offline' : ''}</p>
        <p className="text-muted-foreground">{groupLabel(job.gpu_uuids)}</p>
        {job.error && <p role="alert" className="text-destructive whitespace-pre-wrap break-all">{job.error}</p>}
        {job.diagnostic_tail && <details><summary className="cursor-pointer">Calibration log</summary><pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all text-xs">{job.diagnostic_tail}</pre></details>}
      </div>)}
    </section>}
    {profile.error && <p role="alert" className="text-sm text-destructive whitespace-pre-wrap break-all">{profile.error}</p>}
    {profile.diagnostic_tail && <details><summary className="cursor-pointer text-sm">Profiling log</summary><pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all text-xs">{profile.diagnostic_tail}</pre></details>}
    {!running && <fieldset disabled={blocked} className="space-y-2 text-sm">
      <legend className="font-medium">Select GPU group</legend>
      <p className="text-muted-foreground">A GPU is a graphics card. GInfer supports groups of 1, 2 or 4 matching graphics cards. Each combination needs its own profile. Select the cards you want to use together, then select Build profile. If you have one card, select it below.</p>
      {[...new Set(known.map(gpu => gpu.compute_capability))].map(sm => <div key={sm} className="space-y-1">
        {known.filter(gpu => gpu.compute_capability === sm).map(gpu => <label className="flex items-center gap-2" key={gpu.uuid}>
          <input type="checkbox" checked={selected.includes(gpu.uuid)} disabled={!selected.includes(gpu.uuid) && !!selectedGpus[0] &&
            (gpu.name !== selectedGpus[0].name || gpu.compute_capability !== selectedGpus[0].compute_capability)}
            onChange={event => setChoice(event.target.checked ? [...selected, gpu.uuid] : selected.filter(uuid => uuid !== gpu.uuid))} />
          {groupLabel([gpu.uuid])}
        </label>)}
      </div>)}
      {selected.length > 0 && <p className="break-all">Selected group: {groupLabel(selected)}</p>}
      {selected.length > 0 && <Button variant="outline" onClick={() => setChoice([])}>Clear GPU selection</Button>}
      {!known.length && <p className="text-muted-foreground">No supported graphics cards were found. Check that your NVIDIA driver is installed and your graphics card is supported.</p>}
      {!validGroup && known.length > 0 && <p className="text-muted-foreground">Select 1, 2 or 4 matching cards to continue. Cards of a different type cannot be combined.</p>}
    </fieldset>}
    <div className="flex flex-wrap gap-2">
      {profile.status === 'idle' && <Button variant="outline" disabled={blocked || !validGroup} onClick={() => void action('ensure', selected)}>Build profile</Button>}
      {profile.status !== 'idle' && !running && <Button variant="outline" disabled={blocked || !validGroup} onClick={() => void action('refresh', selected)}>Rebuild profile</Button>}
      {resumable && <Button variant="outline" disabled={blocked} onClick={() => void action('resume')}>Resume profiling</Button>}
      {running && <Button variant="outline" disabled={disabled || offline || profile.status === 'cancelling'} onClick={() => void action('cancel')}>{profile.status === 'cancelling' ? 'Cancelling profiling…' : profile.pending_gpu_groups.length ? 'Cancel profiling and queue' : 'Cancel profiling'}</Button>}
    </div>
  </section>
}

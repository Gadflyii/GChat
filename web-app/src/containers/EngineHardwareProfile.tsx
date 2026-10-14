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
    return index < 0 ? uuid : `GPU ${index + 1}: ${gpus[index].display_name ?? gpus[index].name} (${uuid})`
  }).join(' + ')
  const running = hardwareProfileBusy(profile)
  const resumable = profile.job_id !== null && profile.gpu_uuids.length > 0 && ['interrupted', 'cancelled', 'failed'].includes(profile.status)
  const end = profile.finished_unix_ms ?? (running && !offline ? Date.now() : null)
  const elapsed = profile.started_unix_ms === null || end === null ? null
    : Math.max(0, Math.floor((end - profile.started_unix_ms) / 1000))
  const blocked = disabled || offline
  return <section aria-label="Hardware profile" className="rounded-lg border p-4 space-y-3">
    <h3 className="font-medium">Hardware profile</h3>
    <p role="status" className="text-sm">{profile.status}{elapsed !== null && ` · ${elapsed.toLocaleString()} seconds elapsed`}{offline && ' · last reported, host offline'}</p>
    {profile.gpu_uuids.length > 0 && <p className="text-sm break-all">Job GPU group: {groupLabel(profile.gpu_uuids)}</p>}
    {profile.engine_path && <p className="text-xs text-muted-foreground break-all">Job Engine: {profile.engine_path}</p>}
    {profile.pending_gpu_groups.length > 0 && <div className="space-y-1 text-sm">
      <p>Pending saved deployment groups</p>
      <ul className="space-y-1">{profile.pending_gpu_groups.map(group => <li className="break-all" key={JSON.stringify([...group].sort())}>TP{group.length}: {groupLabel(group)}</li>)}</ul>
      <p className="text-muted-foreground">Cancel stops the current job and queue. Resume continues the retained work.</p>
    </div>}
    {profile.stale_groups.map(group => <section aria-label={`Stale GPU group ${groupLabel(group.gpu_uuids)}`} className="rounded border p-3 space-y-2 text-sm" key={group.profile_path}>
      <p>Hardware changed — re-profile · {group.expected_duration_ms === null
        ? 'recent full installs took 22–73 minutes; time varies by hardware'
        : `~${Math.ceil(group.expected_duration_ms / 60000)} minutes`}</p>
      <p className="break-all">TP{group.gpu_uuids.length}: {groupLabel(group.gpu_uuids)}</p>
      <p className="text-xs text-muted-foreground break-all">{group.profile_path}</p>
      <Button variant="outline" disabled={blocked || running} onClick={() => setChoice([...group.gpu_uuids])}>Select group to re-profile</Button>
    </section>)}
    {running && <progress aria-label="Hardware profiling in progress" className="w-full" />}
    <p className="text-sm text-muted-foreground">Recent full installs took 22–73 minutes; time varies by hardware. Closing this window leaves the Host job running. Model launches wait until profiling stops.</p>
    {profile.status === 'completed' && <p className="text-sm text-muted-foreground">Hardware profiling completed. This does not qualify a model or its full-context capacity.</p>}
    {resumable && <p className="text-sm text-muted-foreground">{profile.checkpoint_available
      ? 'A saved checkpoint is available. Resume validates its inputs before continuing; checkpoint presence alone does not prove compatibility.'
      : 'Resume retries the saved job inputs. The producer validates any retained progress before continuing.'}</p>}
    {!profile.available && !running && <p className="text-sm text-muted-foreground">Choose a GPU group; the Host checks that a compatible hardware profiler is installed.</p>}
    {calibrations.length > 0 && <section aria-label="Draft-width calibration" className="space-y-2 text-sm">
      <p>Draft-width calibration</p>
      <p className="text-muted-foreground">Runs when models are stopped. Starting a model cancels calibration; the engine uses its default policy until calibration completes.</p>
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
      <legend>Choose GPU group</legend>
      <p className="text-muted-foreground">Select 1, 2 or 4 GPUs of the same model and compute capability. The Host binds the profile to the selected GPU set and TP degree.</p>
      {[...new Set(known.map(gpu => gpu.compute_capability))].map(sm => <div key={sm} className="space-y-1">
        <p>SM {sm}</p>
        {known.filter(gpu => gpu.compute_capability === sm).map(gpu => <label className="flex items-center gap-2" key={gpu.uuid}>
          <input type="checkbox" checked={selected.includes(gpu.uuid)} disabled={!selected.includes(gpu.uuid) && !!selectedGpus[0] &&
            (gpu.name !== selectedGpus[0].name || gpu.compute_capability !== selectedGpus[0].compute_capability)}
            onChange={event => setChoice(event.target.checked ? [...selected, gpu.uuid] : selected.filter(uuid => uuid !== gpu.uuid))} />
          {groupLabel([gpu.uuid])}
        </label>)}
      </div>)}
      {selected.length > 0 && <p className="break-all">Selected group: {groupLabel(selected)}</p>}
      {selected.length > 0 && <Button variant="outline" onClick={() => setChoice([])}>Clear GPU selection</Button>}
      {!validGroup && <p className="text-muted-foreground">Choose an explicit homogeneous GPU group before preparing or refreshing.</p>}
    </fieldset>}
    <div className="flex flex-wrap gap-2">
      {profile.status === 'idle' && <Button variant="outline" disabled={blocked || !validGroup} onClick={() => void action('ensure', selected)}>Prepare hardware profile</Button>}
      {profile.status !== 'idle' && !running && <Button variant="outline" disabled={blocked || !validGroup} onClick={() => void action('refresh', selected)}>Refresh hardware profile</Button>}
      {resumable && <Button variant="outline" disabled={blocked} onClick={() => void action('resume')}>Resume profiling</Button>}
      {running && <Button variant="outline" disabled={disabled || offline || profile.status === 'cancelling'} onClick={() => void action('cancel')}>{profile.status === 'cancelling' ? 'Cancelling profiling…' : profile.pending_gpu_groups.length ? 'Cancel profiling and queue' : 'Cancel profiling'}</Button>}
    </div>
  </section>
}

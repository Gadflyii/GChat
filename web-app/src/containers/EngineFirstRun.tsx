import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { engineCommand, type EngineHardwareProfile } from '@/services/engines'
import { useEngineHosts } from '@/stores/engine-hosts-store'
import { formatModelBytes, type ModelDownload, type ModelRelease } from '@/lib/model-release'

type FirstRun = {
  step: 'gpu' | 'profiling' | 'storage' | 'models' | 'downloads' | 'startup' | 'complete'
  gpu_uuids: string[]
  hardware_profile: EngineHardwareProfile
  storage: { path: string; requested_path?: string | null; accepted?: boolean; available_bytes: number | null; recommended_path?: string; error?: string; candidates?: { path: string; available_bytes: number | null; eligible?: boolean; reason?: string; measured_read_bytes_per_second?: number }[] }
  models: { release_id?: string; release: ModelRelease; recommended: boolean; reason: string }[]
  selected_downloads: ModelDownload[]
  selected_release_ids?: string[]
  startup_profiles: { download_id: string; model_id: string; gpu_uuids: string[]; concurrency: number; max_context: number; kv_arena_bytes: number | null; instance_count: number; quote?: unknown; error?: string }[]
  catalog_loaded?: boolean
  error?: string | null
}

/** All progress and long-running work belongs to the shared local Host. */
export function EngineFirstRun({ hostId, onComplete }: { hostId?: string; onComplete?: () => void }) {
  const hosts = useEngineHosts(s => s.hosts)
  const snapshots = useEngineHosts(s => s.snapshots)
  const errors = useEngineHosts(s => s.errors)
  const refresh = useEngineHosts(s => s.refresh)
  const localId = hostId ?? hosts.find(host => host.local)?.host_id
  const snapshot = localId ? snapshots[localId] : undefined
  const [flow, setFlow] = useState<FirstRun>()
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [checked, setChecked] = useState(false)
  const [gpus, setGpus] = useState<string[]>([])
  const [path, setPath] = useState('')
  const [releases, setReleases] = useState<string[]>([])
  const revision = useRef(0)
  const completed = useRef(false)
  const initializedGroup = useRef<string | undefined>(undefined)
  const pathEdited = useRef(false)
  const releasesEdited = useRef(false)
  const step = flow?.step
  useEffect(() => {
    if (step === 'complete' && !completed.current) { completed.current = true; onComplete?.() }
  }, [step, onComplete])
  useEffect(() => {
    void refresh().catch(e => setError(String(e))).finally(() => setChecked(true))
  }, [refresh])
  useEffect(() => {
    if (!localId) return
    let stopped = false
    let timer: ReturnType<typeof setTimeout>
    const poll = async () => {
      const requestRevision = revision.current
      let complete = false
      try {
        const next = await engineCommand<FirstRun>('first_run', { host_id: localId })
        complete = next.step === 'complete'
        if (!stopped && requestRevision === revision.current) { setFlow(next); setError('') }
      } catch (e) { if (!stopped && requestRevision === revision.current) setError(String(e)) }
      if (!stopped && !complete) timer = setTimeout(() => void poll(), 2000)
    }
    void poll()
    return () => { stopped = true; clearTimeout(timer) }
  }, [localId])
  useEffect(() => {
    if (!flow) return
    const group = JSON.stringify(flow.gpu_uuids)
    if (initializedGroup.current !== group) {
      initializedGroup.current = group
      pathEdited.current = false
      releasesEdited.current = false
      setGpus(flow.gpu_uuids)
    }
    if (!pathEdited.current) setPath(flow.storage.requested_path || flow.storage.recommended_path || flow.storage.path)
    if (!releasesEdited.current) setReleases(flow.selected_release_ids?.length ? flow.selected_release_ids : flow.models.filter(model => model.recommended).map(model => model.release_id ?? model.release.sha256))
    // Polls update saved choices and recommendations without replacing edits.
  }, [flow])
  const act = async (args: Record<string, unknown>) => {
    if (!localId) return
    revision.current++
    setBusy(true); setError('')
    try {
      const next = await engineCommand<FirstRun>('first_run', { host_id: localId, ...args })
      setFlow(next)
      if (next.step === 'complete') await refresh().catch(() => undefined)
    } catch (e) { setError(String(e)) } finally { setBusy(false) }
  }
  if (step === 'complete') return null
  const known = snapshot?.gpus.filter(gpu => ['8.0', '8.6', '8.9', '12.0'].includes(gpu.compute_capability ?? '')) ?? []
  const selected = known.filter(gpu => gpus.includes(gpu.uuid))
  const validGroup = [1, 2, 4].includes(gpus.length) && selected.length === gpus.length && selected.every(gpu => gpu.name === selected[0].name && gpu.compute_capability === selected[0].compute_capability)
  const unavailable = error || (localId && errors[localId])
  const choosing = ['profiling', 'storage', 'models'].includes(step ?? '')
  const profiling = step === 'profiling'
  const hardware = flow?.hardware_profile
  const selectedScope = hardware?.scope === 'artifact'
  const selectedReady = selectedScope && hardware?.status === 'completed' && hardware.scope_complete === true
  const phase = hardware?.phase === 'gpu_experts' ? 'GPU expert calibration' : hardware?.phase === 'cpu_experts' ? 'CPU expert calibration' : hardware?.phase === 'publishing' ? 'Validating and saving hardware profile' : 'Hardware calibration and validation'
  const elapsed = hardware?.elapsed_ms
  const expected = hardware?.status === 'running' && (!hardware.scope || hardware.scope === 'all_formats') && hardware.duration_source === 'measured_history' ? hardware.expected_duration_ms : null
  const remaining = expected != null && elapsed != null && elapsed < expected ? expected - elapsed : null
  const overdue = expected != null && elapsed != null && elapsed >= expected
  const minutes = (ms: number) => `${Math.max(0, Math.ceil(ms / 60000))} min`
  const toggle = (values: string[], value: string) => values.includes(value) ? values.filter(v => v !== value) : [...values, value]
  return <section className="space-y-4 rounded-xl border p-5" aria-label="Set up local GInfer">
    <h2 className="font-medium">Set up local GInfer</h2>
    <p className="text-sm text-muted-foreground">Choose your GPUs, storage and models. The Host verifies each selected download before profiling it and checking startup settings. Progress is shared with GInfer Manager and the installer.</p>
    {unavailable && <p role="alert" className="text-sm text-destructive">{unavailable}</p>}
    {!localId && <p role="status" className="text-sm">{checked ? 'Local GInfer is unavailable. Check the NVIDIA GPU and installed runtime, or connect a network host below.' : 'Connecting to the local GInfer host…'}</p>}
    {localId && !flow && !unavailable && <p role="status">Reading saved setup…</p>}
    {flow?.error && <p role="alert" className="text-sm text-destructive">{flow.error}</p>}
    {step === 'gpu' && <fieldset disabled={busy} className="space-y-3"><legend className="font-medium">Choose GPU group</legend>
      <p className="text-sm">Choose 1, 2 or 4 matching GPUs. Profiling starts after your selected models have downloaded and passed verification.</p>
      {known.map(gpu => <label key={gpu.uuid} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={gpus.includes(gpu.uuid)} onChange={() => setGpus(toggle(gpus, gpu.uuid))} />{gpu.display_name ?? gpu.name} · {formatModelBytes(gpu.memory_mib * 1024 ** 2)} · {gpu.uuid}</label>)}
      {!known.length && <p role="alert">No supported NVIDIA GPUs detected. Check your GPU and CUDA 13.1 driver, or use a network host.</p>}
      <Button disabled={!validGroup} onClick={() => void act({ action: 'profile', gpu_uuids: gpus })}>Use selected GPUs</Button>
    </fieldset>}
    {selectedReady && <p role="status">Selected-model profiling is complete. Startup settings still require Engine memory checks.</p>}
    {hardware?.all_formats_complete === false && <p className="text-sm text-muted-foreground">Broader model-format coverage is deferred. It is separate from profiling and checking your selected models.</p>}
    {hardware?.all_formats_complete === true && <p className="text-sm text-muted-foreground">Hardware profiling covers all model formats.</p>}
    {profiling && <div className="space-y-3"><p role="status">{selectedScope ? 'Selected-model profiling' : 'Hardware profiling'}: {hardware?.status}</p><p className="text-sm">{phase}{elapsed != null ? ` · Last reported elapsed: ${minutes(elapsed)}` : ''}</p>
      {hardware?.phase_detail && <p className="text-sm text-muted-foreground">{hardware.phase_detail}</p>}
      <p className="text-sm text-muted-foreground">{remaining != null ? `About ${minutes(remaining)} remaining, based on a previous full profile of this GPU group; CPU resources may differ.` : overdue ? 'Profiling is taking longer than the previous full profile; completion time is unknown.' : 'Completion time is unknown for this GPU group.'} You can close this window or continue choosing storage and models; the Host keeps working.</p>
      <p className="text-sm text-muted-foreground">You can save revised choices while calibration runs. New folder checks, downloads and extraction wait until calibration finishes.</p>
      {flow?.hardware_profile.status === 'running' && <progress aria-label="Hardware profiling" />}
      {flow?.hardware_profile.error && <p role="alert">{flow.hardware_profile.error}</p>}
      {['failed', 'interrupted', 'cancelled'].includes(flow?.hardware_profile.status ?? '') && <Button disabled={busy} onClick={() => void act({ action: 'resume' })}>Resume hardware profiling</Button>}
      {flow?.hardware_profile.diagnostic_tail && <details><summary>Profiling log</summary><pre className="max-h-40 overflow-auto whitespace-pre-wrap text-xs">{flow.hardware_profile.diagnostic_tail}</pre></details>}
    </div>}
    {choosing && <div className="space-y-3"><h3 className="font-medium">Choose model storage</h3><p className="text-sm">{profiling ? 'Live disk ranking, writability and free-space checks wait for hardware profiling.' : flow?.storage.available_bytes == null ? 'Free space is unavailable for the current folder.' : `${formatModelBytes(flow.storage.available_bytes)} available in the current folder.`}</p>
      {flow?.storage.error && <p role="alert">{flow.storage.error}</p>}
      {flow?.storage.recommended_path && <p className="text-sm">Recommended: {flow.storage.recommended_path}</p>}
      <label className="block text-sm">Model download folder<Input value={path} onChange={event => { pathEdited.current = true; setPath(event.target.value) }} /></label>
      {flow?.storage.candidates?.map(candidate => <div key={candidate.path} className="text-sm"><Button variant="outline" disabled={busy || candidate.eligible === false} onClick={() => { pathEdited.current = true; setPath(candidate.path) }}>{candidate.path} · {candidate.available_bytes === null ? 'free space unavailable' : `${formatModelBytes(candidate.available_bytes)} free`}</Button>{candidate.reason && <p className="text-muted-foreground">{candidate.reason}</p>}{candidate.measured_read_bytes_per_second != null && <p className="text-muted-foreground">Measured read: {(candidate.measured_read_bytes_per_second / 1024 ** 2).toFixed(1)} MiB/s</p>}</div>)}
      {profiling && flow?.storage.requested_path && <p role="status">Saved folder choice: {flow.storage.requested_path}</p>}
      <Button disabled={busy || !path.trim()} onClick={() => void act({ action: 'storage', path })}>{profiling ? 'Save folder choice' : 'Use this folder'}</Button>
    </div>}
    {choosing && <fieldset className="space-y-3" disabled={busy}><legend className="font-medium">Choose models to download</legend>
      <p className="text-sm text-muted-foreground">Published model compatibility and available storage guide these choices. Selected-model profiling and Engine memory checks are still required before startup.</p>
      {flow?.models.map(model => { const id = model.release_id ?? model.release.sha256; return <label key={id} className="block rounded border p-3 text-sm"><span className="flex items-center gap-2"><input type="checkbox" checked={releases.includes(id)} onChange={() => { releasesEdited.current = true; setReleases(toggle(releases, id)) }} />{model.release.name} · {formatModelBytes(model.release.bytes)}{model.recommended ? ' · Recommended' : ''}</span><span className="mt-1 block text-muted-foreground">{model.reason}</span></label> })}
      {!flow?.models.length && <p role="status">{flow?.catalog_loaded === false && !flow.error ? 'Loading published model catalog…' : 'No compatible published models are available for this GPU group. Retry after checking the runtime and model catalog.'}</p>}
      {!profiling && (snapshot?.model_management?.downloads ?? []).filter(job => job.status === 'installed' && job.path && !job.path.startsWith(`${flow?.storage.path}/`) && !job.path.startsWith(`${flow?.storage.path}\\`)).map(job => <div key={job.id} className="space-y-2 rounded border p-3 text-sm"><p>{job.release.name} is stored at {job.path}. You can keep it there or move it to {flow?.storage.path}.</p><Button variant="outline" onClick={() => void act({ action: 'move', download_id: job.id })}>Move {job.release.name} to selected storage</Button></div>)}
      {profiling && !!flow?.selected_release_ids?.length && <p role="status">Model choices saved. Downloads wait for hardware profiling and validated storage.</p>}
      <Button disabled={!releases.length} onClick={() => void act({ action: 'models', release_ids: releases })}>{step === 'models' ? 'Download selected models' : 'Save model choices'}</Button>
      <Button variant="outline" onClick={() => void act({ action: 'refresh_catalog' })}>Refresh model catalog</Button>
    </fieldset>}
    {step === 'downloads' && <div className="space-y-3"><h3 className="font-medium">Downloading models</h3>{flow?.selected_downloads.map(job => <div key={job.id} className="space-y-1"><p>{job.release.name} · {job.status} · {(100 * job.received / Math.max(1, job.release.bytes)).toFixed(1)}%</p><progress className="w-full" aria-label={`${job.release.name} download`} max={job.release.bytes} value={job.received} /><p className="text-xs text-muted-foreground">{(job.bytes_per_second / 1024 ** 2).toFixed(1)} MiB/s</p>{job.error && <p role="alert">{job.error}</p>}</div>)}<p className="text-sm text-muted-foreground">Downloads continue when this window closes. Selected-model profiling begins after the downloads are verified.</p><Button variant="outline" disabled={busy} onClick={() => void act({ action: 'resume' })}>Resume downloads</Button></div>}
    {step === 'startup' && <div className="space-y-3"><h3 className="font-medium">Review startup defaults</h3>{!flow?.startup_profiles.length && <p role="status">Preparing startup settings and checking Engine memory…</p>}{flow?.startup_profiles.map(profile => <div key={profile.download_id} className="space-y-3 rounded border p-3 text-sm"><p className="font-medium">{profile.model_id}</p><p>{profile.instance_count} instance(s) · {profile.concurrency} concurrent requests · {profile.max_context.toLocaleString()} tokens · {profile.kv_arena_bytes == null ? 'Automatic GPU KV cache' : `${formatModelBytes(profile.kv_arena_bytes)} GPU KV cache`}</p>{!profile.quote && !profile.error && <p role="status">Checking these settings with the Engine…</p>}{profile.error && <p role="alert">{profile.error}</p>}
      <form className="space-y-2" onSubmit={event => { event.preventDefault(); const fields = new FormData(event.currentTarget); void act({ action: 'startup', download_id: profile.download_id, concurrency: Number(fields.get('concurrency')), max_context: Number(fields.get('max_context')), instance_count: Number(fields.get('instance_count')), kv_arena_bytes: fields.get('kv_arena_bytes') ? Number(fields.get('kv_arena_bytes')) : null }) }}>
        <label className="block">Concurrent requests<Input name="concurrency" aria-label={`${profile.model_id} concurrent requests`} type="number" min={1} max={8} required defaultValue={profile.concurrency} /></label>
        <label className="block">Context tokens<Input name="max_context" aria-label={`${profile.model_id} context tokens`} type="number" min={1} required defaultValue={profile.max_context} /></label>
        <label className="block">Instances<Input name="instance_count" aria-label={`${profile.model_id} instances`} type="number" min={1} required defaultValue={profile.instance_count} /></label>
        <label className="block">GPU KV cache bytes (blank for automatic)<Input name="kv_arena_bytes" aria-label={`${profile.model_id} GPU KV cache bytes`} type="number" min={1} defaultValue={profile.kv_arena_bytes ?? ''} /></label>
        <Button type="submit" variant="outline" disabled={busy}>Check startup settings</Button>
      </form>
    </div>)}<p className="text-sm text-muted-foreground">The Engine checks memory requirements. Models stay stopped until you launch them.</p><Button disabled={busy || !flow?.startup_profiles.length || flow.startup_profiles.some(profile => profile.error || !profile.quote)} onClick={() => void act({ action: 'complete' })}>Finish local setup</Button></div>}
    {unavailable && <Button variant="outline" disabled={busy} onClick={() => { void refresh().catch(e => setError(String(e))); if (localId) void act({}) }}>Retry local setup</Button>}
  </section>
}

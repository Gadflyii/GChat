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
  const profiling = step === 'profiling'
  const hardware = flow?.hardware_profile
  const selectedScope = hardware?.scope === 'artifact'
  const choosing = step === 'storage' || step === 'models' || (profiling && !selectedScope && !flow?.selected_downloads.length)
  const selectedReady = selectedScope && hardware?.status === 'completed' && hardware.scope_complete === true
  const phase = hardware?.phase === 'gpu_experts' ? 'Measuring graphics card performance' : hardware?.phase === 'cpu_experts' ? 'Measuring processor and memory performance' : hardware?.phase === 'publishing' ? 'Checking and saving your hardware profile' : 'Measuring and checking your hardware'
  const elapsed = hardware?.elapsed_ms
  const expected = hardware?.status === 'running' && (!hardware.scope || hardware.scope === 'all_formats') && hardware.duration_source === 'measured_history' ? hardware.expected_duration_ms : null
  const remaining = expected != null && elapsed != null && elapsed < expected ? expected - elapsed : null
  const overdue = expected != null && elapsed != null && elapsed >= expected
  const minutes = (ms: number) => `${Math.max(0, Math.ceil(ms / 60000))} min`
  const toggle = (values: string[], value: string) => values.includes(value) ? values.filter(v => v !== value) : [...values, value]
  return <section className="space-y-4 rounded-xl border p-5" aria-label="Set up local GInfer">
    <h2 className="font-medium">Set up models on this computer</h2>
    <p className="text-sm text-muted-foreground">Choose the graphics cards and model folder to use, then choose a model. GInfer, the engine that runs your models, measures this hardware and checks that each model can start. Saving this hardware profile helps future model loads and switches finish faster.</p>
    {unavailable && <p role="alert" className="text-sm text-destructive">{unavailable}</p>}
    {!localId && <p role="status" className="text-sm">{checked ? 'GInfer could not connect on this computer. Check that a supported NVIDIA graphics card and the GInfer engine are installed. You can also connect to another computer running GInfer.' : 'Connecting to GInfer on this computer…'}</p>}
    {localId && !flow && !unavailable && <p role="status">Reading saved setup…</p>}
    {flow?.error && <p role="alert" className="text-sm text-destructive">{flow.error}</p>}
    {step === 'gpu' && <fieldset disabled={busy} className="space-y-3"><legend className="font-medium">Select graphics cards</legend>
      <p className="text-sm">Select the graphics card you want GInfer to use. You can use 1, 2 or 4 cards of the same model together; each combination needs its own hardware profile. If you have one card, select it below, then select Use selected graphics cards to continue.</p>
      {known.map(gpu => <label key={gpu.uuid} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={gpus.includes(gpu.uuid)} onChange={() => setGpus(toggle(gpus, gpu.uuid))} />{gpu.display_name ?? gpu.name} · {formatModelBytes(gpu.memory_mib * 1024 ** 2)} graphics memory</label>)}
      {!!known.length && <details className="text-sm"><summary className="cursor-pointer">Graphics card details</summary>{known.map(gpu => <p key={gpu.uuid}>{gpu.display_name ?? gpu.name}: {gpu.uuid} · NVIDIA compatibility {gpu.compute_capability}</p>)}</details>}
      {!known.length && <p role="alert">No supported NVIDIA graphics cards were found. Check that your card has a compatible NVIDIA driver. You can also use GInfer on another computer.</p>}
      <Button disabled={!validGroup} onClick={() => void act({ action: 'profile', gpu_uuids: gpus })}>Use selected graphics cards</Button>
    </fieldset>}
    {selectedReady && <p role="status">Your hardware profile is ready for the selected models. GInfer will now check their startup memory needs.</p>}
    {hardware?.all_formats_complete === false && <p className="text-sm text-muted-foreground">Other model types can be measured later. They do not need to be measured before you use your selected models.</p>}
    {hardware?.all_formats_complete === true && <p className="text-sm text-muted-foreground">This hardware profile is ready for all supported model types.</p>}
    {profiling && <div className="space-y-3"><p role="status">{hardware?.status === 'running' ? 'Building your hardware profile…' : hardware?.status === 'completed' ? 'Hardware profile ready' : hardware?.status === 'failed' ? 'Hardware profile could not finish' : hardware?.status === 'cancelled' ? 'Hardware profile cancelled' : hardware?.status === 'interrupted' ? 'Hardware profile interrupted' : 'Preparing your hardware profile…'}</p><p className="text-sm">{phase}{elapsed != null ? ` · Time so far: ${minutes(elapsed)}` : ''}</p>
      <p className="text-sm text-muted-foreground">GInfer measures how quickly your graphics cards, processor and memory can run models, then saves the results. Run this at first setup and again after changing your hardware. It can take 10 minutes to an hour or longer, depending on your hardware and the profile selected.</p>
      <p className="text-sm text-muted-foreground">{remaining != null ? `About ${minutes(remaining)} remaining, based on an earlier profile for these graphics cards. The time may change if processor resources differ.` : overdue ? 'This is taking longer than the earlier profile. GInfer cannot yet estimate the time left.' : 'GInfer cannot yet estimate the time left for these graphics cards.'} {choosing ? 'You can keep choosing your model folder and models below. Closing this window leaves GInfer working in the background.' : 'Closing this window leaves GInfer working in the background.'}</p>
      <p className="text-sm text-muted-foreground">{choosing ? 'Save your choices below when ready. Folder checks and downloads will continue after this measurement finishes.' : 'Your downloaded models and saved choices are kept. GInfer is measuring the hardware needed by these models.'}</p>
      {flow?.hardware_profile.status === 'running' && <progress aria-label="Hardware profiling" />}
      {flow?.hardware_profile.error && <p role="alert">{flow.hardware_profile.error}</p>}
      {['failed', 'interrupted', 'cancelled'].includes(flow?.hardware_profile.status ?? '') && <Button disabled={busy} onClick={() => void act({ action: 'resume' })}>Resume building profile</Button>}
      <details className="text-sm"><summary className="cursor-pointer">Details</summary><p>Profile scope: {selectedScope ? 'Selected models' : 'All model types'} · Status: {hardware?.status}</p>{hardware?.phase_detail && <p className="text-muted-foreground">{hardware.phase_detail}</p>}{flow?.hardware_profile.diagnostic_tail && <pre className="max-h-40 overflow-auto whitespace-pre-wrap text-xs">{flow.hardware_profile.diagnostic_tail}</pre>}</details>
    </div>}
    {choosing && <div className="space-y-3"><h3 className="font-medium">Choose where to keep models</h3><p className="text-sm text-muted-foreground">Models can be large. Keep the recommended folder, or enter a folder on a fast drive with enough free space. Select Use this folder when ready; during profiling, select Save folder choice.</p><p className="text-sm">{profiling ? 'GInfer will check drive speed, free space and permission to save files after hardware measurement finishes.' : flow?.storage.available_bytes == null ? 'GInfer could not check free space for this folder yet.' : `${formatModelBytes(flow.storage.available_bytes)} available in the current folder.`}</p>
      {flow?.storage.error && <p role="alert">{flow.storage.error}</p>}
      {flow?.storage.recommended_path && <details className="text-sm"><summary className="cursor-pointer">Recommended folder details</summary><p>Recommended: {flow.storage.recommended_path}</p></details>}
      <label className="block text-sm">Model download folder<Input value={path} onChange={event => { pathEdited.current = true; setPath(event.target.value) }} /></label>
      {!!flow?.storage.candidates?.length && <details className="text-sm"><summary className="cursor-pointer">Choose another folder</summary>{flow.storage.candidates.map(candidate => <div key={candidate.path} className="text-sm"><Button variant="outline" disabled={busy || candidate.eligible === false} onClick={() => { pathEdited.current = true; setPath(candidate.path) }}>{candidate.path} · {candidate.available_bytes === null ? 'free space unavailable' : `${formatModelBytes(candidate.available_bytes)} free`}</Button>{candidate.reason && <p className="text-muted-foreground">{candidate.reason}</p>}{candidate.measured_read_bytes_per_second != null && <p className="text-muted-foreground">Drive read speed: {(candidate.measured_read_bytes_per_second / 1024 ** 2).toFixed(1)} MiB/s</p>}</div>)}</details>}
      {profiling && flow?.storage.requested_path && <p role="status">Saved folder choice: {flow.storage.requested_path}</p>}
      <Button disabled={busy || !path.trim()} onClick={() => void act({ action: 'storage', path })}>{profiling ? 'Save folder choice' : 'Use this folder'}</Button>
    </div>}
    {choosing && <fieldset className="space-y-3" disabled={busy}><legend className="font-medium">Choose models to download</legend>
      <p className="text-sm text-muted-foreground">Select a model below, then select Download selected models when available. Recommendations consider your graphics cards and free space. GInfer checks the downloaded files, builds the profile needed by each selected model, and checks memory before it can start.</p>
      {flow?.models.map(model => { const id = model.release_id ?? model.release.sha256; return <label key={id} className="block rounded border p-3 text-sm"><span className="flex items-center gap-2"><input type="checkbox" checked={releases.includes(id)} onChange={() => { releasesEdited.current = true; setReleases(toggle(releases, id)) }} />{model.release.name} · {formatModelBytes(model.release.bytes)}{model.recommended ? ' · Recommended' : ''}</span><span className="mt-1 block text-muted-foreground">{model.reason}</span></label> })}
      {!flow?.models.length && <p role="status">{flow?.catalog_loaded === false && !flow.error ? 'Loading published model catalog…' : 'No model downloads are available for these graphics cards. Downloads are optional: use an existing .ginfer model from Installed models, or add its folder there. If you expect a download catalog, select Refresh model catalog.'}</p>}
      {!profiling && (snapshot?.model_management?.downloads ?? []).filter(job => job.status === 'installed' && job.path && !job.path.startsWith(`${flow?.storage.path}/`) && !job.path.startsWith(`${flow?.storage.path}\\`)).map(job => <div key={job.id} className="space-y-2 rounded border p-3 text-sm"><p>{job.release.name} is already on this computer. Keep it where it is, or move it to your selected model folder.</p><details><summary className="cursor-pointer">Folder details</summary><p>Current folder: {job.path}</p><p>Selected folder: {flow?.storage.path}</p></details><Button variant="outline" onClick={() => void act({ action: 'move', download_id: job.id })}>Move {job.release.name} to selected storage</Button></div>)}
      {profiling && !!flow?.selected_release_ids?.length && <p role="status">Model choices saved. Downloads will begin after the hardware measurement and folder check finish.</p>}
      <Button disabled={!releases.length} onClick={() => void act({ action: 'models', release_ids: releases })}>{step === 'models' ? 'Download selected models' : 'Save model choices'}</Button>
      <Button variant="outline" onClick={() => void act({ action: 'refresh_catalog' })}>Refresh model catalog</Button>
    </fieldset>}
    {step === 'downloads' && <div className="space-y-3"><h3 className="font-medium">Downloading models</h3>{flow?.selected_downloads.map(job => <div key={job.id} className="space-y-1"><p>{job.release.name} · {job.status} · {(100 * job.received / Math.max(1, job.release.bytes)).toFixed(1)}%</p><progress className="w-full" aria-label={`${job.release.name} download`} max={job.release.bytes} value={job.received} /><p className="text-xs text-muted-foreground">{(job.bytes_per_second / 1024 ** 2).toFixed(1)} MiB/s</p>{job.error && <p role="alert">{job.error}</p>}</div>)}<p className="text-sm text-muted-foreground">You can close this window while downloads continue. GInfer checks the downloaded files, then measures the hardware needed by your selected models.</p><Button variant="outline" disabled={busy} onClick={() => void act({ action: 'resume' })}>Resume downloads</Button></div>}
    {step === 'startup' && <div className="space-y-3"><h3 className="font-medium">Review model startup settings</h3><p className="text-sm text-muted-foreground">The recommended settings are filled in for you. Wait for the memory check, then select Finish local setup. Open Advanced settings only if you want to change how much conversation a model remembers or how many requests it can answer together.</p>{!flow?.startup_profiles.length && <p role="status">Preparing settings and checking that each model has enough memory…</p>}{flow?.startup_profiles.map(profile => <div key={profile.download_id} className="space-y-3 rounded border p-3 text-sm"><p className="font-medium">{profile.model_id}</p>{!profile.quote && !profile.error && <p role="status">Checking that this model has enough memory to start…</p>}{profile.quote != null && !profile.error && <p role="status">Ready to start with these settings.</p>}{profile.error && <p role="alert">{profile.error}</p>}<details><summary className="cursor-pointer">Advanced settings and memory details</summary><p>{profile.instance_count} instance(s) · {profile.concurrency} concurrent requests · {profile.max_context.toLocaleString()} tokens · {profile.kv_arena_bytes == null ? 'Automatic GPU KV cache' : `${formatModelBytes(profile.kv_arena_bytes)} GPU KV cache`}</p>
      <form className="space-y-2" onSubmit={event => { event.preventDefault(); const fields = new FormData(event.currentTarget); void act({ action: 'startup', download_id: profile.download_id, concurrency: Number(fields.get('concurrency')), max_context: Number(fields.get('max_context')), instance_count: Number(fields.get('instance_count')), kv_arena_bytes: fields.get('kv_arena_bytes') ? Number(fields.get('kv_arena_bytes')) : null }) }}>
        <p>Simultaneous requests controls how many messages this model can answer at once. A larger value uses more memory.</p><label className="block">Simultaneous requests<Input name="concurrency" aria-label={`${profile.model_id} concurrent requests`} type="number" min={1} max={8} required defaultValue={profile.concurrency} /></label>
        <p>Conversation limit is the amount of text the model can remember, measured in tokens (small pieces of text). Larger limits need more memory.</p><label className="block">Conversation limit (tokens)<Input name="max_context" aria-label={`${profile.model_id} context tokens`} type="number" min={1} required defaultValue={profile.max_context} /></label>
        <p>Model copies lets you run more than one copy at once. Keep one unless you need to serve several users.</p><label className="block">Model copies<Input name="instance_count" aria-label={`${profile.model_id} instances`} type="number" min={1} required defaultValue={profile.instance_count} /></label>
        <p>Conversation memory on the graphics card (KV cache) is chosen automatically. Leave this blank unless you need an exact memory budget.</p><label className="block">Conversation memory in bytes (blank for automatic)<Input name="kv_arena_bytes" aria-label={`${profile.model_id} GPU KV cache bytes`} type="number" min={1} defaultValue={profile.kv_arena_bytes ?? ''} /></label>
        <Button type="submit" variant="outline" disabled={busy}>Check startup settings</Button>
      </form></details>
    </div>)}<p className="text-sm text-muted-foreground">GInfer checks that these settings fit in memory. Finish setup when all checks pass, then load a model when you are ready to chat.</p><Button disabled={busy || !flow?.startup_profiles.length || flow.startup_profiles.some(profile => profile.error || !profile.quote)} onClick={() => void act({ action: 'complete' })}>Finish local setup</Button></div>}
    {unavailable && <Button variant="outline" disabled={busy} onClick={() => { void refresh().catch(e => setError(String(e))); if (localId) void act({}) }}>Retry local setup</Button>}
  </section>
}

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { Link } from '@tanstack/react-router'
import { route } from '@/constants/routes'
import { Input } from '@/components/ui/input'
import { HardwareProfileError } from './EngineHardwareProfile'
import { engineCommand, type EngineHardwareProfile } from '@/services/engines'
import { useEngineHosts } from '@/stores/engine-hosts-store'
import { useBundledResources } from '@/hooks/useBundledResources'
import { plainModelName, plainStartupModelName, gpuCardName } from '@/lib/engine-host-labels'
import { diskSpaceWarning, downloadStatusLabel, formatModelBytes, releaseVerified, type ModelDownload, type ModelRelease } from '@/lib/model-release'

type FirstRun = {
  step: 'gpu' | 'profiling' | 'storage' | 'models' | 'downloads' | 'storage_review' | 'startup' | 'complete'
  gpu_uuids: string[]
  hardware_profile: EngineHardwareProfile
  storage: { path: string; requested_path?: string | null; accepted?: boolean; available_bytes: number | null; recommended_path?: string; required_bytes?: number; review_key?: string | null; selected_models?: { download_id: string; name: string; path: string; bytes: number }[]; error?: string; candidates?: { path: string; available_bytes: number | null; required_bytes?: number; eligible?: boolean; reason?: string; measured_read_bytes_per_second?: number }[] }
  models: { release_id?: string; release: ModelRelease; recommended: boolean; reason: string }[]
  selected_downloads: ModelDownload[]
  selected_release_ids?: string[] | null
  startup_profiles: { download_id: string; model_id: string; gpu_uuids: string[]; concurrency: number; max_context: number; kv_arena_bytes: number | null; instance_count: number; quote?: unknown; error?: string }[]
  catalog_loaded?: boolean
  error?: string | null
  maintenance_error?: string | null
}

type StartupProfile = FirstRun['startup_profiles'][number]
type StartupDraft = { concurrency: string; max_context: string; instance_count: string; kv_arena_bytes: string }

const startupDraft = (profile: StartupProfile): StartupDraft => ({
  concurrency: String(profile.concurrency),
  max_context: String(profile.max_context),
  instance_count: String(profile.instance_count),
  kv_arena_bytes: profile.kv_arena_bytes == null ? '' : String(profile.kv_arena_bytes),
})

const startupSettingsMatch = (profile: StartupProfile, draft: StartupDraft) =>
  Number(draft.concurrency) === profile.concurrency &&
  Number(draft.max_context) === profile.max_context &&
  Number(draft.instance_count) === profile.instance_count &&
  (draft.kv_arena_bytes ? Number(draft.kv_arena_bytes) : null) === profile.kv_arena_bytes

/** All progress and long-running work belongs to the shared local Host. */
/** Allow the local Host to connect after bundled resource preparation finishes. */
const LOCAL_HOST_START_GRACE_MS = 30_000

function FirstRunError({ message, details, label }: { message: string; details: string; label: string }) {
  return <div role="alert" className="space-y-2 text-sm text-destructive">
    <p>{message}</p>
    <details><summary className="cursor-pointer">{label}</summary><p className="whitespace-pre-wrap break-all">{details}</p></details>
  </div>
}

type EngineFirstRunProps = {
  hostId?: string; onComplete?: () => void; hardwareProfileControls?: ReactNode
}

export function EngineFirstRun(props: EngineFirstRunProps) {
  const hosts = useEngineHosts(s => s.hosts)
  const localId = props.hostId ?? hosts.find(host => host.local)?.host_id
  // Welcome can discover a replacement local Host without unmounting its setup
  // screen. Drafts and pending commands belong to the selected Host alone.
  return <HostFirstRun key={localId} {...props} hostId={localId} />
}

function HostFirstRun({ hostId: localId, onComplete, hardwareProfileControls }: EngineFirstRunProps) {
  const snapshots = useEngineHosts(s => s.snapshots)
  const errors = useEngineHosts(s => s.errors)
  const refresh = useEngineHosts(s => s.refresh)
  const resources = useBundledResources()
  const resourcesReady = resources.ready === true && !resources.error
  const snapshot = localId ? snapshots[localId] : undefined
  const [flow, setFlow] = useState<FirstRun>()
  const [error, setError] = useState('')
  const [pollError, setPollError] = useState('')
  const [acceptedDownloadAction, setAcceptedDownloadAction] = useState<'pause' | 'discard' | null>(null)
  const [busy, setBusy] = useState(false)
  const [checked, setChecked] = useState(false)
  const [manualOpen, setManualOpen] = useState(false)
  const [gpus, setGpus] = useState<string[]>([])
  const [path, setPath] = useState('')
  const [releases, setReleases] = useState<string[]>([])
  const [startupDrafts, setStartupDrafts] = useState<Record<string, StartupDraft>>({})
  // A check can finish after another edit. Keep each model's draft separate
  // from Host responses and compare it with the settings their quote covers.
  const displayedStartup = (profile: StartupProfile) => startupDrafts[profile.download_id] ?? startupDraft(profile)
  const startupChanged = (profile: StartupProfile) => !startupSettingsMatch(profile, displayedStartup(profile))
  const editStartup = (profile: StartupProfile, field: keyof StartupDraft, value: string) => {
    setStartupDrafts(drafts => ({
      ...drafts,
      [profile.download_id]: { ...(drafts[profile.download_id] ?? startupDraft(profile)), [field]: value },
    }))
  }
  const revision = useRef(0)
  const active = useRef(true)
  const pendingAction = useRef(false)
  useEffect(() => {
    active.current = true
    return () => { active.current = false }
  }, [])
  const completed = useRef(false)
  const initializedGroup = useRef<string | undefined>(undefined)
  const pathEdited = useRef(false)
  const previousStorageStep = useRef<string | undefined>(undefined)
  const releasesEdited = useRef(false)
  const step = flow?.step
  const card = useRef<HTMLElement>(null)
  // A step finishing can change the card far below the visible area, so bring
  // the card back into view; the new step or saved choice is then on screen.
  const showCard = () => card.current?.scrollIntoView?.({ block: 'start', behavior: 'smooth' })
  const shownStep = useRef<string | undefined>(undefined)
  useEffect(() => {
    if (step && shownStep.current && shownStep.current !== step) showCard()
    shownStep.current = step
  }, [step])
  const neededBytes = (flow?.models ?? []).filter(m => releases.includes(m.release_id ?? m.release.sha256)).reduce((sum, m) => sum + m.release.bytes, 0)
  const spaceWarning = diskSpaceWarning(neededBytes, flow?.storage.available_bytes)
  useEffect(() => {
    if (step === 'complete' && !completed.current) { completed.current = true; onComplete?.() }
  }, [step, onComplete])
  useEffect(() => {
    // Installation has its own retained status. A connection grace period can
    // only begin after that work has actually finished.
    setChecked(false)
    if (!resourcesReady) return
    let stopped = false
    let grace: ReturnType<typeof setTimeout> | undefined
    const requestRevision = revision.current
    void refresh().catch(e => {
      // A newer setup command owns the feedback even if discovery finishes last.
      if (!stopped && !pendingAction.current && requestRevision === revision.current) setPollError(String(e))
    }).finally(() => {
      if (!stopped) grace = setTimeout(() => setChecked(true), LOCAL_HOST_START_GRACE_MS)
    })
    return () => { stopped = true; clearTimeout(grace) }
  }, [refresh, resourcesReady])
  useEffect(() => {
    if (!localId) return
    let stopped = false
    let timer: ReturnType<typeof setTimeout>
    const poll = async () => {
      const requestRevision = revision.current
      let complete = false
      try {
        const next = await engineCommand<FirstRun>('first_run', { host_id: localId })
        // Reading status again does not mean a rejected user action succeeded.
        // Only an accepted read can end polling. Reads made during a command
        // may describe its old state even if they finish after its response.
        if (!stopped && !pendingAction.current && requestRevision === revision.current) {
          complete = next.step === 'complete'
          setFlow(next); setPollError('')
          setAcceptedDownloadAction(null)
        }
      } catch (e) { if (!stopped && !pendingAction.current && requestRevision === revision.current) setPollError(String(e)) }
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
    if (flow.step === 'storage_review' && previousStorageStep.current !== 'storage_review') pathEdited.current = false
    previousStorageStep.current = flow.step
    if (!pathEdited.current) setPath(flow.storage.requested_path || (flow.step === 'storage_review' ? flow.storage.path || flow.storage.recommended_path : flow.storage.recommended_path || flow.storage.path) || '')
    if (!releasesEdited.current) setReleases(flow.selected_release_ids ?? flow.models.filter(model => model.recommended && releaseVerified(model.release)).map(model => model.release_id ?? model.release.sha256))
    // Polls update saved choices and recommendations without replacing edits.
  }, [flow])
  const act = async (args: Record<string, unknown>) => {
    if (!localId || pendingAction.current || (args.action && acceptedDownloadAction)) return
    revision.current++
    pendingAction.current = true
    setBusy(true); setError('')
    try {
      const next = await engineCommand<FirstRun>('first_run', { host_id: localId, ...args })
      if (!active.current) return
      setFlow(next)
      setPollError('')
      setAcceptedDownloadAction(null)
      if (next.step === 'complete') await refresh().catch(() => undefined)
      else if (args.action) requestAnimationFrame(showCard)
    } catch (e) {
      if (active.current) {
        if (args.action) setError(String(e))
        else setPollError(String(e))
      }
    } finally {
      revision.current++
      pendingAction.current = false
      if (active.current) setBusy(false)
    }
  }
  const profileAction = async (action: 'cancel' | 'resume') => {
    if (!localId || pendingAction.current) return
    revision.current++
    pendingAction.current = true
    setBusy(true); setError('')
    try {
      const hardware = await engineCommand<EngineHardwareProfile>('hardware_profile', { host_id: localId, body: { action } })
      if (!active.current) return
      setFlow(current => current ? { ...current, hardware_profile: hardware } : current)
      setPollError('')
      await refresh().catch(() => undefined)
    } catch (e) { if (active.current) setError(String(e)) } finally {
      revision.current++
      pendingAction.current = false
      if (active.current) setBusy(false)
    }
  }
  const downloadAction = async (id: string, action: 'pause' | 'discard') => {
    if (!localId || pendingAction.current || acceptedDownloadAction) return
    revision.current++
    pendingAction.current = true
    setBusy(true); setError('')
    try {
      await engineCommand('download_action', { host_id: localId, body: { id, action } })
      if (!active.current) return
      // The Host accepted the mutation, but did not return a new job state.
      // Keep its receipt until a current read confirms which controls apply.
      setAcceptedDownloadAction(action)
      setPollError('')
      try {
        const next = await engineCommand<FirstRun>('first_run', { host_id: localId })
        if (!active.current) return
        setFlow(next)
        setPollError('')
        setAcceptedDownloadAction(null)
      } catch (e) { if (active.current) setPollError(String(e)) }
    } catch (e) { if (active.current) setError(String(e)) } finally {
      revision.current++
      pendingAction.current = false
      if (active.current) setBusy(false)
    }
  }
  if (step === 'complete') return <>{hardwareProfileControls}</>
  const known = snapshot?.gpus.filter(gpu => ['8.0', '8.6', '8.9', '12.0'].includes(gpu.compute_capability ?? '')) ?? []
  const selected = known.filter(gpu => gpus.includes(gpu.uuid))
  const validGroup = [1, 2, 4].includes(gpus.length) && selected.length === gpus.length && selected.every(gpu => gpu.name === selected[0].name && gpu.compute_capability === selected[0].compute_capability)
  const unavailable = error || pollError || (localId && errors[localId])
  const offered = (flow?.models ?? []).filter(model => releaseVerified(model.release))
  const profiling = step === 'profiling'
  const hardware = flow?.hardware_profile
  const selectedScope = hardware?.scope === 'artifact'
  const choosing = step === 'storage' || step === 'models' || (profiling && !selectedScope && !flow?.selected_downloads.length)
  const savedReleases = flow?.selected_release_ids ?? []
  const modelChoicesChanged = releases.length !== savedReleases.length || releases.some(id => !savedReleases.includes(id))
  const clearingSavedChoices = !releases.length && (savedReleases.length > 0 || (flow?.selected_release_ids == null && releasesEdited.current))
  const modelChoiceAction = clearingSavedChoices ? 'Clear saved model choices' : step === 'models' ? 'Download selected models' : 'Save model choices'
  const selectedReady = selectedScope && hardware?.status === 'completed' && hardware.scope_complete === true
  const storageRoot = flow?.storage.path ?? ''
  const savedStoragePath = flow?.storage.requested_path || storageRoot
  const isInStorage = (modelPath: string) => {
    const root = storageRoot.replace(/[/\\]+$/, '')
    return modelPath === root || modelPath.startsWith(`${root}/`) || modelPath.startsWith(`${root}\\`)
  }
  const phase = hardware?.phase === 'gpu_experts' ? 'Measuring graphics card performance' : hardware?.phase === 'cpu_experts' ? 'Measuring processor and memory performance' : hardware?.phase === 'publishing' ? 'Checking and saving graphics-card settings' : 'Measuring and checking your hardware'
  const elapsed = hardware?.elapsed_ms
  const expected = hardware?.status === 'running' && (!hardware.scope || hardware.scope === 'all_formats') && hardware.duration_source === 'measured_history' ? hardware.expected_duration_ms : null
  const remaining = expected != null && elapsed != null && elapsed < expected ? expected - elapsed : null
  const overdue = expected != null && elapsed != null && elapsed >= expected
  const minutes = (ms: number) => `${Math.max(0, Math.ceil(ms / 60000))} min`
  const toggle = (values: string[], value: string) => values.includes(value) ? values.filter(v => v !== value) : [...values, value]
  return <section ref={card} className="scroll-mt-4 space-y-4 rounded-xl border p-5" aria-label="Set up local GInfer">
    <h2 className="font-medium">Set up models on this computer</h2>
    <p className="text-sm text-muted-foreground">Choose the graphics cards and model folder to use, then choose a model. GInfer, the engine that runs your models, measures this hardware and checks that each model can start. Saving these measurements helps future model loads and switches finish faster.</p>
    {resources.error && <FirstRunError message="Could not prepare GInfer to run models on this computer. Restart GChat to try again. If this keeps happening, reinstall GChat." details={resources.error} label="GInfer preparation error details" />}
    {acceptedDownloadAction && <p role="status" className="text-sm">{acceptedDownloadAction === 'pause' ? 'Pause request accepted.' : 'Discard request accepted.'} Checking the current download status…</p>}
    {unavailable && <FirstRunError message={error ? 'GChat could not finish this setup action. Select Retry local setup to check the current status before trying the action again.' : acceptedDownloadAction ? 'GChat could not read the current download status. Select Retry local setup to check again.' : 'GChat could not read or update setup on this computer. Check that GInfer is running, then select Retry local setup.'} details={unavailable} label={error ? 'Setup action error details' : 'Connection error details'} />}
    {!localId && !resources.error && <p role="status" className="text-sm">{!resourcesReady ? 'Preparing GInfer to run models on this computer… GChat is installing and checking its bundled files. This may take a few minutes.' : checked ? 'GInfer could not connect on this computer. Check that a supported NVIDIA graphics card and the GInfer engine are installed. You can also connect to another computer running GInfer.' : 'Starting GInfer on this computer…'}</p>}
    {localId && !flow && !unavailable && <p role="status">Reading saved setup…</p>}
    {flow?.maintenance_error && <div className="space-y-2"><p role="alert" className="text-sm text-destructive">Setup could not continue. {flow.maintenance_error} Your saved folder and model choices are kept.</p><Button variant="outline" disabled={busy || !!acceptedDownloadAction} onClick={() => void act({ action: 'resume' })}>Retry setup</Button></div>}
    {flow?.error && <FirstRunError message="Setup could not finish this step. Check the details below, then try the step again. Your saved folder and model choices are kept." details={flow.error} label="Setup error details" />}
    {step === 'gpu' && !manualOpen && <fieldset disabled={busy} className="space-y-3"><legend className="font-medium">Select graphics cards</legend>
      <p className="text-sm">Select the graphics card you want GInfer to use. You can use 1, 2 or 4 cards of the same model together; each combination needs its own saved settings. If you have one card, select it below, then select Use selected graphics cards to continue.</p>
      {known.map(gpu => <label key={gpu.uuid} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={gpus.includes(gpu.uuid)} onChange={() => setGpus(toggle(gpus, gpu.uuid))} />{gpu.display_name ?? gpu.name} · {formatModelBytes(gpu.memory_mib * 1024 ** 2)} graphics memory</label>)}
      {!!known.length && <details className="text-sm"><summary className="cursor-pointer">Graphics card details</summary>{known.map((gpu, i) => <p key={gpu.uuid}>{gpuCardName(known, i)} · NVIDIA compatibility {gpu.compute_capability}</p>)}</details>}
      {!known.length && (snapshot?.cpu?.isa_path
        ? <p role="status">No supported NVIDIA graphics card was found, so GChat runs models on this computer’s processor (CPU) and system memory. Open <Link to={route.hub.index} className="underline">Models</Link>, select Add local model to choose a .ginfer file, then select Load model.</p>
        : <p role="alert">No supported NVIDIA graphics cards were found. Check that your card has a compatible NVIDIA driver. You can also use GInfer on another computer.</p>)}
      <Button disabled={!validGroup} onClick={() => void act({ action: 'profile', gpu_uuids: gpus })}>Use selected graphics cards</Button>
    </fieldset>}
    {selectedReady && <p role="status">Your graphics-card settings are ready for the selected models. {step === 'storage_review' ? 'Review where to keep them before GInfer checks their startup memory needs.' : 'GInfer will now check their startup memory needs.'}</p>}
    {hardware?.all_formats_complete === false && <p className="text-sm text-muted-foreground">Other model types can be measured later. They do not need to be measured before you use your selected models.</p>}
    {hardware?.all_formats_complete === true && <p className="text-sm text-muted-foreground">These graphics-card settings are ready for all supported model types.</p>}
    {profiling && !manualOpen && <div className="space-y-3"><p role="status">{hardware?.status === 'running' ? 'Measuring graphics cards…' : hardware?.status === 'cancelling' ? 'Stopping graphics-card setup…' : hardware?.status === 'completed' ? 'Graphics-card settings ready' : hardware?.status === 'failed' ? 'Graphics-card setup could not finish' : hardware?.status === 'cancelled' ? 'Graphics-card setup stopped' : hardware?.status === 'interrupted' ? 'Graphics-card setup interrupted' : 'Preparing graphics-card setup…'}</p><p className="text-sm">{phase}{elapsed != null ? ` · Time so far: ${minutes(elapsed)}` : ''}</p>
      <p className="text-sm text-muted-foreground">GInfer measures how quickly your graphics cards, processor and memory can run models, then saves the results. Run this at first setup and again after changing your hardware. It can take 10 minutes to an hour or longer, depending on your hardware and the settings selected.</p>
      <p className="text-sm text-muted-foreground">{remaining != null ? `About ${minutes(remaining)} remaining, based on earlier measurements for these graphics cards. The time may change if processor resources differ.` : overdue ? 'This is taking longer than the earlier measurement. GInfer cannot yet estimate the time left.' : 'GInfer cannot yet estimate the time left for these graphics cards.'} {choosing ? 'You can keep choosing your model folder and models below. Closing this window leaves GInfer working in the background.' : 'Closing this window leaves GInfer working in the background.'}</p>
      <p className="text-sm text-muted-foreground">{choosing ? 'Save your choices below when ready. Folder checks and downloads will continue after this measurement finishes.' : 'Your downloaded models and saved choices are kept. GInfer is measuring the hardware needed by these models.'}</p>
      {(hardware?.status === 'running' || hardware?.status === 'cancelling') && <div className="space-y-3"><progress aria-label="Graphics-card setup in progress" className="block h-2 w-full accent-primary" /><Button variant="outline" disabled={busy || !!(localId && errors[localId]) || hardware.status === 'cancelling'} onClick={() => void profileAction('cancel')}>{hardware.status === 'cancelling' ? 'Stopping setup…' : hardware.pending_gpu_groups?.length ? 'Stop setup for all groups' : 'Stop setup'}</Button></div>}
      {hardware && <HardwareProfileError profile={hardware} label="Graphics-card setup error details" retry="select Continue setup" />}
      {['failed', 'interrupted', 'cancelled'].includes(hardware?.status ?? '') && <><p className="text-sm text-muted-foreground">Your model downloads and choices are kept. GInfer checks saved measurements before reusing them.</p><Button disabled={busy || !!(localId && errors[localId])} onClick={() => void (selectedScope ? act({ action: 'resume' }) : profileAction('resume'))}>Continue setup</Button></>}
      <details className="text-sm"><summary className="cursor-pointer">Graphics-card setup technical details</summary><p>Measurements for: {selectedScope ? 'Selected models' : 'All model types'} · Status: {hardware?.status}</p>{hardware?.phase_detail && <p className="text-muted-foreground">{hardware.phase_detail}</p>}{flow?.hardware_profile.diagnostic_tail && <pre className="max-h-40 overflow-auto whitespace-pre-wrap text-xs">{flow.hardware_profile.diagnostic_tail}</pre>}</details>
    </div>}
    {choosing && <div className="space-y-3"><h3 className="font-medium">Choose where to keep models</h3><p className="text-sm text-muted-foreground">Models can be large. Keep the recommended folder, or enter a folder on a fast drive with enough free space. {profiling ? 'Select Save folder choice when ready.' : 'Select Use this folder when ready.'}</p><p className="text-sm">{profiling ? 'GInfer will check drive speed, free space and permission to save files after hardware measurement finishes.' : flow?.storage.available_bytes == null ? 'GInfer could not check free space for this folder yet.' : `${formatModelBytes(flow.storage.available_bytes)} available in the current folder.`}</p>
      {flow?.storage.error && <FirstRunError message="GInfer could not finish checking this model folder. Check free space and permission to save files, or choose another folder, then try again." details={flow.storage.error} label="Folder error details" />}
      {flow?.storage.recommended_path && <details className="text-sm"><summary className="cursor-pointer">Recommended folder details</summary><p>Recommended: {flow.storage.recommended_path}</p></details>}
      <label className="block text-sm">Model download folder<Input value={path} onChange={event => { pathEdited.current = true; setPath(event.target.value) }} /></label>
      {!!flow?.storage.candidates?.length && <details className="text-sm"><summary className="cursor-pointer">Choose another folder</summary>{flow.storage.candidates.map(candidate => <div key={candidate.path} className="text-sm"><Button variant="outline" disabled={busy || candidate.eligible === false} onClick={() => { pathEdited.current = true; setPath(candidate.path) }}>{candidate.path} · {candidate.available_bytes === null ? 'free space unavailable' : `${formatModelBytes(candidate.available_bytes)} free`}</Button>{candidate.reason && <p className="text-muted-foreground">{candidate.reason}</p>}{candidate.measured_read_bytes_per_second != null && <p className="text-muted-foreground">Drive read speed: {(candidate.measured_read_bytes_per_second / 1024 ** 2).toFixed(1)} MiB/s</p>}</div>)}</details>}
      {profiling && flow?.storage.requested_path && <p role="status">Saved folder choice: {flow.storage.requested_path}</p>}
      <Button disabled={busy || !path.trim()} onClick={() => void act({ action: 'storage', path })}>{profiling ? 'Save folder choice' : 'Use this folder'}</Button>
    </div>}
    {choosing && <fieldset className="space-y-3" disabled={busy}><legend className="font-medium">Choose models to download</legend>
      <p className="text-sm text-muted-foreground">{clearingSavedChoices ? 'To leave no models queued, select Clear saved model choices.' : `Select a model below, then select ${modelChoiceAction}.`} {profiling ? 'Downloads start after the hardware measurement finishes. ' : ''}Recommendations consider your graphics cards and free space. GInfer checks the downloaded files, measures the hardware needed by each selected model, and checks memory before it can start.</p>
      {offered.map(model => { const id = model.release_id ?? model.release.sha256; return <label key={id} className="block rounded border p-3 text-sm"><span className="flex items-center gap-2"><input type="checkbox" checked={releases.includes(id)} onChange={() => { releasesEdited.current = true; setReleases(toggle(releases, id)) }} />{plainModelName(model.release.name)} · {formatModelBytes(model.release.bytes)}{model.recommended ? ' · Recommended' : ''}</span><span className="mt-1 block text-muted-foreground">{model.reason}</span></label> })}
      {!offered.length && <p role="status">{flow?.catalog_loaded === false && !flow.error ? 'Loading published model catalog…' : 'No model downloads are available for these graphics cards. Downloads are optional: open Models > This computer > Installed and select Add local model to choose an existing .ginfer file. If you expect a download catalog, select Refresh model catalog.'}</p>}
      {!profiling && (snapshot?.model_management?.downloads ?? []).filter(job => job.status === 'installed' && job.path && !job.path.startsWith(`${flow?.storage.path}/`) && !job.path.startsWith(`${flow?.storage.path}\\`)).map(job => <div key={job.id} className="space-y-2 rounded border p-3 text-sm"><p>{plainModelName(job.release.name)} is already on this computer. Keep it where it is, or move it to your selected model folder.</p><details><summary className="cursor-pointer">Folder details</summary><p>Current folder: {job.path}</p><p>Selected folder: {flow?.storage.path}</p></details><Button variant="outline" onClick={() => void act({ action: 'move', download_id: job.id })}>Move {plainModelName(job.release.name)} to selected folder</Button></div>)}
      {profiling && !!savedReleases.length && <p role="status">{modelChoicesChanged ? `Your model choices have changed. Select ${modelChoiceAction} to update the queued downloads.` : 'Model choices saved. Downloads will begin after the hardware measurement and folder check finish.'}</p>}
      {profiling && !savedReleases.length && <p role="status">No models are queued for download. Choose models when you are ready.</p>}
      {spaceWarning && <p role="alert" className="text-sm text-destructive">{spaceWarning.text}</p>}
      <div className="flex flex-wrap gap-2">
        <Button disabled={(!releases.length && !clearingSavedChoices) || spaceWarning?.block} onClick={() => void act({ action: 'models', release_ids: releases })}>{modelChoiceAction}</Button>
        <Button variant="outline" onClick={() => void act({ action: 'refresh_catalog' })}>Refresh model catalog</Button>
      </div>
    </fieldset>}
    {step === 'downloads' && <div className="space-y-3"><h3 className="font-medium">Downloading models</h3>{flow?.selected_downloads.map(job => <div key={job.id} className="space-y-1"><p>{plainModelName(job.release.name)} · {downloadStatusLabel(job.status)} · {(100 * job.received / Math.max(1, job.release.bytes)).toFixed(1)}%</p><progress className="w-full" aria-label={`${plainModelName(job.release.name)} download`} max={job.release.bytes} value={job.received} /><p className="text-xs text-muted-foreground">{(job.bytes_per_second / 1024 ** 2).toFixed(1)} MiB/s</p>{job.status === 'failed' && job.error && <FirstRunError message="This model download could not finish. Check your internet connection and free space, then select Try again or Choose a different model." details={job.error} label={`${plainModelName(job.release.name)} download error details`} />}
      {['queued', 'downloading'].includes(job.status) && <div className="space-y-1"><Button variant="outline" disabled={busy || !!acceptedDownloadAction} onClick={() => void downloadAction(job.id, 'pause')}>Pause download</Button><p className="text-sm text-muted-foreground">Pausing keeps the partial file so you can resume later.</p></div>}
      {['paused', 'failed'].includes(job.status) && <div className="space-y-1"><Button variant="outline" disabled={busy || !!acceptedDownloadAction} onClick={() => void downloadAction(job.id, 'discard')}>Discard download</Button><p className="text-sm text-muted-foreground">Discarding removes the partial file. You will need to start this download again.</p></div>}
    </div>)}<p className="text-sm text-muted-foreground">You can close this window while downloads continue. GInfer checks the downloaded files, then measures the hardware needed by your selected models.</p>{flow?.selected_downloads.some(job => job.status === 'failed')
      ? <div className="space-y-2"><p className="text-sm">The download could not finish. You can try again or choose a different model.</p><div className="flex gap-2"><Button disabled={busy || !!acceptedDownloadAction} onClick={() => void act({ action: 'resume' })}>Try again</Button><Button variant="outline" disabled={busy || !!acceptedDownloadAction} onClick={() => void act({ action: 'reselect' })}>Choose a different model</Button></div></div>
      : <Button variant="outline" disabled={busy || !!acceptedDownloadAction} onClick={() => void act({ action: 'resume' })}>Resume downloads</Button>}</div>}
    {step === 'storage_review' && <div className="space-y-3"><h3 className="font-medium">Review model locations</h3>
      <p className="text-sm text-muted-foreground">These models are downloaded and their graphics-card settings are ready. Review their current locations and the measured drive speeds before continuing.</p>
      {flow?.storage.required_bytes != null && <p className="text-sm">Selected models: {formatModelBytes(flow.storage.required_bytes)} total.</p>}
      {flow?.storage.selected_models?.map(model => <div key={model.download_id} className="space-y-2 rounded border p-3 text-sm"><p className="font-medium">{model.name} · {formatModelBytes(model.bytes)}</p><p className="break-all">Current location: {model.path}</p>{!isInStorage(model.path) && <Button variant="outline" disabled={busy} onClick={() => void act({ action: 'move', download_id: model.download_id })}>Move {model.name} to selected storage</Button>}</div>)}
      <p className="break-all text-sm">Selected download folder: {storageRoot}</p>
      <p className="text-sm text-muted-foreground">Choosing another folder saves a destination for downloads. Existing models stay at the locations shown until you select Move for each model.</p>
      {flow?.storage.recommended_path && <p className="break-all text-sm">Recommended: {flow.storage.recommended_path}</p>}
      {flow?.storage.error && <FirstRunError message="GInfer could not finish checking this model folder. Check the details or choose another folder." details={flow.storage.error} label="Folder error details" />}
      {flow?.storage.candidates?.map(candidate => <div key={candidate.path} className="space-y-1 text-sm"><Button variant="outline" disabled={busy || candidate.eligible === false} onClick={() => { pathEdited.current = true; setPath(candidate.path) }}>{candidate.path} · {candidate.available_bytes == null ? 'free space unavailable' : `${formatModelBytes(candidate.available_bytes)} free`}</Button><p className="text-muted-foreground">{candidate.eligible ? 'Eligible' : 'Unavailable'}{candidate.measured_read_bytes_per_second != null ? ` · Measured read: ${(candidate.measured_read_bytes_per_second / 1024 ** 2).toFixed(1)} MiB/s` : ' · Read speed unavailable'}{candidate.required_bytes != null ? ` · Additional space needed: ${formatModelBytes(candidate.required_bytes)}` : ''}</p>{candidate.reason && <p className="text-muted-foreground">{candidate.reason}</p>}</div>)}
      <label className="block text-sm">Model download folder<Input value={path} onChange={event => { pathEdited.current = true; setPath(event.target.value) }} /></label>
      <Button variant="outline" disabled={busy || !path.trim()} onClick={() => void act({ action: 'storage', path })}>Use this folder</Button>
      {path.trim() !== savedStoragePath.trim() && <p className="text-sm">Select Use this folder to save the changed destination before continuing.</p>}
      <Button disabled={busy || !flow?.storage.review_key || path.trim() !== savedStoragePath.trim()} onClick={() => void act({ action: 'accept_storage', review_key: flow?.storage.review_key })}>Keep these locations and continue</Button>
    </div>}
    {step === 'startup' && <div className="space-y-3"><h3 className="font-medium">Review model startup settings</h3><p className="text-sm text-muted-foreground">The recommended settings are filled in for you. Wait for the memory check, then select Finish local setup. Open Advanced settings only if you want to change how much conversation a model remembers or how many requests it can answer together.</p>{!flow?.startup_profiles.length && <p role="status">Preparing settings and checking that each model has enough memory…</p>}{flow?.startup_profiles.map(profile => <div key={profile.download_id} className="space-y-3 rounded border p-3 text-sm"><p className="font-medium">{plainStartupModelName(profile.model_id)}</p>{startupChanged(profile) && <p role="status">Settings changed. Select Check startup settings before finishing setup.</p>}{!startupChanged(profile) && !profile.quote && !profile.error && <p role="status">Checking that this model has enough memory to start…</p>}{!startupChanged(profile) && profile.quote != null && !profile.error && <p role="status">Ready to start with these settings.</p>}{profile.error && <FirstRunError message="GInfer could not confirm that this model can start. Check the details and Advanced settings, then select Check startup settings. A shorter conversation limit or fewer simultaneous requests may help if memory is short." details={profile.error} label={`${plainStartupModelName(profile.model_id)} startup error details`} />}<details><summary className="cursor-pointer">Advanced settings and memory details</summary><p>Saved settings: {profile.instance_count} model copies · {profile.concurrency} replies at once · {profile.max_context.toLocaleString()} context tokens · {profile.kv_arena_bytes == null ? 'Automatic GPU K/V cache' : `${formatModelBytes(profile.kv_arena_bytes)} GPU K/V cache`}</p>
      <form className="space-y-2" onSubmit={event => { event.preventDefault(); const fields = new FormData(event.currentTarget); void act({ action: 'startup', download_id: profile.download_id, concurrency: Number(fields.get('concurrency')), max_context: Number(fields.get('max_context')), instance_count: Number(fields.get('instance_count')), kv_arena_bytes: fields.get('kv_arena_bytes') ? Number(fields.get('kv_arena_bytes')) : null }) }}>
        <p>Simultaneous requests controls how many messages this model can answer at once. A larger value uses more memory.</p><label className="block">Simultaneous requests<Input name="concurrency" aria-label={`${plainStartupModelName(profile.model_id)} simultaneous requests`} type="number" min={1} max={8} required value={displayedStartup(profile).concurrency} onChange={event => editStartup(profile, 'concurrency', event.target.value)} /></label>
        <p>Conversation limit is the amount of text the model can remember, measured in tokens (small pieces of text). Larger limits need more memory.</p><label className="block">Conversation limit (tokens)<Input name="max_context" aria-label={`${plainStartupModelName(profile.model_id)} conversation limit in tokens`} type="number" min={1} required value={displayedStartup(profile).max_context} onChange={event => editStartup(profile, 'max_context', event.target.value)} /></label>
        <p>Model copies lets you run more than one copy at once. Keep one unless you need to serve several users.</p><label className="block">Model copies<Input name="instance_count" aria-label={`${plainStartupModelName(profile.model_id)} model copies`} type="number" min={1} required value={displayedStartup(profile).instance_count} onChange={event => editStartup(profile, 'instance_count', event.target.value)} /></label>
        <p>GPU K/V cache is chosen automatically. Leave this blank unless you need an exact memory budget.</p><label className="block">K/V cache in bytes (blank for automatic)<Input name="kv_arena_bytes" aria-label={`${plainStartupModelName(profile.model_id)} GPU K/V cache in bytes`} type="number" min={1} value={displayedStartup(profile).kv_arena_bytes} onChange={event => editStartup(profile, 'kv_arena_bytes', event.target.value)} /></label>
        <Button type="submit" variant="outline" disabled={busy}>Check startup settings</Button>
      </form></details>
    </div>)}<p className="text-sm text-muted-foreground">GInfer checks that these settings fit in memory. Finish setup when all checks pass, then load a model when you are ready to chat.</p><Button disabled={busy || !flow?.startup_profiles.length || flow.startup_profiles.some(profile => profile.error || !profile.quote || startupChanged(profile))} onClick={() => void act({ action: 'complete' })}>Finish local setup</Button></div>}
    {unavailable && <Button variant="outline" disabled={busy} onClick={() => {
      const requestRevision = revision.current
      void refresh().catch(e => {
        if (active.current && !pendingAction.current && requestRevision === revision.current) setPollError(String(e))
      })
      if (localId) void act({})
    }}>Retry local setup</Button>}
    {hardwareProfileControls && <details open={manualOpen} onToggle={event => setManualOpen(event.currentTarget.open)} className="space-y-3">
      <summary className="cursor-pointer font-medium">Advanced graphics-card setup options</summary>
      <p className="text-sm text-muted-foreground">Measure graphics cards again or continue unfinished setup without downloading a model. Your folder and model choices are kept. Close these options to return to guided setup.</p>
      <div hidden={!manualOpen}>{hardwareProfileControls}</div>
    </details>}
  </section>
}

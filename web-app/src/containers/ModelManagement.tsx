import { useEffect, useMemo, useRef, useState } from 'react'
import { IconChevronDown } from '@tabler/icons-react'
import { toast } from 'sonner'
import HeaderPage from '@/containers/HeaderPage'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { DeleteModelAction } from '@/containers/hub/DeleteModelAction'
import { useHardware } from '@/hooks/useHardware'
import { useBundledResources } from '@/hooks/useBundledResources'
import { useModelProvider } from '@/hooks/useModelProvider'
import { useServiceHub } from '@/hooks/useServiceHub'
import { useEngineHosts } from '@/stores/engine-hosts-store'
import { useModelCatalogStore } from '@/stores/model-catalog-store'
import { useLocalModelDownloads } from '@/stores/local-model-downloads-store'
import { engineCommand, type LocalModelLoadProgress } from '@/services/engines'
import { HostCard } from '@/containers/EngineHostModels'
import { formatModelBytes, releaseReadiness, type ModelDownload, type ModelGpu, type ModelRelease } from '@/lib/model-release'
import { switchToModel } from '@/utils/switchModel'
import { useAppState } from '@/hooks/useAppState'
import { syncActiveModelsFromEngines } from '@/utils/activeModelsSync'

type PendingLocalLoad = {
  operationId: string
  controller: AbortController
  startedAt: number
  ready: boolean
  settled: boolean
  cancelRequested: boolean
}

const loadPhaseLabels: Record<LocalModelLoadProgress['phase'], string> = {
  preparing: 'Preparing installed model',
  verification: 'Verifying installed model',
  profiling: 'Profiling installed model',
  starting: 'Starting installed model',
}

function cancelLocalLoad(load: PendingLocalLoad): Promise<unknown> {
  if (load.ready || load.settled || load.cancelRequested) return Promise.resolve()
  load.cancelRequested = true
  load.controller.abort()
  return engineCommand('local_model_load_cancel', { operation_id: load.operationId })
}

export function ModelManagement({ initialQuery = '' }: { initialQuery?: string }) {
  const service = useServiceHub()
  const hosts = useEngineHosts(s => s.hosts)
  const snapshots = useEngineHosts(s => s.snapshots)
  const hostErrors = useEngineHosts(s => s.errors)
  const refreshHosts = useEngineHosts(s => s.refresh)
  const hardware = useHardware(s => s.hardwareData)
  const hardwareReady = useHardware(s => s.hardwareReady)
  const selectedGpuUuids = useHardware(s => s.selectedGpuUuids)
  const setSelectedGpuUuids = useHardware(s => s.setSelectedGpuUuids)
  const providers = useModelProvider(s => s.providers)
  const activeModels = useAppState(s => s.activeModels)
  const catalog = useModelCatalogStore(s => s.catalog)
  const catalogError = useModelCatalogStore(s => s.error)
  const refreshCatalog = useModelCatalogStore(s => s.refresh)
  const [destination, setDestination] = useState('local')
  const [tab, setTab] = useState<'Installed' | 'Recommended' | 'Downloads'>('Installed')
  const [query, setQuery] = useState(initialQuery)
  const [showUnavailable, setShowUnavailable] = useState(false)
  const localDownloads = useLocalModelDownloads(s => s.jobs)
  const localDownloadError = useLocalModelDownloads(s => s.error)
  const refreshLocal = useLocalModelDownloads(s => s.refresh)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const mounted = useRef(true)
  const loadRef = useRef<PendingLocalLoad | null>(null)
  const [pendingLoad, setPendingLoad] = useState<PendingLocalLoad | null>(null)
  const [loadProgress, setLoadProgress] = useState<LocalModelLoadProgress | null>(null)
  const [loadStatusUnavailable, setLoadStatusUnavailable] = useState(false)
  const [loadElapsedSeconds, setLoadElapsedSeconds] = useState(0)
  const [cancellingLoad, setCancellingLoad] = useState(false)
  const [cancelError, setCancelError] = useState(false)
  const local = destination === 'local'
  const resources = useBundledResources(local)
  const localLoadReady = resources.ready === true && !resources.error
  const host = hosts.find(h => h.host_id === destination)
  const snapshot = snapshots[destination]
  const offline = !local && (!snapshot || !!hostErrors[destination])
  const gpus: ModelGpu[] = useMemo(() => local ? (hardwareReady ? hardware.gpus : []).map(g => ({
    uuid: g.uuid, name: g.name, memory_mib: g.total_memory, compute_capability: g.nvidia_info?.compute_capability,
  })) : snapshot?.gpus ?? [], [local, hardwareReady, hardware.gpus, snapshot?.gpus])
  const invalidGpuSelection = !hardwareReady || (selectedGpuUuids !== null &&
    (!selectedGpuUuids.length || selectedGpuUuids.some(id => !gpus.some(g => g.uuid === id))))
  const downloads = local ? localDownloads : snapshot?.model_management?.downloads ?? []
  const managementAvailable = local || snapshot?.model_management?.version === 1
  const localModels = providers.find(p => p.provider === 'ginfer')?.models ?? []
  const filteredModels = localModels.filter(m => (m.displayName ?? m.id).toLowerCase().includes(query.toLowerCase()))
  const releases = useMemo(() => catalog.filter(m => m.library_name === 'ginfer').flatMap(m =>
    (m.releases?.length ? m.releases : [undefined]).map(release => ({
      name: release?.name ?? m.name ?? m.model_name, release,
      readiness: releaseReadiness(release, gpus),
    }))), [catalog, gpus])

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      if (loadRef.current) void cancelLocalLoad(loadRef.current).catch(() => {})
    }
  }, [])
  useEffect(() => {
    if (!pendingLoad) return
    let stopped = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const poll = async () => {
      try {
        const progress = await engineCommand<LocalModelLoadProgress | null>('local_model_load_status', {
          operation_id: pendingLoad.operationId,
        })
        if (stopped) return
        // A status from another load must never change this route's ownership.
        if (progress?.operation_id === pendingLoad.operationId) {
          pendingLoad.ready ||= progress.status === 'ready'
          setLoadProgress(progress)
          setLoadStatusUnavailable(false)
        }
      } catch {
        if (!stopped) setLoadStatusUnavailable(true)
      }
      if (!stopped) timer = setTimeout(() => { void poll() }, 1000)
    }
    void poll()
    const elapsedTimer = setInterval(() => {
      setLoadElapsedSeconds(Math.floor((performance.now() - pendingLoad.startedAt) / 1000))
    }, 1000)
    return () => {
      stopped = true
      clearTimeout(timer)
      clearInterval(elapsedTimer)
    }
  }, [pendingLoad])

  useEffect(() => {
    if (local) void refreshLocal().catch(e => setError(String(e)))
  }, [local, refreshLocal])
  useEffect(() => { void refreshHosts().catch(e => setError(String(e))) }, [refreshHosts])

  const act = async (operation: () => Promise<unknown>) => {
    setBusy(true)
    try { await operation(); if (mounted.current) { await (local ? refreshLocal() : refreshHosts()); setError(null) } }
    catch (e) {
      const cancelled = typeof e === 'object' && e !== null && 'name' in e && e.name === 'AbortError'
      if (mounted.current && !cancelled) setError(String(e))
    }
    finally { if (mounted.current) setBusy(false) }
  }
  const rescan = async () => {
    if (!local) return engineCommand('scan', { host_id: destination })
    const report = await engineCommand<{ rejected: { filename: string; reason: string }[] }>('local_model_adopt')
    useModelProvider.getState().setProviders(await service.providers().getProviders())
    if (report.rejected.length) throw new Error(report.rejected.map(r => `${r.filename}: ${r.reason}`).join('\n'))
  }
  const download = (release: ModelRelease) => act(async () => {
    const job = await engineCommand<ModelDownload>(local ? 'local_model_download' : 'download', { host_id: destination, body: release })
    if (local) useLocalModelDownloads.getState().acknowledge(job)
    setTab('Downloads')
  })
  const transferAction = (job: ModelDownload, action: string) => act(() =>
    engineCommand(local ? 'local_model_download_action' : 'download_action', local ?
      { id: job.id, operation: action } : { host_id: destination, body: { id: job.id, action } }))
  const loadLocal = (modelId: string) => act(async () => {
    if (invalidGpuSelection) throw new Error('Choose available GPUs before loading this model.')
    const active = await service.models().getActiveModels('ginfer')
    if (!mounted.current) return
    if (active.some(id => id !== modelId) && !window.confirm('Switch the local model? This may interrupt chats and agent runs using the current model.')) return
    const load: PendingLocalLoad = { operationId: crypto.randomUUID(), controller: new AbortController(),
      startedAt: performance.now(), ready: false, settled: false, cancelRequested: false }
    loadRef.current = load
    setPendingLoad(load)
    setLoadProgress(null)
    setLoadElapsedSeconds(0)
    setLoadStatusUnavailable(false)
    setCancellingLoad(false)
    setCancelError(false)
    useModelProvider.getState().selectModelProvider('ginfer', modelId)
    try {
      await switchToModel({ modelId, providerName: 'ginfer', serviceHub: service,
        options: { useProfileDefaults: true, loadOperationId: load.operationId },
        signal: load.controller.signal,
        ...(selectedGpuUuids === null ? {} : { gpuUuids: [...selectedGpuUuids] }) })
      load.ready = true
    } finally {
      load.settled = true
      if (loadRef.current === load) loadRef.current = null
      if (mounted.current) setPendingLoad(null)
    }
  })
  const cancelPendingLoad = async () => {
    if (!pendingLoad || pendingLoad.ready || pendingLoad.settled) return
    setCancellingLoad(true)
    setCancelError(false)
    try { await cancelLocalLoad(pendingLoad) }
    catch {
      pendingLoad.cancelRequested = false
      if (mounted.current) { setCancellingLoad(false); setCancelError(true) }
    }
  }
  const stopLocal = (modelId: string) => act(async () => {
    const result = await service.models().stopModel(modelId, 'ginfer')
    if (!result?.success) throw new Error(result?.error ?? 'The engine did not confirm that this model stopped.')
    syncActiveModelsFromEngines(await service.models().getActiveModels())
  })
  const totalInstalled = local ? localDownloads.filter(j => j.status === 'installed').reduce((n, j) => n + j.release.bytes, 0)
    : snapshot?.models.reduce((n, m) => n + m.metadata.size_bytes, 0) ?? 0
  const partialBytes = downloads.filter(j => j.status !== 'installed').reduce((n, j) => n + j.received, 0)

  return <div className="flex h-full flex-col">
    <HeaderPage><div className="flex w-full flex-wrap items-center justify-between gap-3"><h1>Models</h1>
      <div className="flex items-center gap-2 text-sm">Host
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button aria-label="Model destination" disabled={busy} variant="outline" className="max-w-64 justify-between bg-background text-foreground">
              <span className="truncate">{local ? 'This computer' : `${host?.name ?? 'Choose a host'}${hostErrors[destination] ? ' (offline)' : ''}`}</span>
              <IconChevronDown size={14} />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuRadioGroup value={destination} onValueChange={id => { setDestination(id); setError(null) }}>
              <DropdownMenuRadioItem value="local">This computer</DropdownMenuRadioItem>
              {hosts.map(h => <DropdownMenuRadioItem key={h.host_id} value={h.host_id}>{h.name}{hostErrors[h.host_id] ? ' (offline)' : ''}</DropdownMenuRadioItem>)}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </div></div></HeaderPage>
    <main className="space-y-5 overflow-y-auto p-5">
      <div className="flex flex-wrap gap-2">{gpus.map(g => <span key={g.uuid} className="rounded border px-3 py-1 text-sm">{g.name} · {(g.memory_mib / 1024).toFixed(0)} GiB · {g.compute_capability ? `SM ${g.compute_capability}` : 'SM unknown'}</span>)}</div>
      <p className="text-sm text-muted-foreground">{local ? 'Manage models on this computer.' : `Downloads and model operations run on ${host?.name ?? 'the selected host'}, not this computer.`} GPU memory is evaluated per device, never added together.</p>
      <div className="flex flex-wrap items-center justify-between gap-3"><div className="flex gap-1" role="tablist" aria-label="Model management">
        {(['Installed', 'Recommended', 'Downloads'] as const).map(t => <Button key={t} role="tab" aria-selected={tab === t} variant={tab === t ? 'default' : 'ghost'} onClick={() => setTab(t)}>{t}</Button>)}
      </div><Button variant="outline" disabled={busy || (offline && tab !== 'Recommended')} onClick={() => void act(tab === 'Recommended' ? refreshCatalog : rescan)}>{tab === 'Recommended' ? 'Refresh recommendations' : 'Refresh installed models'}</Button></div>
      {(error || (offline && hostErrors[destination])) && <p role="alert" className="rounded border border-destructive/40 p-3 text-sm text-destructive">{error ?? hostErrors[destination]} · Saved inventory may be out of date.</p>}
      {local && !localLoadReady && (resources.error
        ? <p role="alert" className="rounded border border-destructive/40 p-3 text-sm text-destructive">Local model runtime is unavailable: {resources.error}</p>
        : <p role="status" className="rounded border p-3 text-sm">Preparing local model runtime…</p>)}
      {pendingLoad && <div role="status" className="space-y-2 rounded border p-3 text-sm">
        <p className="font-medium">{cancellingLoad ? 'Cancelling installed model load' : loadProgress?.status === 'ready' ? 'Model ready; finishing startup' : loadPhaseLabels[loadProgress?.phase ?? 'preparing']}</p>
        {loadProgress?.detail && <p>{loadProgress.detail}</p>}
        <p>Load request elapsed: {loadElapsedSeconds}s</p>
        {typeof loadProgress?.completed_bytes === 'number' && typeof loadProgress.total_bytes === 'number' && loadProgress.total_bytes > 0 && <>
          <progress aria-label="Installed model verification" className="h-2 w-full accent-primary" max={loadProgress.total_bytes} value={loadProgress.completed_bytes} />
          <p>{formatModelBytes(loadProgress.completed_bytes)} / {formatModelBytes(loadProgress.total_bytes)}</p>
        </>}
        {loadStatusUnavailable && <p>Startup status is temporarily unavailable. The load request is still running.</p>}
        {cancelError && <p>Cancellation could not be confirmed. Try Cancel load again.</p>}
        <Button variant="outline" disabled={cancellingLoad || pendingLoad.ready} onClick={() => void cancelPendingLoad()}>Cancel load</Button>
      </div>}
      {local && localDownloadError && <p role="alert" className="text-sm text-destructive">{localDownloadError}</p>}
      {(tab === 'Recommended' || (tab === 'Installed' && local)) && <Input aria-label="Search models" placeholder="Find a model…" value={query} onChange={e => setQuery(e.target.value)} />}
      {tab === 'Installed' && <>
        {local && <fieldset disabled={busy} className="space-y-2 rounded border p-3"><legend>GPUs for Load model</legend>
          <label className="flex items-center gap-2"><input type="checkbox" checked={selectedGpuUuids === null} onChange={e => setSelectedGpuUuids(e.target.checked ? null : [])} />Automatic (visible GPUs only)</label>
          {gpus.map(g => <label key={g.uuid} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={selectedGpuUuids?.includes(g.uuid) ?? false} onChange={e => setSelectedGpuUuids(e.target.checked ? [...(selectedGpuUuids ?? []), g.uuid] : (selectedGpuUuids ?? []).filter(id => id !== g.uuid))} />{g.name} · {g.uuid}</label>)}
          <p className="text-sm text-muted-foreground">Select the GPUs required by the model's TP size. CUDA_VISIBLE_DEVICES is also enforced when loading.</p>
          {invalidGpuSelection && <p role="alert">{hardwareReady ? 'Choose available GPUs. A saved GPU may no longer be connected.' : 'Waiting for fresh GPU information.'}</p>}
        </fieldset>}
        {local ? <>{!filteredModels.length && <div className="rounded-xl border p-8 text-center"><p>No installed models found.</p><Button className="mt-3" onClick={() => setTab('Recommended')}>Find a recommended model</Button></div>}
          {filteredModels.map(m => <section key={m.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border p-4"><div><h2 className="font-medium">{m.displayName ?? m.id}</h2><p className="text-sm text-muted-foreground">{activeModels.includes(m.id) ? 'Running' : 'Installed'} · {m.capabilities?.join(' · ') || 'GInfer model'}. Load uses the Host launch profile for the selected GPUs. Use Engines for custom settings.</p></div><div className="flex gap-2"><Button disabled={busy || !localLoadReady || invalidGpuSelection || activeModels.includes(m.id)} onClick={() => void loadLocal(m.id)}>Load model</Button><Button variant="outline" disabled={busy || !activeModels.includes(m.id)} onClick={() => void stopLocal(m.id)}>Stop</Button><DeleteModelAction modelId={m.id} provider="ginfer" /></div></section>)}</>
          : host ? <HostCard key={host.host_id} host={host} snapshot={snapshot} error={hostErrors[destination]} /> : <p>Select a paired host in GInfer Hosts.</p>}
        {!local && snapshot?.model_management && <details><summary className="cursor-pointer text-sm">Managed storage and removal</summary><p className="my-2 text-sm text-muted-foreground">External model roots are read-only. Stop instances before removing a managed package.</p>{snapshot.models.filter(m => downloads.some(j => j.status === 'installed' && j.path === m.path)).map(m => <div key={m.id} className="flex items-center justify-between gap-3 border-b py-2"><span>{m.metadata.identity.model_id} · {formatModelBytes(m.metadata.size_bytes)}</span><Button variant="outline" disabled={busy || offline} onClick={() => { if (window.confirm(`Remove ${m.metadata.identity.model_id} from ${host?.name}? The package will need downloading again.`)) void act(() => engineCommand('remove_model', { host_id: destination, body: { model_id: m.id } })) }}>Remove package</Button></div>)}</details>}
      </>}
      {tab === 'Recommended' && <>
        {catalogError && <p role="alert" className="text-sm text-destructive">Release catalog: {catalogError}. Showing the last available catalog.</p>}
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={showUnavailable} onChange={e => setShowUnavailable(e.target.checked)} />Show unavailable models and explanations</label>
        {!releases.some(r => r.readiness.available) && <div className="rounded-xl border p-5"><h2 className="font-medium">No published recommendation for this hardware yet</h2><p className="mt-1 text-sm text-muted-foreground">Compatible releases must include verified SM, per-GPU VRAM, TP, size and checksum metadata. Smol models will appear when published. You can use installed models or select another host.</p></div>}
        {releases.filter(r => (showUnavailable || r.readiness.available) && r.name.toLowerCase().includes(query.toLowerCase())).map((r, i) => <section key={r.release?.sha256 ?? `${r.name}-${i}`} className="space-y-3 rounded-xl border p-5"><h2 className="font-medium">{r.name}</h2><p className="text-sm text-muted-foreground">{r.readiness.reason}</p>{r.release && <p className="font-mono text-xs">{formatModelBytes(r.release.bytes)} · TP{r.release.tp} · {r.release.capabilities.join(' · ')}</p>}
          <p className="text-sm text-muted-foreground">Configuration comes from the engine; no VRAM-to-context table is maintained in GChat.</p>
          <Button disabled={!r.readiness.available || offline || busy || !managementAvailable} onClick={() => r.release && void download(r.release)}>Download to {local ? 'this computer' : host?.name}</Button>
        </section>)}
        {!managementAvailable && <p role="alert">Update ginfer-host to enable managed downloads on this host.</p>}
      </>}
      {tab === 'Downloads' && <>
        <p className="text-sm text-muted-foreground">{formatModelBytes(partialBytes)} incomplete · {formatModelBytes(totalInstalled)} {local ? 'downloaded through this manager' : 'installed'}. One active download per host keeps disk and memory use bounded.</p>
        {!downloads.length && <p className="rounded-xl border p-6 text-center text-muted-foreground">No downloads on this host.</p>}
        {downloads.map(job => <section key={job.id} className="space-y-2 rounded-xl border p-4"><div className="flex flex-wrap justify-between gap-2"><h2 className="font-medium">{job.release.name}</h2><span className="font-mono text-xs">{job.status}</span></div><progress aria-label={`${job.release.name} download`} className="h-2 w-full accent-primary" max={job.release.bytes} value={job.received} /><p className="font-mono text-xs tabular-nums">{formatModelBytes(job.received)} / {formatModelBytes(job.release.bytes)}{job.bytes_per_second > 0 ? ` · ${(job.bytes_per_second / 1024 ** 2).toFixed(1)} MiB/s · ~${Math.ceil((job.release.bytes - job.received) / job.bytes_per_second)}s remaining` : ''}</p>
          {job.error && <p role="alert" className="text-sm text-destructive">{job.error}</p>}<div className="flex gap-2">
            {['queued', 'downloading'].includes(job.status) && <Button variant="outline" disabled={busy || offline} onClick={() => void transferAction(job, 'pause')}>Pause</Button>}
            {['paused', 'failed'].includes(job.status) && <><Button disabled={busy || offline} onClick={() => void transferAction(job, 'resume')}>Resume / retry</Button><Button variant="outline" disabled={busy || offline} onClick={() => { if (window.confirm('Remove this incomplete download? Installed models are untouched.')) void transferAction(job, 'discard') }}>Remove incomplete files</Button></>}
            {job.status === 'installed' && <Button disabled={busy || offline} onClick={() => void act(async () => { await rescan(); setTab('Installed'); toast.success('Package ready in Installed models') })}>Show installed model</Button>}
          </div></section>)}
      </>}
    </main>
  </div>
}

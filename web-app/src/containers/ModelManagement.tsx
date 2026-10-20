import { ModelCustomSettings, type CustomStart } from './ModelCustomSettings'
import { useEffect, useMemo, useRef, useState } from 'react'
import { confirmAction } from '@/lib/confirm'
import { IconChevronDown } from '@tabler/icons-react'
import { toast } from 'sonner'
import { joinPath } from '@gchat/core'
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
import { CPU_PROBLEM_CODES as CPU_CODES, engineAlias, engineCommand, engineErrorParts, type DevicePreference, type EngineModel, type EngineSnapshot, type LocalModelLoadProgress } from '@/services/engines'
import { controlLocalHostModel } from '@/utils/localHostModel'
import { HostCard } from '@/containers/EngineHostModels'
import { gpuCardName, hostModelLabel, plainModelName } from '@/lib/engine-host-labels'
import { downloadFailureRecovery, downloadStatusLabel, formatModelBytes, releaseReadiness, type ModelDownload, type ModelGpu, type ModelRelease } from '@/lib/model-release'
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
  preparing: 'Getting the model ready',
  verification: 'Checking the model file',
  profiling: 'Finding settings for your graphics cards',
  starting: 'Loading the model into memory',
}

const managementTabs = ['Installed', 'Recommended', 'Downloads'] as const
export type ModelManagementTab = (typeof managementTabs)[number]

const REGISTERED_MODEL_REFRESH_FAILED = 'The model was added, but the model list could not be refreshed. Choose Refresh installed models to try again.'
const ACCEPTED_DOWNLOAD_REFRESH_FAILED = 'The download request was accepted, but its status could not be refreshed. Choose Refresh downloads to check its current state.'
const STOPPED_MODEL_REFRESH_FAILED = 'The model stopped, but the running model list could not be refreshed. Choose Refresh model status before loading or stopping another model.'
const deviceHelp = 'Device: where the model runs. GPU uses NVIDIA graphics cards. CPU uses the processor and system memory (RAM); it needs no graphics card but answers more slowly. Automatic uses a graphics card when this computer has one the model can use.'
const capabilityLabels = (capabilities: string[] = []) => capabilities.flatMap(capability => {
  switch (capability.toLowerCase()) {
    case 'text': return ['Text chat']
    case 'vision': return ['Images and video']
    case 'tools': return ['Tool use']
    case 'embedding': return ['Text search']
    default: return []
  }
}).join(' · ')
const errorMessage = (e: unknown) => e instanceof Error ? e.message : String(e).replace(/^Error: /, '')

function ModelProblem({ message, detail }: { message: string; detail?: string | null }) {
  return <div role="alert" className="space-y-2 rounded border border-destructive/40 p-3 text-sm text-destructive">
    <p>{message}</p>
    {detail && <details className="text-muted-foreground"><summary className="cursor-pointer">Technical details</summary><p className="mt-2 whitespace-pre-wrap break-words">{detail}</p></details>}
  </div>
}

function cancelLocalLoad(load: PendingLocalLoad): Promise<unknown> {
  if (load.ready || load.settled || load.cancelRequested) return Promise.resolve()
  load.cancelRequested = true
  load.controller.abort()
  return engineCommand('local_model_load_cancel', { operation_id: load.operationId })
}

export function ModelManagement({ initialQuery = '', tab, onTabChange: setTab }: {
  initialQuery?: string
  tab: ModelManagementTab
  onTabChange: (tab: ModelManagementTab) => void
}) {
  const service = useServiceHub()
  const hosts = useEngineHosts(s => s.hosts)
  const snapshots = useEngineHosts(s => s.snapshots)
  const hostErrors = useEngineHosts(s => s.errors)
  const refreshHosts = useEngineHosts(s => s.refresh)
  const publishSnapshot = useEngineHosts(s => s.publishSnapshot)
  const hardware = useHardware(s => s.hardwareData)
  const hardwareReady = useHardware(s => s.hardwareReady)
  const selectedGpuUuids = useHardware(s => s.selectedGpuUuids)
  const setSelectedGpuUuids = useHardware(s => s.setSelectedGpuUuids)
  const selectedDevice = useHardware(s => s.selectedDevice)
  const setSelectedDevice = useHardware(s => s.setSelectedDevice)
  const providers = useModelProvider(s => s.providers)
  const activeModels = useAppState(s => s.activeModels)
  const catalog = useModelCatalogStore(s => s.catalog)
  const catalogError = useModelCatalogStore(s => s.error)
  const refreshCatalog = useModelCatalogStore(s => s.refresh)
  const [destination, setDestination] = useState('local')
  const [query, setQuery] = useState(initialQuery)
  const [showUnavailable, setShowUnavailable] = useState(false)
  const localDownloads = useLocalModelDownloads(s => s.jobs)
  const localDownloadError = useLocalModelDownloads(s => s.error)
  const localDownloadsLoaded = useLocalModelDownloads(s => s.loaded)
  const refreshLocal = useLocalModelDownloads(s => s.refresh)
  const [error, setError] = useState<string | null>(null)
  const [errorSummary, setErrorSummary] = useState('Could not refresh the model list. Try refreshing it again.')
  const [busy, setBusy] = useState(false)
  const downloadActionPending = useRef(false)
  const [downloadRefreshErrors, setDownloadRefreshErrors] = useState<Record<string, string>>({})
  const modelStatusPending = useRef(false)
  const [modelStatusError, setModelStatusError] = useState<string | null>(null)
  const [stoppedModelId, setStoppedModelId] = useState<string | null>(null)
  const registrationPending = useRef(false)
  const registrationNeedsRefresh = useRef(false)
  const [localRegistration, setLocalRegistration] = useState<'choosing' | 'registering' | null>(null)
  const mounted = useRef(true)
  const loadRef = useRef<PendingLocalLoad | null>(null)
  const loadSucceeded = useRef(false)
  const inventoryRefreshRef = useRef<HTMLButtonElement>(null)
  const [loadResult, setLoadResult] = useState('')
  // The model whose Automatic load failed, so its custom settings can be offered next.
  const [failedModelId, setFailedModelId] = useState<string | null>(null)
  /** The Host's own plain sentence when settings do not fit; other failures keep the summary. */
  const [failedFit, setFailedFit] = useState<string | null>(null)
  const [customFor, setCustomFor] = useState<string | null>(null)
  const [customPreparing, setCustomPreparing] = useState<string | null>(null)
  /** A CPU start problem in plain words; NVFP4 packages also offer the INT or SMOL version. */
  const [cpuProblem, setCpuProblem] = useState<{ message: string; detail?: string; code?: string; modelId: string } | null>(null)
  const [pendingLoad, setPendingLoad] = useState<PendingLocalLoad | null>(null)
  const [loadProgress, setLoadProgress] = useState<LocalModelLoadProgress | null>(null)
  const [loadStatusUnavailable, setLoadStatusUnavailable] = useState(false)
  const [loadElapsedSeconds, setLoadElapsedSeconds] = useState(0)
  const [cancellingLoad, setCancellingLoad] = useState(false)
  const [cancelError, setCancelError] = useState(false)
  const local = destination === 'local'
  const downloadRefreshError = downloadRefreshErrors[destination]
  const downloadNeedsRefresh = downloadRefreshError !== undefined
  const resources = useBundledResources(local)
  const localLoadReady = resources.ready === true && !resources.error
  const host = hosts.find(h => h.host_id === destination)
  const snapshot = snapshots[destination]
  const offline = !local && (!snapshot || !!hostErrors[destination])
  const gpus: ModelGpu[] = useMemo(() => local ? (hardwareReady ? hardware.gpus : []).map(g => ({
    uuid: g.uuid, name: g.name, memory_mib: g.total_memory, compute_capability: g.nvidia_info?.compute_capability,
  })) : snapshot?.gpus ?? [], [local, hardwareReady, hardware.gpus, snapshot?.gpus])
  const cpuChosen = selectedDevice === 'cpu'
  const invalidGpuSelection = !hardwareReady || (!cpuChosen && selectedGpuUuids !== null &&
    (!selectedGpuUuids.length || selectedGpuUuids.some(id => !gpus.some(g => g.uuid === id))))
  const downloads = local ? localDownloads : snapshot?.model_management?.downloads ?? []
  const downloadsChecked = !downloadNeedsRefresh && (!local || localDownloadsLoaded)
  const managementAvailable = local || snapshot?.model_management?.version === 1
  const localProvider = providers.find(p => p.provider === 'ginfer')
  const localModels = localProvider?.models ?? []
  // A model started from GInfer Hosts is a Host instance, not a desktop-loaded model; match it by its weights file.
  const localHost = hosts.find(h => h.local)
  const localSnapshot = localHost && !hostErrors[localHost.host_id] ? snapshots[localHost.host_id] : undefined
  const hostInstanceOf = (path?: string) => {
    const hostModel = path ? localSnapshot?.models.find(h => h.path === path) : undefined
    const instance = hostModel && localSnapshot?.instances.find(i =>
      (i.status === 'ready' || i.status === 'starting') && i.profile?.model_id === hostModel.id)
    return localHost && instance ? engineAlias(localHost.host_id, instance.instance_id) : undefined
  }
  const localCpu = localSnapshot?.cpu
  /** The first CPU-admitted version (INT, then SMOL) the catalog holds as a single-file release. */
  const cpuAlternative = (modelId: string) => {
    const target = localModels.find(x => x.id === modelId)
    const hostModel = localSnapshot?.models.find(h => h.path === target?.path)
    const identity = hostModel?.metadata.identity
    if (!identity) return undefined
    const releases = catalog.filter(m => m.library_name === 'ginfer').flatMap(m => (m.releases ?? []) as ModelRelease[]).filter(r => r.tp === 1)
    const named = hostModel.cpu_admission?.cpu_alternatives
    return named
      ? named.map(a => releases.find(r => r.identity.model_id === a.model_id && r.identity.weights_id === a.weights_id)).find(r => !!r)
      : releases.find(r => r.identity.model_id === identity.model_id && !r.identity.weights_id.includes('nvfp4'))
  }
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
    if (local) void refreshLocal().catch(e => setError(errorMessage(e)))
  }, [local, refreshLocal])
  useEffect(() => { void refreshHosts().catch(e => setError(errorMessage(e))) }, [refreshHosts])

  const act = async (operation: () => Promise<unknown>, failure = 'Could not refresh the model list. Try refreshing it again.') => {
    setBusy(true)
    try { await operation(); if (mounted.current) { await (local ? refreshLocal() : refreshHosts()); setError(null) } }
    catch (e) {
      const cancelled = typeof e === 'object' && e !== null && 'name' in e && e.name === 'AbortError'
      if (mounted.current && !cancelled) { setErrorSummary(failure); setError(errorMessage(e)) }
    }
    finally { if (mounted.current) setBusy(false) }
  }
  const rescan = async () => {
    if (!local) return engineCommand('scan', { host_id: destination })
    const report = await engineCommand<{ adopted: { modelId: string }[]; rejected: { filename: string; reason: string }[] }>('local_model_adopt')
    for (const model of report.adopted) useModelProvider.getState().recordModelInstall(model.modelId)
    const revision = useModelProvider.getState().inventoryRevision
    useModelProvider.getState().setProviders(await service.providers().getProviders(), revision)
    if (report.rejected.length) throw new Error(report.rejected.map(r => `${r.filename}: ${r.reason}`).join('\n'))
  }
  const refreshRegisteredModels = async () => {
    const revision = useModelProvider.getState().inventoryRevision
    const updated = await service.providers().getProviders()
    if (!mounted.current) return
    useModelProvider.getState().setProviders(updated, revision)
    await refreshHosts()
    if (mounted.current) {
      registrationNeedsRefresh.current = false
      setError(null)
    }
  }
  const retryRegisteredModelRefresh = async () => {
    if (busy || registrationPending.current) return
    registrationPending.current = true
    setBusy(true)
    try { await refreshRegisteredModels() }
    catch (e) {
      if (mounted.current) { setErrorSummary(REGISTERED_MODEL_REFRESH_FAILED); setError(errorMessage(e)) }
    } finally {
      registrationPending.current = false
      if (mounted.current) setBusy(false)
    }
  }
  const addLocalModel = async () => {
    if (!local || busy || registrationPending.current) return
    registrationPending.current = true
    setBusy(true)
    setLocalRegistration('choosing')
    let registered = false
    try {
      const path = await service.dialog().open({
        multiple: false,
        directory: false,
        filters: [{ name: 'GInfer model', extensions: ['ginfer'] }],
      })
      if (typeof path !== 'string' || !path || !mounted.current) return
      setLocalRegistration('registering')
      setError(null)
      const configuredRoot = String(localProvider?.settings?.find(s => s.key === 'model_path')?.controller_props.value ?? '').trim()
      const modelsRoot = configuredRoot ? await joinPath([configuredRoot, 'models']) : undefined
      const entry = await engineCommand<{ modelId: string }>('local_model_register', { path, ...(modelsRoot === undefined ? {} : { modelsRoot }) })
      useModelProvider.getState().recordModelInstall(entry.modelId)
      registered = true
      registrationNeedsRefresh.current = true
      await refreshRegisteredModels()
    } catch (e) {
      if (mounted.current) { setErrorSummary(registered ? REGISTERED_MODEL_REFRESH_FAILED : 'Could not add this model. Choose a complete .ginfer file that GInfer supports, then try again.'); setError(errorMessage(e)) }
    } finally {
      registrationPending.current = false
      if (mounted.current) { setLocalRegistration(null); setBusy(false) }
    }
  }
  const updateDownloads = async (operation?: () => Promise<unknown>, failure = 'Could not check your downloads. Choose Refresh downloads to try again.') => {
    if (busy || downloadActionPending.current || (operation && downloadNeedsRefresh)) return
    downloadActionPending.current = true
    setBusy(true)
    let accepted = false
    try {
      if (operation) { await operation(); accepted = true }
      if (!mounted.current) return
      if (local) await refreshLocal()
      else {
        // The fleet refresh can retain a stale snapshot without rejecting, or
        // return while another refresh is pending. Read this computer directly.
        const updated = await engineCommand<EngineSnapshot>('snapshot', { host_id: destination })
        if (mounted.current) publishSnapshot(destination, updated)
      }
      if (mounted.current) {
        setDownloadRefreshErrors(errors => { const updated = { ...errors }; delete updated[destination]; return updated })
        setError(null)
      }
    } catch (e) {
      if (mounted.current) {
        if (accepted || downloadNeedsRefresh) {
          setDownloadRefreshErrors(errors => ({ ...errors, [destination]: errorMessage(e) }))
          setError(null)
        } else { setErrorSummary(failure); setError(errorMessage(e)) }
      }
    } finally {
      downloadActionPending.current = false
      if (mounted.current) setBusy(false)
    }
  }
  const download = (release: ModelRelease) => updateDownloads(async () => {
    const job = await engineCommand<ModelDownload>(local ? 'local_model_download' : 'download', { host_id: destination, body: release })
    if (local) useLocalModelDownloads.getState().acknowledge(job)
    setTab('Downloads')
  }, 'Could not start the download. Check the computer’s connection and free disk space, then try again.')
  const transferAction = (job: ModelDownload, action: string) => updateDownloads(() =>
    engineCommand(local ? 'local_model_download_action' : 'download_action', local ?
      { id: job.id, operation: action } : { host_id: destination, body: { id: job.id, action } }), `Could not ${action === 'discard' ? 'delete the partial download' : action === 'resume' ? 'resume the download' : 'pause the download'}. Try again when this computer is connected.`)
  // One load attempt with progress and Cancel. `start` first asks the Host to start
  // the chosen custom or tested settings; Automatic leaves the choice to the desktop load.
  const loadLocal = (modelId: string, start?: CustomStart) => act(async () => {
    if (!start && invalidGpuSelection) throw new Error('Choose the graphics cards to use before loading this model.')
    const active = await service.models().getActiveModels('ginfer')
    if (!mounted.current) return
    if (active.some(id => id !== modelId) && !await confirmAction({ title: 'Switch the local model?', message: 'The current model will stop. Chats and agents using it may be interrupted.', confirmLabel: 'Switch model' })) return
    const load: PendingLocalLoad = { operationId: crypto.randomUUID(), controller: new AbortController(),
      startedAt: performance.now(), ready: false, settled: false, cancelRequested: false }
    loadRef.current = load
    loadSucceeded.current = false
    setLoadResult('')
    setFailedModelId(null)
    setFailedFit(null)
    setCpuProblem(null)
    setPendingLoad(load)
    setLoadProgress(null)
    setLoadElapsedSeconds(0)
    setLoadStatusUnavailable(false)
    setCancellingLoad(false)
    setCancelError(false)
    useModelProvider.getState().selectModelProvider('ginfer', modelId)
    try {
      if (start) {
        if (!localHost) throw new Error('GInfer is not ready on this computer.')
        // Other local models stop first, as Automatic does, so the chosen cards are free.
        if (active.some(id => id !== modelId)) await service.models().stopAllModels()
        setLoadResult('Checking these settings and starting the model…')
        await engineCommand(start.action, { host_id: localHost.host_id, body: { ...start.body, load_operation_id: load.operationId } })
      }
      // Automatic: tested settings for these cards, then your saved settings, then the longest
      // context that fits. After a custom start this attaches to the model that is starting.
      await switchToModel({ modelId, providerName: 'ginfer', serviceHub: service,
        options: { useProfileDefaults: true, loadOperationId: load.operationId,
          device: start ? (start.body.device === 'cpu' ? 'cpu' : 'gpu') : selectedDevice },
        signal: load.controller.signal,
        ...(start ? { gpuUuids: start.gpuUuids.length ? [...start.gpuUuids] : undefined }
          : selectedGpuUuids === null || cpuChosen ? {} : { gpuUuids: [...selectedGpuUuids] }) })
      load.ready = true
      loadSucceeded.current = true
      if (mounted.current) setLoadResult('Model loaded and ready to use.')
    } catch (e) {
      const code = (e as { code?: string } | null)?.code
      if (code && CPU_CODES.includes(code)) {
        // A CPU problem has its own plain words and next step; custom GPU settings cannot fix it.
        const parts = engineErrorParts(errorMessage(e).replace(/^Failed to load [^:]*: /, ''))
        if (mounted.current) {
          setCpuProblem({ message: parts.message, detail: parts.detail, code, modelId })
          setLoadResult('Model could not be loaded. Check the error below before trying again.')
        }
        return
      }
      if (mounted.current) {
        const cancelled = (e as { name?: string } | null)?.name === 'AbortError'
        setLoadResult(cancelled ? 'Model startup cancelled.' : 'Model could not be loaded. Check the error below before trying again.')
        if (!cancelled) setFailedModelId(modelId)
        if (code === 'does_not_fit') setFailedFit(errorMessage(e).replace(/^Failed to load [^:]*: /, '').replace(/^\[[a-z_]+\] /, ''))
      }
      throw e
    } finally {
      load.settled = true
      if (loadRef.current === load) loadRef.current = null
      if (mounted.current) setPendingLoad(null)
    }
  }, 'Could not load this model. Choose Custom settings to try a shorter context or other settings, or check that the selected graphics cards are available.')
  /** The Host's entry for an installed model file; the Host learns a file the first time it is used. */
  const hostModelFor = (path?: string): EngineModel | undefined => path ? localSnapshot?.models.find(h => h.path === path) : undefined
  const openCustom = async (modelId: string, path?: string) => {
    setCustomFor(current => current === modelId ? null : modelId)
    if (!path || hostModelFor(path) || !localHost) return
    setCustomPreparing(modelId)
    try {
      await engineCommand('local_model_host_entry', { path })
      const updated = await engineCommand<EngineSnapshot>('snapshot', { host_id: localHost.host_id })
      if (mounted.current) publishSnapshot(localHost.host_id, updated)
    } catch (e) {
      if (mounted.current) { setErrorSummary('Could not prepare custom settings for this model. Check that the model file is available, then try again.'); setError(errorMessage(e)) }
    } finally { if (mounted.current) setCustomPreparing(null) }
  }
  const refreshLocalSnapshot = async () => {
    if (!localHost) return
    const updated = await engineCommand<EngineSnapshot>('snapshot', { host_id: localHost.host_id })
    if (mounted.current) publishSnapshot(localHost.host_id, updated)
  }
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
  const updateModelStatus = async (stop?: { modelId: string; rowModelId: string; operation: () => Promise<void> }) => {
    if (busy || modelStatusPending.current || (stop && modelStatusError !== null)) return
    modelStatusPending.current = true
    setBusy(true)
    let stopped = false
    try {
      if (stop) {
        await stop.operation()
        stopped = true
        const state = useAppState.getState()
        state.setActiveModels(state.activeModels.filter(id => id !== stop.modelId))
        if (mounted.current) setStoppedModelId(stop.rowModelId)
      }
      const active = await service.models().getActiveModels()
      // Desktop unload confirms Stop without publishing the Host's new snapshot.
      // Refresh it before merging ready aliases from that cache into active state.
      if (localHost) {
        const updated = await engineCommand<EngineSnapshot>('snapshot', { host_id: localHost.host_id })
        publishSnapshot(localHost.host_id, updated)
      }
      syncActiveModelsFromEngines(active)
      if (mounted.current) { setModelStatusError(null); setStoppedModelId(null); setError(null) }
    } catch (e) {
      if (mounted.current) {
        if (stopped || modelStatusError !== null) {
          setModelStatusError(errorMessage(e))
          setError(null)
        } else {
          setErrorSummary('Could not stop this model. Check that the computer is connected, then try Stop model again.')
          setError(errorMessage(e))
        }
      }
    } finally {
      modelStatusPending.current = false
      if (mounted.current) setBusy(false)
    }
  }
  const stopLocal = (modelId: string) => updateModelStatus({ modelId, rowModelId: modelId, operation: async () => {
    const result = await service.models().stopModel(modelId, 'ginfer')
    if (!result?.success) throw new Error(result?.error ?? 'The engine did not confirm that this model stopped.')
  } })
  const stopHostInstance = (modelId: string, alias: string) => updateModelStatus({ modelId: alias, rowModelId: modelId,
    operation: () => controlLocalHostModel(alias, 'stop') })
  const totalInstalled = local ? localDownloads.filter(j => j.status === 'installed').reduce((n, j) => n + j.release.bytes, 0)
    : snapshot?.models.reduce((n, m) => n + m.metadata.size_bytes, 0) ?? 0
  const partialBytes = downloads.filter(j => j.status !== 'installed').reduce((n, j) => n + j.received, 0)

  return <div className="flex h-full flex-col">
    <HeaderPage><div className="flex w-full flex-wrap items-center justify-between gap-3 pr-4"><h1>Models</h1>
      <div className="flex items-center gap-2 text-sm">Computer
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button aria-label="Model destination" disabled={busy} variant="outline" className="max-w-64 justify-between bg-background text-foreground">
              <span className="truncate">{local ? 'This computer' : `${host?.name ?? 'Choose a computer'}${hostErrors[destination] ? ' (offline)' : ''}`}</span>
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
      <div className="flex flex-wrap gap-2">{gpus.map(g => <span key={g.uuid} className="rounded border px-3 py-1 text-sm">{g.name} · {(g.memory_mib / 1024).toFixed(0)} GiB memory</span>)}</div>
      <p className="text-sm text-muted-foreground">{local ? 'Manage models on this computer.' : `Downloads and model operations run on ${host?.name ?? 'the selected computer'}.`} A model must fit the memory available on each graphics card it uses, or on the CPU, the computer’s system memory (RAM).</p>
      <div className="flex flex-wrap items-center justify-between gap-3"><div className="flex gap-1" role="tablist" aria-label="Model management">
        {managementTabs.map((t, index) => <Button key={t} role="tab" aria-selected={tab === t} tabIndex={tab === t ? 0 : -1} variant={tab === t ? 'default' : 'ghost'} onClick={() => setTab(t)}
          onKeyDown={event => {
            const next = event.key === 'ArrowRight' ? (index + 1) % managementTabs.length : event.key === 'ArrowLeft' ? (index + managementTabs.length - 1) % managementTabs.length
              : event.key === 'Home' ? 0 : event.key === 'End' ? managementTabs.length - 1 : -1
            if (next < 0) return
            event.preventDefault()
            setTab(managementTabs[next])
            ;(event.currentTarget.parentElement?.children[next] as HTMLElement | undefined)?.focus()
          }}>{t}</Button>)}
      </div><div className="flex flex-wrap gap-2">
        {local && tab === 'Installed' && <Button disabled={busy} onClick={() => void addLocalModel()}>{localRegistration === 'choosing' ? 'Choose a model file…' : localRegistration === 'registering' ? 'Adding local model…' : 'Add local model'}</Button>}
        <Button ref={inventoryRefreshRef} variant="outline" disabled={busy || (offline && tab === 'Installed')} onClick={() => void (tab === 'Downloads' ? updateDownloads() : local && tab === 'Installed' && registrationNeedsRefresh.current ? retryRegisteredModelRefresh() : act(tab === 'Recommended' ? refreshCatalog : rescan))}>{tab === 'Recommended' ? 'Refresh recommendations' : tab === 'Downloads' ? 'Refresh downloads' : 'Refresh installed models'}</Button>
      </div></div>
      {local && tab === 'Installed' && <p className="text-sm text-muted-foreground">Add an existing .ginfer file. The file stays in its current location.</p>}
      {error && (failedModelId
        ? <div className="space-y-2">
          <ModelProblem message={failedFit ?? errorSummary} detail={error} />
          {customFor !== failedModelId && <Button variant="outline" disabled={busy} onClick={() => void openCustom(failedModelId, localModels.find(x => x.id === failedModelId)?.path)}>Choose custom settings</Button>}
        </div>
        : <ModelProblem message={errorSummary} detail={error} />)}
      {cpuProblem && <div className="space-y-2">
        <ModelProblem message={cpuProblem.message} detail={cpuProblem.detail} />
        {cpuProblem.code === 'no_cpu_format' && (() => {
          const alternative = cpuAlternative(cpuProblem.modelId)
          return alternative
            ? <Button disabled={busy} onClick={() => void download(alternative)}>Download {plainModelName(alternative.name)}</Button>
            : <Button disabled={busy} onClick={() => void addLocalModel()}>Add the INT or SMOL version (.ginfer file)</Button>
        })()}
      </div>}
      {downloadNeedsRefresh && <ModelProblem message={ACCEPTED_DOWNLOAD_REFRESH_FAILED} detail={downloadRefreshError} />}
      {local && modelStatusError !== null && <div className="space-y-2">
        <ModelProblem message={STOPPED_MODEL_REFRESH_FAILED} detail={modelStatusError} />
        <Button variant="outline" disabled={busy} onClick={() => void updateModelStatus()}>Refresh model status</Button>
      </div>}
      {offline && <ModelProblem message={`Cannot reach ${host?.name ?? 'this computer'}. Check that it is on and GInfer Host is running, then reconnect in GInfer Hosts. The model list shown here may be out of date.`} detail={hostErrors[destination]} />}
      {local && !localLoadReady && (resources.error
        ? <ModelProblem message="Could not prepare GInfer to run models on this computer. Restart GChat to try again. If this keeps happening, reinstall GChat." detail={resources.error} />
        : <p role="status" className="rounded border p-3 text-sm">Preparing GInfer to run models on this computer…</p>)}
      <p role="status" aria-label="Model load status" aria-live="polite" aria-atomic="true" className={pendingLoad || loadResult ? 'rounded border p-3 text-sm font-medium' : 'sr-only'}>{pendingLoad
        ? cancellingLoad ? 'Cancelling model startup…' : loadStatusUnavailable ? 'Cannot check progress right now. GChat is still waiting for the model to finish loading.' : loadProgress?.status === 'ready' ? 'The model is loaded. Finishing up…' : loadResult ? loadResult : loadPhaseLabels[loadProgress?.phase ?? 'preparing']
        : loadResult}</p>
      {pendingLoad && <div className="space-y-2 rounded border p-3 text-sm">
        {loadProgress?.detail && <details className="text-muted-foreground"><summary className="cursor-pointer">Startup details</summary><p className="mt-2 whitespace-pre-wrap break-words">{loadProgress.detail}</p></details>}
        <p>Time since you chose Load model: {loadElapsedSeconds} seconds</p>
        {typeof loadProgress?.completed_bytes === 'number' && typeof loadProgress.total_bytes === 'number' && loadProgress.total_bytes > 0 && <>
          <progress aria-label="Model file check" className="h-2 w-full accent-primary" max={loadProgress.total_bytes} value={loadProgress.completed_bytes} />
          <p>{formatModelBytes(loadProgress.completed_bytes)} / {formatModelBytes(loadProgress.total_bytes)}</p>
        </>}
        {cancelError && <p role="alert">Could not confirm that startup was cancelled. Choose Cancel load to try again.</p>}
        <Button variant="outline" disabled={cancellingLoad || pendingLoad.ready} onClick={() => void cancelPendingLoad()}>Cancel load</Button>
      </div>}
      {local && localDownloadError && !downloadNeedsRefresh && <ModelProblem message="Could not check your downloads. Open Downloads and choose Refresh downloads to try again." detail={localDownloadError} />}
      {(tab === 'Recommended' || (tab === 'Installed' && local)) && <Input aria-label="Search models" placeholder="Find a model…" value={query} onChange={e => setQuery(e.target.value)} />}
      {tab === 'Installed' && <>
        {local && <fieldset disabled={busy} className="space-y-1 rounded border p-3"><legend>Device</legend>
          <label className="flex items-center gap-2 text-sm">Device
            <select aria-describedby="model-device-help" className="rounded border bg-background px-2 py-1" value={selectedDevice} onChange={e => setSelectedDevice(e.target.value as DevicePreference)}>
              <option value="auto">Automatic</option>
              <option value="gpu">GPU</option>
              <option value="cpu">CPU</option>
            </select>
          </label>
          <p id="model-device-help" className="text-xs text-muted-foreground">{deviceHelp}</p>
          {localCpu && <p className="text-xs text-muted-foreground">This computer’s processor: {localCpu.label ?? 'no supported CPU path (needs AVX2)'}{localCpu.total_ram_bytes ? ` · ${formatModelBytes(localCpu.total_ram_bytes)} system memory` : ''}.</p>}
          {localCpu?.gpu_inventory_note && selectedDevice !== 'cpu' && <p className="text-xs text-muted-foreground">No usable NVIDIA graphics card was found, so Automatic runs models on the CPU. {localCpu.gpu_inventory_note}</p>}
        </fieldset>}
        {local && !cpuChosen && <fieldset disabled={busy} className="space-y-2 rounded border p-3"><legend>Graphics cards to use when loading a model</legend>
          <label className="flex items-center gap-2"><input type="checkbox" checked={selectedGpuUuids === null} onChange={e => setSelectedGpuUuids(e.target.checked ? null : [])} />Automatic (all available graphics cards)</label>
          {gpus.map(g => <label key={g.uuid} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={selectedGpuUuids?.includes(g.uuid) ?? false} onChange={e => setSelectedGpuUuids(e.target.checked ? [...(selectedGpuUuids ?? []), g.uuid] : (selectedGpuUuids ?? []).filter(id => id !== g.uuid))} />{gpuCardName(gpus, gpus.indexOf(g))}</label>)}
          <p className="text-sm text-muted-foreground">Choose the graphics cards to load the model onto. Leave Automatic checked to use every available card; a model that needs several cards needs that many selected.</p>
          {invalidGpuSelection && <p role="alert">{hardwareReady ? 'Select at least one available graphics card. A previously selected card may have been disconnected.' : 'Checking which graphics cards are available…'}</p>}
        </fieldset>}
        {local ? <>{!filteredModels.length && <div className="rounded-xl border p-8 text-center">{query ? <><p>No installed models match “{query}”.</p><Button className="mt-3" onClick={() => setQuery('')}>Clear search</Button></> : <><p>No installed models found.</p><Button className="mt-3" onClick={() => setTab('Recommended')}>Find a recommended model</Button></>}</div>}
          {filteredModels.map(m => { const running = activeModels.includes(m.id) || !!hostInstanceOf(m.path); const hostModel = hostModelFor(m.path); return <section key={m.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border p-4"><div><h2 className="font-medium">{plainModelName(m.displayName ?? m.id)}</h2><p className="text-sm text-muted-foreground">{stoppedModelId === m.id ? (modelStatusError !== null ? 'Status unavailable' : 'Checking status') : running ? 'Running' : 'Installed'} · {capabilityLabels(m.capabilities) || 'GInfer model'}. {cpuChosen ? 'Load model checks settings that fit this computer’s memory and runs the model on the CPU.' : 'Load model picks settings for you: tested settings for your graphics card when they exist, then your saved settings, then the longest conversation that fits.'} Choose Custom settings to pick your own.</p></div><div className="flex gap-2"><Button disabled={busy || modelStatusError !== null || !localLoadReady || invalidGpuSelection || running} onClick={() => void loadLocal(m.id)}>Load model</Button>
            <Button variant="outline" aria-expanded={customFor === m.id} disabled={busy || !localLoadReady || !localHost} onClick={() => void openCustom(m.id, m.path)}>Custom settings</Button><Button variant="outline" disabled={busy || modelStatusError !== null || !(activeModels.includes(m.id) || hostInstanceOf(m.path))} onClick={() => void (activeModels.includes(m.id) ? stopLocal(m.id) : stopHostInstance(m.id, hostInstanceOf(m.path)!))}>Stop model</Button><DeleteModelAction modelId={m.id} label={m.displayName ?? m.name} provider="ginfer" externalReference={m.source === 'external'} returnFocusRef={inventoryRefreshRef} /></div>
            {customFor === m.id && (hostModel && localHost && localSnapshot
              ? <ModelCustomSettings key={hostModel.id} hostId={localHost.host_id} snapshot={localSnapshot} model={hostModel} modelName={plainModelName(m.displayName ?? m.id)}
                disabled={busy || !!pendingLoad} running={running} onChanged={refreshLocalSnapshot}
                onStart={async start => { await loadLocal(m.id, start); return loadSucceeded.current }} />
              : <p role="status" className="w-full text-sm text-muted-foreground">{customPreparing === m.id ? 'Preparing custom settings for this model…' : 'GInfer is not ready to check settings for this model yet. Choose Refresh installed models, then try again.'}</p>)}
            {customFor === m.id && running && <p className="w-full text-sm text-muted-foreground">This model is running. You can save these settings now; stop the model to check or start other settings.</p>}
          </section> })}</>
          : host ? <HostCard key={host.host_id} host={host} snapshot={snapshot} error={hostErrors[destination]} /> : <p>Connect another computer in GInfer Hosts, then choose it from the Computer menu above.</p>}
        {!local && snapshot?.model_management && <details><summary className="cursor-pointer text-sm">Delete downloaded models</summary><p className="my-2 text-sm text-muted-foreground">You can delete models downloaded by GInfer. Files added from other folders stay in place. Stop a running model before deleting it.</p>{snapshot.models.filter(m => downloads.some(j => j.status === 'installed' && j.path === m.path)).map(m => <div key={m.id} className="flex items-center justify-between gap-3 border-b py-2"><span>{hostModelLabel(m)} · {formatModelBytes(m.metadata.size_bytes)}</span><Button variant="outline" disabled={busy || offline} onClick={async () => { if (await confirmAction({ title: 'Delete this downloaded model?', message: `Delete ${hostModelLabel(m)} from ${host?.name}? You will need to download it again to use it.`, confirmLabel: 'Delete model', destructive: true })) void act(() => engineCommand('remove_model', { host_id: destination, body: { model_id: m.id } }), 'Could not delete this model. Stop it if it is running, then try again.') }}>Delete model</Button></div>)}</details>}
      </>}
      {tab === 'Recommended' && <>
        {catalogError && <ModelProblem message="Could not get the latest model recommendations. Showing the last saved list. Check your connection, then choose Refresh recommendations." detail={catalogError} />}
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={showUnavailable} onChange={e => setShowUnavailable(e.target.checked)} />Show unavailable models and explanations</label>
        {!releases.some(r => r.readiness.available) && <div className="rounded-xl border p-5"><h2 className="font-medium">No recommended model for these graphics cards yet</h2><p className="mt-1 text-sm text-muted-foreground">No model in the list supports these graphics cards and fits their memory. Check back later, use a model you already have installed, or choose another computer in the Computer menu.</p></div>}
        {releases.filter(r => (showUnavailable || r.readiness.available) && r.name.toLowerCase().includes(query.toLowerCase())).map((r, i) => <section key={r.release?.sha256 ?? `${r.name}-${i}`} className="space-y-3 rounded-xl border p-5"><h2 className="font-medium">{plainModelName(r.name)}</h2><p className="text-sm text-muted-foreground">{r.readiness.reason}</p>{r.release && <p className="text-sm text-muted-foreground">{formatModelBytes(r.release.bytes)} download · {r.release.tp === 1 ? '1 graphics card' : `${r.release.tp} graphics cards`} · {capabilityLabels(r.release.capabilities)}</p>}
          <Button disabled={!r.readiness.available || offline || busy || downloadNeedsRefresh || !managementAvailable} onClick={() => r.release && void download(r.release)}>Download to {local ? 'this computer' : host?.name}</Button>
        </section>)}
        {!managementAvailable && <p role="alert">Downloads are not available on this computer’s version of GInfer Host. Update GInfer on that computer, then reconnect in GInfer Hosts.</p>}
      </>}
      {tab === 'Downloads' && <>
        <p className="text-sm text-muted-foreground">{downloadsChecked && <>{formatModelBytes(partialBytes)} of unfinished downloads · {formatModelBytes(totalInstalled)} of downloaded models. </>}Only one model downloads at a time on each computer.</p>
        {!downloads.length && (downloadNeedsRefresh
          ? <p className="rounded-xl border p-6 text-center text-muted-foreground">Download status is unavailable. Choose Refresh downloads to check it.</p>
          : downloadsChecked
          ? <p className="rounded-xl border p-6 text-center text-muted-foreground">No downloads on this computer yet. Choose Recommended to find a model.</p>
          : !localDownloadError && <p role="status" className="rounded-xl border p-6 text-center text-muted-foreground">Checking for downloads…</p>)}
        {downloads.map(job => {
          const recovery = downloadFailureRecovery(job.error)
          return <section key={job.id} className="space-y-2 rounded-xl border p-4"><div className="flex flex-wrap justify-between gap-2"><h2 className="font-medium">{plainModelName(job.release.name)}</h2><span role="status" aria-live="polite" aria-atomic="true" className="text-sm text-muted-foreground"><span className="sr-only">{plainModelName(job.release.name)}: </span>{downloadStatusLabel(job.status)}{job.status === 'downloading' && job.release.bytes > 0 && <span className="sr-only"> · {Math.min(100, Math.floor(job.received / job.release.bytes * 10) * 10)}%</span>}</span></div><progress aria-label={`${job.release.name} download`} className="h-2 w-full accent-primary" max={job.release.bytes} value={job.received} /><p className="font-mono text-xs tabular-nums">{formatModelBytes(job.received)} / {formatModelBytes(job.release.bytes)}{job.bytes_per_second > 0 ? ` · ${(job.bytes_per_second / 1024 ** 2).toFixed(1)} MiB/s · about ${Math.ceil((job.release.bytes - job.received) / job.bytes_per_second)} seconds left` : ''}</p>
          {job.status === 'failed' && <ModelProblem message={recovery.message} detail={job.error} />}<div className="flex gap-2">
            {['queued', 'downloading'].includes(job.status) && <Button variant="outline" disabled={busy || offline || downloadNeedsRefresh} onClick={() => void transferAction(job, 'pause')}>Pause download</Button>}
            {['paused', 'failed'].includes(job.status) && <>{(job.status === 'paused' || recovery.retry) && <Button disabled={busy || offline || downloadNeedsRefresh} onClick={() => void transferAction(job, 'resume')}>{job.status === 'failed' ? 'Retry download' : 'Resume download'}</Button>}<Button variant="outline" disabled={busy || offline || downloadNeedsRefresh} onClick={async () => { if (await confirmAction({ title: 'Delete this partial download?', message: 'This removes the unfinished file. You will need to start the download again. Models already installed stay in place.', confirmLabel: 'Delete partial download', destructive: true })) void transferAction(job, 'discard') }}>Delete partial download</Button></>}
            {job.status === 'installed' && <Button disabled={busy || offline} onClick={() => void act(async () => { await rescan(); setTab('Installed'); toast.success('Your model is ready in Installed') }, 'Could not find the downloaded model. Choose Refresh installed models to try again.')}>Show in Installed</Button>}
          </div></section>})}
      </>}
    </main>
  </div>
}

import { useEffect, useRef, useState } from 'react'
import { confirmAction } from '@/lib/confirm'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ChoiceSelect } from '@/components/ui/choice-select'
import { engineCommand, hardwareProfileBlocksLaunch, type EngineHost, type EngineSnapshot, type EngineLaunchOptions, type EngineStartupQuote } from '@/services/engines'
import { useEngineHosts } from '@/stores/engine-hosts-store'
import { EngineHostSharing } from '@/containers/EngineHostSharing'
import { EngineGbotControl } from '@/containers/EngineGbotControl'
import { EngineInstanceSettings } from '@/containers/EngineInstanceSettings'
import { EngineProfilePicker } from '@/containers/EngineProfilePicker'
import { EngineHardwareProfile } from '@/containers/EngineHardwareProfile'
import { EngineFirstRun } from '@/containers/EngineFirstRun'
import { hostInstanceLabel, hostModelLabel, identityLabel, weightsDrafterDetail } from '@/lib/engine-host-labels'
import { formatModelBytes } from '@/lib/model-release'

const advancedFieldLabels = { draft_tokens: 'Draft ahead length (tokens)', draft_tp: 'Drafting graphics cards (TP)', prefill_chunk: 'Input batch size (tokens)' } as const
const instanceStatusLabels = { starting: 'Starting', ready: 'Ready to chat', stopping: 'Stopping', stopped: 'Stopped', failed: 'Could not start' } as const
const modelActionMessages = {
  start: 'Model start requested.',
  stop: 'Model stop requested.',
  restart: 'Model restart requested.',
  reload: 'Model settings saved; restart requested.',
  launch: 'Model start requested.',
  profile_launch: 'Model start requested.',
} as const

export function HostCard({ host, snapshot, error }: { host: EngineHost; snapshot?: EngineSnapshot; error?: string }) {
  const refresh = useEngineHosts((s) => s.refresh)
  const publishSnapshot = useEngineHosts((s) => s.publishSnapshot)
  const [modelId, setModelId] = useState('')
  const [gpus, setGpus] = useState<string[]>([])
  const [context, setContext] = useState(0)
  const [concurrency, setConcurrency] = useState(1)
  const [instanceCount, setInstanceCount] = useState(1)
  const [startupQuote, setStartupQuote] = useState<{ key: string; result?: EngineStartupQuote; error?: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState<{ message: string; details: string } | null>(null)
  const [actionResult, setActionResult] = useState<string | null>(null)
  const actionPending = useRef(false)
  const [connectionRemoved, setConnectionRemoved] = useState(false)
  const [connectionCleanupWarning, setConnectionCleanupWarning] = useState<string | null>(null)
  const [connectionRefreshError, setConnectionRefreshError] = useState<string | null>(null)
  const [connectionResult, setConnectionResult] = useState(false)
  const [scanResult, setScanResult] = useState(false)
  const connectPending = useRef(false)
  const scanPending = useRef(false)
  const hostListRefreshPending = useRef(false)
  const [hostStopError, setHostStopError] = useState<string | null>(null)
  const [hostStopping, setHostStopping] = useState(false)
  const profiling = hardwareProfileBlocksLaunch(snapshot?.hardware_profile)
  const [activeId, setActiveId] = useState('')
  const active = activeId === 'additional' ? undefined : snapshot?.instances.find(i => i.instance_id === activeId) ??
    snapshot?.instances.find(i => i.status === 'ready') ?? snapshot?.instances[0]
  const [editing, setEditing] = useState<string | null>(null)
  const editingInstance = snapshot?.instances.find(instance => instance.instance_id === editing)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const editor = useRef<HTMLDetailsElement>(null)
  useEffect(() => {
    if (editing && settingsOpen) {
      editor.current?.scrollIntoView?.({ behavior: 'smooth', block: 'nearest' })
      editor.current?.querySelector<HTMLButtonElement>('[data-choice-select]')?.focus()
    }
  }, [editing, settingsOpen])
  const [editingSession, setEditingSession] = useState<string | null>(null)
  const [options, setOptions] = useState<EngineLaunchOptions>({ vision: true, structured_outputs: true, spec: 'none', draft_tokens: 0, draft_tp: 0, kv_dtype: 'auto', kv_arena_bytes: null, host_kv_cache_bytes: null, prefill_chunk: 0, no_cuda_graph: false })
  const selected = snapshot?.models.find((m) => m.id === modelId)
  const configuration = { ...options, model_id: modelId, gpu_uuids: gpus, max_context: context, concurrency }
  const profile = snapshot?.hardware_profile
  // Snapshot revisions and profiling progress can change while the same quote is
  // running. Only launch inputs and the Host's placement/profile state invalidate it.
  const quoteKey = JSON.stringify([host.host_id, host.base_url, host.certificate_sha256, error, snapshot?.boot_id,
    selected, snapshot?.gpus.map(gpu => [gpu.uuid, gpu.memory_mib, gpu.compute_capability]),
    [profiling, profile?.profile_path, profile?.engine_path, profile?.gpu_uuids, profile?.available,
      profile?.base_complete, profile?.scope_complete, profile?.all_formats_complete],
    snapshot?.instances.map(instance => [instance.instance_id, instance.status, instance.configuration]),
    configuration, instanceCount, editing])
  const quoteRevision = useRef(0)
  useEffect(() => {
    quoteRevision.current++
    setStartupQuote(null)
  }, [quoteKey])
  const currentQuote = startupQuote?.key === quoteKey ? startupQuote : null
  const invalidNumbers = !Number.isSafeInteger(context) || context < 1 ||
    !Number.isSafeInteger(concurrency) || concurrency < 1 || concurrency > 8 ||
    (!editing && (!Number.isInteger(instanceCount) || instanceCount < 1 || instanceCount > 4294967295)) ||
    [options.draft_tokens, options.draft_tp, options.prefill_chunk]
      .some((value) => !Number.isSafeInteger(value) || value < 0) ||
    (options.host_kv_cache_bytes !== null && (!Number.isSafeInteger(options.host_kv_cache_bytes) || options.host_kv_cache_bytes < 0)) ||
    (options.kv_arena_bytes !== null && (!Number.isSafeInteger(options.kv_arena_bytes) || options.kv_arena_bytes < 1))
  const launchError = invalidNumbers ? 'Use whole numbers. Conversation length and model copies must be at least 1. Requests at once must be between 1 and 8. Advanced settings cannot be negative; the graphics-card memory limit must be greater than 0 or left blank.'
    : options.kv_dtype === 'nvfp4' && selected?.metadata.nvfp4_kv_available === false
      ? 'This model cannot use NVFP4 conversation memory. Choose INT8 or BF16, or add a model prepared for NVFP4 memory.' : null
  const act = async (action: keyof typeof modelActionMessages | 'hardware_profile' | 'gbot_grant', args: Record<string, unknown> = {}) => {
    if (busy || actionPending.current) return false
    actionPending.current = true
    setBusy(true)
    setActionError(null)
    setActionResult(null)
    setConnectionRefreshError(null)
    try {
      if (action === 'start' || action === 'stop' || action === 'restart' || action === 'reload') {
        const changedSnapshot = await engineCommand<EngineSnapshot>(action, { host_id: host.host_id, ...args })
        publishSnapshot(host.host_id, changedSnapshot)
      } else {
        await engineCommand(action, { host_id: host.host_id, ...args })
      }
      if (action !== 'hardware_profile' && action !== 'gbot_grant') setActionResult(modelActionMessages[action])
      await refreshHostList()
      return true
    }
    catch (e) {
      const message = action === 'stop' ? 'Could not stop this model. Check its status and try again.'
              : action === 'restart' || action === 'reload' ? 'Could not restart this model. Check the settings and try again.'
                : action === 'hardware_profile' ? 'Could not change the graphics-card setup. Check the connection and try again.'
                  : action === 'gbot_grant' ? 'Could not change this connection’s access. Check the connection and try again.'
                    : 'Could not start this model. Check its settings and available graphics-card memory, then try again.'
      setActionError({ message, details: String(e) })
      toast.error(message)
      return false
    } finally { actionPending.current = false; setBusy(false) }
  }
  const refreshHostList = async () => {
    if (hostListRefreshPending.current) return
    hostListRefreshPending.current = true
    setBusy(true)
    try {
      await refresh()
      setConnectionRefreshError(null)
    } catch (e) { setConnectionRefreshError(String(e)) }
    finally { hostListRefreshPending.current = false; setBusy(false) }
  }
  const connectHost = async () => {
    if (busy || connectPending.current) return
    connectPending.current = true
    setBusy(true)
    setActionError(null)
    setConnectionResult(false)
    setConnectionRefreshError(null)
    try {
      const connectedSnapshot = await engineCommand<EngineSnapshot>('connect', { host_id: host.host_id })
      publishSnapshot(host.host_id, connectedSnapshot)
      setConnectionResult(true)
      await refreshHostList()
    } catch (e) {
      const message = 'Could not connect to this computer. Check that it is on and reachable, then try Connect again.'
      setActionError({ message, details: String(e) })
      toast.error(message)
    } finally { connectPending.current = false; setBusy(false) }
  }
  const scanModels = async () => {
    if (busy || scanPending.current) return
    scanPending.current = true
    setBusy(true)
    setActionError(null)
    setScanResult(false)
    setConnectionRefreshError(null)
    try {
      const scannedSnapshot = await engineCommand<EngineSnapshot>('scan', { host_id: host.host_id })
      publishSnapshot(host.host_id, scannedSnapshot)
      setScanResult(true)
      await refreshHostList()
    } catch (e) {
      const message = 'Could not refresh the model list. Check that the model files are available, then try again.'
      setActionError({ message, details: String(e) })
      toast.error(message)
    } finally { scanPending.current = false; setBusy(false) }
  }
  const removeConnection = async () => {
    if (busy || connectionRemoved) return
    setBusy(true)
    setActionError(null)
    try {
      const result = await engineCommand<{ credential_cleanup_warning?: string | null }>('forget', { host_id: host.host_id })
      setConnectionRemoved(true)
      setConnectionCleanupWarning(result?.credential_cleanup_warning ?? null)
      toast.success('Connection removed')
      if (result?.credential_cleanup_warning) toast.warning('Connection removed. Its saved sign-in could not be cleared.')
      await refreshHostList()
    } catch (e) {
      const message = 'Could not remove this saved connection. Try again.'
      setActionError({ message, details: String(e) })
      toast.error(message)
    } finally { setBusy(false) }
  }
  const connectionRefreshFeedback = connectionRefreshError !== null && <div role="alert" className="space-y-2 text-sm text-destructive"><p>Could not refresh the host list. Choose Refresh host list to try again.</p><details><summary className="cursor-pointer">Host refresh error details</summary><p className="whitespace-pre-wrap break-all">{connectionRefreshError}</p></details><Button variant="outline" disabled={busy} onClick={() => void refreshHostList()}>Refresh host list</Button></div>
  if (connectionRemoved) return <section className="rounded-xl border p-5 space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="font-semibold">{host.name}</h2><Button variant="outline" disabled>Remove connection</Button></div>
    <p role="status" className="text-sm">The saved connection was removed.</p>
    {connectionCleanupWarning && <div role="alert" className="text-sm text-destructive"><p>The saved connection was removed, but its saved sign-in could not be cleared from this computer.</p><details className="mt-2"><summary className="cursor-pointer">Technical details</summary><p className="whitespace-pre-wrap break-all">{connectionCleanupWarning}</p></details></div>}
    {connectionRefreshFeedback}
  </section>
  const hardwareProfileControls = snapshot?.hardware_profile && <EngineHardwareProfile profile={snapshot.hardware_profile} calibrations={snapshot.draft_width_calibrations} gpus={snapshot.gpus} offline={!!error} disabled={busy}
    action={(action, gpu_uuids) => act('hardware_profile', { body: { action, ...(gpu_uuids ? { gpu_uuids } : {}) } })} />
  return <section className="rounded-xl border p-5 space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><h2 className="font-semibold">{host.name}</h2><p className="text-sm text-muted-foreground">{host.base_url} · {error ? 'Computer not reachable' : snapshot ? 'Connected' : host.local ? 'Connecting' : 'Not connected'}</p></div>
      {!host.local && (error || !snapshot) && <Button variant="outline" disabled={busy} onClick={() => void connectHost()}>Connect</Button>}
      {active && snapshot && <div className="flex min-w-0 flex-1 flex-wrap items-end gap-3">
        <div className="min-w-0 basis-64 flex-1">
        {snapshot.instances.length > 1 ? <label className="block min-w-0 text-xs font-medium">Model server
        <ChoiceSelect aria-label={`${host.name} serving instance`} className="mt-1 w-full" value={active.instance_id} onValueChange={setActiveId}
          options={snapshot.instances.map(i => ({ value: i.instance_id, label: `${hostInstanceLabel(i, snapshot)} · ${instanceStatusLabels[i.status]}` }))} /></label> : <p className="text-sm">{hostInstanceLabel(active, snapshot)} · {instanceStatusLabels[active.status]}</p>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" disabled={busy || profiling || !!error || !active.profile || !['stopped', 'failed'].includes(active.status)} onClick={() => void act('start', { instance_id: active.instance_id, body: {} })}>Start model</Button>
        <Button variant="outline" disabled={busy || !!error || !['ready', 'starting'].includes(active.status)} onClick={() => void act('stop', { instance_id: active.instance_id, body: { force: false, expected_session_id: active.session_id } })}>Stop model</Button>
        <Button variant="outline" disabled={busy || profiling || !!error || active.status !== 'ready'} onClick={async () => {
          if (await confirmAction({ title: 'Restart this model?', message: 'The model will finish its current replies, then restart with its saved settings. It will be unavailable for new chats while restarting.', confirmLabel: 'Restart model' })) void act('restart', { instance_id: active.instance_id, body: { force: false, expected_session_id: active.session_id } })
        }}>Restart model</Button>
        </div>
      </div>}
      {host.local ? <span className="text-sm text-muted-foreground">This computer</span> : <Button variant="outline" disabled={busy} onClick={async () => {
        if (await confirmAction({ title: `Remove the connection to ${host.name}?`, message: 'GChat will remove this saved connection. Models and downloads on that computer will keep running.', confirmLabel: 'Remove connection', destructive: true })) void removeConnection()
      }}>Remove connection</Button>}
      {host.local && snapshot?.can_stop_host && <Button variant="outline" disabled={busy || hostStopping || !!error} onClick={async () => {
        setBusy(true)
        setHostStopError(null)
        try {
          await engineCommand('stop_host', { host_id: host.host_id })
          setHostStopping(true)
        } catch (e) { setHostStopError(String(e)) }
        finally { setBusy(false) }
      }}>{hostStopping ? 'Quitting…' : 'Stop model service and quit'}</Button>}
    </div>
    {connectionResult && <p role="status" className="text-sm">Connected to {host.name}.</p>}
    {scanResult && <p role="status" className="text-sm">Model list refreshed.</p>}
    {actionResult && <p role="status" className="text-sm">{actionResult}</p>}
    {connectionRefreshFeedback}
    {actionError && <div role="alert" className="text-sm text-destructive"><p>{actionError.message}</p><details className="mt-2"><summary className="cursor-pointer">Technical details</summary><p className="whitespace-pre-wrap break-all">{actionError.details}</p></details></div>}
    {hostStopError && <div role="alert" className="text-sm text-destructive"><p>Could not stop the model service. Wait for any model loading or other work to finish, then try again.</p><details className="mt-2"><summary className="cursor-pointer">Technical details</summary><p className="whitespace-pre-wrap break-all">{hostStopError}</p></details></div>}
    {!error && snapshot?.draft_width_calibrations?.some(job => job.status === 'running') && <p role="status" className="text-sm text-muted-foreground">Finishing graphics-card speed tuning (about 1 minute). Your graphics card is busy until it finishes. Starting a model stops the tuning.</p>}
    {hostStopping && <p role="status" className="text-sm text-muted-foreground">The model service is stopping. Quitting GChat…</p>}
    {!host.local && !snapshot && <p className="text-sm text-muted-foreground">Choose Connect to use this saved computer. Your desktop may ask you to unlock the saved sign-in.</p>}
    {snapshot && <p className="text-sm text-muted-foreground">A model server runs one model and makes it available for chats. Each server uses graphics-card memory on the computer running it.</p>}
    {host.local ? <EngineFirstRun hostId={host.host_id} hardwareProfileControls={hardwareProfileControls} /> : hardwareProfileControls}
    {host.local && snapshot && <EngineHostSharing sharing={snapshot.lan_sharing} managementNotice={snapshot.management_notice} />}
      {host.local && snapshot && <EngineGbotControl clients={snapshot.clients} disabled={busy || !!error} change={(client_id, action) => act('gbot_grant', { body: { client_id, action } })} />}
    {snapshot && <details className="rounded-lg border p-4 space-y-3">
      <summary className="cursor-pointer font-medium">Start a model with saved settings</summary>
      <EngineProfilePicker hideHeading key={active?.instance_id ?? 'additional'} instanceId={active?.instance_id ?? ''} labelPrefix={host.name}
        snapshot={snapshot} disabled={busy || !!error || active?.status === 'starting' || active?.status === 'stopping'}
        launch={async body => { if (await act('profile_launch', { body })) setActiveId('') }} />
      {active && snapshot.gpus.some(gpu => !snapshot.instances.some(instance => instance.configuration.gpu_uuids.includes(gpu.uuid))) &&
        <Button variant="outline" disabled={busy || !!error} onClick={() => setActiveId('additional')}>Use other graphics cards for another model</Button>}
      {activeId === 'additional' && <Button variant="outline" onClick={() => setActiveId('')}>Cancel another model</Button>}
    </details>}
    {snapshot && <details className="rounded-lg border p-4 space-y-3">
      <summary className="cursor-pointer font-medium">Model and memory settings</summary>
      <div className="flex flex-wrap gap-2">{snapshot.gpus.map((gpu, index) => <span className="rounded border px-3 py-1 text-sm" key={gpu.uuid}>Graphics card {index + 1}: {gpu.display_name ?? gpu.name} · {(gpu.memory_mib / 1024).toFixed(0)} GiB</span>)}</div>
      {active?.status === 'stopped' && <p className="text-sm text-muted-foreground">This model is stopped. Choose a model and saved settings above to start it again.</p>}
      {!snapshot.instances.length && <p className="text-sm text-muted-foreground">No models are loaded. Choose an installed model below to start one.</p>}
      {(active ? [active] : []).map((instance) => <div key={instance.instance_id} className="rounded-lg bg-muted/40 p-3 space-y-2">
        <details><summary className="cursor-pointer text-sm text-muted-foreground">Current model settings</summary><EngineInstanceSettings instance={instance} online={!error} /></details>
        {instance.last_error && <div role="alert" className="text-sm text-destructive"><p>The model reported a problem. Check its settings and available graphics-card memory before trying again.</p><details className="mt-2"><summary className="cursor-pointer">Technical details</summary><p className="whitespace-pre-wrap break-all">{instance.last_error}</p></details></div>}
        <div className="flex gap-2">
          {instance.profile && <Button variant="outline" disabled={busy || !!error} onClick={() => {
            const profile = instance.profile!
            setEditing(instance.instance_id); setSettingsOpen(true); setModelId(profile.model_id); setGpus(profile.gpu_uuids)
            setEditingSession(instance.session_id)
            setContext(profile.max_context); setConcurrency(profile.concurrency)
            setOptions({ vision: profile.vision, structured_outputs: profile.structured_outputs ?? true, spec: profile.spec, draft_tokens: profile.draft_tokens, draft_tp: profile.draft_tp,
              kv_dtype: profile.kv_dtype, kv_arena_bytes: profile.kv_arena_bytes, host_kv_cache_bytes: profile.host_kv_cache_bytes ?? null,
              kv_arena_headroom_bytes: profile.kv_arena_headroom_bytes,
              prefill_chunk: profile.prefill_chunk, no_cuda_graph: profile.no_cuda_graph })
          }}>Edit settings</Button>}
          <Button variant="outline" disabled={busy || !!error || !['ready', 'starting'].includes(instance.status)} onClick={async () => {
            if (await confirmAction({ title: 'Stop this model immediately?', message: 'This stops the model now and cancels any replies it is generating. Other people using this model will also lose their current replies.', confirmLabel: 'Stop immediately', destructive: true })) void act('stop', { instance_id: instance.instance_id, body: { force: true, expected_session_id: instance.session_id } })
          }}>Stop immediately</Button>
        </div>
      </div>)}
      <details ref={editor} open={settingsOpen} className="rounded-lg border p-4 space-y-3">
      <summary className="cursor-pointer font-medium" onClick={event => { event.preventDefault(); setSettingsOpen(!settingsOpen) }}>{editing ? 'Change model settings' : 'Choose model settings'}</summary>
      {editingInstance && <p className="text-sm text-muted-foreground">Changing {hostInstanceLabel(editingInstance, snapshot)}. Save and restart below to apply your choices.</p>}
      <h3 className="font-medium">Installed models</h3>
      {!!snapshot.inventory_errors?.length && <div role="alert" className="rounded border border-destructive/40 p-3 text-sm"><p className="font-medium">Some model files could not be read. Check that the files are available, then refresh the model list.</p><details className="mt-2"><summary className="cursor-pointer">Technical details</summary>{snapshot.inventory_errors.map((item, index) => <p key={`${item.path}-${index}`} className="mt-1 break-all">{item.path}: {item.error}</p>)}</details><Button variant="outline" disabled={busy || !!error} onClick={() => void scanModels()}>Refresh model list</Button></div>}
      <p className="text-sm text-muted-foreground">Choose an installed model and the graphics cards it will use. Check these settings to confirm which model file will be used and how much memory it needs before starting it.</p>
      <label className="block text-sm">Installed model<ChoiceSelect aria-label="Installed model" className="mt-1 w-full" value={modelId} onValueChange={(value) => {
        setModelId(value)
        const model = snapshot.models.find(m => m.id === value)
        const target = model?.metadata.identity.model_id
        setContext(target === 'qwen3.8-27b' || target === 'qwen3.8-flash-next' ? 262144
          : target === 'muse-glimmer-30b' ? 131072 : 0)
        const occupied = new Set(snapshot.instances.filter(i => ['ready', 'starting', 'stopping'].includes(i.status) && i.instance_id !== editing).flatMap(i => i.configuration.gpu_uuids))
        const available = snapshot.gpus.filter(g => !occupied.has(g.uuid))
        setGpus(model?.metadata.tp_size === 1 && available.length === 1 ? [available[0].uuid] : [])
      }} options={[{ value: '', label: 'Choose an installed model' }, ...snapshot.models.map(m => ({ value: m.id, title: weightsDrafterDetail(m.metadata.identity.weights_id), label: `${hostModelLabel(m)} · ${m.metadata.tp_size} ${m.metadata.tp_size === 1 ? 'graphics card' : 'graphics cards'} · ${(m.metadata.size_bytes / 1024 ** 3).toFixed(1)} GiB${m.artifact_set ? ' · multi-file model' : ''}` }))]} /></label>
      <div className="flex flex-wrap gap-3">{snapshot.gpus.map((gpu, index) => <label key={gpu.uuid} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={gpus.includes(gpu.uuid)} onChange={(e) => setGpus((ids) => e.target.checked ? [...ids, gpu.uuid] : ids.filter((id) => id !== gpu.uuid))} />Graphics card {index + 1}: {gpu.display_name ?? gpu.name}</label>)}</div>
      <div className="flex flex-wrap gap-4">
        <label className="text-sm">Conversation length (tokens)<Input type="number" min={1} value={context || ''} onChange={(e) => setContext(Number(e.target.value))} /></label>
        <label className="text-sm">Requests at once<Input type="number" min={1} max={8} value={concurrency} onChange={(e) => setConcurrency(Number(e.target.value))} /></label>
        {!editing && <label className="text-sm">Model copies<Input type="number" min={1} max={4294967295} value={instanceCount} onChange={(e) => setInstanceCount(Number(e.target.value))} /></label>}
      </div>
      <p className="text-sm text-muted-foreground">Tokens are pieces of text. Conversation length includes your messages, earlier conversation and the reply. Requests at once limits how many replies can be generated together. Each model copy is a separate server and needs its own memory.</p>
      {snapshot.model_management?.engine_presets_available === false && <p className="text-sm text-muted-foreground">There are no tested saved settings for these models yet. Choose your own settings below. When changing a running model, it finishes its current replies before restarting.</p>}
      <div className="flex flex-wrap gap-4">
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={options.vision} onChange={(e) => setOptions({ ...options, vision: e.target.checked })} />Read images</label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={options.structured_outputs} onChange={(e) => setOptions({ ...options, structured_outputs: e.target.checked })} />Follow a response format</label>
        <label className="text-sm">Reply speedup<ChoiceSelect aria-label="Reply speedup" className="ml-2" value={options.spec} onValueChange={value => setOptions({ ...options, spec: value as EngineLaunchOptions['spec'], draft_tokens: 0, draft_tp: 0 })} options={[{ value: 'none', label: 'Off' }, { value: 'auto', label: 'Automatic' }, { value: 'dflash', label: 'DFlash' }]} /></label>
        <label className="text-sm">Conversation memory format<ChoiceSelect aria-label="Conversation memory format" className="ml-2" value={options.kv_dtype} onValueChange={value => setOptions({ ...options, kv_dtype: value as EngineLaunchOptions['kv_dtype'] })} options={['auto', 'bf16', 'int8', 'nvfp4'].map(value => ({ value, label: value === 'auto' ? 'Automatic' : value.toUpperCase() }))} /></label>
      </div>
      <p className="text-sm text-muted-foreground">Read images lets the model understand pictures when supported. Follow a response format lets apps request replies in a set format, such as JSON. Reply speedup drafts text ahead for the model to check; DFlash is one method. Conversation memory stores earlier text; its format affects memory use.</p>
      {launchError && selected && <p role="alert" className="text-sm text-destructive">{launchError}</p>}
      <details className="space-y-3"><summary className="cursor-pointer text-sm">Advanced model settings</summary>
        <p className="text-sm text-muted-foreground">These settings control how GInfer, the program running your model, uses memory and drafts replies. Leave them at their defaults unless you need to adjust them.</p>
        <p className="text-sm text-muted-foreground">Draft ahead length is how much text is drafted before the model checks it. Drafting graphics cards is the number of cards used for this work; it must match the model file. Input batch size is how much input text is processed at once. Set these to 0 to let GInfer choose.</p>
        <p className="text-sm text-muted-foreground">Conversation memory stores earlier text. The limits below are measured in bytes. Computer conversation memory uses this computer’s main memory: leave it blank for automatic sizing, set 0 to turn it off, or enter a positive size. Graphics-card conversation memory limits memory on the graphics cards; leave it blank for automatic sizing. CUDA Graphs reduce repeated setup work on the graphics card.</p>
        <div className="grid grid-cols-2 gap-3">{(['draft_tokens', 'draft_tp', 'prefill_chunk'] as const).map((key) => <label className="text-sm" key={key}>{advancedFieldLabels[key]}<Input type="number" min={0} max={Number.MAX_SAFE_INTEGER} value={options[key]} onChange={(e) => setOptions({ ...options, [key]: Number(e.target.value) })} /></label>)}
          <label className="text-sm">Computer conversation memory (bytes)<Input type="number" min={0} max={Number.MAX_SAFE_INTEGER} value={options.host_kv_cache_bytes ?? ''} onChange={(e) => setOptions({ ...options, host_kv_cache_bytes: e.target.value === '' ? null : Number(e.target.value) })} /></label>
          <label className="text-sm">Graphics-card conversation memory (bytes)<Input type="number" min={1} max={Number.MAX_SAFE_INTEGER} value={options.kv_arena_bytes ?? ''} onChange={(e) => setOptions({ ...options, kv_arena_bytes: e.target.value ? Number(e.target.value) : null })} /></label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={options.no_cuda_graph} onChange={(e) => setOptions({ ...options, no_cuda_graph: e.target.checked })} />Turn off CUDA Graphs</label>
        </div>
      </details>
      {!editing && <>
        <p className="text-sm text-muted-foreground">Checking settings does not start a model or set aside memory. When starting several copies, automatic sizing divides the available graphics-card conversation memory equally. Available memory is checked again when each model starts.</p>
        <Button variant="outline" disabled={busy || profiling || !!error || !!launchError || !selected || gpus.length !== selected.metadata.tp_size} onClick={() => {
          const key = quoteKey
          const revision = quoteRevision.current
          setBusy(true); setStartupQuote(null)
          void engineCommand<EngineStartupQuote>('quote', { host_id: host.host_id, body: { ...configuration, remaining_instances: instanceCount } })
            .then(result => { if (quoteRevision.current === revision) setStartupQuote({ key, result }) })
            .catch(error => { if (quoteRevision.current === revision) setStartupQuote({ key, error: String(error) }) })
            .finally(() => setBusy(false))
        }}>Check model settings</Button>
        {currentQuote?.result && <p role="status" className="text-sm">Model file checked: {identityLabel(currentQuote.result.model_identity)}. {currentQuote.result.instance_count} {currentQuote.result.instance_count === 1 ? 'model copy' : 'model copies'}. {currentQuote.result.kv_arena_bytes === null ? 'Conversation memory is automatic. Start one copy first so GInfer can measure its memory use before sharing the graphics cards.' : `${formatModelBytes(currentQuote.result.kv_arena_bytes)} of graphics-card conversation memory per model copy.`} This check did not start a model.</p>}
        {currentQuote?.error && <div role="alert" className="text-sm text-destructive"><p>These model settings could not be checked. Review your choices and available graphics-card memory, then try again.</p><details className="mt-2"><summary className="cursor-pointer">Technical details</summary><p className="whitespace-pre-wrap break-all">{currentQuote.error}</p></details></div>}
      </>}
      <div className="flex gap-2"><Button disabled={busy || profiling || !!error || !!launchError || !selected || gpus.length !== selected.metadata.tp_size} onClick={async () => {
        if (editing && !await confirmAction({ title: 'Save and restart this model?', message: 'The model will finish its current replies, then restart with your chosen settings. Other people using it will be affected while it restarts.', confirmLabel: 'Save and restart' })) return
        if (editing) void act('reload', { instance_id: editing, body: { configuration, expected_session_id: editingSession } })
        else void (async () => {
          for (let remaining = instanceCount; remaining > 0; remaining--) {
            if (!await act('launch', { body: { ...configuration, remaining_instances: remaining } })) {
              if (remaining < instanceCount) toast.warning(`${instanceCount - remaining} of ${instanceCount} model copies started. The started copies are still running; select each one above to manage it.`)
              break
            }
          }
        })()
      }}>{editing ? 'Save and restart model' : 'Start model with these settings'}</Button>
        {editing && <Button variant="outline" onClick={() => { setEditing(null); setSettingsOpen(false) }}>Cancel editing</Button>}
      </div>
      </details>
    </details>}
  </section>
}

import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { engineCommand, hardwareProfileBlocksLaunch, type EngineHost, type EngineSnapshot, type EngineLaunchOptions, type EngineStartupQuote } from '@/services/engines'
import { useEngineHosts } from '@/stores/engine-hosts-store'
import { EngineHostSharing } from '@/containers/EngineHostSharing'
import { EngineGbotControl } from '@/containers/EngineGbotControl'
import { EngineInstanceSettings } from '@/containers/EngineInstanceSettings'
import { EngineProfilePicker } from '@/containers/EngineProfilePicker'
import { EngineHardwareProfile } from '@/containers/EngineHardwareProfile'
import { EngineFirstRun } from '@/containers/EngineFirstRun'
import { hostInstanceLabel, hostModelLabel } from '@/lib/engine-host-labels'

export function HostCard({ host, snapshot, error }: { host: EngineHost; snapshot?: EngineSnapshot; error?: string }) {
  const refresh = useEngineHosts((s) => s.refresh)
  const [modelId, setModelId] = useState('')
  const [gpus, setGpus] = useState<string[]>([])
  const [context, setContext] = useState(0)
  const [concurrency, setConcurrency] = useState(1)
  const [instanceCount, setInstanceCount] = useState(1)
  const [startupQuote, setStartupQuote] = useState<{ key: string; result?: EngineStartupQuote; error?: string } | null>(null)
  const [busy, setBusy] = useState(false)
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
      editor.current?.querySelector('select')?.focus()
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
  const launchError = invalidNumbers ? 'Use whole numbers: positive context and instance count, 1–8 concurrent requests, and nonnegative advanced settings. GPU KV budget must be positive or blank.'
    : options.kv_dtype === 'nvfp4' && selected?.metadata.nvfp4_kv_available === false
      ? 'This artifact lacks NVFP4 KV calibration. Install a calibrated artifact or select INT8/BF16 KV.' : null
  const act = async (action: string, args: Record<string, unknown> = {}) => {
    setBusy(true)
    try {
      const result = await engineCommand<{ credential_cleanup_warning?: string | null }>(action, { host_id: host.host_id, ...args })
      if (result?.credential_cleanup_warning) toast.warning(`Host forgotten, but OS credential cleanup failed: ${result.credential_cleanup_warning}`)
      await refresh()
      return true
    }
    catch (e) { toast.error(String(e)); return false } finally { setBusy(false) }
  }
  const hardwareProfileControls = snapshot?.hardware_profile && <EngineHardwareProfile profile={snapshot.hardware_profile} calibrations={snapshot.draft_width_calibrations} gpus={snapshot.gpus} offline={!!error} disabled={busy}
    action={(action, gpu_uuids) => act('hardware_profile', { body: { action, ...(gpu_uuids ? { gpu_uuids } : {}) } })} />
  return <section className="rounded-xl border p-5 space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><h2 className="font-semibold">{host.name}</h2><p className="text-sm text-muted-foreground">{host.base_url} · {error ? 'GInfer offline' : snapshot ? 'Connected' : host.local ? 'Connecting' : 'Not connected'}</p></div>
      {!host.local && (error || !snapshot) && <Button variant="outline" disabled={busy} onClick={() => void act('connect')}>Connect</Button>}
      {active && snapshot && <div className="flex min-w-0 flex-1 flex-wrap items-end gap-3">
        <div className="min-w-0 flex-1">
        {snapshot.instances.length > 1 ? <label className="min-w-0 text-xs font-medium">Server instance
        <select aria-label={`${host.name} serving instance`} className="mt-1 block w-full min-w-0 rounded border bg-background p-2 text-sm font-normal" value={active.instance_id} onChange={e => setActiveId(e.target.value)}>
          {snapshot.instances.map(i => <option key={i.instance_id} value={i.instance_id}>{hostInstanceLabel(i, snapshot)} · {i.status}</option>)}
        </select></label> : <p className="text-sm">{hostInstanceLabel(active, snapshot)} · {active.status}</p>}
        </div>
        <div className="flex items-center gap-2">
        <Button variant="outline" disabled={busy || profiling || !!error || !active.profile || !['stopped', 'failed'].includes(active.status)} onClick={() => void act('start', { instance_id: active.instance_id, body: {} })}>Start</Button>
        <Button variant="outline" disabled={busy || !!error || !['ready', 'starting'].includes(active.status)} onClick={() => void act('stop', { instance_id: active.instance_id, body: { force: false, expected_session_id: active.session_id } })}>Stop</Button>
        <Button variant="outline" disabled={busy || profiling || !!error || active.status !== 'ready'} onClick={() => {
          if (window.confirm('Reload this instance with its saved settings after current requests drain?')) void act('restart', { instance_id: active.instance_id, body: { force: false, expected_session_id: active.session_id } })
        }}>Reload</Button>
        </div>
      </div>}
      {host.local ? <span className="text-sm text-muted-foreground">Local host</span> : <Button variant="outline" disabled={busy} onClick={() => {
        if (window.confirm(`Forget ${host.name}? This removes its saved connection from GChat. Running jobs stay on the host.`)) void act('forget')
      }}>Forget</Button>}
      {host.local && snapshot?.can_stop_host && <Button variant="outline" disabled={busy || hostStopping || !!error} onClick={async () => {
        setBusy(true)
        setHostStopError(null)
        try {
          await engineCommand('stop_host', { host_id: host.host_id })
          setHostStopping(true)
        } catch (e) { setHostStopError(String(e)) }
        finally { setBusy(false) }
      }}>{hostStopping ? 'Quitting…' : 'Stop Host and Quit'}</Button>}
    </div>
    {hostStopError && <p role="alert" className="text-sm text-destructive">{hostStopError}</p>}
    {hostStopping && <p role="status" className="text-sm text-muted-foreground">Host is stopping. Quitting GChat…</p>}
    {!host.local && !snapshot && <p className="text-sm text-muted-foreground">Choose Connect to use this saved host. Your desktop may ask you to unlock its stored credential.</p>}
    {host.local ? <EngineFirstRun hostId={host.host_id} hardwareProfileControls={hardwareProfileControls} /> : hardwareProfileControls}
    {host.local && snapshot && <EngineHostSharing sharing={snapshot.lan_sharing} managementNotice={snapshot.management_notice} />}
      {host.local && snapshot && <EngineGbotControl clients={snapshot.clients} disabled={busy || !!error} change={(client_id, action) => act('gbot_grant', { body: { client_id, action } })} />}
    {snapshot && <details className="rounded-lg border p-4 space-y-3">
      <summary className="cursor-pointer font-medium">Launch Server Instance</summary>
      <EngineProfilePicker hideHeading key={active?.instance_id ?? 'additional'} instanceId={active?.instance_id ?? ''} labelPrefix={host.name}
        snapshot={snapshot} disabled={busy || !!error || active?.status === 'starting' || active?.status === 'stopping'}
        launch={async body => { if (await act('profile_launch', { body })) setActiveId('') }} />
      {active && snapshot.gpus.some(gpu => !snapshot.instances.some(instance => instance.configuration.gpu_uuids.includes(gpu.uuid))) &&
        <Button variant="outline" disabled={busy || !!error} onClick={() => setActiveId('additional')}>Add server on another GPU group</Button>}
      {activeId === 'additional' && <Button variant="outline" onClick={() => setActiveId('')}>Cancel additional server</Button>}
    </details>}
    {snapshot && <details className="rounded-lg border p-4 space-y-3">
      <summary className="cursor-pointer font-medium">Server details</summary>
      <div className="flex flex-wrap gap-2">{snapshot.gpus.map((gpu, index) => <span className="rounded border px-3 py-1 text-sm" key={gpu.uuid}>GPU {index + 1}: {gpu.display_name ?? gpu.name} · {(gpu.memory_mib / 1024).toFixed(0)} GB</span>)}</div>
      {active?.status === 'stopped' && <p className="text-sm text-muted-foreground">Server stopped. Select a model and profile above to reuse this instance.</p>}
      {!snapshot.instances.length && <p className="text-sm text-muted-foreground">No models are loaded. Choose an installed model below to start one.</p>}
      {(active ? [active] : []).map((instance) => <div key={instance.instance_id} className="rounded-lg bg-muted/40 p-3 space-y-2">
        <details><summary className="cursor-pointer text-sm text-muted-foreground">Runtime details</summary><EngineInstanceSettings instance={instance} online={!error} /></details>
        {instance.last_error && <p role="alert" className="text-sm text-destructive">{instance.last_error}</p>}
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
          <Button variant="outline" disabled={busy || !!error || !['ready', 'starting'].includes(instance.status)} onClick={() => {
            if (window.confirm('Force-stop this instance and cancel its active requests?')) void act('stop', { instance_id: instance.instance_id, body: { force: true, expected_session_id: instance.session_id } })
          }}>Force stop</Button>
        </div>
      </div>)}
      <details ref={editor} open={settingsOpen} className="rounded-lg border p-4 space-y-3">
      <summary className="cursor-pointer font-medium" onClick={event => { event.preventDefault(); setSettingsOpen(!settingsOpen) }}>{editing ? 'Edit server instance settings' : 'Custom server settings'}</summary>
      {editingInstance && <p className="text-sm text-muted-foreground">Editing {hostInstanceLabel(editingInstance, snapshot)}. Apply below to save and reload.</p>}
      <h3 className="font-medium">Installed models</h3>
      {!!snapshot.inventory_errors?.length && <div role="alert" className="rounded border border-destructive/40 p-3 text-sm"><p className="font-medium">Some inventory paths could not be loaded</p>{snapshot.inventory_errors.map((item, index) => <p key={`${item.path}-${index}`} className="mt-1 break-all">{item.path}: {item.error}</p>)}<Button variant="outline" disabled={busy || !!error} onClick={() => void act('scan')}>Rescan models</Button></div>}
      <p className="text-sm text-muted-foreground">Select an installed model and its GPU group. Check startup settings to verify its artifact identity and memory requirements before loading.</p>
      <label className="block text-sm">Custom model<select className="mt-1 w-full rounded border bg-background p-2" value={modelId} onChange={(e) => {
        setModelId(e.target.value)
        const model = snapshot.models.find(m => m.id === e.target.value)
        const target = model?.metadata.identity.model_id
        setContext(target === 'qwen3.8-27b' || target === 'qwen3.8-flash-next' ? 262144
          : target === 'muse-glimmer-30b' ? 131072 : 0)
        const occupied = new Set(snapshot.instances.filter(i => ['ready', 'starting', 'stopping'].includes(i.status) && i.instance_id !== editing).flatMap(i => i.configuration.gpu_uuids))
        const available = snapshot.gpus.filter(g => !occupied.has(g.uuid))
        setGpus(model?.metadata.tp_size === 1 && available.length === 1 ? [available[0].uuid] : [])
      }}>
        <option value="">Choose an installed model</option>
        {snapshot.models.map((m) => <option key={m.id} value={m.id}>{hostModelLabel(m)} · TP{m.metadata.tp_size} · {(m.metadata.size_bytes / 1024 ** 3).toFixed(1)} GB{m.artifact_set ? ' · deployment set' : ''}</option>)}
      </select></label>
      <div className="flex flex-wrap gap-3">{snapshot.gpus.map((gpu, index) => <label key={gpu.uuid} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={gpus.includes(gpu.uuid)} onChange={(e) => setGpus((ids) => e.target.checked ? [...ids, gpu.uuid] : ids.filter((id) => id !== gpu.uuid))} />GPU {index + 1}: {gpu.display_name ?? gpu.name}</label>)}</div>
      <div className="flex flex-wrap gap-4">
        <label className="text-sm">Context tokens<Input type="number" min={1} value={context || ''} onChange={(e) => setContext(Number(e.target.value))} /></label>
        <label className="text-sm">Concurrent requests<Input type="number" min={1} max={8} value={concurrency} onChange={(e) => setConcurrency(Number(e.target.value))} /></label>
        {!editing && <label className="text-sm">Instances<Input type="number" min={1} max={4294967295} value={instanceCount} onChange={(e) => setInstanceCount(Number(e.target.value))} /></label>}
      </div>
      {snapshot.model_management?.engine_presets_available === false && <p className="text-sm text-muted-foreground">No qualified profiles are installed for these models. The controls below use custom launch settings. Reload drains this instance’s tracked requests before applying changes.</p>}
      <div className="flex flex-wrap gap-4">
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={options.vision} onChange={(e) => setOptions({ ...options, vision: e.target.checked })} />Vision</label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={options.structured_outputs} onChange={(e) => setOptions({ ...options, structured_outputs: e.target.checked })} />Structured outputs</label>
        <label className="text-sm">Speculative decoding<select className="ml-2 rounded border bg-background p-2" value={options.spec} onChange={(e) => setOptions({ ...options, spec: e.target.value as EngineLaunchOptions['spec'], draft_tokens: 0, draft_tp: 0 })}><option value="none">Disabled</option><option value="auto">Automatic</option><option value="dflash">DFlash</option></select></label>
        <label className="text-sm">KV format<select className="ml-2 rounded border bg-background p-2" value={options.kv_dtype} onChange={(e) => setOptions({ ...options, kv_dtype: e.target.value as EngineLaunchOptions['kv_dtype'] })}>{['auto', 'bf16', 'int8', 'nvfp4'].map((v) => <option key={v} value={v}>{v}</option>)}</select></label>
      </div>
      {launchError && selected && <p role="alert" className="text-sm text-destructive">{launchError}</p>}
      <details className="space-y-3"><summary className="cursor-pointer text-sm">Advanced launch settings</summary>
        <p className="text-sm text-muted-foreground">Zero selects engine defaults for draft count, draft TP and prefill chunk. Draft TP must match the artifact. Memory budgets are bytes. Host KV cache is automatic when blank; zero disables it and a positive value sets its exact size.</p>
        <div className="grid grid-cols-2 gap-3">{(['draft_tokens', 'draft_tp', 'prefill_chunk'] as const).map((key) => <label className="text-sm" key={key}>{key.replaceAll('_', ' ')}<Input type="number" min={0} max={Number.MAX_SAFE_INTEGER} value={options[key]} onChange={(e) => setOptions({ ...options, [key]: Number(e.target.value) })} /></label>)}
          <label className="text-sm">Host KV cache (bytes, blank = automatic, 0 = disabled)<Input type="number" min={0} max={Number.MAX_SAFE_INTEGER} value={options.host_kv_cache_bytes ?? ''} onChange={(e) => setOptions({ ...options, host_kv_cache_bytes: e.target.value === '' ? null : Number(e.target.value) })} /></label>
          <label className="text-sm">GPU KV budget (blank = automatic)<Input type="number" min={1} max={Number.MAX_SAFE_INTEGER} value={options.kv_arena_bytes ?? ''} onChange={(e) => setOptions({ ...options, kv_arena_bytes: e.target.value ? Number(e.target.value) : null })} /></label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={options.no_cuda_graph} onChange={(e) => setOptions({ ...options, no_cuda_graph: e.target.checked })} />Disable CUDA Graphs</label>
        </div>
      </details>
      {!editing && <>
        <p className="text-sm text-muted-foreground">The check does not load a model or reserve memory. For multiple instances, Automatic divides the remaining GPU KV memory equally. Startup checks the available memory again.</p>
        <Button variant="outline" disabled={busy || profiling || !!error || !!launchError || !selected || gpus.length !== selected.metadata.tp_size} onClick={() => {
          const key = quoteKey
          const revision = quoteRevision.current
          setBusy(true); setStartupQuote(null)
          void engineCommand<EngineStartupQuote>('quote', { host_id: host.host_id, body: { ...configuration, remaining_instances: instanceCount } })
            .then(result => { if (quoteRevision.current === revision) setStartupQuote({ key, result }) })
            .catch(error => { if (quoteRevision.current === revision) setStartupQuote({ key, error: String(error) }) })
            .finally(() => setBusy(false))
        }}>Check startup settings</Button>
        {currentQuote?.result && <p role="status" className="text-sm">Verified artifact: {currentQuote.result.model_identity.model_id} / {currentQuote.result.model_identity.weights_id}. {currentQuote.result.instance_count} instance(s). {currentQuote.result.kv_arena_bytes === null ? 'Automatic KV; a solo startup must measure graph memory before sharing.' : `${currentQuote.result.kv_arena_bytes.toLocaleString()} bytes GPU KV per instance.`} This check did not start a model.</p>}
        {currentQuote?.error && <p role="alert" className="text-sm text-destructive">{currentQuote.error}</p>}
      </>}
      <div className="flex gap-2"><Button disabled={busy || profiling || !!error || !!launchError || !selected || gpus.length !== selected.metadata.tp_size} onClick={() => {
        if (editing && !window.confirm('Apply these model and launch settings? This restarts the selected instance after its current requests drain.')) return
        if (editing) void act('reload', { instance_id: editing, body: { configuration, expected_session_id: editingSession } })
        else void (async () => {
          for (let remaining = instanceCount; remaining > 0; remaining--) {
            if (!await act('launch', { body: { ...configuration, remaining_instances: remaining } })) {
              if (remaining < instanceCount) toast.warning(`${instanceCount - remaining} of ${instanceCount} instances started. Manage these instances separately.`)
              break
            }
          }
        })()
      }}>{editing ? 'Apply settings and reload' : 'Load model'}</Button>
        {editing && <Button variant="outline" onClick={() => { setEditing(null); setSettingsOpen(false) }}>Cancel editing</Button>}
      </div>
      </details>
    </details>}
  </section>
}

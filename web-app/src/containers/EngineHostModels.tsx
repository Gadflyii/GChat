import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { engineCommand, type EngineHost, type EngineSnapshot, type EngineLaunchOptions } from '@/services/engines'
import { useEngineHosts } from '@/stores/engine-hosts-store'
import { EngineInstanceSettings } from '@/containers/EngineInstanceSettings'
import { EngineProfilePicker } from '@/containers/EngineProfilePicker'

export function HostCard({ host, snapshot, error }: { host: EngineHost; snapshot?: EngineSnapshot; error?: string }) {
  const refresh = useEngineHosts((s) => s.refresh)
  const [modelId, setModelId] = useState('')
  const [gpus, setGpus] = useState<string[]>([])
  const [context, setContext] = useState(8192)
  const [concurrency, setConcurrency] = useState(1)
  const [busy, setBusy] = useState(false)
  const [expanded, setExpanded] = useState(true)
  const [activeId, setActiveId] = useState('')
  const active = snapshot?.instances.find(i => i.instance_id === activeId) ?? snapshot?.instances[0]
  const [editing, setEditing] = useState<string | null>(null)
  const [editingSession, setEditingSession] = useState<string | null>(null)
  const [options, setOptions] = useState<EngineLaunchOptions>({ vision: true, spec: 'none', draft_tokens: 0, draft_tp: 0, kv_dtype: 'auto', kv_arena_bytes: null, host_kv_cache_bytes: 0, prefill_chunk: 0, no_cuda_graph: false })
  const selected = snapshot?.models.find((m) => m.id === modelId)
  const invalidNumbers = !Number.isSafeInteger(context) || context < 1 ||
    !Number.isSafeInteger(concurrency) || concurrency < 1 || concurrency > 8 ||
    [options.draft_tokens, options.draft_tp, options.prefill_chunk, options.host_kv_cache_bytes]
      .some((value) => !Number.isSafeInteger(value) || value < 0) ||
    (options.kv_arena_bytes !== null && (!Number.isSafeInteger(options.kv_arena_bytes) || options.kv_arena_bytes < 1))
  const launchError = invalidNumbers ? 'Use whole numbers: positive context, 1–8 concurrent requests, and nonnegative advanced settings. GPU KV budget must be positive or blank.'
    : options.kv_dtype === 'nvfp4' && selected?.metadata.nvfp4_kv_available === false
      ? 'This artifact lacks NVFP4 KV calibration. Install a calibrated artifact or select INT8/BF16 KV.' : null
  const act = async (action: string, args: Record<string, unknown> = {}) => {
    setBusy(true)
    try {
      const result = await engineCommand<{ credential_cleanup_warning?: string | null }>(action, { host_id: host.host_id, ...args })
      if (result?.credential_cleanup_warning) toast.warning(`Host forgotten, but OS credential cleanup failed: ${result.credential_cleanup_warning}`)
      await refresh()
    }
    catch (e) { toast.error(String(e)) } finally { setBusy(false) }
  }
  return <section className="rounded-xl border p-5 space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><button className="font-semibold" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>{expanded ? '▾' : '▸'} {host.name}</button><p className="text-sm text-muted-foreground">{host.base_url} · {error ? 'Unavailable' : snapshot ? 'Connected' : 'Connecting'}</p></div>
      {active && <div className="flex flex-wrap items-center gap-2">
        <select aria-label={`${host.name} serving instance`} className="max-w-60 rounded border bg-background p-2 text-sm" value={active.instance_id} onChange={e => setActiveId(e.target.value)}>
          {snapshot?.instances.map(i => <option key={i.instance_id} value={i.instance_id}>{i.display_name} · {i.status}</option>)}
        </select>
        <Button variant="outline" disabled={busy || !!error || !active.profile || !['stopped', 'failed'].includes(active.status)} onClick={() => void act('start', { instance_id: active.instance_id, body: {} })}>Start</Button>
        <Button variant="outline" disabled={busy || !!error || !['ready', 'starting'].includes(active.status)} onClick={() => void act('stop', { instance_id: active.instance_id, body: { force: false, expected_session_id: active.session_id } })}>Stop</Button>
        <Button variant="outline" disabled={busy || !!error || active.status !== 'ready'} onClick={() => {
          if (window.confirm('Reload this instance with its saved settings after current requests drain?')) void act('restart', { instance_id: active.instance_id, body: { force: false, expected_session_id: active.session_id } })
        }}>Reload</Button>
        {active.profile && <select aria-label={`${host.name} model`} className="max-w-60 rounded border bg-background p-2 text-sm" value={active.profile.model_id} disabled={busy || !!error || active.status === 'stopping' || active.status === 'starting'} onChange={e => {
          if (!active.profile || !window.confirm('Change the model for this instance? Current requests drain before serving restarts. Existing context and concurrency settings are retained; select a hardware profile to change them.')) return
          void act('reload', { instance_id: active.instance_id, body: { configuration: { ...active.profile, qualified_profile_id: null, model_id: e.target.value }, expected_session_id: active.session_id } })
        }}>
          {snapshot?.models.filter(m => m.metadata.tp_size === active.profile!.gpu_uuids.length).map(m => <option key={m.id} value={m.id}>{m.metadata.identity.model_id} / {m.metadata.identity.weights_id}</option>)}
        </select>}
      </div>}
      {host.local ? <span className="text-sm text-muted-foreground">Local host</span> : <Button variant="outline" disabled={busy} onClick={() => {
        if (window.confirm(`Forget ${host.name}? This removes its saved connection from GChat. Running jobs stay on the host.`)) void act('forget')
      }}>Forget</Button>}
    </div>
    {error && <p role="alert" className="text-sm text-destructive">{error}. Saved models below are last known; reconnect before using them.</p>}
    {snapshot && expanded && <>
      <div className="flex flex-wrap gap-2">{snapshot.gpus.map((gpu) => <span className="rounded border px-3 py-1 text-sm" key={gpu.uuid}>{gpu.name} · {(gpu.memory_mib / 1024).toFixed(0)} GB</span>)}</div>
      <EngineProfilePicker snapshot={snapshot} disabled={busy || !!error} launch={body => act('profile_launch', { body })} />
      <h3 className="font-medium">Configured instances</h3>
      {!snapshot.instances.length && <p className="text-sm text-muted-foreground">No models are loaded. Choose an installed model below to start one.</p>}
      {snapshot.instances.map((instance) => <div key={instance.instance_id} className="rounded-lg bg-muted/40 p-3 space-y-2">
        <p>{instance.display_name} · {instance.status}</p>
        <EngineInstanceSettings instance={instance} online={!error} />
        {instance.last_error && <p role="alert" className="text-sm text-destructive">{instance.last_error}</p>}
        <div className="flex gap-2">
          {instance.profile && <Button variant="outline" disabled={busy || !!error} onClick={() => {
            const profile = instance.profile!
            setEditing(instance.instance_id); setModelId(profile.model_id); setGpus(profile.gpu_uuids)
            setEditingSession(instance.session_id)
            setContext(profile.max_context); setConcurrency(profile.concurrency)
            setOptions({ vision: profile.vision, spec: profile.spec, draft_tokens: profile.draft_tokens, draft_tp: profile.draft_tp,
              kv_dtype: profile.kv_dtype, kv_arena_bytes: profile.kv_arena_bytes, host_kv_cache_bytes: profile.host_kv_cache_bytes,
              kv_arena_headroom_bytes: profile.kv_arena_headroom_bytes,
              prefill_chunk: profile.prefill_chunk, no_cuda_graph: profile.no_cuda_graph })
          }}>Edit settings</Button>}
          <Button variant="outline" disabled={busy || !!error || !['ready', 'starting'].includes(instance.status)} onClick={() => {
            if (window.confirm('Force-stop this instance and cancel its active requests?')) void act('stop', { instance_id: instance.instance_id, body: { force: true, expected_session_id: instance.session_id } })
          }}>Force stop</Button>
        </div>
      </div>)}
      <h3 className="font-medium">Installed models</h3>
      {!!snapshot.inventory_errors?.length && <div role="alert" className="rounded border border-destructive/40 p-3 text-sm"><p className="font-medium">Some inventory paths could not be loaded</p>{snapshot.inventory_errors.map((item, index) => <p key={`${item.path}-${index}`} className="mt-1 break-all">{item.path}: {item.error}</p>)}<Button variant="outline" disabled={busy || !!error} onClick={() => void act('scan')}>Rescan models</Button></div>}
      <p className="text-sm text-muted-foreground">Select a model and its GPU group. The engine verifies compatibility when loading. GPU selections are exclusive to this host service.</p>
      <label className="block text-sm">Model<select className="mt-1 w-full rounded border bg-background p-2" value={modelId} onChange={(e) => {
        setModelId(e.target.value)
        const model = snapshot.models.find(m => m.id === e.target.value)
        const occupied = new Set(snapshot.instances.filter(i => ['ready', 'starting', 'stopping'].includes(i.status) && i.instance_id !== editing).flatMap(i => i.configuration.gpu_uuids))
        const available = snapshot.gpus.filter(g => !occupied.has(g.uuid))
        setGpus(model?.metadata.tp_size === 1 && available.length === 1 ? [available[0].uuid] : [])
      }}>
        <option value="">Choose an installed model</option>
        {snapshot.models.map((m) => <option key={m.id} value={m.id}>{m.metadata.identity.model_id} / {m.metadata.identity.weights_id} · TP{m.metadata.tp_size} · {(m.metadata.size_bytes / 1024 ** 3).toFixed(1)} GB{m.artifact_set ? ' · deployment set' : ''}</option>)}
      </select></label>
      <div className="flex flex-wrap gap-3">{snapshot.gpus.map((gpu) => <label key={gpu.uuid} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={gpus.includes(gpu.uuid)} onChange={(e) => setGpus((ids) => e.target.checked ? [...ids, gpu.uuid] : ids.filter((id) => id !== gpu.uuid))} />{gpu.name} ({gpu.uuid.slice(-8)})</label>)}</div>
      <div className="flex flex-wrap gap-4">
        <label className="text-sm">Context tokens<Input type="number" min={1} value={context} onChange={(e) => setContext(Number(e.target.value))} /></label>
        <label className="text-sm">Concurrent requests<Input type="number" min={1} max={8} value={concurrency} onChange={(e) => setConcurrency(Number(e.target.value))} /></label>
      </div>
      {snapshot.model_management?.engine_presets_available === false && <p className="text-sm text-muted-foreground">No qualified profiles are installed for these models. The controls below use custom launch settings. Reload drains this instance’s tracked requests before applying changes.</p>}
      <div className="flex flex-wrap gap-4">
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={options.vision} onChange={(e) => setOptions({ ...options, vision: e.target.checked })} />Vision</label>
        <label className="text-sm">Speculative decoding<select className="ml-2 rounded border bg-background p-2" value={options.spec} onChange={(e) => setOptions({ ...options, spec: e.target.value as EngineLaunchOptions['spec'], draft_tokens: 0, draft_tp: 0 })}><option value="none">Disabled</option><option value="auto">Automatic</option><option value="dflash">DFlash</option></select></label>
        <label className="text-sm">KV format<select className="ml-2 rounded border bg-background p-2" value={options.kv_dtype} onChange={(e) => setOptions({ ...options, kv_dtype: e.target.value as EngineLaunchOptions['kv_dtype'] })}>{['auto', 'bf16', 'int8', 'nvfp4'].map((v) => <option key={v} value={v}>{v}</option>)}</select></label>
      </div>
      {launchError && <p role="alert" className="text-sm text-destructive">{launchError}</p>}
      <details className="space-y-3"><summary className="cursor-pointer text-sm">Advanced launch settings</summary>
        <p className="text-sm text-muted-foreground">Zero selects engine defaults for draft count, draft TP and prefill chunk. Draft TP must match the artifact. Memory budgets are bytes; host KV zero disables host caching.</p>
        <div className="grid grid-cols-2 gap-3">{(['draft_tokens', 'draft_tp', 'prefill_chunk', 'host_kv_cache_bytes'] as const).map((key) => <label className="text-sm" key={key}>{key.replaceAll('_', ' ')}<Input type="number" min={0} max={Number.MAX_SAFE_INTEGER} value={options[key]} onChange={(e) => setOptions({ ...options, [key]: Number(e.target.value) })} /></label>)}
          <label className="text-sm">GPU KV budget (blank = automatic)<Input type="number" min={1} max={Number.MAX_SAFE_INTEGER} value={options.kv_arena_bytes ?? ''} onChange={(e) => setOptions({ ...options, kv_arena_bytes: e.target.value ? Number(e.target.value) : null })} /></label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={options.no_cuda_graph} onChange={(e) => setOptions({ ...options, no_cuda_graph: e.target.checked })} />Disable CUDA Graphs</label>
        </div>
      </details>
      <div className="flex gap-2"><Button disabled={busy || !!error || !!launchError || !selected || gpus.length !== selected.metadata.tp_size} onClick={() => {
        const configuration = { ...options, model_id: modelId, gpu_uuids: gpus, max_context: context, concurrency }
        if (editing && !window.confirm('Apply these model and launch settings? This restarts the selected instance after its current requests drain.')) return
        void act(editing ? 'reload' : 'launch', editing ? { instance_id: editing, body: { configuration, expected_session_id: editingSession } } : { body: configuration })
      }}>{editing ? 'Apply settings and reload' : 'Load model'}</Button>
        {editing && <Button variant="outline" onClick={() => setEditing(null)}>Cancel editing</Button>}
      </div>
    </>}
  </section>
}

import { useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ChoiceSelect } from '@/components/ui/choice-select'
import { confirmAction } from '@/lib/confirm'
import { formatModelBytes } from '@/lib/model-release'
import { gpuCardName } from '@/lib/engine-host-labels'
import {
  engineCommand, plainHostError,
  type EngineCustomProfile, type EngineLaunchOptions, type EngineModel, type EngineSnapshot, type EngineStartupQuote,
} from '@/services/engines'
import { DEFAULT_LAUNCH_OPTIONS } from './autoModelSettings'
import { profileOptionLabel } from '../../../src-tauri/ginfer-manager/ui/profile-presentation.js'

export type CustomStart = {
  /** `profile_launch` keeps an unchanged tested profile's identity; everything else is a custom launch. */
  action: 'launch' | 'profile_launch'
  body: Record<string, unknown>
  gpuUuids: string[]
}

type Form = { gpu_uuids: string[]; max_context: number; concurrency: number; options: EngineLaunchOptions }

const statusMessages: Record<Exclude<EngineCustomProfile['status'], 'ready'>, string> = {
  model_changed: 'The model file changed since you saved these settings. Check them again before using them.',
  model_missing: 'The model these settings were saved for is not installed on this computer.',
  hardware_changed: 'The graphics cards on this computer changed since you saved these settings. Check them again before using them.',
}

function Help({ id, children }: { id: string; children: React.ReactNode }) {
  return <p id={id} className="text-xs text-muted-foreground">{children}</p>
}

/** Graphics cards no running model holds, as groups of the model's size that share one card type. */
/** The graphics cards GInfer may use on this computer (CUDA_VISIBLE_DEVICES can hide some). */
const usableGpus = (snapshot: EngineSnapshot) => {
  const visible = (snapshot as { cuda_visible_gpu_uuids?: string[] }).cuda_visible_gpu_uuids
  return visible ? snapshot.gpus.filter(gpu => visible.includes(gpu.uuid)) : snapshot.gpus
}

function freeGroup(snapshot: EngineSnapshot, size: number): string[] {
  const held = new Set(snapshot.instances.filter(i => ['ready', 'starting', 'stopping'].includes(i.status))
    .flatMap(i => i.configuration.gpu_uuids))
  const free = usableGpus(snapshot).filter(gpu => !held.has(gpu.uuid))
  for (const first of free) {
    const group = free.filter(gpu => gpu.name === first.name && gpu.compute_capability === first.compute_capability).slice(0, size)
    if (group.length === size) return group.map(gpu => gpu.uuid)
  }
  return []
}

const settingsOf = (form: Form, modelId: string) => ({
  model_id: modelId, gpu_uuids: form.gpu_uuids, max_context: form.max_context, concurrency: form.concurrency, options: form.options,
})

export function ModelCustomSettings({ hostId, snapshot, model, modelName, disabled, running = false, onStart, onChanged }: {
  hostId: string
  snapshot: EngineSnapshot
  model: EngineModel
  modelName: string
  disabled: boolean
  /** The model is running: its settings can still be saved, but not checked or started again. */
  running?: boolean
  onStart: (start: CustomStart) => Promise<boolean>
  onChanged: () => Promise<unknown>
}) {
  const tp = model.metadata.tp_size
  // A running copy of this model shows the settings it started with; they already work, so
  // they can be saved as a profile straight away.
  const runningProfile = snapshot.instances.find(i => i.status === 'ready' && i.profile?.model_id === model.id)?.profile
  const initial = useMemo<Form>(() => runningProfile ? {
    gpu_uuids: runningProfile.gpu_uuids, max_context: runningProfile.max_context, concurrency: runningProfile.concurrency,
    options: Object.fromEntries(Object.keys({ ...DEFAULT_LAUNCH_OPTIONS, device: 'gpu', cpu_ram_headroom_gib: null }).map(key =>
      [key, (runningProfile as Record<string, unknown>)[key] ?? (DEFAULT_LAUNCH_OPTIONS as Record<string, unknown>)[key] ?? null])) as EngineLaunchOptions,
  } : {
    gpu_uuids: freeGroup(snapshot, tp), max_context: 32768, concurrency: 1, options: { ...DEFAULT_LAUNCH_OPTIONS },
  // The first form only; later snapshots must not overwrite the person's choices.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const [form, setForm] = useState<Form>(initial)
  const [choice, setChoice] = useState('new')
  const [check, setCheck] = useState<{ key: string; quote?: EngineStartupQuote; error?: string } | null>(null)
  const [verified, setVerified] = useState<string | null>(() => runningProfile ? JSON.stringify(settingsOf(initial, model.id)) : null)
  const [working, setWorking] = useState<null | 'check' | 'start' | 'save'>(null)
  const [saveName, setSaveName] = useState('')
  const [rename, setRename] = useState('')
  const [problem, setProblem] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const key = JSON.stringify(settingsOf(form, model.id))
  const set = (patch: Partial<Form>) => { setForm(current => ({ ...current, ...patch })); setNotice(null) }
  const option = (patch: Partial<EngineLaunchOptions>) => set({ options: { ...form.options, ...patch } })
  const cpu = form.options.device === 'cpu'

  const tested = (snapshot.launch_profiles ?? []).filter(entry => entry.model_id === model.id)
    .flatMap(entry => {
      const group = entry.compatible_gpu_groups[0]
      return group ? [{ entry, group }] : []
    })
  const saved = (snapshot.custom_profiles ?? []).filter(profile => profile.model_id === model.id
    || (profile.model_id === null && profile.identity.model_id === model.metadata.identity.model_id
      && profile.identity.weights_id === model.metadata.identity.weights_id))
  const selectedSaved = choice.startsWith('custom:') ? saved.find(profile => `custom:${profile.id}` === choice) : undefined
  const selectedTested = choice.startsWith('tested:') ? tested.find(item => `tested:${item.entry.profile.id}` === choice) : undefined
  useEffect(() => { if (selectedSaved) setRename(selectedSaved.name) }, [selectedSaved?.id, selectedSaved?.name]) // eslint-disable-line react-hooks/exhaustive-deps

  const testedForm = (item: NonNullable<typeof selectedTested>): Form => ({
    gpu_uuids: item.group, max_context: item.entry.profile.max_context, concurrency: item.entry.profile.concurrency,
    options: { ...DEFAULT_LAUNCH_OPTIONS, ...item.entry.profile.options, kv_arena_bytes: null } as EngineLaunchOptions,
  })
  const choose = (value: string) => {
    setChoice(value); setCheck(null); setProblem(null); setNotice(null)
    const custom = saved.find(profile => `custom:${profile.id}` === value)
    const testedItem = tested.find(item => `tested:${item.entry.profile.id}` === value)
    if (custom) {
      // Cards that changed are replaced by free cards of this computer for the new check.
      const cards = custom.status === 'ready' ? custom.gpu_uuids : freeGroup(snapshot, tp)
      setForm({ gpu_uuids: cards, max_context: custom.max_context, concurrency: custom.concurrency, options: { ...DEFAULT_LAUNCH_OPTIONS, ...custom.options } })
    } else if (testedItem) setForm(testedForm(testedItem))
    else setForm(initial)
  }
  const unchangedTested = selectedTested && JSON.stringify(settingsOf(testedForm(selectedTested), model.id)) === key

  const invalid = !Number.isSafeInteger(form.max_context) || form.max_context < 1
    ? 'Enter a context length of at least 1 token.'
    : !Number.isSafeInteger(form.concurrency) || form.concurrency < 1 || form.concurrency > 8
      ? 'Concurrency must be a whole number from 1 to 8.'
      : !Number.isSafeInteger(form.options.draft_tokens) || form.options.draft_tokens < 0
        ? 'Draft tokens must be 0 (automatic) or more.'
        : !cpu && form.gpu_uuids.length !== tp
          ? `Choose ${tp === 1 ? '1 graphics card' : `${tp} graphics cards`} for this model.`
          : null
  // The Host's launch request carries the engine settings beside the model, cards and sizes.
  const request = () => ({ ...form.options, model_id: model.id, gpu_uuids: form.gpu_uuids,
    max_context: form.max_context, concurrency: form.concurrency, remaining_instances: 1 })

  const runCheck = async () => {
    if (invalid || working) return
    setWorking('check'); setCheck(null); setProblem(null); setNotice(null)
    const checked = key
    try {
      const quote = await engineCommand<EngineStartupQuote>('quote', { host_id: hostId, body: request() })
      setCheck({ key: checked, quote })
      if (quote.fit?.fits !== false) setVerified(checked)
    } catch (cause) {
      setCheck({ key: checked, error: String(cause) })
    } finally { setWorking(null) }
  }
  const start = async () => {
    if (invalid || working) return
    setWorking('start'); setProblem(null); setNotice(null)
    const started = key
    try {
      const ok = await onStart(unchangedTested && selectedTested
        ? { action: 'profile_launch', gpuUuids: form.gpu_uuids, body: { profile_id: selectedTested.entry.profile.id, model_id: model.id,
            gpu_uuids: form.gpu_uuids, instance_id: null, force: false, structured_outputs: form.options.structured_outputs } }
        : { action: 'launch', gpuUuids: form.gpu_uuids, body: request() })
      if (ok) setVerified(started)
    } finally { setWorking(null) }
  }
  const change = async (body: Record<string, unknown>, done: string) => {
    setWorking('save'); setProblem(null); setNotice(null)
    try {
      const result = await engineCommand<{ profile: EngineCustomProfile | null }>('custom_profile', { host_id: hostId, body })
      await onChanged()
      setNotice(done)
      return result.profile
    } catch (cause) {
      setProblem(plainHostError(cause))
      return undefined
    } finally { setWorking(null) }
  }
  const saveAsProfile = async () => {
    const profile = await change({ action: 'save', name: saveName.trim() || defaultName, settings: settingsOf(form, model.id) }, 'Settings saved. They are listed under Saved settings as Custom.')
    if (profile) { setChoice(`custom:${profile.id}`); setSaveName('') }
  }
  const remove = async (profile: EngineCustomProfile) => {
    if (!await confirmAction({ title: 'Delete these saved settings?', message: `Delete “${profile.name}”? The model and its other settings stay installed.`, confirmLabel: 'Delete settings', destructive: true })) return
    if (await change({ action: 'delete', id: profile.id }, 'Saved settings deleted.') !== undefined) { setChoice('new'); setForm(initial) }
  }
  const defaultName = `${modelName} · ${form.max_context.toLocaleString()} tokens`
  const current = check?.key === key ? check : null
  const checkedNow = verified === key
  const usable = usableGpus(snapshot)
  const cards = snapshot.gpus.map((gpu, index) => ({ gpu, index })).filter(({ gpu }) => usable.includes(gpu))
  const id = (name: string) => `custom-${model.id}-${name}`

  return <section aria-label={`Custom settings for ${modelName}`} className="w-full space-y-4 rounded-lg border p-4">
    <div><h3 className="font-medium">Custom settings</h3>
      <p className="text-sm text-muted-foreground">Choose your own settings for this model. Check them to see whether they fit, then start the model. You can save settings that work and pick them again later.</p></div>
    {runningProfile && <p role="status" className="text-sm">The model is running with the settings below. You can save them as a profile.</p>}
    <label className="block text-sm">Saved settings
      <ChoiceSelect aria-label="Saved settings" className="mt-1 w-full" disabled={disabled || !!working} value={choice} onValueChange={choose}
        options={[{ value: 'new', label: 'New custom settings' },
          ...tested.map(({ entry }) => ({ value: `tested:${entry.profile.id}`, label: `Tested · ${profileOptionLabel(entry.profile, false)}` })),
          ...saved.map(profile => ({ value: `custom:${profile.id}`, label: `Custom · ${profile.name}${profile.status === 'ready' ? '' : ' · check again'}` }))]} />
    </label>
    <Help id={id('saved-help')}>Tested settings were checked by the GInfer team on this kind of graphics card. Custom settings are ones you saved on this computer.</Help>
    {selectedSaved && selectedSaved.status !== 'ready' && <div role="alert" className="rounded border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
      <p>{statusMessages[selectedSaved.status]}</p>
      {selectedSaved.status !== 'model_missing' && <p className="mt-1">Choose Check settings to check them on this computer. If they fit, choose Save changes to use them again.</p>}
    </div>}

    <div className="grid gap-4 sm:grid-cols-2">
      <div className="space-y-1">
        <label className="block text-sm">Device
          <ChoiceSelect aria-label="Device" aria-describedby={id('device-help')} className="mt-1 w-full" disabled={disabled || !!working} value={form.options.device ?? 'gpu'}
            onValueChange={value => value === 'cpu'
              ? set({ gpu_uuids: [], options: { ...form.options, device: 'cpu', vision: false, spec: 'none', draft_tokens: 0, draft_tp: 0, kv_dtype: form.options.kv_dtype === 'nvfp4' ? 'auto' : form.options.kv_dtype } })
              : set({ gpu_uuids: freeGroup(snapshot, tp), options: { ...form.options, device: 'gpu' } })}
            options={[{ value: 'gpu', label: 'GPU' }, { value: 'cpu', label: 'CPU' }]} />
        </label>
        <Help id={id('device-help')}>GPU runs the model on graphics cards. CPU runs it on the processor and computer memory, which is slower.</Help>
      </div>
      <div className="space-y-1">
        <p className="text-sm">Tensor parallel: {tp}</p>
        <Help id={id('tp-help')}>How many graphics cards the model is split across. The model file sets this.</Help>
      </div>
    </div>
    {!cpu && <fieldset className="space-y-1" disabled={disabled || !!working}><legend className="text-sm">Graphics cards</legend>
      <div className="flex flex-wrap gap-3">{cards.map(({ gpu, index }) => <label key={gpu.uuid} className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={form.gpu_uuids.includes(gpu.uuid)}
          onChange={e => set({ gpu_uuids: e.target.checked ? [...form.gpu_uuids, gpu.uuid] : form.gpu_uuids.filter(uuid => uuid !== gpu.uuid) })} />
        {gpuCardName(snapshot.gpus, index)} · {(gpu.memory_mib / 1024).toFixed(0)} GiB</label>)}</div>
      {!cards.length && <p className="text-sm text-muted-foreground">GInfer found no graphics cards on this computer. Choose Device CPU if this model can run on the processor.</p>}
    </fieldset>}
    <div className="grid gap-4 sm:grid-cols-2">
      <div className="space-y-1">
        <label className="block text-sm">Context length (tokens)<Input aria-describedby={id('context-help')} type="number" min={1} value={form.max_context || ''} disabled={disabled || !!working}
          onChange={e => set({ max_context: Number(e.target.value) })} /></label>
        <Help id={id('context-help')}>How much text the model keeps in mind: your messages, the earlier conversation and its reply. Longer needs more memory.</Help>
      </div>
      <div className="space-y-1">
        <label className="block text-sm">Concurrency<Input aria-describedby={id('concurrency-help')} type="number" min={1} max={8} value={form.concurrency || ''} disabled={disabled || !!working}
          onChange={e => set({ concurrency: Number(e.target.value) })} /></label>
        <Help id={id('concurrency-help')}>How many replies the model can write at the same time. More needs more memory.</Help>
      </div>
      <div className="space-y-1">
        <label className="block text-sm">K/V cache
          <ChoiceSelect aria-label="K/V cache" aria-describedby={id('kv-help')} className="mt-1 w-full" disabled={disabled || !!working} value={form.options.kv_dtype}
            onValueChange={value => option({ kv_dtype: value as EngineLaunchOptions['kv_dtype'] })}
            options={[{ value: 'auto', label: 'Automatic' }, { value: 'bf16', label: 'BF16' }, { value: 'int8', label: 'INT8' },
              ...(!cpu && model.metadata.nvfp4_kv_available !== false ? [{ value: 'nvfp4', label: 'NVFP4' }] : [])]} />
        </label>
        <Help id={id('kv-help')}>How the conversation is stored in memory. INT8 and NVFP4 fit longer conversations than BF16.</Help>
      </div>
      {!cpu && <div className="space-y-1">
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" aria-describedby={id('spec-help')} disabled={disabled || !!working}
          checked={form.options.spec !== 'none'} onChange={e => option({ spec: e.target.checked ? 'auto' : 'none', draft_tokens: 0, draft_tp: 0 })} />Enable Speculative Decoding</label>
        <Help id={id('spec-help')}>Drafts a few words ahead and checks them, which usually makes replies faster.</Help>
        {form.options.spec !== 'none' && <label className="block text-sm">Draft tokens<Input aria-describedby={id('draft-help')} type="number" min={0} value={form.options.draft_tokens} disabled={disabled || !!working}
          onChange={e => option({ draft_tokens: Number(e.target.value) })} /></label>}
        {form.options.spec !== 'none' && <Help id={id('draft-help')}>How many words are drafted before each check. 0 lets GInfer choose.</Help>}
      </div>}
      {!cpu && <div className="space-y-1">
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" aria-describedby={id('vision-help')} disabled={disabled || !!working}
          checked={form.options.vision} onChange={e => option({ vision: e.target.checked })} />Enable Vision</label>
        <Help id={id('vision-help')}>Lets the model read pictures, when the model supports it. Uses extra memory.</Help>
      </div>}
      <div className="space-y-1">
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" aria-describedby={id('structured-help')} disabled={disabled || !!working}
          checked={form.options.structured_outputs} onChange={e => option({ structured_outputs: e.target.checked })} />Structured outputs</label>
        <Help id={id('structured-help')}>Lets apps ask for replies in an exact format, such as JSON.</Help>
      </div>
      {!cpu && <div className="space-y-1">
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" aria-describedby={id('graphs-help')} disabled={disabled || !!working}
          checked={!form.options.no_cuda_graph} onChange={e => option({ no_cuda_graph: !e.target.checked })} />CUDA Graphs</label>
        <Help id={id('graphs-help')}>Records graphics-card work once and replays it, which makes replies faster. Turn it off only if the model fails to start.</Help>
      </div>}
    </div>
    {invalid && <p role="alert" className="text-sm text-destructive">{invalid}</p>}
    <div className="flex flex-wrap gap-2">
      <Button variant="outline" disabled={disabled || running || !!working || !!invalid} onClick={() => void runCheck()}>{working === 'check' ? 'Checking settings…' : 'Check settings'}</Button>
      <Button disabled={disabled || running || !!working || !!invalid || selectedSaved?.status === 'model_missing'} onClick={() => void start()}>{working === 'start' ? 'Starting…' : 'Start with these settings'}</Button>
    </div>
    <Help id={id('check-help')}>Checking does not start the model. The first check on a new graphics card measures it once, which can take a few minutes.</Help>
    {current?.quote && (current.quote.fit?.fits === false
      ? <p role="alert" className="text-sm text-destructive">{current.quote.fit.message ?? 'These settings do not fit in the memory that is free.'}</p>
      : <p role="status" className="text-sm">These settings fit. {current.quote.kv_arena_bytes == null
        ? 'GInfer sizes the K/V cache when the model starts.' : `GPU K/V cache: ${formatModelBytes(current.quote.kv_arena_bytes)}.`}</p>)}
    {current?.error && <div role="alert" className="text-sm text-destructive"><p>These settings could not be checked: {plainHostError(current.error)}</p>
      <details className="mt-1 text-muted-foreground"><summary className="cursor-pointer">Technical details</summary><p className="whitespace-pre-wrap break-all">{current.error}</p></details></div>}
    {problem && <p role="alert" className="text-sm text-destructive">{problem}</p>}
    {notice && <p role="status" className="text-sm">{notice}</p>}

    {checkedNow && !selectedSaved && <div className="flex flex-wrap items-end gap-2">
      <label className="min-w-64 flex-1 text-sm">Profile name<Input value={saveName} placeholder={defaultName} disabled={disabled || !!working} onChange={e => setSaveName(e.target.value)} /></label>
      <Button variant="outline" disabled={disabled || !!working} onClick={() => void saveAsProfile()}>Save as profile</Button>
    </div>}
    {selectedSaved && <div className="flex flex-wrap items-end gap-2">
      <label className="min-w-64 flex-1 text-sm">Profile name<Input value={rename} disabled={disabled || !!working} onChange={e => setRename(e.target.value)} /></label>
      <Button variant="outline" disabled={disabled || !!working || !rename.trim() || rename.trim() === selectedSaved.name}
        onClick={() => void change({ action: 'update', id: selectedSaved.id, name: rename }, 'Saved settings renamed.')}>Rename</Button>
      <Button variant="outline" disabled={disabled || !!working || !checkedNow}
        title={checkedNow ? undefined : 'Check or start these settings first'}
        onClick={() => void change({ action: 'update', id: selectedSaved.id, settings: settingsOf(form, model.id) }, 'Saved settings updated.')}>Save changes</Button>
      <Button variant="outline" disabled={disabled || !!working} onClick={() => void remove(selectedSaved)}>Delete</Button>
    </div>}
    {selectedSaved && !checkedNow && <Help id={id('save-help')}>Save changes is available after these settings pass Check settings or start.</Help>}
  </section>
}

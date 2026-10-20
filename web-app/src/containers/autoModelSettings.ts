import {
  engineCommand,
  engineErrorParts,
  CPU_ADMISSION_CODES,
  type DevicePreference,
  type EngineDevice,
  type EngineHardwareProfile,
  type EngineLaunchOptions,
  type EngineModel,
  type EngineSnapshot,
  type EngineStartupQuote,
} from '@/services/engines'
const DEFAULT_GPU_RESERVE_BYTES = 300 * 1024 * 1024

/** The same options the Hosts page starts with, so a model started here matches one started there. */
export const DEFAULT_LAUNCH_OPTIONS: EngineLaunchOptions = {
  vision: true,
  structured_outputs: true,
  spec: 'none',
  draft_tokens: 0,
  draft_tp: 0,
  kv_dtype: 'auto',
  kv_arena_bytes: null,
  kv_arena_headroom_bytes: DEFAULT_GPU_RESERVE_BYTES,
  host_kv_cache_bytes: null,
  prefill_chunk: 0,
  no_cuda_graph: false,
  flash_host_ram_headroom_gib: null,
  expert_lfu: true,
}

/** The CPU device runs text only, without speculation; the Engine keeps INT8 K/V by default. */
export const CPU_LAUNCH_OPTIONS: EngineLaunchOptions = {
  ...DEFAULT_LAUNCH_OPTIONS,
  device: 'cpu',
  vision: false,
  spec: 'none',
}

/** A start problem in plain words, with the Host's typed code and Engine text kept for details. */
export class ModelStartError extends Error {
  code?: string
  detail?: string
  /** CPU problems have their own next step; GInfer Hosts cannot fix them. */
  device?: EngineDevice
  constructor(text: string, device?: EngineDevice) {
    const parts = engineErrorParts(text)
    super(parts.message)
    this.code = parts.code
    this.detail = parts.detail
    this.device = device
  }
}

const SUPPORTED_GPU = ['8.0', '8.6', '8.9', '12.0']

/** Automatic picks the CPU for a CPU-only model or a computer without a usable NVIDIA graphics card. */
export function resolveDevice(snapshot: EngineSnapshot, model: EngineModel, preference: DevicePreference = 'auto'): EngineDevice {
  if (preference !== 'auto') return preference
  if (model.devices?.length === 1 && model.devices[0] === 'cpu') return 'cpu'
  return snapshot.gpus.some((gpu) => SUPPORTED_GPU.includes(gpu.compute_capability ?? '')) ? 'gpu' : 'cpu'
}

const busy = (profile?: EngineHardwareProfile) =>
  profile?.status === 'running' || profile?.status === 'cancelling'

const LADDER = [262144, 131072, 65536, 32768, 16384, 8192]

/** Context lengths to try, longest first. Models known to support 262,144 start there. */
export function conversationLengths(modelId: string): number[] {
  if (modelId === 'qwen3.8-27b' || modelId === 'qwen3.8-flash-next' || modelId === 'qwen3.6-35b-a3b') return LADDER
  return LADDER.slice(1)
}

export type AutoStartDeps = {
  command?: typeof engineCommand
  sleep?: (ms: number) => Promise<void>
  report?: (text: string) => void
  signal?: AbortSignal
  pollMs?: number
  timeoutMs?: number
  device?: DevicePreference
}

const message = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause))

/**
 * For a model file with no tested settings: check settings that fit this computer (the same check as Check model
 * settings, trying shorter context lengths when one does not fit), start the model with the first set that
 * passes, and wait until it is ready. Throws the last check or start problem, in the host's words, if none works.
 */
export async function startWithCheckedSettings(
  hostId: string,
  modelPath: string,
  deps: AutoStartDeps = {}
): Promise<void> {
  const command = deps.command ?? engineCommand
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
  const report = deps.report ?? (() => undefined)
  report('Finding settings that fit your computer…')
  const snapshot = await command<EngineSnapshot>('snapshot', { host_id: hostId })
  const model = snapshot.models.find((m) => m.path === modelPath)
  if (!model) throw new Error('This model is no longer installed.')
  if (resolveDevice(snapshot, model, deps.device) === 'cpu') return startOnCpu(hostId, model, deps)
  const busyCards = new Set(
    snapshot.instances
      .filter((i) => ['ready', 'starting', 'stopping'].includes(i.status))
      .flatMap((i) => i.configuration.gpu_uuids)
  )
  const free = snapshot.gpus.filter((gpu) => !busyCards.has(gpu.uuid))
  const needed = model.metadata.tp_size
  if (free.length < needed)
    throw new Error('There are not enough free graphics cards for this model.')
  const gpu_uuids = free.slice(0, needed).map((gpu) => gpu.uuid)
  const measured = snapshot.hardware_profile
  const covered =
    !!measured?.available && gpu_uuids.every((uuid) => measured.gpu_uuids?.includes(uuid))
  if (!covered) {
    // A new computer has no graphics-card measurements yet; settings cannot be checked without them.
    report('Measuring your graphics card so GChat can pick safe settings (one time, a few minutes)…')
    // Measure only what the launch below reads. Host finishes the other formats later while idle.
    // A model set spread over several files has no single package path, so it measures every format.
    const artifact =
      !model.artifact_set && model.path.endsWith('.ginfer')
        ? {
            path: model.path,
            tp: needed,
            draft_tp: DEFAULT_LAUNCH_OPTIONS.draft_tp,
            spec: DEFAULT_LAUNCH_OPTIONS.spec,
          }
        : undefined
    await command('hardware_profile', {
      host_id: hostId,
      body: { action: 'ensure', gpu_uuids, ...(artifact ? { artifact } : {}) },
    })
    const measureDeadline = Date.now() + (deps.timeoutMs ?? 30 * 60 * 1000)
    for (;;) {
      if (deps.signal?.aborted) throw new Error('Model startup cancelled.')
      const now = await command<EngineSnapshot>('snapshot', { host_id: hostId })
      const profile: EngineHardwareProfile | undefined = now.hardware_profile
      if (profile && !busy(profile)) {
        if (profile.status === 'failed' || !profile.available)
          throw new Error(profile.error ?? 'Measuring the graphics card did not finish.')
        break
      }
      if (profile?.remaining_ms)
        report(`Measuring your graphics card (one time): about ${Math.max(1, Math.round(profile.remaining_ms / 60000))} min left…`)
      if (Date.now() > measureDeadline) throw new Error('Measuring the graphics card took too long.')
      await sleep(deps.pollMs ?? 3000)
    }
    report('Finding settings that fit your computer…')
  }
  let lastError = 'No settings could be checked.'
  let chosen: Record<string, unknown> | undefined
  for (const max_context of conversationLengths(model.metadata.identity.model_id)) {
    if (deps.signal?.aborted) throw new Error('Model startup cancelled.')
    const configuration = {
      ...DEFAULT_LAUNCH_OPTIONS,
      model_id: model.id,
      gpu_uuids,
      max_context,
      concurrency: 1,
    }
    try {
      await command<EngineStartupQuote>('quote', {
        host_id: hostId,
        body: { ...configuration, remaining_instances: 1 },
      })
      chosen = configuration
      break
    } catch (cause) {
      lastError = message(cause)
    }
  }
  if (!chosen) throw new Error(lastError)
  report('Starting the model with settings that fit your computer…')
  await command('launch', { host_id: hostId, body: { ...chosen, remaining_instances: 1 } })
  const deadline = Date.now() + (deps.timeoutMs ?? 15 * 60 * 1000)
  for (;;) {
    if (deps.signal?.aborted) throw new Error('Model startup cancelled.')
    const now = await command<EngineSnapshot>('snapshot', { host_id: hostId })
    const mine = now.instances.find((i) =>
      i.configuration.gpu_uuids.some((id) => gpu_uuids.includes(id))
    )
    if (mine?.status === 'ready') return
    if (mine?.status === 'failed')
      throw new Error(mine.last_error ?? 'The model could not start.')
    if (Date.now() > deadline) throw new Error('The model did not become ready in time.')
    await sleep(deps.pollMs ?? 2000)
  }
}

/** CPU device: no graphics-card measurement; the Engine plans memory, shorter contexts are tried when RAM is short. */
async function startOnCpu(hostId: string, model: EngineModel, deps: AutoStartDeps): Promise<void> {
  const command = deps.command ?? engineCommand
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
  const report = deps.report ?? (() => undefined)
  report('Finding settings that fit your computer’s memory…')
  let lastError = 'No settings could be checked.'
  let chosen: Record<string, unknown> | undefined
  for (const max_context of conversationLengths(model.metadata.identity.model_id)) {
    if (deps.signal?.aborted) throw new Error('Model startup cancelled.')
    const configuration = { ...CPU_LAUNCH_OPTIONS, model_id: model.id, gpu_uuids: [], max_context, concurrency: 1 }
    try {
      await command<EngineStartupQuote>('quote', { host_id: hostId, body: { ...configuration, remaining_instances: 1 } })
      chosen = configuration
      break
    } catch (cause) {
      lastError = message(cause)
      // A model or processor the CPU cannot run fails the same way at every length.
      const code = engineErrorParts(lastError).code
      if (code && CPU_ADMISSION_CODES.includes(code)) throw new ModelStartError(lastError, 'cpu')
    }
  }
  if (!chosen) throw new ModelStartError(lastError, 'cpu')
  report('Starting the model on the CPU. Large models take a few minutes to read into memory…')
  const started = await command<{ instance_id?: string } | undefined>('launch', { host_id: hostId, body: { ...chosen, remaining_instances: 1 } })
  const deadline = Date.now() + (deps.timeoutMs ?? 15 * 60 * 1000)
  for (;;) {
    if (deps.signal?.aborted) throw new Error('Model startup cancelled.')
    const now = await command<EngineSnapshot>('snapshot', { host_id: hostId })
    const mine = now.instances.find((i) => started?.instance_id
      ? i.instance_id === started.instance_id
      : i.configuration.device === 'cpu' && i.profile?.model_id === model.id)
    if (mine?.status === 'ready') return
    if (mine?.status === 'failed') throw new ModelStartError(mine.last_error ?? 'The model could not start.', 'cpu')
    if (Date.now() > deadline) throw new ModelStartError('The model did not become ready in time.', 'cpu')
    await sleep(deps.pollMs ?? 2000)
  }
}

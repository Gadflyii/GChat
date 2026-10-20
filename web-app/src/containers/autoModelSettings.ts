import type { EngineLaunchOptions } from '@/services/engines'

const DEFAULT_GPU_RESERVE_BYTES = 300 * 1024 * 1024

/**
 * The settings a new custom form starts from: the same options the GInfer Hosts page and the
 * Host's Automatic fit check use, so a model started here matches one started there.
 */
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

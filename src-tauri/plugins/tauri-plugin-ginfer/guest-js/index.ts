import { invoke } from '@tauri-apps/api/core'
import {
  SessionInfo,
  UnloadResult,
  GinferConfig,
  GinferLoadRequest,
  GinferBenchmarkRequest,
  GinferBenchmarkResult,
} from './types'

// Helpers
function asNumber(v: any, defaultValue = 0): number {
  if (v === '' || v === null || v === undefined) return defaultValue
  const n = Number(v)
  return isFinite(n) ? n : defaultValue
}

function asBool(v: any): boolean {
  if (v === '' || v === null || v === undefined) return false
  return v === true || v === 'true' || v === 1 || v === '1'
}

function asString(v: any, defaultValue = ''): string {
  if (v === '' || v === null || v === undefined) return defaultValue
  return String(v)
}

export function normalizeGinferConfig(config: any): GinferConfig {
  const value = config ?? {}
  if (value.load_operation_id !== undefined &&
      (typeof value.load_operation_id !== 'string' || !value.load_operation_id.trim())) {
    throw new Error('A model load operation needs a nonempty identifier')
  }
  if (value.gpu_uuids !== undefined &&
      (!Array.isArray(value.gpu_uuids) || value.gpu_uuids.length === 0 ||
       value.gpu_uuids.some((id: unknown) => typeof id !== "string" || !id.trim()) ||
       new Set(value.gpu_uuids).size !== value.gpu_uuids.length)) {
    throw new Error("Choose at least one unique GPU")
  }
  return {
    ...(value.use_profile_defaults === true ? { use_profile_defaults: true } : {}),
    ...(value.load_operation_id === undefined ? {} : { load_operation_id: value.load_operation_id }),
    vision: value.vision === undefined ? true : asBool(value.vision),
    spec: asString(value.spec, 'auto'),
    draft_tokens: asNumber(value.draft_tokens),
    draft_tp: asNumber(value.draft_tp),
    kv_dtype: asString(value.kv_dtype, 'auto'),
    max_context: asNumber(value.max_context),
    kv_arena_bytes: asString(value.kv_arena_bytes, 'auto'),
    prefill_chunk: asNumber(value.prefill_chunk),
    max_concurrency: asNumber(value.max_concurrency),
    no_cuda_graph: asBool(value.no_cuda_graph),
    ...(value.gpu_uuids === undefined ? {} : { gpu_uuids: [...value.gpu_uuids] }),
  }
}

// GInfer server commands
export async function loadGinferModel(
  request: GinferLoadRequest
): Promise<SessionInfo> {
  return await invoke('plugin:ginfer|load_ginfer_model', {
    request: {
      ...request,
      config: normalizeGinferConfig(request.config),
      isEmbedding:
        request.isEmbedding === undefined ? false : request.isEmbedding,
      timeout: request.timeout === undefined ? 600 : request.timeout,
    },
  })
}

export async function unloadGinferModel(pid: number): Promise<UnloadResult> {
  return await invoke('plugin:ginfer|unload_ginfer_model', { pid })
}

export async function isProcessRunning(pid: number): Promise<boolean> {
  return await invoke('plugin:ginfer|is_process_running', { pid })
}

export async function findSessionByModel(
  modelId: string
): Promise<SessionInfo | null> {
  return await invoke('plugin:ginfer|find_session_by_model', { modelId })
}

export async function getLoadedModels(): Promise<string[]> {
  return await invoke('plugin:ginfer|get_loaded_models')
}

export async function getAllSessions(): Promise<SessionInfo[]> {
  return await invoke('plugin:ginfer|get_all_sessions')
}

export async function runGinferBenchmark(
  request: GinferBenchmarkRequest
): Promise<GinferBenchmarkResult> {
  return await invoke('plugin:ginfer|run_ginfer_benchmark', { request })
}

export async function cancelGinferBenchmark(runId: string): Promise<boolean> {
  return await invoke('plugin:ginfer|cancel_ginfer_benchmark', { runId })
}

// Cleanup commands
export async function cleanupGinferProcesses(): Promise<void> {
  return await invoke('plugin:ginfer|cleanup_ginfer_processes')
}

export * from './types'

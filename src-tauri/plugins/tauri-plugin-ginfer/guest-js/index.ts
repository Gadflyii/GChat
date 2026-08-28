import { invoke } from '@tauri-apps/api/core'
import { SessionInfo, UnloadResult, GinferConfig } from './types'

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
  return {
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
  }
}

// GInfer server commands
export async function loadGinferModel(
  binaryPath: string,
  modelId: string,
  modelPath: string,
  port: number,
  cfg: GinferConfig,
  apiKey: string,
  isEmbedding: boolean = false,
  timeout: number = 600
): Promise<SessionInfo> {
  const config = normalizeGinferConfig(cfg)
  return await invoke('plugin:ginfer|load_ginfer_model', {
    binaryPath,
    modelId,
    modelPath,
    port,
    config,
    apiKey,
    isEmbedding,
    timeout,
  })
}

export async function unloadGinferModel(pid: number): Promise<UnloadResult> {
  return await invoke('plugin:ginfer|unload_ginfer_model', { pid })
}

export async function isProcessRunning(pid: number): Promise<boolean> {
  return await invoke('plugin:ginfer|is_process_running', { pid })
}

export async function getRandomPort(): Promise<number> {
  return await invoke('plugin:ginfer|get_random_port')
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

// Cleanup commands
export async function cleanupGinferProcesses(): Promise<void> {
  return await invoke('plugin:ginfer|cleanup_ginfer_processes')
}

export * from './types'

import { invoke } from '@tauri-apps/api/core'

export type EngineHost = {
  local?: boolean
  host_id: string; name: string; base_url: string; certificate_sha256: string; client_id: string
}
export type NearbyHost = { host_id: string; name: string; urls: string[] }
export type EngineModel = {
  id: string; path: string; artifact_set: boolean;
  metadata: { identity: { model_id: string; weights_id: string }; tp_size: number; draft_tp: number; size_bytes: number }
}
export type EngineInstance = {
  instance_id: string; session_id: string | null; display_name: string; upstream_model_id: string;
  status: 'starting' | 'ready' | 'stopping' | 'stopped' | 'failed'; last_error?: string;
  configuration: Partial<EngineLaunchOptions> & { gpu_uuids: string[]; tp?: number; max_context: number; concurrency: number };
  profile?: EngineLaunchProfile;
  model_metadata?: Record<string, unknown>
}
export type EngineLaunchOptions = {
  vision: boolean; spec: 'auto' | 'none' | 'dflash'; draft_tokens: number; draft_tp: number;
  kv_dtype: 'auto' | 'bf16' | 'int8' | 'nvfp4'; kv_arena_bytes: number | null;
  kv_arena_headroom_bytes?: number;
  host_kv_cache_bytes: number; prefill_chunk: number; no_cuda_graph: boolean;
}
export type EngineLaunchProfile = EngineLaunchOptions & {
  qualified_profile_id?: string | null;
  instance_id?: string; model_id: string; gpu_uuids: string[]; max_context: number; concurrency: number;
}
export type EngineSnapshot = {
  launch_profiles?: { model_id: string; gpu_groups: string[][]; compatible_gpu_groups: string[][];
    profile: { id: string; name: string; tp: number; max_context: number; concurrency: number } }[];
  profile_error?: string | null;
  host_id: string; display_name: string; revision: number;
  gpus: import('@/lib/model-release').ModelGpu[];
  models: EngineModel[]; instances: EngineInstance[]
  inventory_errors?: { path: string; error: string }[]
  model_management?: { version: number; managed_root: string; engine_presets_available: boolean; downloads: import('@/lib/model-release').ModelDownload[] }
}
export const engineCommand = <T>(action: string, args: Record<string, unknown> = {}) =>
  invoke<T>('engine_hosts_command', { action, args })

export const engineAlias = (hostId: string, instanceId: string) => `ginfer/${hostId}/${instanceId}`

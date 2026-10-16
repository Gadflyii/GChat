import { invoke } from '@tauri-apps/api/core'

export type EngineHost = {
  local?: boolean
  host_id: string; name: string; base_url: string; certificate_sha256: string; client_id: string
}
export type NearbyHost = { host_id: string; name: string; urls: string[] }
export type EngineModel = {
  id: string; path: string; artifact_set: boolean;
  metadata: { identity: { model_id: string; weights_id: string }; tp_size: number; draft_tp: number; size_bytes: number; nvfp4_kv_available?: boolean }
}
export type EngineInstance = {
  instance_id: string; session_id: string | null; display_name: string; upstream_model_id: string;
  status: 'starting' | 'ready' | 'stopping' | 'stopped' | 'failed'; last_error?: string;
  configuration: Partial<EngineLaunchOptions> & { gpu_uuids: string[]; tp?: number; max_context: number; concurrency: number };
  profile?: EngineLaunchProfile;
  model_metadata?: Record<string, unknown>
}
export type EngineLaunchOptions = {
  vision: boolean; structured_outputs: boolean; spec: 'auto' | 'none' | 'dflash' | 'mtp'; draft_tokens: number; draft_tp: number;
  draft_policy?: 'auto' | 'fixed' | 'adaptive';
  kv_dtype: 'auto' | 'bf16' | 'int8' | 'nvfp4'; kv_arena_bytes: number | null;
  kv_arena_headroom_bytes?: number;
  host_kv_cache_bytes: number | null; prefill_chunk: number; no_cuda_graph: boolean;
}
export type EngineLaunchProfile = EngineLaunchOptions & {
  qualified_profile_id?: string | null;
  benchmark_profile?: BenchmarkProfileReference | null;
  instance_id?: string; model_id: string; gpu_uuids: string[]; max_context: number; concurrency: number;
}
export type EngineStartupQuote = {
  instance_count: number
  kv_arena_bytes: number | null
  model_identity: { model_id: string; weights_id: string }
}
export type BenchmarkModelClass = 'qwen27-int-dflash-q4' | 'qwen27-nvfp4-dflash-q4' | 'flash-smol-mtp' | 'flash-int-mtp'
export type BenchmarkProfileReference = {
  id: 'gbench-max-perf'; version: 1; model_class: BenchmarkModelClass
}
export type EngineMaxPerfProfile = {
  model_id: string
  profile: {
    reference: BenchmarkProfileReference; id: string; name: string
    max_context: number; concurrency: number; tp: number; options: EngineLaunchOptions
  }
  compatible_gpu_groups: string[][]
}
export type EngineHardwareProfileAction = 'ensure' | 'refresh' | 'resume' | 'cancel'
export type EngineHardwareProfile = {
  status: 'idle' | 'running' | 'cancelling' | 'interrupted' | 'cancelled' | 'completed' | 'failed'
  job_id: string | null
  pid: number | null
  reprofile: boolean
  started_unix_ms: number | null
  finished_unix_ms: number | null
  phase?: 'preparing' | 'gpu_experts' | 'cpu_experts' | 'publishing' | null
  phase_detail?: string | null
  elapsed_ms?: number | null
  expected_duration_ms?: number | null
  remaining_ms?: number | null
  duration_source?: 'measured_history' | null
  scope?: 'all_formats' | 'artifact' | 'declared_formats' | 'complete_remaining_formats' | null
  selected_artifact?: {
    path: string
    directory_sha256: string
    package_sha256?: string | null
    tp: number
    draft_tp: number
    spec: string
    draft_tokens?: number | null
  } | null
  scope_complete?: boolean | null
  base_complete?: boolean | null
  all_formats_complete?: boolean | null
  profile_path: string
  gpu_uuids: string[]
  engine_path: string | null
  pending_gpu_groups: string[][]
  stale_groups: {
    gpu_uuids: string[]
    profile_path: string
    expected_duration_ms: number | null
  }[]
  checkpoint_available: boolean
  diagnostic_tail: string
  error: string | null
  available: boolean
}
export const hardwareProfileBusy = (profile?: EngineHardwareProfile) =>
  profile?.status === 'running' || profile?.status === 'cancelling'

export type EngineDraftWidthCalibration = {
  key: string; model_id: string; gpu_uuids: string[]; max_context: number; concurrency: number;
  status: 'queued' | 'running' | 'cancelling' | 'completed' | 'failed';
  pid: number | null; error: string | null; diagnostic_tail: string
}

export type EngineSnapshot = {
  can_stop_host?: boolean
  clients?: { client_id: string; name: string; local: boolean; gbot_control?: import('@/services/gbot').GbotControlGrant }[]
  max_perf_profiles?: EngineMaxPerfProfile[]
  hardware_profile?: EngineHardwareProfile
  draft_width_calibrations?: EngineDraftWidthCalibration[]
  local_identity?: { state_directory: string | null; platform: string };
  management_origin?: string | null;
  management_notice?: string | null;
  lan_sharing?: { managed: boolean; enabled: boolean; active: boolean; port: number; error?: string | null; notice?: string | null };
  launch_profiles?: { model_id: string; gpu_groups: string[][]; compatible_gpu_groups: string[][];
    profile: { id: string; name: string; tp: number; max_context: number; concurrency: number;
      options: Partial<EngineLaunchOptions> & { vision: boolean };
      qualification: { tier: 'full-context-tested' | 'calculated-startup-smoke' | 'calculated-pending-validation'; engine_revision: string } } }[];
  profile_error?: string | null;
  host_id: string; display_name: string; revision: number; boot_id?: string;
  gpus: import('@/lib/model-release').ModelGpu[];
  models: EngineModel[]; instances: EngineInstance[]
  inventory_errors?: { path: string; error: string }[]
  model_management?: { version: number; managed_root: string; engine_presets_available: boolean; downloads: import('@/lib/model-release').ModelDownload[] }
}
export const engineCommand = <T>(action: string, args: Record<string, unknown> = {}) =>
  invoke<T>('engine_hosts_command', { action, args })

export const hardwareProfile = (hostId: string, action: EngineHardwareProfileAction, gpuUuids?: string[]) =>
  engineCommand<EngineHardwareProfile>('hardware_profile', {
    host_id: hostId, body: { action, ...(gpuUuids === undefined ? {} : { gpu_uuids: gpuUuids }) },
  })

export const engineAlias = (hostId: string, instanceId: string) => `ginfer/${hostId}/${instanceId}`

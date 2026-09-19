import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'

export type BenchmarkSessionInfo = {
  target_id: string
  display_name?: string
  session_id?: string | null
  pid: number | null
  port: number | null
  model_id: string
  model_path: string
  is_embedding: boolean
  vision: boolean
  max_context: number
  spec: string
  draft_tokens: number
  draft_tp: number
  kv_dtype: string
  kv_arena_bytes: string
  prefill_chunk: number
  max_concurrency: number
  no_cuda_graph: boolean
}

export type BenchmarkRequest = {
  benchmark_id: 'standard' | 'serving' | 'long-context' | 'big-bench' | 'custom'
  run_id: string
  session_pid: number | null
  prompt_tokens: number
  max_output_tokens: number
  concurrencies: number[]
  warmup_rounds: number
  measured_rounds: number
}

export type BenchmarkPoint = {
  evidence: {
    schema: string
    corpus: string
    configuration: BenchmarkConfiguration
    warmup: BenchmarkWave[]
    measured: BenchmarkWave[]
  }
  concurrency: number
  requested_prompt_tokens: number
  requested_output_tokens: number
  completed_requests: number
  average_prompt_tokens: number
  average_completion_tokens: number
  cached_prompt_tokens: number
  cold_prompt_tokens_per_second: number | null
  prompt_tokens_per_second: number | null
  generation_tokens_per_second: number | null
  per_request_generation_tokens_per_second: number | null
  wave_output_tokens_per_second: number
  average_prefill_seconds: number
  average_decode_seconds: number
  average_request_seconds: number
  wave_seconds: number
  finish_reasons: string[]
}

export type BenchmarkConfiguration = {
  engine_build: string; model: string; weights: string
  tp: number; draft_tp: number; max_context: number; max_concurrency: number
  kv_dtype: string; spec: string; draft_tokens: number; draft_policy: string
  cuda_graph: boolean; vision: boolean
}

export type BenchmarkWave = {
  full_cold_prompt: boolean; computed_tokens: number; compute_seconds: number
  cached_tokens: number; output_tokens: number; mean_ttft_seconds: number
  decode_tokens: number; decode_rounds: number; decode_seconds: number
  wall_seconds: number
}

export type BenchmarkResult = {
  benchmark_id: BenchmarkRequest['benchmark_id']
  hardware: BenchmarkHardware | null
  methodology: 'ginfer-resident-max-perf-v1'
  run_id: string
  started_at_ms: number
  completed_at_ms: number
  session: {
    display_name: string
    pid: number | null
    target_id: string
    session_id: string | null
    model_id: string
    model_path: string
    max_context: number
    max_concurrency: number
    vision: boolean
    spec: string
    draft_tokens: number
    draft_tp: number
    kv_dtype: string
    prefill_chunk: number
    cuda_graph: boolean
  }
  points: BenchmarkPoint[]
}

export type BenchmarkHardware = {
  cpu_model: string | null
  physical_cores: number | null
  logical_threads: number | null
  ram_bytes: number | null
  ram_speed_mt_s: number | null
  os: 'Windows' | 'WSL' | 'Linux'
  os_version: string | null
  resource_scope: string
  gpus: { model: string; vram_mib: number; sm: string | null }[]
}

export type BenchmarkProgress = {
  run_id: string
  completed_points: number
  total_points: number
  concurrency: number
  phase: 'preparing' | 'warming' | 'measuring' | 'complete'
}

export async function listBenchmarkSessions(): Promise<BenchmarkSessionInfo[]> {
  const [local, paired] = await Promise.all([
    invoke<BenchmarkSessionInfo[]>('plugin:ginfer|get_all_sessions'),
    invoke<BenchmarkSessionInfo[]>('engine_hosts_command', { action: 'benchmark_sessions', args: {} }),
  ])
  return [...local.map((session) => ({ ...session, target_id: `local:${session.pid}` })), ...paired]
}

export async function runBenchmark(
  request: BenchmarkRequest,
  targetId?: string
): Promise<BenchmarkResult> {
  if (targetId?.startsWith('ginfer/')) {
    return invoke('engine_hosts_command', { action: 'benchmark', args: { target_id: targetId, request } })
  }
  return invoke('plugin:ginfer|run_ginfer_benchmark', { request })
}

export async function cancelBenchmark(runId: string): Promise<boolean> {
  return invoke('plugin:ginfer|cancel_ginfer_benchmark', { runId })
}

export async function onBenchmarkProgress(
  callback: (progress: BenchmarkProgress) => void
): Promise<UnlistenFn> {
  return listen<BenchmarkProgress>('ginfer-benchmark-progress', (event) =>
    callback(event.payload)
  )
}

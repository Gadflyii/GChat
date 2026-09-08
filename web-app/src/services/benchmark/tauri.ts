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
  run_id: string
  session_pid: number | null
  prompt_tokens: number
  max_output_tokens: number
  concurrencies: number[]
  warmup_rounds: number
  measured_rounds: number
}

export type BenchmarkPoint = {
  concurrency: number
  requested_prompt_tokens: number
  requested_output_tokens: number
  completed_requests: number
  average_prompt_tokens: number
  average_completion_tokens: number
  cached_prompt_tokens: number
  prompt_tokens_per_second: number
  generation_tokens_per_second: number
  per_request_generation_tokens_per_second: number
  wave_output_tokens_per_second: number
  average_prefill_seconds: number
  average_decode_seconds: number
  average_request_seconds: number
  wave_seconds: number
  finish_reasons: string[]
}

export type BenchmarkResult = {
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

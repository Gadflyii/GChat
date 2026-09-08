// Types

export interface SessionInfo {
  pid: number
  port: number
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
  api_key: string
}

export type GinferBenchmarkRequest = {
  run_id: string
  session_pid: number | null
  prompt_tokens: number
  max_output_tokens: number
  concurrencies: number[]
  warmup_rounds: number
  measured_rounds: number
}

export type GinferBenchmarkSession = {
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

export type GinferBenchmarkPoint = {
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

export type GinferBenchmarkResult = {
  run_id: string
  started_at_ms: number
  completed_at_ms: number
  session: GinferBenchmarkSession
  points: GinferBenchmarkPoint[]
}

export type GinferBenchmarkProgress = {
  run_id: string
  completed_points: number
  total_points: number
  concurrency: number
  phase: 'preparing' | 'warming' | 'measuring' | 'complete'
}

export interface UnloadResult {
  success: boolean
  error?: string
}

// ginfer-serve startup capability configuration
export type GinferConfig = {
  vision: boolean
  /** Speculative backend: `auto`, `none`, or `dflash`. */
  spec: string
  /** Explicit DFlash2 window; 0 uses the model/server default. */
  draft_tokens: number
  /** DFlash2 tensor parallel degree; 0 uses automatic placement. */
  draft_tp: number
  /** KV-cache storage: `auto`, `bf16`, `int8`, or `nvfp4`. */
  kv_dtype: string
  max_context: number
  /** Exact per-rank KV arena bytes, or `auto`. */
  kv_arena_bytes: string
  prefill_chunk: number
  /** Valid range 1..8; 0 leaves the server default. */
  max_concurrency: number
  no_cuda_graph: boolean
}

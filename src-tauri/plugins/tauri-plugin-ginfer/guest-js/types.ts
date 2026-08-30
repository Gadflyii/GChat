// Types

export interface SessionInfo {
  pid: number
  port: number
  model_id: string
  model_path: string
  is_embedding: boolean
  vision: boolean
  api_key: string
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

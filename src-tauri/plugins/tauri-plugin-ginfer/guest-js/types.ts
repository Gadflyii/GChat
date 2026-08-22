// Types

export interface SessionInfo {
  pid: number
  port: number
  model_id: string
  model_path: string
  is_embedding: boolean
  api_key: string
}

export interface UnloadResult {
  success: boolean
  error?: string
}

// ginfer-serve startup capability configuration
export type GinferConfig = {
  vision: boolean
  /** Speculative backend: `auto`, `none`, `mtp`, or `dflash`. */
  spec: string
  draft_tokens: number
  /** KV-cache storage: `bf16` or `int8`; empty means the server default. */
  kv_dtype: string
  lm_head_draft: boolean
  max_context: number
  /** Shared KV capacity: a number or `auto`; empty means follow max-context. */
  kv_capacity: string
  prefill_chunk: number
  /** Valid range 1..8; 0 leaves the server default. */
  max_concurrency: number
  no_cuda_graph: boolean
}

/**
 * Settings > GInfer: only a few options matter on first use. Engine-level ones
 * sit behind an Advanced section and use plain labels. Keys match
 * extensions/ginfer-extension/settings.json; stored values are unchanged.
 */
export const ginferAdvancedKeys = new Set([
  'model_path',
  'binary_path',
  'spec',
  'draft_tokens',
  'draft_tp',
  'kv_dtype',
  'kv_arena_bytes',
  'prefill_chunk',
  'max_concurrency',
  'no_cuda_graph',
])

export const ginferSettingLabels: Record<string, { title: string; description: string }> = {
  model_path: {
    title: 'Model folder',
    description: 'Where GChat keeps downloaded models. Leave empty to use the default folder inside GChat’s data folder.',
  },
  binary_path: {
    title: 'Engine program',
    description: 'Path to a GInfer engine program. Leave empty to use the one that comes with GChat.',
  },
  spec: {
    title: 'Speculative decoding',
    description: 'A built-in helper model that can make answers faster. Auto uses it when the model has one; Off turns it off. Applies the next time a model starts.',
  },
  draft_tokens: {
    title: 'Helper draft length',
    description: 'How many words the speculative helper guesses ahead (1 to 7). Auto uses the model’s own recommendation.',
  },
  draft_tp: {
    title: 'Helper model placement',
    description: 'Auto places the helper model for you. Change it only if a model’s instructions say to.',
  },
  kv_dtype: {
    title: 'Conversation memory precision',
    description: 'How precisely GInfer stores the conversation it is keeping in memory (the KV cache). Auto lets GInfer choose. Applies the next time a model starts.',
  },
  kv_arena_bytes: {
    title: 'Conversation memory size',
    description: 'How much graphics memory to set aside for conversations, in bytes. Auto sizes it from the memory that is free.',
  },
  prefill_chunk: {
    title: 'Prompt processing block size',
    description: 'How many words of a long prompt are read at once. Auto is fine for most computers; values must be multiples of 128.',
  },
  max_concurrency: {
    title: 'Simultaneous requests',
    description: 'How many answers can be written at the same time (1 to 8). Auto uses 1.',
  },
  no_cuda_graph: {
    title: 'Turn off CUDA Graphs (troubleshooting)',
    description: 'Makes startup and answers a little slower; use only if a model will not start. Applies the next time a model starts.',
  },
}

/**
 * GInfer settings that are engine start arguments. They change nothing for a
 * model that is already running, so applying one means restarting that model.
 * Every other GInfer setting (Model folder, Auto Unload, Timeout) is read at
 * the next load or the next request and never needs the running model touched.
 * Keep in step with buildGinferConfig / binary_path in
 * extensions/ginfer-extension/src/index.ts.
 */
export const ginferRestartKeys = new Set([
  'binary_path',
  'vision',
  'spec',
  'draft_tokens',
  'draft_tp',
  'kv_dtype',
  'kv_arena_bytes',
  'prefill_chunk',
  'max_concurrency',
  'no_cuda_graph',
])

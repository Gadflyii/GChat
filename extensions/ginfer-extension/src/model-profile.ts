export type GinferModelProfile = {
  family: 'qwen3.8-27b' | 'muse-glimmer-30b'
  nativeContextTokens: number
}

const QWEN_NATIVE_CONTEXT = 262_144
const MUSE_NATIVE_CONTEXT = 131_072

/**
 * GInfer admits a closed set of registered model families. Model IDs created
 * from local filenames use underscores while published IDs use punctuation,
 * so family detection deliberately normalizes both forms.
 */
export function ginferModelProfile(
  modelId: string,
  displayName?: string
): GinferModelProfile | undefined {
  const identity = `${modelId} ${displayName ?? ''}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')

  if (identity.includes('museglimmer30b')) {
    return {
      family: 'muse-glimmer-30b',
      nativeContextTokens: MUSE_NATIVE_CONTEXT,
    }
  }
  if (identity.includes('qwen3827b') || identity.includes('qwen38')) {
    return {
      family: 'qwen3.8-27b',
      nativeContextTokens: QWEN_NATIVE_CONTEXT,
    }
  }
  return undefined
}

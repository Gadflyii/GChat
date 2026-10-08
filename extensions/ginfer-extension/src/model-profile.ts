export type GinferModelProfile = {
  family: 'qwen3.8-27b' | 'muse-glimmer-30b' | 'qwen3.8-flash-next'
  nativeContextTokens: number
}

const QWEN_NATIVE_CONTEXT = 262_144
const MUSE_NATIVE_CONTEXT = 131_072
// GInfer's Flash-Next Package::model_max_context, independently of Qwen 27B.
const FLASH_NATIVE_CONTEXT = 262_144

const QWEN_WEIGHTS = new Set([
  'groupwise-int-dflash2-q4',
  'groupwise-int-dflash2-q4-g32',
  'groupwise-int-dflash2-q4w8',
  'groupwise-int-dflash2-w8',
  'smol-q2g64-dflash2-q4',
  'smol-q2g64-l51down-q4-dflash2-q4',
  'smol-q2g64-fullattn-gate-value-l51down-q4-dflash2-q4',
  'nvfp4',
  'nvfp4-dflash2-q4',
  'nvfp4-dflash2-q4w8',
  'nvfp4-dflash2-w8',
  'nvfp4-dflash2-nvfp4',
])
const MUSE_WEIGHTS = new Set([
  'groupwise-int',
  'groupwise-int-dflash-q4',
  'groupwise-int-dflash-q4-g32',
  'groupwise-int-dflash-q4w8',
  'groupwise-int-dflash-w8',
  'nvfp4',
  'nvfp4-dflash-q4w8',
  'nvfp4-dflash-w8',
  'nvfp4-dflash-nvfp4',
  'smol-q2g64-dflash-q4',
])
const FLASH_WEIGHTS = new Set(['groupwise-int', 'smol-q2g64', 'nvfp4'])

function registeredIdentity(
  modelId: string,
  family: GinferModelProfile['family'],
  weights: Set<string>
): boolean {
  return modelId === family || (
    modelId.startsWith(`${family}/`) && weights.has(modelId.slice(family.length + 1))
  )
}

/**
 * Match registered artifact identities and current package stems separately.
 * Display names are editable labels; they cannot establish a context contract.
 * The October 8 rename preserves the artifact identities and package contents.
 */
export function ginferModelProfile(modelId: string): GinferModelProfile | undefined {
  if (
    registeredIdentity(modelId, 'muse-glimmer-30b', MUSE_WEIGHTS) ||
    /^muse_glimmer_30b_(?:(?:int_df2|nvfp4_df2|nvfp4_df2q4)(?:_tp[24])?|smol_df2)$/.test(modelId)
  ) {
    return {
      family: 'muse-glimmer-30b',
      nativeContextTokens: MUSE_NATIVE_CONTEXT,
    }
  }
  if (
    registeredIdentity(modelId, 'qwen3.8-27b', QWEN_WEIGHTS) ||
    /^qwen38_27b_(?:(?:int_df2|nvfp4_df2|nvfp4_df2q4)(?:_tp[24])?|smol_df2)$/.test(modelId)
  ) {
    return {
      family: 'qwen3.8-27b',
      nativeContextTokens: QWEN_NATIVE_CONTEXT,
    }
  }
  if (
    registeredIdentity(modelId, 'qwen3.8-flash-next', FLASH_WEIGHTS) ||
    /^qwen38_flash_(?:(?:int|smol)_mtp(?:_tp[24])?|nvfp4_mtp)$/.test(modelId) ||
    // Released Flash NVFP4 packages were excluded from the filename rename.
    /^qwen3\.8-flash-next-nvfp4-tp[124]-nv-kv$/.test(modelId)
  ) {
    return {
      family: 'qwen3.8-flash-next',
      nativeContextTokens: FLASH_NATIVE_CONTEXT,
    }
  }
  return undefined
}

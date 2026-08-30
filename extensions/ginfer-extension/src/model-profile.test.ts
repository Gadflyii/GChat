import { describe, expect, it } from 'vitest'

import { ginferModelProfile } from './model-profile'

describe('ginferModelProfile', () => {
  it('recognizes adopted and published Muse identities', () => {
    expect(
      ginferModelProfile('muse_glimmer_30b_nvfp4_dflash2')
        ?.nativeContextTokens
    ).toBe(131_072)
    expect(
      ginferModelProfile('muse-glimmer-30b/nvfp4-dflash-w8')
        ?.nativeContextTokens
    ).toBe(131_072)
  })

  it('recognizes adopted and published Qwen3.8 identities', () => {
    expect(
      ginferModelProfile('qwen38_27b_nvfp4_dflash2')?.nativeContextTokens
    ).toBe(262_144)
    expect(
      ginferModelProfile('qwen3.8-27b/nvfp4-dflash2-q4')
        ?.nativeContextTokens
    ).toBe(262_144)
  })

  it('does not invent a context contract for an unknown artifact', () => {
    expect(ginferModelProfile('custom-model')).toBeUndefined()
  })
})

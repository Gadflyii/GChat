import { describe, expect, it } from 'vitest'

import { ginferModelProfile } from './model-profile'

const degrees = ['', '_tp2', '_tp4']
const targetPackages = (prefix: string) => [
  ...['int_df2', 'nvfp4_df2', 'nvfp4_df2q4'].flatMap((recipe) =>
    degrees.map((degree) => `${prefix}_${recipe}${degree}`)
  ),
  `${prefix}_smol_df2`,
]

describe('ginferModelProfile', () => {
  it.each(targetPackages('muse_glimmer_30b'))('recognizes current Muse package %s', (id) => {
    expect(ginferModelProfile(id)).toEqual({
      family: 'muse-glimmer-30b',
      nativeContextTokens: 131_072,
    })
  })

  it.each(targetPackages('qwen38_27b'))('recognizes current Qwen 27B package %s', (id) => {
    expect(ginferModelProfile(id)).toEqual({
      family: 'qwen3.8-27b',
      nativeContextTokens: 262_144,
    })
  })

  it.each([
    ...['int', 'smol'].flatMap((recipe) =>
      degrees.map((degree) => `qwen38_flash_${recipe}_mtp${degree}`)
    ),
    'qwen38_flash_nvfp4_mtp',
    'qwen3.8-flash-next-nvfp4-tp1-nv-kv',
    'qwen3.8-flash-next-nvfp4-tp2-nv-kv',
    'qwen3.8-flash-next-nvfp4-tp4-nv-kv',
    'qwen3.8-flash-next',
    'qwen3.8-flash-next/groupwise-int',
    'qwen3.8-flash-next/smol-q2g64',
    'qwen3.8-flash-next/nvfp4',
  ])('recognizes Flash as its own family for %s', (id) => {
    expect(ginferModelProfile(id)).toEqual({
      family: 'qwen3.8-flash-next',
      nativeContextTokens: 262_144,
    })
  })

  it.each([
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
  ])('preserves the registered Muse identity %s', (weights) => {
    expect(ginferModelProfile(`muse-glimmer-30b/${weights}`)?.family).toBe('muse-glimmer-30b')
  })

  it.each([
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
  ])('preserves the registered Qwen identity %s', (weights) => {
    expect(ginferModelProfile(`qwen3.8-27b/${weights}`)?.family).toBe('qwen3.8-27b')
  })

  it.each([
    ['muse-glimmer-30b', 131_072],
    ['qwen3.8-27b', 262_144],
  ] as const)('recognizes the container model_id %s', (id, context) => {
    expect(ginferModelProfile(id)?.nativeContextTokens).toBe(context)
  })

  it.each([
    'custom-model',
    'custom_qwen38_27b_int_df2',
    'muse_glimmer_30b_nvfp4_df2q4_backup',
    'qwen38_flash_int_mtp_draft',
    'qwen38_27b_int_df2_tp1',
    'qwen38_27b_int_df2_tp8',
    'qwen38_27b_int_df2_TP2',
    'muse_glimmer_30b_nvfp4_df2q8',
    'muse_glimmer_30b_nvfp4_df2q4_tp3',
    'muse_glimmer_30b_smol_df2_tp2',
    'qwen38_flash_unknown_mtp',
    'qwen38_flash_int_mtp_tp8',
    'qwen38_flash_nvfp4_mtp_tp2',
    'qwen38_flash_nvfp4_mtp_tp4',
    'qwen3.8-flash-next-nvfp4-tp8-nv-kv',
    'qwen3.8-flash-next-groupwise-int-tp1-nv-kv',
    'qwen3.8-flash-next-smol-q2g64-tp2-nv-kv',
    'qwen3.8-flash-next/unknown',
    'qwen3.8-27b/unknown',
    'muse-glimmer-30b/unknown',
    'qwen38_27b_autoround_dflash2',
    'qwen38_27b_nvfp4_dflash2',
    'muse_glimmer_30b_nvfp4_dflash2',
    'Muse Glimmer 30B',
    'Qwen3.8 Flash',
  ])('does not invent a profile for an unknown or superseded ID %s', (id) => {
    expect(ginferModelProfile(id)).toBeUndefined()
  })
})

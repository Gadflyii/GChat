import { describe, expect, it } from 'vitest'
import { identityLabel, plainModelName, plainWeightsName, weightsDrafterDetail } from '../engine-host-labels'

describe('plain model names', () => {
  it.each([
    ['qwen3.8-27b', 'smol-q2g64-mix-dflash2-q4', 'Qwen 3.8 27B — 2-bit mix'],
    ['muse-glimmer-30b', 'smol-q2g64-mix-dflash-q4', 'Muse 30B — 2-bit mix'],
    ['qwen3.8-flash-next', 'smol-q2g64', 'Qwen 3.8 Flash — pure 2-bit'],
    ['qwen3.8-27b', 'groupwise-int-dflash2-q4', 'Qwen 3.8 27B — INT'],
    ['muse-glimmer-30b', 'nvfp4-dflash-nvfp4', 'Muse 30B — NVFP4'],
  ])('shows %s / %s as "%s" without internal format names', (model, weights, label) => {
    expect(identityLabel({ model_id: model, weights_id: weights })).toBe(label)
    expect(label).not.toMatch(/smol|q2g64|dflash|groupwise/i)
  })

  it('keeps the drafter for a details line and strips a trailing package hash from catalog names', () => {
    expect(weightsDrafterDetail('smol-q2g64-mix-dflash2-q4')).toBe('Speculative drafter: DFlash2')
    expect(weightsDrafterDetail('nvfp4')).toBeUndefined()
    expect(plainModelName(`Qwen 27B 2-bit mix (${'a'.repeat(64)})`)).toBe('Qwen 27B 2-bit mix')
    expect(plainModelName('Qwen 27B 2-bit mix')).toBe('Qwen 27B 2-bit mix')
    expect(plainWeightsName('x', 'weird-format')).toBe('WEIRD FORMAT')
  })
})

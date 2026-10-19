import { describe, expect, it } from 'vitest'
import type { EngineInstance, EngineSnapshot } from '@/services/engines'
import { hostInstanceLabel, identityLabel, plainModelName, plainWeightsName, weightsDrafterDetail } from '../engine-host-labels'

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

describe('plain profile names', () => {
  it('maps SMOL in Host profile names to the plain names', async () => {
    const { plainProfileName } = await import('../engine-host-labels')
    expect(plainProfileName('GBench Max Perf · Flash SMOL')).toBe('GBench Max Perf · Flash pure 2-bit')
    expect(plainProfileName('GBench Max Perf · Qwen 3.8 Flash SMOL')).toBe('GBench Max Perf · Qwen 3.8 Flash pure 2-bit')
    expect(plainProfileName('Qwen 27B SMOL')).toBe('Qwen 27B 2-bit mix')
    expect(plainProfileName('GBench Max Perf · Qwen 3.8 27B INT')).toBe('GBench Max Perf · Qwen 3.8 27B INT')
  })
})

describe('plain GPU and startup names', () => {
  it('names a startup profile without the raw package id', async () => {
    const { plainStartupModelName } = await import('../engine-host-labels')
    expect(plainStartupModelName('qwen3.8-27b/smol-q2g64-mix-dflash2-q4')).toBe('Qwen 3.8 27B — 2-bit mix')
    expect(plainStartupModelName('muse')).toBe('muse')
  })
  it('numbers cards only when names repeat', async () => {
    const { gpuCardName } = await import('../engine-host-labels')
    expect(gpuCardName([{ name: 'RTX 5090' }, { name: 'RTX 4090' }], 0)).toBe('RTX 5090')
    expect(gpuCardName([{ name: 'RTX 5090' }, { name: 'RTX 5090' }], 1)).toBe('RTX 5090 (card 2 of 2)')
  })
})


describe('model server labels', () => {
  const instance: EngineInstance = {
    instance_id: 'second', session_id: 'session', display_name: 'Qwen for writing', upstream_model_id: 'qwen', status: 'ready',
    configuration: { gpu_uuids: ['card-two'], concurrency: 4, max_context: 131072 },
  }
  const snapshot: EngineSnapshot = {
    host_id: 'host', display_name: 'Office computer', revision: 1, models: [],
    instances: [{ ...instance, instance_id: 'first' }, instance],
    gpus: [
      { uuid: 'card-one', name: 'RTX 5090', memory_mib: 32768, compute_capability: '12.0' },
      { uuid: 'card-two', name: 'RTX 5090', memory_mib: 32768, compute_capability: '12.0' },
    ],
  }

  it('distinguishes the model server, request limit, context length and graphics card', () => {
    expect(hostInstanceLabel(instance, snapshot)).toBe('Model server 2 · Qwen for writing · 4 requests at once · 131,072 context tokens · Graphics cards 2')
  })

  it('keeps automatic choices distinct from a graphics card that is no longer available', () => {
    const automatic = { ...instance, configuration: { gpu_uuids: [], concurrency: 0, max_context: 0 } }
    expect(hostInstanceLabel(automatic, snapshot)).toBe('Model server 2 · Qwen for writing · Concurrency: automatic · Context length: automatic · Graphics cards chosen automatically')
    expect(hostInstanceLabel({ ...automatic, configuration: { ...automatic.configuration, gpu_uuids: ['missing-card'] } }, snapshot)).toContain('Graphics cards unavailable')
  })
})

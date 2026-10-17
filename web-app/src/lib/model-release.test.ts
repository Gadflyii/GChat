import { afterEach, describe, expect, it, vi } from 'vitest'
import { releaseReadiness, validRelease, type ModelRelease } from './model-release'

const release: ModelRelease = { name: 'Fixture', identity: { model_id: 'fixture', weights_id: 'q4' },
  url: `https://huggingface.co/test/model/resolve/${'a'.repeat(40)}/model.ginfer`, sha256: 'b'.repeat(64),
  bytes: 4096, tp: 1, qualified_sm: ['8.6'], min_vram_mib_per_gpu: 16384, capabilities: ['tools'] }
const gpu = { uuid: 'one', name: 'Fixture GPU', memory_mib: 16384, compute_capability: '8.6' }
afterEach(() => vi.unstubAllEnvs())
describe('released model recommendations', () => {
  it('matches actual SM and per-GPU memory, not marketing names', () => {
    expect(releaseReadiness(release, [gpu]).available).toBe(true)
    expect(releaseReadiness(release, [{ ...gpu, compute_capability: '8.9' }]).available).toBe(false)
    expect(releaseReadiness(release, [{ ...gpu, memory_mib: 12288 }]).available).toBe(false)
  })
  it('never sums VRAM or treats heterogeneous devices as a TP group', () => {
    expect(releaseReadiness({ ...release, min_vram_mib_per_gpu: 32768 }, [gpu, { ...gpu, uuid: 'two' }]).available).toBe(false)
    expect(releaseReadiness({ ...release, tp: 2 }, [gpu, { ...gpu, uuid: 'two', name: 'Different GPU' }]).available).toBe(false)
    expect(releaseReadiness({ ...release, tp: 2 }, [gpu, { ...gpu, uuid: 'two' }]).gpuIds).toEqual(['one', 'two'])
  })
  it('does not offer unknown, unpublished or mutable packages', () => {
    expect(validRelease({ ...release, url: release.url.replace('a'.repeat(40), 'main') })).toBe(false)
    expect(releaseReadiness(undefined, [gpu]).reason).toContain('not published')
    expect(releaseReadiness(release, [{ ...gpu, compute_capability: undefined }]).available).toBe(false)
    expect(releaseReadiness(release, []).available).toBe(false)
  })
  it('admits real package metadata from an explicitly selected private development catalog', () => {
    vi.stubEnv('DEV', true)
    vi.stubEnv('VITE_MODEL_CATALOG_URL', 'http://127.0.0.1:19361/catalog.json')
    const local = { ...release, url: 'http://127.0.0.1:19361/model.ginfer' }
    expect(releaseReadiness(local, [gpu]).available).toBe(true)
    expect(validRelease({ ...local, sha256: '' })).toBe(false)
    expect(validRelease({ ...local, bytes: 0 })).toBe(false)
    expect(validRelease({ ...local, tp: 3 })).toBe(false)
    expect(releaseReadiness(local, [{ ...gpu, memory_mib: 12288 }]).available).toBe(false)
  })
  it('keeps the private catalog restricted to its loopback origin and development builds', () => {
    const local = { ...release, url: 'http://127.0.0.1:19361/model.ginfer' }
    vi.stubEnv('DEV', true)
    vi.stubEnv('VITE_MODEL_CATALOG_URL', '')
    expect(validRelease(local)).toBe(false)
    vi.stubEnv('VITE_MODEL_CATALOG_URL', 'http://127.0.0.1:19361/catalog.json')
    for (const url of [
      'http://127.0.0.1:19362/model.ginfer',
      'http://192.168.1.10:19361/model.ginfer',
      'http://user@127.0.0.1:19361/model.ginfer',
      'http://127.0.0.1:19361/model.ginfer?other',
      'http://127.0.0.1:19361/model.ginfer#other',
      'http://127.0.0.1:19361/model.gguf',
    ]) expect(validRelease({ ...local, url })).toBe(false)
    vi.stubEnv('VITE_MODEL_CATALOG_URL', 'http://192.168.1.10:19361/catalog.json')
    expect(validRelease({ ...local, url: 'http://192.168.1.10:19361/model.ginfer' })).toBe(false)
    vi.stubEnv('VITE_MODEL_CATALOG_URL', 'http://127.0.0.1:19361/catalog.json')
    vi.stubEnv('VITE_MODEL_CATALOG_URL', 'invalid')
    expect(validRelease(release)).toBe(true)
    vi.stubEnv('DEV', false)
    expect(validRelease(local)).toBe(false)
    expect(validRelease(release)).toBe(true)
  })
})

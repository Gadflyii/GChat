import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ModelDownload } from '@/lib/model-release'
const mocks = vi.hoisted(() => ({
  command: vi.fn(), providers: vi.fn(async () => [{ provider: 'ginfer', models: [] }]),
  imported: [] as unknown[], projected: [] as unknown[],
}))
vi.mock('@/services/engines', () => ({ engineCommand: mocks.command }))
vi.mock('@gchat/core', () => ({ AppEvent: { onModelImported: 'imported' }, events: { emit: (_event: string, value: unknown) => mocks.imported.push(value) } }))
vi.mock('@/hooks/useServiceHub', () => ({ isServiceHubInitialized: () => true, getServiceHub: () => ({ providers: () => ({ getProviders: mocks.providers }) }) }))
vi.mock('@/hooks/useModelProvider', () => ({ useModelProvider: { getState: () => ({ setProviders: (value: unknown[]) => { mocks.projected = value } }) } }))
const job: ModelDownload = { id: 'job', release: { name: 'Fixture', identity: { model_id: 'muse-glimmer-30b', weights_id: 'nvfp4' },
  bytes: 4096, sha256: 'a'.repeat(64), url: 'https://example.invalid/fixture', tp: 1, qualified_sm: ['12.0'], min_vram_mib_per_gpu: 32000, capabilities: ['tools'] },
  status: 'downloading', received: 128, bytes_per_second: 128, error: null, path: null }
describe('local transfer projection', () => {
  beforeEach(() => { vi.resetModules(); vi.clearAllMocks(); mocks.imported = []; mocks.projected = [] })
  it('deduplicates refresh and publishes one import transition without replaying old jobs', async () => {
    const { useLocalModelDownloads: store } = await import('./local-model-downloads-store')
    let resolve!: (jobs: ModelDownload[]) => void
    mocks.command.mockReturnValueOnce(new Promise<ModelDownload[]>(done => { resolve = done }))
    const first = store.getState().refresh(), second = store.getState().refresh()
    resolve([job]); await Promise.all([first, second])
    expect(first).toBe(second)
    expect(store.getState().jobs[0].received).toBe(128)
    const finished = { ...job, status: 'installed', received: 4096, path: '/models/fixture/model.ginfer' }
    mocks.command.mockResolvedValue([finished])
    await store.getState().refresh()
    expect(store.getState().jobs[0].status).toBe('installed')
    expect(mocks.projected).toEqual([{ provider: 'ginfer', models: [] }])
    expect(mocks.imported).toEqual([{ modelId: job.release.sha256, modelPath: finished.path, size_bytes: 4096, model_sha256: job.release.sha256, model_size_bytes: 4096, source: 'local' }])
    const previous = store.getState().jobs
    mocks.command.mockResolvedValue([{ ...finished }])
    await store.getState().refresh()
    expect(store.getState().jobs).toBe(previous)
    expect(mocks.imported).toHaveLength(1)
  })
  it('keeps last-known transfer data and reports an unavailable destination', async () => {
    const { useLocalModelDownloads: store } = await import('./local-model-downloads-store')
    mocks.command.mockResolvedValueOnce([job])
    await store.getState().refresh()
    mocks.command.mockRejectedValueOnce(new Error('Disk unavailable'))
    await expect(store.getState().refresh()).rejects.toThrow('Disk unavailable')
    expect(store.getState().error).toContain('Disk unavailable')
    expect(store.getState().jobs[0].received).toBe(128)
  })
  it('notifies a just-requested download even when it finishes before the first poll', async () => {
    const { useLocalModelDownloads: store } = await import('./local-model-downloads-store')
    store.getState().acknowledge(job)
    mocks.command.mockResolvedValue([{ ...job, status: 'installed', received: 4096 }])
    await store.getState().refresh()
    expect(store.getState().jobs[0].status).toBe('installed')
    expect(mocks.imported).toHaveLength(1)
    await store.getState().refresh()
    expect(mocks.imported).toHaveLength(1)
  })
})

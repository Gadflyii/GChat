import { expect, it, vi } from 'vitest'
import { studioCommand } from '@/services/agent/studio'
import { refreshStudioCatalog, useStudioCatalogState } from './useStudioCatalog'

vi.mock('@/services/agent/studio', () => ({ studioCommand: vi.fn() }))
it('shares in-flight capacity requests, retains unchanged state and reports stale data', async () => {
  const catalog = { instances: [], pools: [], usage: { local: 1 } }
  let complete!: (data: typeof catalog) => void
  vi.mocked(studioCommand).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        complete = resolve
      })
  )
  const a = refreshStudioCatalog()
  const b = refreshStudioCatalog()
  expect(a).toBe(b)
  complete(catalog)
  await a
  expect(useStudioCatalogState.getState().catalog.usage.local).toBe(1)
  const state = useStudioCatalogState.getState()
  vi.mocked(studioCommand).mockResolvedValueOnce(structuredClone(catalog))
  await refreshStudioCatalog()
  expect(useStudioCatalogState.getState()).toBe(state)
  vi.mocked(studioCommand).mockRejectedValueOnce(new Error('Host unavailable'))
  await refreshStudioCatalog()
  expect(useStudioCatalogState.getState().catalog).toBe(state.catalog)
  expect(useStudioCatalogState.getState().error).toContain('Host unavailable')
})

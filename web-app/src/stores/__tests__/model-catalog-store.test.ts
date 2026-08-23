import { describe, expect, it, vi } from 'vitest'

// The catalog is the closed ginfer set, so the store no longer fetches a
// remote registry or a bundled seed: `refresh()` resolves to the bundled
// baseline, with the shard-folding helper still applied to it.
//
// The baseline is read from the same module graph the store loads after
// `vi.resetModules()`, so the store's entries are comparable by reference.
const loadStore = async () => {
  vi.resetModules()
  const [{ useModelCatalogStore }, { BASELINE_MODEL_CATALOG: baseline }] =
    await Promise.all([
      import('../model-catalog-store'),
      import('@/constants/models'),
    ])
  await useModelCatalogStore.getState().refresh()
  return { store: useModelCatalogStore, baseline }
}

describe('model-catalog-store', () => {
  it('resolves the catalog to the baseline ginfer set', async () => {
    const { store, baseline } = await loadStore()

    const state = store.getState()
    expect(state.catalog).toHaveLength(baseline.length)
    expect(state.catalog).toEqual(baseline)
    expect(state.catalog.every((entry) => entry.library_name === 'ginfer')).toBe(
      true
    )
    expect(state.source).toBe('baseline')
    expect(state.status).toBe('success')
    expect(state.hasInitialized).toBe(true)
    expect(state.error).toBeNull()
  })

  it('keeps the download pointing at the bundled .ginfer artifact', async () => {
    const { store } = await loadStore()

    for (const model of store.getState().catalog) {
      expect(model.quants[0].path).toBe(
        `https://huggingface.co/${model.model_name}/resolve/main/model.ginfer`
      )
    }
  })

  it('leaves an unsharded entry untouched', async () => {
    const { store, baseline } = await loadStore()

    // The baseline entries each carry a single quant, so the folding helper
    // passes them through as-is rather than rewriting them.
    const catalog = store.getState().catalog
    for (const [index, model] of catalog.entries()) {
      expect(model).toBe(baseline[index])
    }
  })
})

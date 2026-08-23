/**
 * Zustand store wrapping the model-catalog loader.
 *
 * Mirrors `provider-registry-store.ts` and
 * `recommended-models-registry-store.ts`:
 *  - Bootstraps the catalog + index in the background on first import.
 *  - Holds the in-memory list (and the pre-built MiniSearch payload) so
 *    React components and non-React modules read it synchronously.
 *  - Surfaces loading / source / last-fetch metadata for UI.
 *
 * The store stays platform-neutral. Platform-aware filtering (MLX vs
 * non-macOS hosts) happens in `useModelSources` / `model-search.ts`, not
 * here, so the cache + baseline remain portable.
 */

import { create } from 'zustand'
import { type CatalogIndexPayload, type RegistrySource } from '@/services/model-catalog-registry'
import { BASELINE_MODEL_CATALOG } from '@/constants/models'
import { mergeShardedQuants } from '@/lib/models'
import type { CatalogModel } from '@/services/models/types'

/**
 * The catalog mirrors each repository's file list, so a quant published as
 * `-00001-of-000NN` shards arrives as one entry per shard. Folding them back
 * into one variant belongs here rather than in a consumer: the Hub list, the
 * search service and `getCatalogSync` all read this store and would each have
 * to repeat it. Applied on read, so a cached artefact needs no migration.
 */
const adopt = (models: ReadonlyArray<CatalogModel>): CatalogModel[] =>
  models.map(mergeShardedQuants)

export type CatalogStatus = 'idle' | 'loading' | 'success' | 'error'

type ModelCatalogState = {
  catalog: CatalogModel[]
  manifestUpdatedAt: string | null
  source: RegistrySource
  status: CatalogStatus
  fetchedAt: number | null
  error: string | null
  /** Pre-built MiniSearch snapshot (or `null` if absent). */
  index: CatalogIndexPayload | null
  indexSource: RegistrySource
  indexFetchedAt: number | null
  /** True until the first refresh resolves (success or fallback). */
  hasInitialized: boolean
  refresh: () => Promise<void>
}

export const useModelCatalogStore = create<ModelCatalogState>()((set) => ({
  catalog: adopt(BASELINE_MODEL_CATALOG),
  manifestUpdatedAt: null,
  source: 'baseline',
  status: 'idle',
  fetchedAt: null,
  error: null,
  index: null,
  indexSource: 'baseline',
  indexFetchedAt: null,
  hasInitialized: false,
  refresh: async () => {
    // GChat runs a single local backend (ginfer) with a closed model set, so
    // the catalog is the bundled baseline. The remote registry and the
    // bundled seed carry model formats this app cannot load and are never
    // fetched.
    set({
      catalog: adopt(BASELINE_MODEL_CATALOG),
      source: 'baseline',
      status: 'success',
      error: null,
      hasInitialized: true,
    })
  },
}))

/**
 * Synchronous accessor for non-React code returning the current catalog.
 */
export const getCatalogSync = (): CatalogModel[] =>
  useModelCatalogStore.getState().catalog

/**
 * Synchronous accessor for the pre-built MiniSearch index payload.
 */
export const getCatalogIndexSync = (): CatalogIndexPayload | null =>
  useModelCatalogStore.getState().index

/**
 * Ensure the catalog has resolved at least once. Cheap on subsequent
 * calls — returns immediately when initialization is already complete.
 */
export const ensureCatalogLoaded = async (): Promise<CatalogModel[]> => {
  const state = useModelCatalogStore.getState()
  if (state.hasInitialized) return state.catalog
  await state.refresh()
  return useModelCatalogStore.getState().catalog
}

/**
 * Kick off the initial fetch in the background. Importing this module is
 * enough to start loading; tests can override or skip via mocking.
 */
if (typeof window !== 'undefined') {
  void useModelCatalogStore
    .getState()
    .refresh()
    .catch((error) => {
      console.warn('[model-catalog-store] initial refresh failed:', error)
    })
}

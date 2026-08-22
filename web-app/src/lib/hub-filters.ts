/**
 * Pure filtering / sorting / persistence logic for the Hub model list.
 *
 * Kept free of React and of the DOM so the behaviour can be unit-tested
 * without rendering: `HubFilters.tsx` only renders the controls and forwards
 * state changes here.
 */

import {
  estimateFit,
  parseFileSizeToBytes,
  pickMedianQuant,
} from '@/lib/model-card'
import { getTotalDownloadFileSize } from '@/lib/models'
import type { CatalogModel } from '@/services/models/types'

export type HubSortKey =
  | 'recommended'
  | 'likes'
  | 'downloads'
  | 'last-modified'

export const HUB_SORT_KEYS: readonly HubSortKey[] = [
  'recommended',
  'likes',
  'downloads',
  'last-modified',
]

export type HubFilterState = {
  sort: HubSortKey
  /** Hide entries that cannot fit the detected memory budget. */
  onlyFitting: boolean
}

export const DEFAULT_HUB_FILTERS: HubFilterState = {
  sort: 'recommended',
  onlyFitting: true,
}

export const HUB_FILTERS_STORAGE_KEY = 'gchat_hub_filters_v1'

const isSortKey = (value: unknown): value is HubSortKey =>
  typeof value === 'string' && HUB_SORT_KEYS.includes(value as HubSortKey)

/** Coerce anything (parsed JSON, legacy shape, garbage) into a valid state. */
export function normalizeHubFilters(raw: unknown): HubFilterState {
  if (typeof raw !== 'object' || raw === null) return { ...DEFAULT_HUB_FILTERS }
  const value = raw as Record<string, unknown>

  return {
    sort: isSortKey(value.sort) ? value.sort : DEFAULT_HUB_FILTERS.sort,
    onlyFitting:
      typeof value.onlyFitting === 'boolean'
        ? value.onlyFitting
        : DEFAULT_HUB_FILTERS.onlyFitting,
  }
}

export function serializeHubFilters(state: HubFilterState): string {
  return JSON.stringify({
    sort: state.sort,
    onlyFitting: state.onlyFitting,
  })
}

export function readHubFilters(storage?: Storage | null): HubFilterState {
  const ls = storage ?? safeLocalStorage()
  if (!ls) return { ...DEFAULT_HUB_FILTERS }
  try {
    const raw = ls.getItem(HUB_FILTERS_STORAGE_KEY)
    if (!raw) return { ...DEFAULT_HUB_FILTERS }
    return normalizeHubFilters(JSON.parse(raw))
  } catch {
    return { ...DEFAULT_HUB_FILTERS }
  }
}

export function writeHubFilters(
  state: HubFilterState,
  storage?: Storage | null
): void {
  const ls = storage ?? safeLocalStorage()
  if (!ls) return
  try {
    ls.setItem(HUB_FILTERS_STORAGE_KEY, serializeHubFilters(state))
  } catch (error) {
    console.warn('[hub-filters] Failed to persist filter state:', error)
  }
}

function safeLocalStorage(): Storage | null {
  try {
    if (typeof window === 'undefined') return null
    return window.localStorage
  } catch {
    return null
  }
}

/**
 * Download size of the entry as shown on its row: the median quant plus its
 * mmproj companion.
 */
export function modelDownloadSizeText(
  model: CatalogModel
): string | undefined {
  return getTotalDownloadFileSize(model, pickMedianQuant(model.quants))
}

/**
 * Does this model fit the memory budget? A zero/unknown budget means the
 * hardware probe has not resolved yet — never hide anything in that case.
 */
export function modelFitsBudget(
  model: CatalogModel,
  budgetBytes: number
): boolean {
  if (!budgetBytes) return true
  const sizeBytes = parseFileSizeToBytes(modelDownloadSizeText(model))
  return estimateFit(sizeBytes, budgetBytes) !== 'no'
}

const timestamp = (value?: string): number => {
  if (!value) return 0
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : 0
}

/**
 * Sort a list of models.
 *
 * `recommended` keeps the incoming order, which is the relevance ranking
 * already produced by `model-search.ts` (or the curated `order` for staff
 * picks) — re-sorting it here would throw that work away.
 */
export function sortModels(
  models: readonly CatalogModel[],
  sort: HubSortKey
): CatalogModel[] {
  const next = [...models]
  switch (sort) {
    case 'likes':
      return next.sort((a, b) => (b.likes ?? 0) - (a.likes ?? 0))
    case 'downloads':
      return next.sort((a, b) => (b.downloads ?? 0) - (a.downloads ?? 0))
    case 'last-modified':
      return next.sort(
        (a, b) =>
          timestamp(b.last_modified ?? b.created_at) -
          timestamp(a.last_modified ?? a.created_at)
      )
    case 'recommended':
    default:
      return next
  }
}

/** Are there any like counts at all? Drives whether the sort option shows. */
export function hasLikeData(models: readonly CatalogModel[]): boolean {
  return models.some((model) => (model.likes ?? 0) > 0)
}

export type ApplyHubFiltersOptions = {
  /** Memory budget in bytes; 0 disables the fit filter. */
  budgetBytes?: number
  /** Allows callers without reliable size data to bypass the fit filter. */
  applyFitFilter?: boolean
}

/** Full pipeline: optional fit filter, then sort. */
export function applyHubFilters(
  models: readonly CatalogModel[],
  state: HubFilterState,
  options: ApplyHubFiltersOptions = {}
): CatalogModel[] {
  const { budgetBytes = 0, applyFitFilter = true } = options

  let result = [...models]

  if (applyFitFilter && state.onlyFitting && budgetBytes > 0) {
    result = result.filter((model) => modelFitsBudget(model, budgetBytes))
  }

  return sortModels(result, state.sort)
}

/** Human-readable memory budget for the "based on this device" hint. */
export function formatMemoryBudget(budgetBytes: number): string | undefined {
  if (!budgetBytes || budgetBytes <= 0) return undefined
  return `${(budgetBytes / 1024 ** 3).toFixed(2)} GB`
}

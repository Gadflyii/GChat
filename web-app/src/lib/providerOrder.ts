import { getProviderTitle } from '@/lib/utils'

/**
 * Display order for the provider lists in Settings (the sidebar list and the
 * provider overview cards). Anything not listed here — remote/cloud and
 * user-added providers — sorts after these, alphabetically by title.
 *
 * The single local engine (GInfer) always leads; the legacy `jan` entry is
 * kept so pre-migration installs still pin it to the top.
 */
const PROVIDER_PRIORITY: Record<string, number> = {
  'jan': 0,
  'ginfer': 1,
}

/**
 * Returns a new array ordered for the Settings provider lists. The input is
 * not mutated — callers pass store-owned arrays straight in.
 */
export const sortProvidersForSettings = <T extends { provider: string }>(
  providers: T[]
): T[] =>
  providers.slice().sort((a, b) => {
    const aPriority = PROVIDER_PRIORITY[a.provider] ?? Number.MAX_SAFE_INTEGER
    const bPriority = PROVIDER_PRIORITY[b.provider] ?? Number.MAX_SAFE_INTEGER

    if (aPriority !== bPriority) {
      return aPriority - bPriority
    }

    return getProviderTitle(a.provider).localeCompare(
      getProviderTitle(b.provider)
    )
  })

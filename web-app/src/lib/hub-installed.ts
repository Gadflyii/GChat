/**
 * "Installed on this device" list for the Hub.
 *
 * The Hub renders `CatalogModel` rows, but what is actually on disk is known
 * only to the provider registry: a model reaches it without ever appearing in
 * the curated catalog — a long-tail Hugging Face download or a manually
 * imported file. Filtering the catalog down to installed entries therefore
 * cannot show those models at all, so the list is built from the installed
 * models and merely *enriched* from the catalog when an entry claims them.
 *
 * Kept free of React so the matching rules can be unit-tested directly.
 */

import { EMBEDDING_MODEL_ID } from '@/constants/models'
import { sanitizeModelId } from '@/lib/utils'
import type { CatalogModel } from '@/services/models/types'

export const GINFER_PROVIDER = 'ginfer'
/** Every provider that keeps model files on this device. */
export const LOCAL_PROVIDERS = [GINFER_PROVIDER] as const

type InstalledModel = { model: Model }

/**
 * Installed local models keyed by provider model id. The single local
 * provider registers every download, so the first occurrence wins.
 */
function collectLocalModels(
  providers: readonly ModelProvider[]
): Map<string, InstalledModel> {
  const out = new Map<string, InstalledModel>()

  const provider = providers.find((entry) => entry.provider === GINFER_PROVIDER)
  for (const model of provider?.models ?? []) {
    // The embedding model is an app-internal download for retrieval, not
    // something the Hub can offer a chat with.
    if (model.embedding || model.id === EMBEDDING_MODEL_ID) continue
    if (out.has(model.id)) continue
    out.set(model.id, { model })
  }

  return out
}

/**
 * Provider model ids one quant would register under once downloaded.
 * Downloads register either the bare id or a developer-prefixed one, so both
 * spellings count as a match.
 */
export function quantModelIds(
  entry: CatalogModel,
  quantModelId: string
): string[] {
  const prefix = entry.developer ? `${entry.developer}/` : ''
  return [quantModelId, `${prefix}${sanitizeModelId(quantModelId)}`]
}

/**
 * Provider model ids a catalog entry would produce once downloaded.
 */
function candidateIds(entry: CatalogModel): string[] {
  return (entry.quants ?? []).flatMap((quant) =>
    quantModelIds(entry, quant.model_id)
  )
}

/** Where an installed model actually lives: the id and the provider owning it. */
export type InstalledModelLocation = { modelId: string; provider: string }

/**
 * The first local provider that carries any of `ids`, together with the id it
 * registered. Deleting a model needs both: `models().deleteModel` dispatches on
 * the provider, and the id the engine knows is not always the catalog's
 * spelling of it.
 */
export function findInstalledLocalModel(
  providers: readonly ModelProvider[],
  ids: readonly string[],
  providerNames: readonly string[] = LOCAL_PROVIDERS
): InstalledModelLocation | null {
  for (const name of providerNames) {
    const provider = providers.find((entry) => entry.provider === name)
    if (!provider) continue
    const match = provider.models.find((model) => ids.includes(model.id))
    if (match) return { modelId: match.id, provider: name }
  }
  return null
}

/**
 * Row for an installed model the catalog does not carry. The single synthesized
 * quant is what `DownloadOptionsSelect` reads to recognise the model as present
 * and offer "New chat" instead of a download.
 */
function synthesizeEntry(id: string, installed: InstalledModel): CatalogModel {
  const [owner, ...rest] = id.split('/')
  const developer = rest.length > 0 ? owner : undefined

  return {
    model_name: id,
    description: '',
    downloads: 0,
    developer,
    num_quants: 1,
    quants: [{ model_id: id, path: installed.model.path ?? '', file_size: '' }],
  }
}

/**
 * Every model installed locally, as Hub rows: the catalog entry when one claims
 * the installed id (so its quant list, README and stats stay available), a
 * synthesized entry otherwise.
 */
export function collectInstalledModels(
  catalog: readonly CatalogModel[],
  providers: readonly ModelProvider[]
): CatalogModel[] {
  const installed = collectLocalModels(providers)
  if (installed.size === 0) return []

  const claimed = new Set<string>()
  const rows: CatalogModel[] = []

  for (const entry of catalog) {
    const matches = candidateIds(entry).filter((id) => installed.has(id))
    if (matches.length === 0) continue
    for (const id of matches) claimed.add(id)
    rows.push(entry)
  }

  for (const [id, model] of installed) {
    if (claimed.has(id)) continue
    rows.push(synthesizeEntry(id, model))
  }

  return rows
}

/**
 * Narrow the installed list by the Hub search box. The catalog search index
 * cannot answer this — it knows nothing about synthesized entries — so it is a
 * plain substring match over the id and its developer.
 */
export function filterInstalledBySearch(
  models: readonly CatalogModel[],
  searchValue: string
): CatalogModel[] {
  const query = searchValue.trim().toLowerCase()
  if (query.length === 0) return [...models]
  return models.filter((model) =>
    `${model.model_name} ${model.developer ?? ''}`.toLowerCase().includes(query)
  )
}

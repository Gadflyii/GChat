/**
 * Removing a model installed on this device, shared by every entry point that
 * offers it (the Hub download panel, Settings → Model Providers).
 *
 * Kept in one place because the order matters: the caches must not be updated
 * before the engine confirms the files are gone, or a failed delete leaves the
 * row hidden until the next provider refresh brings it back — which reads as
 * "the model won't delete" with nothing to explain why.
 */

import { useFavoriteModel } from '@/hooks/useFavoriteModel'
import { useModelProvider } from '@/hooks/useModelProvider'
import type { ServiceHub } from '@/services'

/**
 * Delete a local model and reconcile the app state around it. A rejected delete
 * throws. Once accepted, returns null for a refreshed inventory or the refresh
 * error for a read-only retry; that error must not be reported as delete failure.
 */
export async function deleteLocalModel(
  serviceHub: ServiceHub,
  modelId: string,
  provider: string
): Promise<string | null> {
  await serviceHub.models().deleteModel(modelId, provider)

  useFavoriteModel.getState().removeFavorite(modelId)
  useModelProvider.getState().deleteModel(modelId)

  try {
    await refreshModelProviders(serviceHub, modelId)
    return null
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
}

/** Read inventory without repeating deletion or rediscovering/adopting files. */
export async function refreshModelProviders(
  serviceHub: ServiceHub,
  deletedModelId: string
): Promise<void> {
  const providers = await serviceHub.providers().getProviders()
  useModelProvider.getState().setProviders(
    providers.map((entry) => ({
      ...entry,
      models: entry.models.filter((model) => model.id !== deletedModelId),
    }))
  )
}

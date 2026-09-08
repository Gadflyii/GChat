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
 * Delete a local model and reconcile the app state around it. Rejects when the
 * engine refuses (unknown model, missing `model.yml`, no engine registered for
 * the provider); the caller is expected to surface that.
 */
export async function deleteLocalModel(
  serviceHub: ServiceHub,
  modelId: string,
  provider: string
): Promise<void> {
  await serviceHub.models().deleteModel(modelId, provider)

  useFavoriteModel.getState().removeFavorite(modelId)
  useModelProvider.getState().deleteModel(modelId)

  // Re-list the engines so a model the other llama.cpp provider also registered
  // (both read the same models directory) disappears too.
  const providers = await serviceHub.providers().getProviders()
  useModelProvider.getState().setProviders(
    providers.map((entry) => ({
      ...entry,
      models: entry.models.filter((model) => model.id !== modelId),
    }))
  )
}

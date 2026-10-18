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

type AcceptedDeletion = { modelId: string; readded: boolean }

const acceptedDeletions = new Map<string, AcceptedDeletion>()
const pendingInventoryReads = new Set<Map<string, AcceptedDeletion>>()

function retireReaddedModels() {
  // Accepted deletions already removed their cached rows. A row now present
  // came from a later registration/download publication and must stay visible.
  const installedIds = new Set(
    useModelProvider.getState().providers.flatMap((provider) =>
      provider.models.map((model) => model.id)
    )
  )
  for (const deletions of [acceptedDeletions, ...pendingInventoryReads]) {
    for (const deletion of deletions.values()) {
      if (!installedIds.has(deletion.modelId)) continue
      deletion.readded = true
      if (acceptedDeletions.get(deletion.modelId) === deletion) {
        acceptedDeletions.delete(deletion.modelId)
      }
    }
  }
}

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

  retireReaddedModels()
  const deletion = { modelId, readded: false }
  acceptedDeletions.set(modelId, deletion)
  for (const read of pendingInventoryReads) read.set(modelId, deletion)
  useFavoriteModel.getState().removeFavorite(modelId)
  useModelProvider.getState().deleteModel(modelId)

  try {
    await refreshModelProviders(serviceHub)
    return null
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
}

/** Read inventory without repeating deletion or rediscovering/adopting files. */
export async function refreshModelProviders(
  serviceHub: ServiceHub
): Promise<void> {
  retireReaddedModels()
  const deletions = new Map(acceptedDeletions)
  // A snapshot started before a deletion cannot acknowledge its absence.
  const acknowledgeable = new Set(deletions.values())
  pendingInventoryReads.add(deletions)
  try {
    const providers = await serviceHub.providers().getProviders()
    retireReaddedModels()
    const state = useModelProvider.getState()
    state.setProviders(
      providers.map((entry) => ({
        ...entry,
        models: [
          ...entry.models.filter((model) => !deletions.has(model.id)),
          // An older snapshot must not erase or overwrite a new installation.
          ...(state.providers.find((current) => current.provider === entry.provider)
            ?.models.filter((model) => deletions.get(model.id)?.readded) ?? []),
        ],
      }))
    )
    const installedIds = new Set(
      providers.flatMap((entry) => entry.models.map((model) => model.id))
    )
    for (const deletion of acknowledgeable) {
      if (
        !deletion.readded &&
        !installedIds.has(deletion.modelId) &&
        acceptedDeletions.get(deletion.modelId) === deletion
      ) {
        acceptedDeletions.delete(deletion.modelId)
      }
    }
  } finally {
    pendingInventoryReads.delete(deletions)
  }
}

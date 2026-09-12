
import type { ServiceHub } from '@/services'

/**
 * Copy of `settings` with the `api-key` entry's value replaced.
 *
 * Immutable down to the entry being changed — the settings page's own handler
 * mutates `controller_props` through a shallow copy, which edits the object the
 * previous state still points at. Not a bug worth chasing there, but not one to
 * reproduce here either.
 *
 * Returns the input unchanged when the provider declares no `api-key` setting.
 */
export function applyApiKeyToSettings(
  settings: ProviderSetting[],
  apiKey: string
): ProviderSetting[] {
  const index = settings.findIndex((s) => s.key === 'api-key')
  if (index === -1) return settings

  const next = [...settings]
  next[index] = {
    ...next[index],
    controller_props: { ...next[index].controller_props, value: apiKey },
  }
  return next
}

/** The full patch an API-key write means: the settings array and its mirror. */
export function buildApiKeyUpdate(
  provider: ModelProvider,
  apiKey: string
): Pick<ModelProvider, 'settings' | 'api_key'> {
  return {
    settings: applyApiKeyToSettings(provider.settings, apiKey),
    api_key: apiKey,
  }
}

/**
 * Persist an API key onto a provider.
 *
 * The zustand write is what actually stores the key (it is persisted to
 * localStorage under `model-provider`). `updateSettings` only reaches an engine
 * extension, and cloud providers have none — so it is a no-op for them, called
 * for parity with local providers and deliberately never awaited or treated as
 * the success condition.
 */
export function saveProviderApiKey(params: {
  provider: ModelProvider
  apiKey: string
  updateProvider: (name: string, data: Partial<ModelProvider>) => void
  serviceHub: Pick<ServiceHub, 'providers'>
}): void {
  const { provider, apiKey, updateProvider, serviceHub } =
    params
  const update = buildApiKeyUpdate(provider, apiKey)

  updateProvider(provider.provider, { ...provider, ...update })

  try {
    void Promise.resolve(
      serviceHub.providers().updateSettings(provider.provider, update.settings)
    ).catch((error) => {
      console.warn('[provider-api-key] updateSettings failed:', error)
    })
  } catch (error) {
    console.warn('[provider-api-key] updateSettings threw:', error)
  }
}

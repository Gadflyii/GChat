import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { localStorageKey } from '@/constants/localStorage'
import { getServiceHub } from '@/hooks/useServiceHub'

/** The local provider selected by default on fresh installs. */
const GINFER_DEFAULT_PROVIDER = 'ginfer'
const GINFER_LEGACY_CONTEXT_DEFAULT = 16_384

function mergeGinferModelSettings(
  incoming: Model['settings'],
  persisted?: Model['settings']
): Model['settings'] {
  if (!incoming) return incoming

  return Object.fromEntries(
    Object.entries(incoming).map(([key, setting]) => {
      const persistedValue = persisted?.[key]?.controller_props?.value
      let value = persistedValue ?? setting.controller_props?.value

      if (key === 'ctx_len') {
        const bounds = setting.controller_props as
          | (ControllerProps & { min?: number; max?: number })
          | undefined
        const fallback = Number(setting.controller_props?.value)
        const minimum = Number(bounds?.min) || 1
        const maximum = Number(bounds?.max) || fallback
        const numeric = Number(value)
        value =
          numeric === GINFER_LEGACY_CONTEXT_DEFAULT ||
          !Number.isFinite(numeric) ||
          numeric <= 0
            ? fallback
            : Math.min(Math.max(numeric, minimum), maximum)
      }

      return [
        key,
        {
          ...setting,
          controller_props: {
            ...setting.controller_props,
            value,
          },
        },
      ]
    })
  ) as Model['settings']
}

/**
 * Local backend provider ids retired by the single-ginfer strip. Persisted
 * state from older installs may still carry them — the one-time migration at
 * the bottom of `migrate()` drops these provider entries and redirects any
 * selection on one to the only remaining local provider.
 */
export const RETIRED_LOCAL_PROVIDERS = [
  'llamacpp',
  'llamacpp-upstream',
  'mlx',
  'foundation-models',
]

type ModelProviderState = {
  providers: ModelProvider[]
  selectedProvider: string
  selectedModel: Model | null
  // Session-local ordering; persisted inventory is not an in-flight read.
  inventoryRevision: number
  modelMutations: Record<string, { revision: number; deleted: boolean }>
  recordModelInstall: (modelId: string) => void
  getModelBy: (modelId: string) => Model | undefined
  setProviders: (providers: ModelProvider[], readRevision?: number) => void
  getProviderByName: (providerName: string) => ModelProvider | undefined
  updateProvider: (providerName: string, data: Partial<ModelProvider>) => void
  selectModelProvider: (
    providerName: string,
    modelName: string
  ) => Model | undefined
  addProvider: (provider: ModelProvider) => void
  deleteProvider: (providerName: string) => void
  deleteModel: (modelId: string) => void
}

export const useModelProvider = create<ModelProviderState>()(
  persist(
    (set, get) => ({
      providers: [],
      // Fresh installs default to the ginfer local provider. This initial
      // value only applies when no state has been persisted yet — existing
      // installs keep their stored `selectedProvider` (the migrations below
      // never rewrite it). Unsupported machines (no NVIDIA GPU / wrong OS)
      // still register the provider but surface a clear hardware error when a
      // model is actually loaded or imported, so the default is safe.
      selectedProvider: GINFER_DEFAULT_PROVIDER,
      selectedModel: null,
      inventoryRevision: 0,
      modelMutations: {},
      recordModelInstall: (modelId) =>
        set((state) => {
          const revision = state.inventoryRevision + 1
          return {
            inventoryRevision: revision,
            modelMutations: {
              ...state.modelMutations,
              [modelId]: { revision, deleted: false },
            },
          }
        }),
      getModelBy: (modelId: string) => {
        const provider = get().providers.find(
          (provider) => provider.provider === get().selectedProvider
        )
        if (!provider) return undefined
        return provider.models.find((model) => model.id === modelId)
      },
      setProviders: (providers, readRevision) =>
        set((state) => {
          let revision = state.inventoryRevision
          const mutations = { ...state.modelMutations }
          // Unstamped publication is an explicit local inventory mutation.
          // Every asynchronous read must supply its start revision instead.
          if (readRevision === undefined) {
            for (const provider of providers) {
              if (provider.provider !== GINFER_DEFAULT_PROVIDER) continue
              const current = state.providers.find(
                (entry) => entry.provider === provider.provider
              )
              for (const model of current?.models ?? []) {
                if (!provider.models.some((entry) => entry.id === model.id)) {
                  mutations[model.id] = { revision: ++revision, deleted: true }
                }
              }
              for (const model of provider.models) {
                mutations[model.id] = { revision: ++revision, deleted: false }
              }
            }
          }
          const incoming = providers.map((provider) => {
            if (
              provider.provider !== GINFER_DEFAULT_PROVIDER ||
              readRevision === undefined
            ) return provider
            const current = state.providers.find(
              (entry) => entry.provider === provider.provider
            )
            // A deletion remains authoritative until a local installation
            // supersedes it. New installations outrank older read snapshots.
            const protectedIds = new Set(
              Object.entries(mutations)
                .filter(([, mutation]) =>
                  mutation.deleted || mutation.revision > readRevision
                )
                .map(([id]) => id)
            )
            return {
              ...provider,
              models: [
                ...provider.models.filter((model) => !protectedIds.has(model.id)),
                ...(current?.models.filter((model) =>
                  protectedIds.has(model.id) && !mutations[model.id].deleted
                ) ?? []),
              ],
            }
          })
          const existingProviders = state.providers
            // Filter out legacy cortex `llama.cpp` provider for migration
            // Can remove after a couple of releases
            .filter(
              (e) =>
                e.provider !== 'llama.cpp' &&
                !RETIRED_LOCAL_PROVIDERS.includes(e.provider)
            )
            .map((provider) => {
              return {
                ...provider,
                models: provider.models.filter(
                  (e) =>
                    ('id' in e || 'model' in e) &&
                    typeof (e.id ?? e.model) === 'string'
                ),
              }
            })

          let legacyModels: Model[] | undefined = []
          /// Cortex Migration
          if (
            localStorage.getItem('cortex_model_settings_migrated') !== 'true'
          ) {
            legacyModels = state.providers.find(
              (e) => e.provider === 'llama.cpp'
            )?.models
            localStorage.setItem('cortex_model_settings_migrated', 'true')
          }
          const updatedProviders = incoming.map((provider) => {
            const existingProvider = existingProviders.find(
              (x) => x.provider === provider.provider
            )
            const models = (existingProvider?.models || []).filter(
              (e) =>
                ('id' in e || 'model' in e) &&
                typeof (e.id ?? e.model) === 'string'
            )
            const mergedModels = [
              ...(provider?.models ?? []).filter(
                (e) =>
                  ('id' in e || 'model' in e) &&
                  typeof (e.id ?? e.model) === 'string' &&
                  !models.some((m) => m.id === e.id)
              ),
              ...models,
            ]
            const updatedModels = provider.models?.map((model) => {
              const persistedModels =
                legacyModels && legacyModels.length > 0 ? legacyModels : models
              const persistedModel =
                persistedModels.find((m) => m.id === model.id) ??
                persistedModels.find(
                  (m) =>
                    m.id
                      .split(':')
                      .slice(0, 2)
                      .join(getServiceHub().path().sep()) === model.id
                )
              const settings =
                provider.provider === GINFER_DEFAULT_PROVIDER
                  ? mergeGinferModelSettings(
                      model.settings,
                      persistedModel?.settings
                    )
                  : persistedModel?.settings || model.settings
              const existingModel = models.find((m) => m.id === model.id)
              const mergedCapabilities = [
                ...(model.capabilities || []),
                ...(existingModel?.capabilities || []).filter(
                  (cap) => !(model.capabilities || []).includes(cap)
                ),
              ]
              return {
                ...model,
                settings: settings,
                capabilities:
                  mergedCapabilities.length > 0
                    ? mergedCapabilities
                    : undefined,
                displayName: existingModel?.displayName || model.displayName,
              }
            })

            return {
              ...provider,
              models: provider.persist ? updatedModels : mergedModels,
              settings: provider.settings.map((setting) => {
                const existingSetting = provider.persist
                  ? undefined
                  : existingProvider?.settings?.find(
                      (x) => x.key === setting.key
                    )
                return {
                  ...setting,
                  controller_props: {
                    ...setting.controller_props,
                    ...(existingSetting?.controller_props || {}),
                  },
                }
              }),
              api_key: existingProvider?.api_key || provider.api_key,
              base_url: existingProvider?.base_url || provider.base_url,
              active: existingProvider ? existingProvider.active : true,
            }
          })
          const nextProviders = [
            ...updatedProviders,
            ...existingProviders.filter(
              (e) => !updatedProviders.some((p) => p.provider === e.provider)
            ),
          ]

          const nextSelectedProvider = nextProviders.find(
            (provider) => provider.provider === state.selectedProvider
          )
          const nextSelectedModel = state.selectedModel?.id
            ? (nextSelectedProvider?.models.find(
                (model) => model.id === state.selectedModel?.id
              ) ?? null)
            : null

          return {
            providers: nextProviders,
            selectedModel: nextSelectedModel,
            inventoryRevision: revision,
            modelMutations: mutations,
          }
        }),
      updateProvider: (providerName, data) => {
        set((state) => {
          let nextSelectedModel = state.selectedModel
          let revision = state.inventoryRevision
          const mutations = { ...state.modelMutations }
          if (providerName === GINFER_DEFAULT_PROVIDER && data.models) {
            const oldModels = state.providers.find(
              (entry) => entry.provider === providerName
            )?.models ?? []
            for (const model of oldModels) {
              if (!data.models.some((entry) => entry.id === model.id)) {
                mutations[model.id] = { revision: ++revision, deleted: true }
              }
            }
            for (const model of data.models) {
              if (oldModels.find((entry) => entry.id === model.id) !== model) {
                mutations[model.id] = { revision: ++revision, deleted: false }
              }
            }
          }

          const nextProviders = state.providers.map((provider) => {
            if (provider.provider !== providerName) {
              return provider
            }

            const updatedProvider = {
              ...provider,
              ...data,
            }

            if (
              state.selectedProvider === providerName &&
              state.selectedModel?.id
            ) {
              nextSelectedModel =
                updatedProvider.models.find(
                  (model) => model.id === state.selectedModel?.id
                ) ?? null
            }

            return updatedProvider
          })

          return {
            providers: nextProviders,
            selectedModel: nextSelectedModel,
            inventoryRevision: revision,
            modelMutations: mutations,
          }
        })
      },
      getProviderByName: (providerName: string) => {
        const provider = get().providers.find(
          (provider) => provider.provider === providerName
        )

        return provider
      },
      selectModelProvider: (providerName: string, modelName: string) => {
        // Find the model object
        const provider = get().providers.find(
          (provider) => provider.provider === providerName
        )

        let modelObject: Model | undefined = undefined

        if (provider && provider.models) {
          modelObject = provider.models.find((model) => model.id === modelName)
        }

        set({
          selectedProvider: providerName,
          selectedModel: modelObject || null,
        })

        return modelObject
      },
      deleteModel: (modelId: string) => {
        set((state) => {
          const revision = state.inventoryRevision + 1
          return {
            providers: state.providers.map((provider) => {
              const models = provider.models.filter(
                (model) => model.id !== modelId
              )
              return {
                ...provider,
                models,
              }
            }),
            inventoryRevision: revision,
            modelMutations: {
              ...state.modelMutations,
              [modelId]: { revision, deleted: true },
            },
            selectedModel:
              state.selectedModel?.id === modelId ? null : state.selectedModel,
          }
        })
      },
      addProvider: (provider: ModelProvider) => {
        set((state) => {
          let revision = state.inventoryRevision
          const mutations = { ...state.modelMutations }
          if (provider.provider === GINFER_DEFAULT_PROVIDER) {
            for (const model of provider.models) {
              mutations[model.id] = { revision: ++revision, deleted: false }
            }
          }
          return {
            providers: [...state.providers, provider],
            inventoryRevision: revision,
            modelMutations: mutations,
          }
        })
      },
      deleteProvider: (providerName: string) => {
        set((state) => {
          let revision = state.inventoryRevision
          const mutations = { ...state.modelMutations }
          if (providerName === GINFER_DEFAULT_PROVIDER) {
            const models = state.providers.find(
              (entry) => entry.provider === providerName
            )?.models ?? []
            for (const model of models) {
              mutations[model.id] = { revision: ++revision, deleted: true }
            }
          }
          return {
            providers: state.providers.filter((provider) => provider.provider !== providerName),
            inventoryRevision: revision,
            modelMutations: mutations,
          }
        })
      },
    }),
    {
      name: localStorageKey.modelProvider,
      storage: createJSONStorage(() => localStorage),
      partialize: ({ providers, selectedProvider, selectedModel }) => ({
        providers, selectedProvider, selectedModel,
      }),
      merge: (persisted, current) => {
        const saved = (persisted ?? {}) as Partial<ModelProviderState>
        return {
          ...current,
          providers: saved.providers ?? current.providers,
          selectedProvider: saved.selectedProvider ?? current.selectedProvider,
          selectedModel: saved.selectedModel ?? null,
        }
      },
      migrate: (persistedState: unknown, version: number) => {
        const state = persistedState as ModelProviderState

        if (version <= 3 && state?.providers) {
          state.providers.forEach((provider) => {
            // Migrate Anthropic provider base URL and add custom headers
            if (provider.provider === 'anthropic') {
              if (provider.base_url === 'https://api.anthropic.com') {
                provider.base_url = 'https://api.anthropic.com/v1'
              }

              // Update base-url in settings
              if (provider.settings) {
                const baseUrlSetting = provider.settings.find(
                  (s) => s.key === 'base-url'
                )
                if (
                  baseUrlSetting?.controller_props?.value ===
                  'https://api.anthropic.com'
                ) {
                  baseUrlSetting.controller_props.value =
                    'https://api.anthropic.com/v1'
                }
                if (
                  baseUrlSetting?.controller_props?.placeholder ===
                  'https://api.anthropic.com'
                ) {
                  baseUrlSetting.controller_props.placeholder =
                    'https://api.anthropic.com/v1'
                }
              }

              if (!provider.custom_header) {
                provider.custom_header = [
                  {
                    header: 'anthropic-version',
                    value: '2023-06-01',
                  },
                  {
                    header: 'anthropic-dangerous-direct-browser-access',
                    value: 'true',
                  },
                ]
              }
            }

            if (provider.provider === 'cohere') {
              if (
                provider.base_url === 'https://api.cohere.ai/compatibility/v1'
              ) {
                provider.base_url = 'https://api.cohere.ai/v1'
              }

              // Update base-url in settings
              if (provider.settings) {
                const baseUrlSetting = provider.settings.find(
                  (s) => s.key === 'base-url'
                )
                if (
                  baseUrlSetting?.controller_props?.value ===
                  'https://api.cohere.ai/compatibility/v1'
                ) {
                  baseUrlSetting.controller_props.value = 'https://api.cohere.ai/v1'
                }
                if (
                  baseUrlSetting?.controller_props?.placeholder ===
                  'https://api.cohere.ai/compatibility/v1'
                ) {
                  baseUrlSetting.controller_props.placeholder =
                    'https://api.cohere.ai/v1'
                }
              }
            }
          })
        }

        if (version <= 7 && state?.providers) {
          // Remove 'proactive' capability from all models as it's now managed in MCP settings
          state.providers.forEach((provider) => {
            if (provider.models) {
              provider.models.forEach((model) => {
                if (model.capabilities) {
                  model.capabilities = model.capabilities.filter(
                    (cap) => cap !== 'proactive'
                  )
                }
              })
            }
          })
        }

        if (version <= 8 && state?.providers) {
          state.providers.forEach((provider) => {
            // Migrate Mistral provider base URL to add /v1
            if (provider.provider === 'mistral') {
              if (provider.base_url === 'https://api.mistral.ai') {
                provider.base_url = 'https://api.mistral.ai/v1'
              }

              // Update base-url in settings
              if (provider.settings) {
                const baseUrlSetting = provider.settings.find(
                  (s) => s.key === 'base-url'
                )
                if (
                  baseUrlSetting?.controller_props?.value === 'https://api.mistral.ai'
                ) {
                  baseUrlSetting.controller_props.value = 'https://api.mistral.ai/v1'
                }
                if (
                  baseUrlSetting?.controller_props?.placeholder ===
                  'https://api.mistral.ai'
                ) {
                  baseUrlSetting.controller_props.placeholder =
                    'https://api.mistral.ai/v1'
                }
              }
            }
          })
        }

        if (version <= 9 && state?.providers) {
          state.providers = state.providers.filter(
            (provider) => provider.provider !== 'cohere'
          )
        }

        // v15 — single-ginfer strip: drop the retired local backends from
        // persisted state and redirect any selection stuck on one of them to
        // the only remaining local provider.
        if (version <= 14 && state?.providers) {
          state.providers = state.providers.filter(
            (provider) => !RETIRED_LOCAL_PROVIDERS.includes(provider.provider)
          )
          if (
            state.selectedProvider &&
            RETIRED_LOCAL_PROVIDERS.includes(state.selectedProvider)
          ) {
            state.selectedProvider = GINFER_DEFAULT_PROVIDER
          }
        }

        return state
      },
      version: 15,
    }
  )
)

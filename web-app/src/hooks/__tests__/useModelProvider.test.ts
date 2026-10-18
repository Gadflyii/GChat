import { describe, it, expect, beforeEach, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useModelProvider } from '../useModelProvider'
import type { PathService } from '@/services/path/types'
import { seedServiceHub } from '@/test/service-hub'

// Mock the localStorage key constants
vi.mock('@/constants/localStorage', () => ({
  localStorageKey: {
    modelProvider: 'gchat-model-provider',
  },
}))

// Mock localStorage
const localStorageMock = {
  getItem: vi.fn(() => null),
  setItem: vi.fn(),
  removeItem: vi.fn(),
  clear: vi.fn(),
  length: 0,
  key: vi.fn(() => null),
}
Object.defineProperty(window, 'localStorage', {
  value: localStorageMock,
  writable: true,
})

describe('useModelProvider - displayName functionality', () => {
  beforeEach(() => {
    seedServiceHub({
      path: {
        sep: () => '/',
      } as PathService,
    })
    // Reset the mock implementations instead of clearing them
    localStorageMock.getItem.mockReturnValue(null)
    localStorageMock.setItem.mockClear()
    localStorageMock.removeItem.mockClear()
    localStorageMock.clear.mockClear()

    // Reset Zustand store to default state
    act(() => {
      useModelProvider.setState({
        providers: [],
        selectedProvider: 'ginfer',
        selectedModel: null,
        inventoryRevision: 0, modelMutations: {},
      })
    })
  })

  it('should handle models without displayName property', () => {
    const { result } = renderHook(() => useModelProvider())

    const provider = {
      provider: 'ginfer',
      active: true,
      models: [
        {
          id: 'test-model.gguf',
          capabilities: ['completion'],
        },
      ],
      settings: [],
    } as any

    // First add the provider, then update it (since updateProvider only updates existing providers)
    act(() => {
      result.current.addProvider(provider)
    })

    const updatedProvider = result.current.getProviderByName('ginfer')
    expect(updatedProvider?.models[0].displayName).toBeUndefined()
    expect(updatedProvider?.models[0].id).toBe('test-model.gguf')
  })

  it('should preserve displayName when merging providers in setProviders', () => {
    const { result } = renderHook(() => useModelProvider())

    // First, set up initial state with displayName via direct state manipulation
    // This simulates the scenario where a user has already customized a display name
    act(() => {
      useModelProvider.setState({
        providers: [
          {
            provider: 'ginfer',
            active: true,
            models: [
              {
                id: 'test-model.gguf',
                displayName: 'My Custom Model',
                capabilities: ['completion'],
              },
            ],
            settings: [],
          },
        ] as any,
        selectedProvider: 'ginfer',
        selectedModel: null,
        inventoryRevision: 0, modelMutations: {},
      })
    })

    // Now simulate setProviders with fresh data (like from server refresh)
    const freshProviders = [
      {
        provider: 'ginfer',
        active: true,
        persist: true,
        models: [
          {
            id: 'test-model.gguf',
            capabilities: ['completion'],
            // Note: no displayName in fresh data
          },
        ],
        settings: [],
      },
    ] as any

    act(() => {
      result.current.setProviders(freshProviders)
    })

    // The displayName should be preserved from existing state
    const provider = result.current.getProviderByName('ginfer')
    expect(provider?.models[0].displayName).toBe('My Custom Model')
  })

  it('should preserve existing model settings by exact id in setProviders', () => {
    const { result } = renderHook(() => useModelProvider())

    act(() => {
      useModelProvider.setState({
        providers: [
          {
            provider: 'ginfer',
            active: true,
            models: [
              {
                id: 'Qwen3_5-9B-IQ4_XS',
                capabilities: ['completion'],
                settings: {
                  ctx_len: {
                    controller_props: {
                      value: 48000,
                    },
                  },
                },
              },
            ],
            settings: [],
          },
        ] as any,
        selectedProvider: 'ginfer',
        selectedModel: null,
        inventoryRevision: 0, modelMutations: {},
      })
    })

    const freshProviders = [
      {
        provider: 'ginfer',
        active: true,
        persist: true,
        models: [
          {
            id: 'Qwen3_5-9B-IQ4_XS',
            capabilities: ['completion'],
            settings: {
              ctx_len: {
                controller_props: {
                  value: 262144,
                  min: 1024,
                  max: 262144,
                },
              },
            },
          },
        ],
        settings: [],
      },
    ] as any

    act(() => {
      result.current.setProviders(freshProviders)
    })

    const provider = result.current.getProviderByName('ginfer')
    expect(provider?.models[0].settings?.ctx_len?.controller_props?.value).toBe(
      48000
    )
  })

  it('upgrades the retired GInfer context default and removes legacy settings', () => {
    const { result } = renderHook(() => useModelProvider())
    const persisted = {
      provider: 'ginfer',
      active: true,
      models: [
        {
          id: 'muse_glimmer_30b_nvfp4_df2q4',
          settings: {
            ctx_len: { controller_props: { value: 16384 } },
            ngl: { controller_props: { value: 100 } },
          },
        },
      ],
      settings: [],
    } as any
    act(() => {
      useModelProvider.setState({
        providers: [persisted],
        selectedProvider: 'ginfer',
        selectedModel: null,
        inventoryRevision: 0, modelMutations: {},
      })
    })

    act(() => {
      result.current.setProviders([
        {
          ...persisted,
          persist: true,
          models: [
            {
              id: 'muse_glimmer_30b_nvfp4_df2q4',
              settings: {
                ctx_len: {
                  controller_props: {
                    value: 131072,
                    min: 1024,
                    max: 131072,
                  },
                },
              },
            },
          ],
        },
      ] as any)
    })

    const settings = result.current.getProviderByName('ginfer')?.models[0]
      .settings
    expect(settings?.ctx_len?.controller_props?.value).toBe(131072)
    expect(settings).not.toHaveProperty('ngl')
  })

  it('should provide basic functionality without breaking existing behavior', () => {
    const { result } = renderHook(() => useModelProvider())

    // Test that basic provider operations work
    expect(result.current.providers).toEqual([])
    expect(result.current.selectedProvider).toBe('ginfer')
    expect(result.current.selectedModel).toBeNull()

    // Test addProvider functionality
    const provider = {
      provider: 'openai',
      active: true,
      models: [],
      settings: [],
    } as any

    act(() => {
      result.current.addProvider(provider)
    })

    expect(result.current.providers).toHaveLength(1)
    expect(result.current.getProviderByName('openai')).toBeDefined()
  })

  it('should handle provider operations with models that have displayName', () => {
    const { result } = renderHook(() => useModelProvider())

    // Test that we can at least get and set providers with displayName models
    const providerWithDisplayName = {
      provider: 'ginfer',
      active: true,
      models: [
        {
          id: 'test-model.gguf',
          displayName: 'Custom Model Name',
          capabilities: ['completion'],
        },
      ],
      settings: [],
    } as any

    // Set the state directly (simulating what would happen in real usage)
    act(() => {
      useModelProvider.setState({
        providers: [providerWithDisplayName],
        selectedProvider: 'ginfer',
        selectedModel: null,
        inventoryRevision: 0, modelMutations: {},
      })
    })

    const provider = result.current.getProviderByName('ginfer')
    expect(provider?.models[0].displayName).toBe('Custom Model Name')
    expect(provider?.models[0].id).toBe('test-model.gguf')
  })

  it('keeps selectedModel in sync when updateProvider changes model settings', () => {
    const { result } = renderHook(() => useModelProvider())

    const provider = {
      provider: 'ginfer',
      active: true,
      models: [
        {
          id: 'test-model.gguf',
          capabilities: ['completion'],
          settings: {
            ctx_len: {
              controller_props: {
                value: 16384,
              },
            },
          },
        },
      ],
      settings: [],
    } as any

    act(() => {
      useModelProvider.setState({
        providers: [provider],
        selectedProvider: 'ginfer',
        selectedModel: provider.models[0],
        inventoryRevision: 0, modelMutations: {},
      })
    })

    act(() => {
      result.current.updateProvider('ginfer', {
        models: [
          {
            ...provider.models[0],
            settings: {
              ctx_len: {
                controller_props: {
                  value: 32768,
                },
              },
            },
          },
        ],
      } as any)
    })

    expect(
      result.current.selectedModel?.settings?.ctx_len?.controller_props?.value
    ).toBe(32768)
  })

  it('keeps selectedModel in sync when setProviders rebuilds providers', () => {
    const { result } = renderHook(() => useModelProvider())

    const provider = {
      provider: 'ginfer',
      active: true,
      persist: true,
      models: [
        {
          id: 'test-model.gguf',
          capabilities: ['completion'],
          settings: {
            ctx_len: {
              controller_props: {
                value: 32768,
              },
            },
          },
        },
      ],
      settings: [],
    } as any

    const staleSelectedModel = {
      ...provider.models[0],
      settings: {
        ctx_len: {
          controller_props: {
            value: 16384,
          },
        },
      },
    }

    act(() => {
      useModelProvider.setState({
        providers: [provider],
        selectedProvider: 'ginfer',
        selectedModel: staleSelectedModel,
        inventoryRevision: 0, modelMutations: {},
      })
    })

    act(() => {
      result.current.setProviders([
        {
          ...provider,
          models: [
            {
              ...provider.models[0],
              settings: {
                ctx_len: {
                  controller_props: {
                    value: 131072,
                    min: 1024,
                    max: 131072,
                  },
                },
              },
            },
          ],
        },
      ] as any)
    })

    expect(
      result.current.selectedModel?.settings?.ctx_len?.controller_props?.value
    ).toBe(32768)
  })

  it.each(['stale', 'omitted'] as const)(
    'preserves newer local installations and deletions when a stamped read returns %s inventory',
    (returned) => {
      const oldModel = { id: 're-added', path: '/models/old.ginfer' } as Model
      const retained = { id: 'retained' } as Model
      const provider = {
        provider: 'ginfer', active: true, persist: true, settings: [],
        models: [oldModel, { id: 'deleted' }, retained],
        api_key: 'saved-key', base_url: 'http://localhost:1337/v1',
      } as ModelProvider
      const readded = {
        id: oldModel.id, path: '/models/new.ginfer', displayName: 'My re-added model',
        settings: { temperature: { controller_props: { value: 0.25 } } },
      } as Model
      useModelProvider.setState({ providers: [provider] })
      const readRevision = useModelProvider.getState().inventoryRevision
      act(() => {
        useModelProvider.getState().deleteModel('deleted')
        useModelProvider.getState().setProviders([{ ...provider, models: [readded, retained] }])
        useModelProvider.getState().selectModelProvider('ginfer', readded.id)
      })
      const acceptedReadd = useModelProvider.getState().selectedModel
      act(() => useModelProvider.getState().setProviders([
        { ...provider, models: [...(returned === 'stale' ? [oldModel] : []), { id: 'deleted' }, retained, { id: 'fresh' }] },
        { provider: 'openai', active: true, persist: true, settings: [], models: [{ id: 'remote' }] } as ModelProvider,
      ], readRevision))

      const state = useModelProvider.getState()
      expect(state.providers[0].models.find(model => model.id === readded.id)).toEqual(acceptedReadd)
      expect(state.providers[0].models.some(model => model.id === 'deleted')).toBe(false)
      expect(state.providers[0].models.map(model => model.id)).toEqual(expect.arrayContaining(['fresh', 'retained', readded.id]))
      expect(state.providers[0]).toMatchObject({ api_key: 'saved-key', base_url: 'http://localhost:1337/v1' })
      expect(state.selectedModel).toEqual(acceptedReadd)
      expect(state.providers[1].models.map(model => model.id)).toEqual(['remote'])
    }
  )

  it('records an accepted install before its read so older inventory cannot erase the replacement', () => {
    const provider = {
      provider: 'ginfer', active: true, persist: true, settings: [],
      models: [{ id: 'reinstalled', path: '/models/original.ginfer' }],
    } as ModelProvider
    useModelProvider.setState({ providers: [provider] })
    act(() => useModelProvider.getState().deleteModel('reinstalled'))
    const olderRead = useModelProvider.getState().inventoryRevision
    act(() => useModelProvider.getState().recordModelInstall('reinstalled'))
    const installationRead = useModelProvider.getState().inventoryRevision
    expect(installationRead).toBeGreaterThan(olderRead)
    act(() => {
      useModelProvider.getState().setProviders([{ ...provider, models: [{ id: 'reinstalled', path: '/models/reinstalled.ginfer' }] }], installationRead)
      useModelProvider.getState().selectModelProvider('ginfer', 'reinstalled')
      useModelProvider.getState().setProviders([{ ...provider, models: [] }], olderRead)
    })

    expect(useModelProvider.getState().providers[0].models).toEqual([
      expect.objectContaining({ id: 'reinstalled', path: '/models/reinstalled.ginfer' }),
    ])
    expect(useModelProvider.getState().selectedModel?.path).toBe('/models/reinstalled.ginfer')
  })

  it('persists inventory and selection without carrying pending-read revisions into a new session', () => {
    act(() => useModelProvider.getState().recordModelInstall('session-install'))
    const options = useModelProvider.persist.getOptions()
    const fresh = { ...useModelProvider.getState(), inventoryRevision: 0, modelMutations: {} }
    expect(options.merge!(undefined, fresh)).toEqual(fresh)
    const saved = options.partialize!(useModelProvider.getState())
    expect(Object.keys(saved).sort()).toEqual(['providers', 'selectedModel', 'selectedProvider'])
    const restored = options.merge!({
      ...saved, inventoryRevision: 100,
      modelMutations: { 'old-deletion': { revision: 100, deleted: true } },
      deletedModels: ['old-deletion'],
    }, fresh)
    expect(restored.inventoryRevision).toBe(0)
    expect(restored.modelMutations).toEqual({})
    expect(restored).not.toHaveProperty('deletedModels')
  })
})

describe('useModelProvider migrations', () => {
  it('drops the retired local backends from persisted state (v15)', () => {
    const persistApi = (useModelProvider as any).persist
    const migrate = persistApi?.getOptions().migrate as
      | ((state: unknown, version: number) => any)
      | undefined

    expect(migrate).toBeDefined()

    const persistedState = {
      providers: [
        { provider: 'llamacpp', models: [], settings: [] },
        { provider: 'llamacpp-upstream', models: [], settings: [] },
        { provider: 'mlx', models: [], settings: [] },
        { provider: 'ginfer', models: [], settings: [] },
        { provider: 'openai', models: [], settings: [] },
      ],
      selectedProvider: 'llamacpp-upstream',
      selectedModel: null,
      inventoryRevision: 0, modelMutations: {},
    }

    const migratedState = migrate!(persistedState, 14)

    expect(
      migratedState.providers.map((p: any) => p.provider)
    ).toEqual(['ginfer', 'openai'])
    expect(migratedState.selectedProvider).toBe('ginfer')
  })

  it('migrates Mistral provider base URL to add /v1 suffix', () => {
    const persistApi = (useModelProvider as any).persist
    const migrate = persistApi?.getOptions().migrate as
      | ((state: unknown, version: number) => any)
      | undefined

    expect(migrate).toBeDefined()

    const persistedState = {
      providers: [
        {
          provider: 'mistral',
          models: [],
          base_url: 'https://api.mistral.ai',
          settings: [
            {
              key: 'base-url',
              controller_props: {
                value: 'https://api.mistral.ai',
                placeholder: 'https://api.mistral.ai',
              },
            },
          ],
        },
      ],
      selectedProvider: 'mistral',
      selectedModel: null,
      inventoryRevision: 0, modelMutations: {},
    }

    const migratedState = migrate!(persistedState, 8)
    const mistralProvider = migratedState.providers[0]
    const baseUrlSetting = mistralProvider.settings.find(
      (setting: any) => setting.key === 'base-url'
    )

    expect(mistralProvider.base_url).toBe('https://api.mistral.ai/v1')
    expect(baseUrlSetting.controller_props.value).toBe(
      'https://api.mistral.ai/v1'
    )
    expect(baseUrlSetting.controller_props.placeholder).toBe(
      'https://api.mistral.ai/v1'
    )
  })

  it('does not migrate Mistral provider base URL if already has /v1', () => {
    const persistApi = (useModelProvider as any).persist
    const migrate = persistApi?.getOptions().migrate as
      | ((state: unknown, version: number) => any)
      | undefined

    expect(migrate).toBeDefined()

    const persistedState = {
      providers: [
        {
          provider: 'mistral',
          models: [],
          base_url: 'https://api.mistral.ai/v1',
          settings: [
            {
              key: 'base-url',
              controller_props: {
                value: 'https://api.mistral.ai/v1',
                placeholder: 'https://api.mistral.ai/v1',
              },
            },
          ],
        },
      ],
      selectedProvider: 'mistral',
      selectedModel: null,
      inventoryRevision: 0, modelMutations: {},
    }

    const migratedState = migrate!(persistedState, 8)
    const mistralProvider = migratedState.providers[0]
    const baseUrlSetting = mistralProvider.settings.find(
      (setting: any) => setting.key === 'base-url'
    )

    expect(mistralProvider.base_url).toBe('https://api.mistral.ai/v1')
    expect(baseUrlSetting.controller_props.value).toBe(
      'https://api.mistral.ai/v1'
    )
    expect(baseUrlSetting.controller_props.placeholder).toBe(
      'https://api.mistral.ai/v1'
    )
  })

  it('does not affect other providers during Mistral migration', () => {
    const persistApi = (useModelProvider as any).persist
    const migrate = persistApi?.getOptions().migrate as
      | ((state: unknown, version: number) => any)
      | undefined

    expect(migrate).toBeDefined()

    const persistedState = {
      providers: [
        {
          provider: 'mistral',
          models: [],
          base_url: 'https://api.mistral.ai',
          settings: [],
        },
        {
          provider: 'openai',
          models: [],
          base_url: 'https://api.openai.com/v1',
          settings: [],
        },
      ],
      selectedProvider: 'mistral',
      selectedModel: null,
      inventoryRevision: 0, modelMutations: {},
    }

    const migratedState = migrate!(persistedState, 8)

    expect(migratedState.providers[0].base_url).toBe(
      'https://api.mistral.ai/v1'
    )
    expect(migratedState.providers[1].base_url).toBe(
      'https://api.openai.com/v1'
    )
  })
})

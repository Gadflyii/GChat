import { beforeEach, describe, expect, it } from 'vitest'

import { localStorageKey } from '@/constants/localStorage'
import { getModelToStart } from '@/utils/getModelToStart'

const makeProvider = (
  name: string,
  modelIds: string[],
  active = true
): ModelProvider =>
  ({
    provider: name,
    active,
    models: modelIds.map((id) => ({ id })),
    settings: [],
  }) as unknown as ModelProvider

const lookup =
  (providers: ModelProvider[]) =>
  (name: string): ModelProvider | undefined =>
    providers.find((p) => p.provider === name)

beforeEach(() => {
  localStorage.clear()
})

describe('getModelToStart', () => {
  it('picks the first usable model on the local provider', () => {
    const providers = [makeProvider('ginfer', ['model-a'], true)]

    const result = getModelToStart({ getProviderByName: lookup(providers) })
    expect(result?.provider.provider).toBe('ginfer')
    expect(result?.model).toBe('model-a')
  })

  it('skips a deactivated local provider', () => {
    const providers = [makeProvider('ginfer', ['model-a'], false)]

    expect(getModelToStart({ getProviderByName: lookup(providers) })).toBeNull()
  })

  it('never resurrects a deactivated provider via lastUsedModel', () => {
    localStorage.setItem(
      localStorageKey.lastUsedModel,
      JSON.stringify({ provider: 'ginfer', model: 'model-a' })
    )
    const providers = [makeProvider('ginfer', ['model-a'], false)]

    expect(getModelToStart({ getProviderByName: lookup(providers) })).toBeNull()
  })

  it('still honors lastUsedModel on an active provider', () => {
    localStorage.setItem(
      localStorageKey.lastUsedModel,
      JSON.stringify({ provider: 'ginfer', model: 'model-a' })
    )
    const providers = [makeProvider('ginfer', ['model-a'], true)]

    const result = getModelToStart({ getProviderByName: lookup(providers) })
    expect(result?.provider.provider).toBe('ginfer')
    expect(result?.model).toBe('model-a')
  })

  it('ignores a stale selection pointing at a deactivated provider', () => {
    const providers = [makeProvider('ginfer', ['model-a'], false)]

    const result = getModelToStart({
      selectedModel: { id: 'model-a' } as never,
      selectedProvider: 'ginfer',
      getProviderByName: lookup(providers),
    })
    expect(result).toBeNull()
  })

  it('honors an explicit selection on an active provider', () => {
    const providers = [makeProvider('ginfer', ['model-a'], true)]

    const result = getModelToStart({
      selectedModel: { id: 'model-a' } as never,
      selectedProvider: 'ginfer',
      getProviderByName: lookup(providers),
    })
    expect(result?.provider.provider).toBe('ginfer')
    expect(result?.model).toBe('model-a')
  })

  it('skips broken-link (missing) models when auto-picking', () => {
    const providers = [
      {
        provider: 'ginfer',
        active: true,
        models: [
          { id: 'broken', missing: true },
          { id: 'model-b' },
        ],
        settings: [],
      } as unknown as ModelProvider,
    ]

    const result = getModelToStart({ getProviderByName: lookup(providers) })
    expect(result?.model).toBe('model-b')
  })
})

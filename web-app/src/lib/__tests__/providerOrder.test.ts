import { describe, it, expect } from 'vitest'
import { sortProvidersForSettings } from '../providerOrder'

const order = (names: string[]) =>
  sortProvidersForSettings(names.map((provider) => ({ provider }))).map(
    (p) => p.provider
  )

describe('sortProvidersForSettings', () => {
  it('puts the local engines first, then the rest by title', () => {
    // foundation-models/openai/mlx all sort by title: Foundation-models, Mlx, OpenAI
    expect(
      order(['foundation-models', 'ginfer', 'openai', 'jan', 'mlx'])
    ).toEqual(['jan', 'ginfer', 'foundation-models', 'mlx', 'openai'])
  })

  it('sorts unknown providers after the local engines, by title', () => {
    // Anthropic < OpenAI < OpenRouter by title
    expect(order(['openrouter', 'anthropic', 'ginfer', 'openai'])).toEqual([
      'ginfer',
      'anthropic',
      'openai',
      'openrouter',
    ])
  })

  it('never leaves a cloud provider ahead of the local engines', () => {
    expect(order(['openai', 'ginfer', 'jan'])).toEqual([
      'jan',
      'ginfer',
      'openai',
    ])
  })

  it('does not mutate the input array', () => {
    const input = [{ provider: 'ginfer' }, { provider: 'openai' }]
    sortProvidersForSettings(input)
    expect(input.map((p) => p.provider)).toEqual(['ginfer', 'openai'])
  })
})

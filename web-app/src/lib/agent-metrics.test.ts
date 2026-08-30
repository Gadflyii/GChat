import { describe, expect, it } from 'vitest'
import {
  aggregateAgentMetrics,
  formatTokensPerSecond,
  tokensPerSecond,
} from '@/lib/agent-metrics'

describe('agent model-instance metrics', () => {
  it('weights throughput by exact GInfer token and engine-time totals', () => {
    const metrics = aggregateAgentMetrics([
      {
        modelInstanceId: 'qwen',
        inference: {
          promptTokens: 100,
          generatedTokens: 40,
          promptMs: 10,
          generationMs: 100,
        },
      },
      {
        modelInstanceId: 'qwen',
        inference: {
          promptTokens: 300,
          generatedTokens: 60,
          promptMs: 30,
          generationMs: 200,
        },
      },
    ])

    expect(metrics).toHaveLength(1)
    expect(metrics[0]).toMatchObject({
      stageCount: 2,
      promptTokens: 400,
      generatedTokens: 100,
      promptMs: 40,
      generationMs: 300,
    })
    expect(tokensPerSecond(100, 300)).toBeCloseTo(333.333)
  })

  it('formats unavailable and large rates without inventing values', () => {
    expect(formatTokensPerSecond(0, 0)).toBe('—')
    expect(formatTokensPerSecond(15_000, 1_000)).toBe('15.0k')
  })
})

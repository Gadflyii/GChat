import type { AgentInferenceMetrics } from '@/types/agent'

export type AgentInstanceMetrics = AgentInferenceMetrics & {
  modelInstanceId: string
  modelId?: string
  stageCount: number
}

export function tokensPerSecond(tokens: number, milliseconds: number): number {
  return milliseconds > 0 ? (tokens * 1000) / milliseconds : 0
}

export function formatTokensPerSecond(
  tokens: number,
  milliseconds: number
): string {
  const rate = tokensPerSecond(tokens, milliseconds)
  if (!Number.isFinite(rate) || rate <= 0) return '—'
  return rate >= 1000
    ? `${(rate / 1000).toFixed(rate >= 10_000 ? 1 : 2)}k`
    : rate.toFixed(rate >= 100 ? 0 : 1)
}

export function aggregateAgentMetrics(
  stages: Array<{
    modelInstanceId: string
    modelId?: string
    inference?: AgentInferenceMetrics
  }>
): AgentInstanceMetrics[] {
  const byInstance = new Map<string, AgentInstanceMetrics>()
  for (const stage of stages) {
    if (!stage.inference) continue
    const current = byInstance.get(stage.modelInstanceId) ?? {
      modelInstanceId: stage.modelInstanceId,
      modelId: stage.modelId,
      stageCount: 0,
      promptTokens: 0,
      generatedTokens: 0,
      promptMs: 0,
      generationMs: 0,
    }
    current.stageCount += 1
    current.modelId ??= stage.modelId
    current.promptTokens += stage.inference.promptTokens
    current.generatedTokens += stage.inference.generatedTokens
    current.promptMs += stage.inference.promptMs
    current.generationMs += stage.inference.generationMs
    byInstance.set(stage.modelInstanceId, current)
  }
  return [...byInstance.values()]
}

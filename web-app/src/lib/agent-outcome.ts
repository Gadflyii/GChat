import type { AgentTurnFinishReason } from '@/types/agent'

export function agentTurnStatus(reason: string) {
  switch (reason) {
    case 'reply':
    case 'finish':
      return 'finished' as const
    case 'failed':
      return 'failed' as const
    case 'cancelled':
      return 'cancelled' as const
    default:
      return 'incomplete' as const
  }
}

export function incompleteOutcomeMessage(reason?: AgentTurnFinishReason | '') {
  switch (reason) {
    case 'max_steps':
      return 'Step limit reached. A stage used its full model-step budget without returning a completed result. Available output is preserved.'
    case 'max_cycles':
      return 'Revision limit reached. The evaluator did not return PASS; the best available executor result is preserved.'
    case 'loop_detected':
      return 'A stage stopped after repeated tool calls made no progress. The fallback and available output are preserved; the run is incomplete.'
    default:
      return undefined
  }
}

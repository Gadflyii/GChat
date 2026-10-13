import { invoke } from '@tauri-apps/api/core'
import {
  getSmartContextFailure,
  contextLimitErrorTrigger,
  isModelAccessError,
  isOutOfMemoryError,
} from '@/utils/error'

const PROMPT_FAILURES = new Map([
  ['Invalid prompt: The messages must be a ModelMessage[]. If you have passed a UIMessage[], you can use convertToModelMessages to convert them.', 'model-message-schema-rejected'],
  ['Invalid prompt: messages must not be empty', 'empty-model-messages'],
  ['Invalid prompt: system must be a string', 'invalid-system-format'],
  ['Invalid prompt: prompt or messages must be defined', 'missing-prompt'],
  ['Invalid prompt: prompt and messages cannot be defined at the same time', 'conflicting-prompt-formats'],
])

export interface ChatWarningContext {
  threadId: string
  modelId?: string
  providerId?: string
  messageFormat: 'UIMessage[]' | 'ModelMessage[]'
  conversion: 'pending' | 'rejected' | 'converted'
  uiMessageCount: number | null
  modelMessageCount: number | null
  toolCount: number | null
  configuredContextTokens: number | null
  loadedContextTokens: number | null
  contextTokens: number | null
  inputTokens: number | null
  outputTokens: number | null
  reservedOutputTokens: number | null
}

export function logChatWarning(
  trigger: string,
  context: ChatWarningContext,
  error?: unknown,
  completion?: {
    finishReason?: string
    ginferFinishReason?: string
    comparisonContextTokens: number
  }
): void {
  const smart = getSmartContextFailure(error)
  const rawContextTrigger = contextLimitErrorTrigger(error)
  const contextError = !!completion || smart !== null || rawContextTrigger !== null
  const accessError = !contextError && isModelAccessError(error)
  const memoryError = !contextError && !accessError && isOutOfMemoryError(error)
  const errorName = error instanceof Error ? error.name : null
  const promptDecision = errorName === 'AI_InvalidPromptError' && error instanceof Error
    ? PROMPT_FAILURES.get(error.message) : undefined
  const errorContext: Record<string, number> = {}
  if (smart) {
    const responseBody = error && typeof error === 'object' && 'responseBody' in error
      ? error.responseBody : error instanceof Error ? error.message : error
    if (typeof responseBody === 'string') {
      try {
        const envelope = JSON.parse(responseBody.slice(responseBody.indexOf('{')))
        for (const key of ['inputTokens', 'inputBudget', 'summaryInputTokens', 'configuredContextTokens', 'reservedOutputTokens', 'inputSafetyMargin']) {
          const value = envelope?.error?.[key]
          if (typeof value === 'number' && Number.isFinite(value)) errorContext[key] = value
        }
      } catch {
        // Some providers expose only a message, without structured counts.
      }
    }
  }
  const record = {
    event: 'chat_warning',
    trigger,
    ...context,
    formatDecision: promptDecision ?? (errorName === 'AI_InvalidPromptError' ? 'invalid-prompt'
      : errorName === 'AI_TypeValidationError' ? 'value-schema-rejected' : context.conversion),
    displayDecision: smart?.code === 'context_output_conflict' ? 'context-settings-conflict'
      : contextError ? 'context-window-full'
      : accessError ? 'model-access-error'
        : memoryError ? 'out-of-memory' : 'error-generating-response',
    classificationTrigger: completion ? trigger
      : smart?.code ?? rawContextTrigger ?? promptDecision ?? (accessError ? 'model-access-matcher'
          : memoryError ? 'memory-matcher' : 'unclassified-error'),
    errorName,
    errorMessage: promptDecision && error instanceof Error ? error.message : null,
    errorContext,
    ...completion,
  }
  // Use the existing app.log target; diagnostics cannot fail the request.
  void invoke('plugin:log|log', {
    level: 4,
    message: JSON.stringify(record),
    location: 'chat-warning',
    file: null,
    line: null,
    keyValues: {},
  }).catch((failure) => console.warn('Could not log Chat warning:', failure))
}

export function reportCompletionContextWarning(
  context: ChatWarningContext,
  completion: {
    isAbort?: boolean
    finishReason?: string
    ginferFinishReason?: string
    comparisonContextTokens: number
  }
): boolean {
  if (completion.isAbort || completion.finishReason !== 'length') return false
  const atCapacity = completion.ginferFinishReason
    ? completion.ginferFinishReason === 'context_capacity'
    : (context.inputTokens ?? 0) + (context.outputTokens ?? 0) >=
      completion.comparisonContextTokens * 0.9
  if (!atCapacity) return false
  logChatWarning(completion.ginferFinishReason
    ? 'finish.context_capacity' : 'finish.usage_at_least_90_percent', context,
    undefined, completion)
  return true
}

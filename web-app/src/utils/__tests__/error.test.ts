import { describe, it, expect } from 'vitest'
import {
  OUT_OF_CONTEXT_SIZE,
  MODEL_ACCESS_DENIED_TITLE,
  MODEL_ACCESS_DENIED_MESSAGE,
  GINFER_CONTEXT_OVERFLOW_MESSAGE,
  getSmartContextFailure,
  isModelAccessError,
  isOutOfMemoryError,
} from '../error'

describe('error utilities', () => {
  describe('GInfer context failures', () => {
    const wrapped = (code: string, message: string) =>
      new Error(
        `API request failed with status 400: ${JSON.stringify({ error: { code, message } })}`
      )

    it('keeps the actionable checkpoint and current-turn failures', () => {
      expect(
        getSmartContextFailure(
          wrapped('context_checkpoint_failed', 'Remove a large historical tool result.')
        )
      ).toEqual({
        code: 'context_checkpoint_failed',
        message: 'Remove a large historical tool result.',
      })
      expect(
        getSmartContextFailure(
          wrapped('context_turn_too_large', 'Reduce the current tool output.')
        )
      ).toEqual({
        code: 'context_turn_too_large',
        message: 'Reduce the current tool output.',
      })
    })

    it('reads the provider HTTP error body without losing the specific failure', () => {
      const error = Object.assign(new Error('Request failed'), {
        responseBody: JSON.stringify({ error: {
          code: 'context_checkpoint_failed', message: 'The tool-result summary could not finish.',
        } }, null, 2),
      })
      expect(getSmartContextFailure(error)).toEqual({
        code: 'context_checkpoint_failed', message: 'The tool-result summary could not finish.',
      })
    })

    it('ignores unrelated errors and malformed response bodies', () => {
      expect(getSmartContextFailure(wrapped('invalid_request', 'Bad request'))).toBeNull()
      expect(getSmartContextFailure(wrapped('context_growth_required', 'Old growth error'))).toBeNull()
      expect(getSmartContextFailure(new Error('API request failed: {"error":'))).toBeNull()
    })

    it('falls back to profile guidance if a recognized error lacks a message', () => {
      expect(getSmartContextFailure(wrapped('context_turn_too_large', ''))).toEqual({
        code: 'context_turn_too_large',
        message: GINFER_CONTEXT_OVERFLOW_MESSAGE,
      })
    })
  })

  describe('OUT_OF_CONTEXT_SIZE', () => {
    it('should have correct error message', () => {
      expect(OUT_OF_CONTEXT_SIZE).toBe(
        'the request exceeds the available context size.'
      )
    })

    it('should be a string', () => {
      expect(typeof OUT_OF_CONTEXT_SIZE).toBe('string')
    })
  })

  describe('MODEL_ACCESS_DENIED constants', () => {
    it('exposes a user-friendly title and message', () => {
      expect(MODEL_ACCESS_DENIED_TITLE).toBe('Model not available for your API key')
      expect(MODEL_ACCESS_DENIED_MESSAGE).toContain(
        'enabled in your provider'
      )
      expect(MODEL_ACCESS_DENIED_MESSAGE).toContain('allowed models list')
    })
  })

  describe('isModelAccessError', () => {
    const positives: Array<[string, string]> = [
      [
        'openai model_not_found',
        'The model `gpt-5.4` does not exist or you do not have access to it.',
      ],
      [
        'openai code string',
        'Error: model_not_found - project lacks access',
      ],
      [
        'anthropic permission scoped to model',
        'permission_error: your API key does not have permission to use this model',
      ],
      [
        'gemini permission denied',
        'PERMISSION_DENIED: Caller does not have permission to access model',
      ],
      [
        'xai style not authorized',
        'Not authorized to invoke model grok-4-1-fast-reasoning',
      ],
      [
        'plain english',
        "You don't have access to this model yet.",
      ],
      [
        'model not available',
        'Model not available for this API key',
      ],
    ]

    it.each(positives)('detects %s', (_label, message) => {
      expect(isModelAccessError(new Error(message))).toBe(true)
      expect(isModelAccessError(message)).toBe(true)
      expect(isModelAccessError({ message })).toBe(true)
    })

    const negatives: Array<[string, string]> = [
      ['empty string', ''],
      ['context size', OUT_OF_CONTEXT_SIZE],
      ['network failure', 'fetch failed: ECONNREFUSED'],
      ['rate limit', 'Rate limit exceeded, please retry later'],
      ['generic 500', 'Internal server error'],
      ['unrelated 404', 'Thread not found'],
    ]

    it.each(negatives)('does not match %s', (_label, message) => {
      expect(isModelAccessError(message ? new Error(message) : message)).toBe(
        false
      )
    })

    it('handles null / undefined safely', () => {
      expect(isModelAccessError(null)).toBe(false)
      expect(isModelAccessError(undefined)).toBe(false)
      expect(isModelAccessError({})).toBe(false)
    })
  })

  describe('isOutOfMemoryError', () => {
    const positives: Array<[string, string]> = [
      ['raw metal compute error', 'Compute error'],
      [
        'proxy insufficient_memory envelope',
        'The model ran out of memory while processing this request. Try a smaller or lighter model.',
      ],
      ['cuda oom', 'ggml_cuda: CUDA_ERROR_OUT_OF_MEMORY'],
      ['vulkan oom', 'ErrorOutOfDeviceMemory'],
      ['alloc failure', 'failed to allocate buffer'],
      ['insufficient memory', 'error: Insufficient Memory'],
    ]

    it.each(positives)('detects %s', (_label, message) => {
      expect(isOutOfMemoryError(new Error(message))).toBe(true)
      expect(isOutOfMemoryError(message)).toBe(true)
      expect(isOutOfMemoryError({ message })).toBe(true)
    })

    const negatives: Array<[string, string]> = [
      ['empty string', ''],
      ['context size', OUT_OF_CONTEXT_SIZE],
      ['rate limit', 'Rate limit exceeded'],
      ['generic 500', 'Internal server error'],
    ]

    it.each(negatives)('does not match %s', (_label, message) => {
      expect(isOutOfMemoryError(message ? new Error(message) : message)).toBe(
        false
      )
    })

    it('handles null / undefined safely', () => {
      expect(isOutOfMemoryError(null)).toBe(false)
      expect(isOutOfMemoryError(undefined)).toBe(false)
      expect(isOutOfMemoryError({})).toBe(false)
    })
  })
})

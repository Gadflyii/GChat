import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ModelFactory } from '../model-factory'
import type { ProviderObject } from '@gchat/core'
import type { ModelsService } from '@/services/models/types'
import { seedServiceHub } from '@/test/service-hub'
import { fetch as httpFetch } from '@tauri-apps/plugin-http'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { clearSmartContextCacheForTests, type GInferContextState } from '../smart-context'

// Mock the Tauri invoke function
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
  Channel: vi.fn(),
}))

// Mock the Tauri HTTP plugin
vi.mock('@tauri-apps/plugin-http', () => ({
  fetch: vi.fn(),
}))

// Mock the AI SDK providers
vi.mock('@ai-sdk/openai-compatible', () => {
  const MockChatModel = vi.fn().mockImplementation(() => ({
    type: 'foundation-models',
    modelId: 'apple/on-device',
  }))
  return {
    createOpenAICompatible: vi.fn(() => ({
      languageModel: vi.fn(() => ({ type: 'openai-compatible' })),
    })),
    OpenAICompatibleChatLanguageModel: MockChatModel,
    MetadataExtractor: vi.fn(),
  }
})

vi.mock('@ai-sdk/anthropic', () => ({
  createAnthropic: vi.fn(() => vi.fn(() => ({ type: 'anthropic' }))),
}))

vi.mock('ai', () => ({
  wrapLanguageModel: vi.fn(({ model }) => model),
  extractReasoningMiddleware: vi.fn(() => ({})),
}))

const mockStartModel = vi.fn().mockResolvedValue(undefined)

describe('ModelFactory', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockStartModel.mockResolvedValue(undefined)
    seedServiceHub({
      models: {
        startModel: mockStartModel,
      } as ModelsService,
    })
  })

  describe('createModel', () => {
    it('compacts paired GInfer aliases through the facade and reuses their checkpoint without local startup', async () => {
      clearSmartContextCacheForTests()
      const state: GInferContextState = { lastCompaction: null, manualCompactionRequested: true, manualCompactionResult: null }
      const alias = 'ginfer/paired-host/ready-instance'
      const provider: ProviderObject = { provider: 'ginfer-lan', models: [], settings: [], active: true }
      const calls: Array<{ url: string; body: Record<string, unknown> }> = []
      vi.mocked(httpFetch).mockImplementation(async (input, init) => {
        const url = String(input)
        const body = JSON.parse(String(init?.body))
        calls.push({ url, body })
        if (url.endsWith('/count_tokens')) {
          const text = JSON.stringify(body.messages)
          return new Response(JSON.stringify({ input_tokens: text.includes('GChat conversation checkpoint') ? 220 : 4900 }))
        }
        return new Response(JSON.stringify({ choices: [{ message: { content: '## Objective\nPreserve the goal.\n## Decisions\nUse the recorded design.\n## Tool findings\nFile a.txt exists.\n## Pending work\nContinue safely.' } }] }))
      })
      await ModelFactory.createModel(alias, provider, {}, undefined, {
        threadId: 'paired-compact', configuredContextTokens: 16000, state,
      })
      const config = vi.mocked(createOpenAICompatible).mock.calls.at(-1)![0]
      const fetcher = config.fetch!
      const transcript = { model: alias, max_tokens: 100, stream: true, messages: [
        { role: 'user', content: 'Earlier goal' },
        { role: 'assistant', content: 'Recorded decision and completed findings' },
        { role: 'user', content: 'Recent work' },
        { role: 'assistant', content: 'Recent response' },
        { role: 'user', content: 'Current task' },
      ] }
      const stored = structuredClone(transcript)
      const response = await fetcher(`${config.baseURL}/chat/completions`, { method: 'POST', body: JSON.stringify(transcript) })
      expect(await response.text()).toContain('gchat-context-compact')
      expect(state.manualCompactionResult?.status).toBe('compacted')
      expect(calls.filter((call) => !call.url.endsWith('/count_tokens'))).toHaveLength(1)
      expect(calls.every((call) => call.body.model === alias)).toBe(true)
      expect(calls.some((call) => call.url.endsWith('/chat/completions/count_tokens'))).toBe(true)
      expect(transcript).toEqual(stored)
      state.manualCompactionRequested = false
      const next = await fetcher(`${config.baseURL}/chat/completions`, { method: 'POST', body: JSON.stringify(transcript) })
      await next.text()
      expect(state.lastCompaction?.reusedCheckpoint).toBe(true)
      expect(JSON.stringify(calls.at(-1)!.body.messages)).toContain('GChat conversation checkpoint')
      expect(mockStartModel).not.toHaveBeenCalled()
    })

    it('should create an Anthropic model for anthropic provider', async () => {
      const provider: ProviderObject = {
        provider: 'anthropic',
        api_key: 'test-api-key',
        base_url: 'https://api.anthropic.com/v1',
        models: [],
        settings: [],
        active: true,
        custom_header: [{ header: 'anthropic-version', value: '2023-06-01' }],
      }

      const model = await ModelFactory.createModel('claude-3-opus', provider)
      expect(model).toBeDefined()
      expect(model.type).toBe('anthropic')
    })

    it('should create a Google model for google provider', async () => {
      const provider: ProviderObject = {
        provider: 'google',
        api_key: 'test-api-key',
        base_url: 'https://generativelanguage.googleapis.com/v1',
        models: [],
        settings: [],
        active: true,
      }

      const model = await ModelFactory.createModel('gemini-pro', provider)
      expect(model).toBeDefined()
      expect(model.type).toBe('openai-compatible')
    })

    it('should create a Google model for gemini provider', async () => {
      const provider: ProviderObject = {
        provider: 'gemini',
        api_key: 'test-api-key',
        base_url: 'https://generativelanguage.googleapis.com/v1',
        models: [],
        settings: [],
        active: true,
      }

      const model = await ModelFactory.createModel('gemini-pro', provider)
      expect(model).toBeDefined()
      expect(model.type).toBe('openai-compatible')
    })

    it('should create an OpenAI-compatible model for openai provider', async () => {
      const provider: ProviderObject = {
        provider: 'openai',
        api_key: 'test-api-key',
        base_url: 'https://api.openai.com/v1',
        models: [],
        settings: [],
        active: true,
      }

      const model = await ModelFactory.createModel('gpt-4', provider)
      expect(model).toBeDefined()
    })

    it('should create an OpenAI-compatible model for groq provider', async () => {
      const provider: ProviderObject = {
        provider: 'groq',
        api_key: 'test-api-key',
        base_url: 'https://api.groq.com/openai/v1',
        models: [],
        settings: [],
        active: true,
      }

      const model = await ModelFactory.createModel('llama-3', provider)
      expect(model).toBeDefined()
      expect(model.type).toBe('openai-compatible')
    })

    it('should create an OpenAI-compatible model for minimax provider', async () => {
      const provider: ProviderObject = {
        provider: 'minimax',
        api_key: 'test-api-key',
        base_url: 'https://api.minimax.io/v1',
        models: [],
        settings: [],
        active: true,
      }

      const model = await ModelFactory.createModel('MiniMax-M2.7', provider)
      expect(model).toBeDefined()
      expect(model.type).toBe('openai-compatible')
    })

    it('should handle custom headers for OpenAI-compatible providers', async () => {
      const provider: ProviderObject = {
        provider: 'custom',
        api_key: 'test-api-key',
        base_url: 'https://custom.api.com/v1',
        models: [],
        settings: [],
        active: true,
        custom_header: [{ header: 'X-Custom-Header', value: 'custom-value' }],
      }

      const model = await ModelFactory.createModel('custom-model', provider)
      expect(model).toBeDefined()
      expect(model.type).toBe('openai-compatible')
    })
  })
})

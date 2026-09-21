/**
 * Model Factory
 *
 * This factory provides a unified interface for creating language models from various providers.
 * It handles the complexity of initializing different AI SDK providers with their specific
 * configurations and returns a standard LanguageModel interface.
 *
 * Supported Providers:
 * - ginfer: Local models via the GInfer backend (requires running session)
 * - anthropic: Claude models via Anthropic API (@ai-sdk/anthropic v2.0)
 * - google/gemini: Gemini models via Google Generative AI API (@ai-sdk/google v2.0)
 * - openai: OpenAI models via OpenAI API (@ai-sdk/openai)
 * - OpenAI-compatible: Azure, Groq, Together, Fireworks, DeepSeek, Mistral, Cohere, etc.
 *
 * Usage:
 * ```typescript
 * const model = await ModelFactory.createModel(modelId, provider, parameters)
 * ```
 *
 * The factory automatically:
 * - Handles provider-specific authentication and headers
 * - Manages ginfer session discovery and connection
 * - Configures custom headers for each provider
 * - Returns a unified LanguageModel interface compatible with Vercel AI SDK
 */

/**
 * Inference parameters for customizing model behavior
 */
export interface ModelParameters {
  temperature?: number
  top_k?: number
  top_p?: number
  repeat_penalty?: number
  max_output_tokens?: number
  presence_penalty?: number
  frequency_penalty?: number
  stop_sequences?: string[]
}

import {
  extractReasoningMiddleware,
  wrapLanguageModel,
  type LanguageModel,
} from 'ai'
import { createOpenAI } from '@ai-sdk/openai'
import {
  createOpenAICompatible,
  MetadataExtractor,
  OpenAICompatibleChatLanguageModel,
} from '@ai-sdk/openai-compatible'
import { createAnthropic } from '@ai-sdk/anthropic'
import { createXai } from '@ai-sdk/xai'
import { invoke } from '@tauri-apps/api/core'
import { inferenceFetch } from '@/lib/inference-fetch'
import { SessionInfo } from '@gchat/core'
import { fetch as httpFetch } from '@tauri-apps/plugin-http'
import { useLocalApiServer } from '@/hooks/useLocalApiServer'
import { ttftPreBegin } from '@/lib/ttft-timing'
import { extractModelErrorMessage } from '@/lib/modelErrorMessage'
import {
  prepareGInferContextRequest,
  SmartContextError,
  smartContextErrorResponse,
  type GInferContextPolicy,
} from '@/lib/smart-context'


/** Optional server timing counters. */
interface ServerTimings {
  prompt_n?: number
  predicted_n?: number
  predicted_per_second?: number
  prompt_per_second?: number
  // Speculative draft and accepted-token counts.
  draft_n?: number
  draft_n_accepted?: number
}

/**
 * OpenAI-compatible `usage` block emitted by local inference servers on every
 * streaming chunk and on the final non-streaming response.
 */
interface ServerUsage {
  prompt_tokens?: number
  completion_tokens?: number
  total_tokens?: number
  prompt_tps?: number
  generation_tps?: number
  peak_memory?: number
}

interface ProviderMetricsChunk {
  usage?: ServerUsage
  timings?: ServerTimings
  x_ginfer?: GinferMetrics
}

interface GinferMetrics {
  computed_prefill_tokens?: number
  prefill_tokens_per_second?: number
  decode_tokens_per_second?: number
  finish_reason?: string
}

interface NormalizedMetrics {
  promptTokens: number | null
  completionTokens: number | null
  tokensPerSecond: number | null
  promptPerSecond: number | null
  draftTokensTotal: number | null
  draftTokensAccepted: number | null
  ginferFinishReason: string | null
}

const buildFromUsage = (usage: ServerUsage): NormalizedMetrics => ({
  promptTokens: usage.prompt_tokens ?? null,
  completionTokens: usage.completion_tokens ?? null,
  tokensPerSecond: usage.generation_tps ?? null,
  promptPerSecond: usage.prompt_tps ?? null,
  draftTokensTotal: null,
  draftTokensAccepted: null,
  ginferFinishReason: null,
})

const buildFromTimings = (timings: ServerTimings): NormalizedMetrics => ({
  promptTokens: timings.prompt_n ?? null,
  completionTokens: timings.predicted_n ?? null,
  tokensPerSecond: timings.predicted_per_second ?? null,
  promptPerSecond: timings.prompt_per_second ?? null,
  draftTokensTotal: timings.draft_n ?? null,
  draftTokensAccepted: timings.draft_n_accepted ?? null,
  ginferFinishReason: null,
})

const buildFromGinfer = (metrics: GinferMetrics): NormalizedMetrics => ({
  promptTokens: metrics.computed_prefill_tokens ?? null,
  completionTokens: null,
  tokensPerSecond: metrics.decode_tokens_per_second ?? null,
  promptPerSecond: metrics.prefill_tokens_per_second ?? null,
  draftTokensTotal: null,
  draftTokensAccepted: null,
  ginferFinishReason: metrics.finish_reason ?? null,
})

const hasAnyMetric = (m: NormalizedMetrics): boolean =>
  m.promptTokens != null ||
  m.completionTokens != null ||
  m.tokensPerSecond != null ||
  m.promptPerSecond != null ||
  m.ginferFinishReason != null

// Prefer usage counts, but preserve timing rates when usage has no positive rate.
const mergeMetrics = (
  usage: ServerUsage | undefined,
  timings: ServerTimings | undefined,
  ginfer: GinferMetrics | undefined
): NormalizedMetrics | null => {
  if (!usage && !timings && !ginfer) return null
  const u = usage ? buildFromUsage(usage) : null
  const t = timings ? buildFromTimings(timings) : null
  const g = ginfer ? buildFromGinfer(ginfer) : null

  const pickCount = (
    a: number | null | undefined,
    b: number | null | undefined
  ): number | null => (a != null ? a : (b ?? null))

  const pickRate = (
    a: number | null | undefined,
    b: number | null | undefined
  ): number | null => {
    if (a != null && a > 0) return a
    if (b != null && b > 0) return b
    return a ?? b ?? null
  }

  const merged: NormalizedMetrics = {
    promptTokens: pickCount(u?.promptTokens, t?.promptTokens),
    completionTokens: pickCount(u?.completionTokens, t?.completionTokens),
    tokensPerSecond: pickRate(
      g?.tokensPerSecond,
      pickRate(u?.tokensPerSecond, t?.tokensPerSecond)
    ),
    promptPerSecond: pickRate(
      g?.promptPerSecond,
      pickRate(u?.promptPerSecond, t?.promptPerSecond)
    ),
    draftTokensTotal: pickCount(u?.draftTokensTotal, t?.draftTokensTotal),
    draftTokensAccepted: pickCount(
      u?.draftTokensAccepted,
      t?.draftTokensAccepted
    ),
    ginferFinishReason: g?.ginferFinishReason ?? null,
  }
  return hasAnyMetric(merged) ? merged : null
}

/**
 * Custom metadata extractor for local providers that pulls token / TPS
 * metrics from both the OpenAI-compatible `usage` block and the legacy
 * `timings.*` shape. The two shapes are merged (usage-first,
 * timings-fallback per field) so a server that only fills one of the two
 * channels still produces a complete metric.
 */
const providerMetadataExtractor: MetadataExtractor = {
  extractMetadata: async ({ parsedBody }: { parsedBody: unknown }) => {
    const body = parsedBody as ProviderMetricsChunk
    const merged = mergeMetrics(body?.usage, body?.timings, body?.x_ginfer)
    if (!merged) return undefined
    return { providerMetadata: { ...merged } }
  },
  createStreamExtractor: () => {
    let lastUsage: ServerUsage | undefined
    let lastTimings: ServerTimings | undefined
    let lastGinfer: GinferMetrics | undefined

    return {
      processChunk: (parsedChunk: unknown) => {
        const chunk = parsedChunk as ProviderMetricsChunk
        // Each mlx-vlm streaming chunk carries the full running usage; keep
        // the most recent one so the final metadata reflects end-of-stream
        // counts and TPS.
        if (chunk?.usage) {
          lastUsage = chunk.usage
        }
        if (chunk?.timings) {
          lastTimings = chunk.timings
        }
        if (chunk?.x_ginfer) {
          lastGinfer = chunk.x_ginfer
        }
      },
      buildMetadata: () => {
        const merged = mergeMetrics(lastUsage, lastTimings, lastGinfer)
        if (!merged) return undefined
        return { providerMetadata: { ...merged } }
      },
    }
  },
}

/**
 * Create a custom fetch function that injects additional parameters into the request body
 */
function createCustomFetch(
  baseFetch: typeof httpFetch,
  parameters: Record<string, unknown>
): typeof httpFetch {
  return async (
    input: RequestInfo | URL,
    init?: RequestInit
  ): Promise<Response> => {
    // Only transform POST requests with JSON body
    if (init?.method === 'POST' || !init?.method) {
      const body = init?.body ? JSON.parse(init.body as string) : {}

      // Merge parameters into the request body
      const mergedBody = { ...body, ...parameters }

      init = {
        ...init,
        body: JSON.stringify(mergedBody),
      }
    }

    return baseFetch(input, init)
  }
}

/** Prepare local context, then use the version-matched native HTTP bridge. */
function createLocalStreamingFetch(
  fallbackFetch: typeof httpFetch,
  parameters: Record<string, unknown>,
  contextPolicy?: GInferContextPolicy
): typeof httpFetch {
  const normalFetch = createCustomFetch(fallbackFetch, parameters)

  return async (
    input: RequestInfo | URL,
    init?: RequestInit
  ): Promise<Response> => {
    const urlStr =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url

    const isLocal =
      urlStr.startsWith('http://localhost:') ||
      urlStr.startsWith('http://127.0.0.1:')
    const isPost = !init?.method || init.method.toUpperCase() === 'POST'

    if (!isLocal || !isPost) return normalFetch(input, init)

    let bodyStr = (init?.body as string) ?? ''
    if (bodyStr) {
      try {
        bodyStr = JSON.stringify({ ...JSON.parse(bodyStr), ...parameters })
      } catch {
        /* non-JSON body, leave as-is */
      }
    }

    const hdrs: Record<string, string> = {}
    if (init?.headers) {
      const h = init.headers
      if (h instanceof Headers)
        h.forEach((v, k) => {
          hdrs[k] = v
        })
      else if (Array.isArray(h)) for (const [k, v] of h) hdrs[k] = String(v)
      else for (const [k, v] of Object.entries(h)) hdrs[k] = String(v)
    }

    if (contextPolicy && /\/chat\/completions(?:\?.*)?$/.test(urlStr)) {
      try {
        const parsedBody = JSON.parse(bodyStr) as Record<string, unknown>
        const prepared = await prepareGInferContextRequest(
          urlStr,
          parsedBody,
          hdrs,
          fallbackFetch,
          contextPolicy,
          init?.signal ?? undefined
        )
        bodyStr = prepared.body
        if (contextPolicy.state?.manualCompactionRequested) {
          const preparedBody = JSON.parse(bodyStr) as Record<string, unknown>
          const created = Math.floor(Date.now() / 1_000)
          const model = String(preparedBody.model ?? '')
          const chunks = [
            {
              id: 'gchat-context-compact',
              object: 'chat.completion.chunk',
              created,
              model,
              choices: [
                {
                  index: 0,
                  delta: { role: 'assistant', content: '' },
                  finish_reason: null,
                },
              ],
            },
            {
              id: 'gchat-context-compact',
              object: 'chat.completion.chunk',
              created,
              model,
              choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
              usage: {
                prompt_tokens: 0,
                completion_tokens: 0,
                total_tokens: 0,
              },
            },
          ]
          return new Response(
            `${chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join('')}data: [DONE]\n\n`,
            {
              status: 200,
              headers: { 'Content-Type': 'text/event-stream' },
            }
          )
        }
      } catch (error) {
        if (error instanceof SmartContextError) {
          return smartContextErrorResponse(error)
        }
        throw error
      }
    }

    return inferenceFetch(fallbackFetch, input, { ...init, body: bodyStr })
  }
}

/**
 * Build the base URL of the running Local API Server proxy.
 * Cloud providers route inference through this proxy so `proxy.rs` can
 * dispatch by model name to the real provider endpoint.
 */
function getLocalApiServerBaseURL(): {
  baseURL: string
  apiKey: string
} {
  const { serverHost, serverPort, apiPrefix, apiKey } =
    useLocalApiServer.getState()
  // 0.0.0.0 is a listen-any address, not a dial address — clients must use
  // the loopback equivalent.
  const host = serverHost === '0.0.0.0' ? '127.0.0.1' : serverHost
  const prefix = apiPrefix.startsWith('/') ? apiPrefix : `/${apiPrefix}`
  return {
    baseURL: `http://${host}:${serverPort}${prefix}`,
    apiKey,
  }
}

/**
 * Factory for creating language models based on provider type.
 * Supports native AI SDK providers (Anthropic, Google) and OpenAI-compatible providers.
 */
/**
 * Cached `SessionInfo` (port + api_key) for an already-warm local session,
 * keyed by `providerName::modelId`. Avoids paying 100–200ms of redundant IPC
 * (`startModel` + `find_session_by_model`) on every `sendMessages` for a
 * session that is clearly still alive.
 *
 * TTL is short so that if the user stops/restarts the model the cache
 * naturally expires and the next request re-discovers the new session.
 */
interface CachedSession {
  sessionInfo: SessionInfo
  expiresAt: number
  inFlight?: Promise<SessionInfo>
}

const LOCAL_SESSION_CACHE_TTL_MS = 10_000

export class ModelFactory {
  private static localSessionCache: Map<string, CachedSession> = new Map()

  private static sessionCacheKey(providerName: string, modelId: string): string {
    return `${providerName}::${modelId}`
  }

  /**
   * Invalidate the cached `SessionInfo` for the given local provider/model.
   * Call this when the model is explicitly stopped or restarted so the next
   * request rediscovers the new port/api_key.
   */
  static invalidateLocalSessionCache(
    providerName: string,
    modelId?: string
  ): void {
    if (modelId) {
      ModelFactory.localSessionCache.delete(
        ModelFactory.sessionCacheKey(providerName, modelId)
      )
    } else {
      for (const key of Array.from(ModelFactory.localSessionCache.keys())) {
        if (key.startsWith(`${providerName}::`)) {
          ModelFactory.localSessionCache.delete(key)
        }
      }
    }
  }

  /**
   * Resolve `SessionInfo` for a ginfer model, reusing a cached entry when
   * fresh, otherwise calling `startModel` + the
   * `find_session_by_model` IPC and populating the cache. Concurrent
   * resolves for the same key share a single in-flight promise so the
   * pre-warm from the chat input and the real send don't both hit IPC.
   */
  private static async resolveLocalSession(
    providerName: 'ginfer',
    modelId: string,
    provider: ProviderObject | undefined
  ): Promise<SessionInfo> {
    const key = ModelFactory.sessionCacheKey(providerName, modelId)
    const now = Date.now()
    const cached = ModelFactory.localSessionCache.get(key)
    if (cached && cached.expiresAt > now) {
      // #region agent log
      ttftPreBegin('resolveLocalSession-cacheHit', { key })
      // #endregion
      return cached.sessionInfo
    }
    if (cached?.inFlight) {
      // #region agent log
      ttftPreBegin('resolveLocalSession-awaitInflight', { key })
      // #endregion
      return cached.inFlight
    }

    // #region agent log
    ttftPreBegin('resolveLocalSession-cacheMiss', { key })
    // #endregion
    const inFlight = (async () => {
      if (provider) {
        try {
          const { useServiceStore } = await import('@/hooks/useServiceHub')
          const serviceHub = useServiceStore.getState().serviceHub
          if (serviceHub) {
            await serviceHub.models().startModel(provider, modelId)
          }
        } catch (error) {
          console.error(`Failed to start ${providerName} model:`, error)
          throw new Error(
            `Failed to start model: ${extractModelErrorMessage(error)}`
          )
        }
      }

      const sessionInfo = await invoke<SessionInfo | null>(
        'plugin:ginfer|find_session_by_model',
        { modelId }
      )
      if (!sessionInfo) {
        throw new Error(
          `No running session found for model: ${modelId} (provider: ${providerName})`
        )
      }
      ModelFactory.localSessionCache.set(key, {
        sessionInfo,
        expiresAt: Date.now() + LOCAL_SESSION_CACHE_TTL_MS,
      })
      // #region agent log
      ttftPreBegin('resolveLocalSession-cached', { key })
      // #endregion
      return sessionInfo
    })()

    ModelFactory.localSessionCache.set(key, {
      sessionInfo: cached?.sessionInfo ?? ({} as SessionInfo),
      expiresAt: cached?.expiresAt ?? 0,
      inFlight,
    })

    try {
      return await inFlight
    } finally {
      const entry = ModelFactory.localSessionCache.get(key)
      if (entry && entry.inFlight === inFlight) {
        entry.inFlight = undefined
      }
    }
  }

  /**
   * Fire-and-forget pre-warm of a local session. Designed to be called from
   * the chat input the moment the user hits Send on the home screen, so that
   * `startModel` + session discovery happen in parallel with thread
   * creation, navigation, and route mounting. Safe to call repeatedly: the
   * in-flight de-duplication in `resolveLocalSession` keeps it to a single
   * IPC round-trip.
   */
  static async prewarmSession(
    providerName: string,
    modelId: string,
    provider: ProviderObject
  ): Promise<void> {
    if (providerName.toLowerCase() !== 'ginfer') {
      return
    }
    try {
      await ModelFactory.resolveLocalSession('ginfer', modelId, provider)
    } catch (error) {
      console.debug('[ModelFactory] prewarmSession failed:', error)
    }
  }

  /**
   * Create a language model instance based on the provider configuration
   */
  static async createModel(
    modelId: string,
    provider: ProviderObject,
    parameters: Record<string, unknown> = {},
    reasoningOverride?: Record<string, unknown>,
    contextPolicy?: GInferContextPolicy
  ): Promise<LanguageModel> {
    const providerName = provider.provider.toLowerCase()
    const override = reasoningOverride ?? {}
    // Local providers accept the full inference-parameter bag (top_k,
    // repeat_penalty, stop_sequences, …) as body injection. Cloud providers
    // must receive ONLY the reasoning-override fields — otherwise local-only
    // keys like `top_k` leak into request bodies and strict APIs (OpenAI)
    // respond with 400 "Unknown parameter".
    const localInjected: Record<string, unknown> = {
      ...parameters,
      ...override,
    }

    switch (providerName) {
      case 'ginfer':
        return this.createGinferModel(
          modelId,
          provider,
          localInjected,
          contextPolicy
        )

      case 'anthropic':
        return this.createAnthropicModel(modelId, provider, override)

      case 'openai':
        return this.createOpenAIModel(modelId, provider, override)
      case 'google':
      case 'gemini':
      case 'azure':
      case 'groq':
      case 'together':
      case 'fireworks':
      case 'deepseek':
      case 'mistral':
      case 'cohere':
      case 'perplexity':
      case 'moonshot':
      case 'minimax':
      case 'openrouter':
      case 'huggingface':
      case 'nvidia':
      case 'ollama':
        return this.createOpenAICompatibleModel(modelId, provider, override)

      case 'xai':
        return this.createXaiModel(modelId, provider, override)

      default:
        // User-registered custom OpenAI-compatible providers — keep the
        // previous behaviour (full local-merged bag) for backwards compat.
        return this.createOpenAICompatibleModel(
          modelId,
          provider,
          localInjected
        )
    }
  }

  /**
   * Create a GInfer model by starting the model and finding the running
   * session. GInfer exposes an OpenAI-compatible HTTP surface, so the model
   * construction is shared with the rest of the local-provider path — only
   * the session-discovery IPC differs.
   */
  private static async createGinferModel(
    modelId: string,
    provider?: ProviderObject,
    parameters: Record<string, unknown> = {},
    contextPolicy?: GInferContextPolicy
  ): Promise<LanguageModel> {
    const sessionInfo = await ModelFactory.resolveLocalSession(
      'ginfer',
      modelId,
      provider
    )

    const customFetch = createLocalStreamingFetch(
      httpFetch,
      parameters,
      contextPolicy
    )

    const model = new OpenAICompatibleChatLanguageModel(modelId, {
      provider: 'ginfer',
      headers: () => ({
        Authorization: `Bearer ${sessionInfo.api_key}`,
        Origin: 'tauri://localhost',
      }),
      url: ({ path }) => {
        const url = new URL(`http://localhost:${sessionInfo.port}/v1${path}`)
        return url.toString()
      },
      includeUsage: true,
      fetch: customFetch,
      metadataExtractor: providerMetadataExtractor,
    })

    return wrapLanguageModel({
      model,
      middleware: extractReasoningMiddleware({
        tagName: 'think',
        separator: '\n',
      }),
    })
  }

  /**
   * Create an Anthropic model using the official AI SDK.
   *
   * Requests are routed through the Local API Server proxy which dispatches
   * by model name to the configured Anthropic endpoint + key. The SDK still
   * emits `/messages` and `proxy.rs` handles that route natively.
   */
  private static createAnthropicModel(
    modelId: string,
    provider: ProviderObject,
    parameters: Record<string, unknown> = {}
  ): LanguageModel {
    const headers: Record<string, string> = {}

    if (provider.custom_header) {
      provider.custom_header.forEach((customHeader) => {
        headers[customHeader.header] = customHeader.value
      })
    }

    const { baseURL, apiKey } = getLocalApiServerBaseURL()

    const anthropic = createAnthropic({
      apiKey: apiKey || provider.api_key || 'local',
      baseURL,
      headers: Object.keys(headers).length > 0 ? headers : undefined,
      // Use the IPC-channel streaming fetch because the Local API Server is on
      // localhost and tauri_plugin_http's ReadableStream bridge does not relay
      // SSE chunks from loopback targets.
      fetch: createLocalStreamingFetch(httpFetch, parameters),
    })

    return anthropic(modelId)
  }

  /**
   * Create an OpenAI model using the official AI SDK.
   *
   * Requests are routed through the Local API Server proxy; `proxy.rs`
   * dispatches to the real OpenAI endpoint based on the `model` field and
   * the provider config registered via `register_provider_config`.
   */
  private static createOpenAIModel(
    modelId: string,
    provider: ProviderObject,
    parameters: Record<string, unknown> = {}
  ): LanguageModel {
    const headers: Record<string, string> = {}

    if (provider.custom_header) {
      provider.custom_header.forEach((customHeader) => {
        headers[customHeader.header] = customHeader.value
      })
    }

    const { baseURL, apiKey } = getLocalApiServerBaseURL()

    const openai = createOpenAI({
      apiKey: apiKey || provider.api_key || 'local',
      baseURL,
      headers: Object.keys(headers).length > 0 ? headers : undefined,
      // Use the IPC-channel streaming fetch because the Local API Server is on
      // localhost and tauri_plugin_http's ReadableStream bridge does not relay
      // SSE chunks from loopback targets.
      fetch: createLocalStreamingFetch(httpFetch, parameters),
    })

    // AI SDK v5 routes `openai(id)` through the new Responses API
    // (`POST /responses`), which the Local API Server proxy does not route.
    // `openai.chat(id)` targets `POST /chat/completions`, which `proxy.rs`
    // dispatches to the real provider via `register_provider_config`.
    return openai.chat(modelId)
  }

  /**
   * Create an XAI (Grok) model using the official AI SDK, routed through the
   * Local API Server proxy.
   */
  private static createXaiModel(
    modelId: string,
    provider: ProviderObject,
    parameters: Record<string, unknown> = {}
  ): LanguageModel {
    const headers: Record<string, string> = {}

    if (provider.custom_header) {
      provider.custom_header.forEach((customHeader) => {
        headers[customHeader.header] = customHeader.value
      })
    }

    const { baseURL, apiKey } = getLocalApiServerBaseURL()

    const xai = createXai({
      apiKey: apiKey || provider.api_key || 'local',
      baseURL,
      headers: Object.keys(headers).length > 0 ? headers : undefined,
      // Use the IPC-channel streaming fetch (see OpenAI factory rationale).
      fetch: createLocalStreamingFetch(httpFetch, parameters),
    })

    return xai(modelId)
  }

  /**
   * Create an OpenAI-compatible model for providers that support the OpenAI
   * API format. Routed through the Local API Server proxy.
   */
  private static createOpenAICompatibleModel(
    modelId: string,
    provider: ProviderObject,
    parameters: Record<string, unknown> = {}
  ): LanguageModel {
    const headers: Record<string, string> = {}

    if (provider.custom_header) {
      provider.custom_header.forEach((customHeader) => {
        headers[customHeader.header] = customHeader.value
      })
    }

    const { baseURL, apiKey } = getLocalApiServerBaseURL()

    // Proxy replaces the outbound Authorization header with the registered
    // provider api_key, so only the local-server apiKey matters here (if set).
    if (apiKey) {
      headers['Authorization'] = `Bearer ${apiKey}`
    } else if (provider.api_key) {
      headers['Authorization'] = `Bearer ${provider.api_key}`
    }

    const openAICompatible = createOpenAICompatible({
      name: provider.provider,
      baseURL,
      headers,
      includeUsage: true,
      // Use the IPC-channel streaming fetch (see OpenAI factory rationale).
      fetch: createLocalStreamingFetch(httpFetch, parameters),
    })

    // Some OpenAI-compatible providers (MiniMax, DeepSeek, Moonshot, NVIDIA
    // NIM, etc.) stream chain-of-thought inline as <think>...</think> inside
    // the assistant text instead of as a separate reasoning field. Without
    // this middleware the tags leak into the rendered message verbatim; with
    // it, the reasoning is split into a dedicated reasoning part. The
    // middleware is a no-op for providers that never emit <think> tags.
    return wrapLanguageModel({
      model: openAICompatible.languageModel(modelId),
      middleware: extractReasoningMiddleware({
        tagName: 'think',
        separator: '\n',
      }),
    })
  }
}

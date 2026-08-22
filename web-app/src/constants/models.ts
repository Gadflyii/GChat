/**
 * Model-related constants
 */

import type { CatalogModel } from '@/services/models/types'
import type { Recommendation } from '@/services/recommended-models-registry'
import type { HardwareTier } from '@/lib/hardware-tier'

export const EMBEDDING_MODEL_ID = 'sentence-transformer-mini'

/** HF repo for the bundled quick-start coding model (Settings → Claude Code). */
export const JAN_CODE_HF_REPO = 'janhq/Jan-Code-4b-Gguf'

/**
 * Model offered by the bottom-right reminder that appears when onboarding is
 * left without picking anything. Must stay in sync with the first entry of the
 * onboarding manifest (`atomic-chat-conf/models/recommended.json`) so the
 * reminder repeats the same recommendation the setup screen showed.
 */
export const ONBOARDING_REMINDER_MODEL_HF_REPO =
  'GadflyII/Qwen3.8-27B-NInfer'

/** What the bottom-right reminder offers, keyed by hardware tier. */
export type OnboardingReminderModel = {
  /** Hugging Face repo id. */
  repo: string
  /** Display name — this card is not translated, matching its siblings. */
  title: string
}

/**
 * The reminder must offer what the machine can actually run, or it repeats the
 * mistake the low-spec tier exists to fix: a weak device that skipped
 * onboarding got nudged toward a 2.5 GB model it would struggle with.
 *
 * Keep the `standard` entry in sync with the first entry of
 * `recommendations` in the onboarding manifest.
 */
export const ONBOARDING_REMINDER_MODELS: Record<
  HardwareTier,
  OnboardingReminderModel
> = {
  standard: {
    repo: ONBOARDING_REMINDER_MODEL_HF_REPO,
    title: 'Qwen3.8 27B',
  },
  low: {
    repo: ONBOARDING_REMINDER_MODEL_HF_REPO,
    title: 'Qwen3.8 27B',
  },
}
export const DEFAULT_MODEL_QUANTIZATIONS = ['iq4_xs', 'q4_k_m']

/**
 * Quantizations to check for SetupScreen quick start
 * Includes Q8 for higher quality on capable systems
 */
export const SETUP_SCREEN_QUANTIZATIONS = ['q4_k_m']

/**
 * Bundled fallback for the recommended-models registry. Mirrors the contents
 * of `atomic-chat-conf/models/recommended.json` so the client can render the
 * Recommended section on the very first launch (before the manifest fetch
 * resolves) and when the network is unavailable.
 *
 * Platform filtering happens at runtime in
 * `recommended-models-registry-store.ts` — keep `platforms` declarative here
 * (do NOT inline `IS_MACOS` ternaries) so the baseline mirrors the manifest
 * shape verbatim.
 */
export const BASELINE_RECOMMENDED_MODELS: ReadonlyArray<Recommendation> = [
  {
    model_name: 'GadflyII/Qwen3.8-27B-NInfer',
    description_key: 'hub:recEverydayUse',
  },
  {
    model_name: 'GadflyII/Qwen3.8-27B-nvfp4-NInfer',
    description_key: 'hub:recMathReasoning',
  },
]

/**
 * Mirror of the manifest's `low_spec_recommendations` array. Shown INSTEAD of
 * {@link BASELINE_RECOMMENDED_MODELS} on machines `classifyHardwareTier` calls
 * low-spec, so the first model a weak machine downloads is one it can run.
 * Empty: the single local backend (GInfer) requires an NVIDIA GPU, so there is
 * no low-spec local model to offer.
 */
export const BASELINE_LOW_SPEC_RECOMMENDED_MODELS: ReadonlyArray<Recommendation> =
  []

/**
 * One `.ginfer` weights file per repo. File sizes and hashes are unknown
 * until the repos are published, so the download resolves them from the live
 * HuggingFace repo at download time — an unpublished repo degrades to a clean
 * download error, never a crash.
 */
const ginferEntry = ({
  id,
  name,
  repo,
  tags,
}: {
  id: string
  name: string
  repo: string
  tags: string
}): CatalogModel => ({
  model_name: repo,
  name,
  developer: 'GadflyII',
  library_name: 'ginfer',
  description: `**Tags**: ${tags}`,
  downloads: 0,
  num_quants: 1,
  quants: [
    {
      model_id: id,
      path: `https://huggingface.co/${repo}/resolve/main/model.ginfer`,
      file_size: '',
    },
  ],
  num_mmproj: 0,
  mmproj_models: [],
  num_safetensors: 0,
  safetensors_files: [],
  is_mlx: false,
  readme: `https://huggingface.co/${repo}/resolve/main/README.md`,
})

/**
 * Bundled offline-first fallback for the model catalog registry.
 *
 * Seeds `useModelCatalogStore` when neither the `localStorage` cache nor the
 * network fetch succeed (e.g. first launch on an air-gapped machine). Each
 * entry follows the exact `CatalogModel` shape so the existing download
 * pipeline can act on it without conversion.
 */
export const BASELINE_MODEL_CATALOG: ReadonlyArray<CatalogModel> = [
  ginferEntry({
    id: 'qwen3.8-27b-int-autoround',
    name: 'Qwen3.8 27B (int autoround)',
    repo: 'GadflyII/Qwen3.8-27B-NInfer',
    tags: 'ginfer, qwen3, nvidia, cuda, conversational',
  }),
  ginferEntry({
    id: 'qwen3.8-27b-nvfp4',
    name: 'Qwen3.8 27B (NVFP4)',
    repo: 'GadflyII/Qwen3.8-27B-nvfp4-NInfer',
    tags: 'ginfer, qwen3, nvidia, cuda, conversational',
  }),
  ginferEntry({
    id: 'muse-glimmer-30b-int-autoround',
    name: 'Muse Glimmer 30B (int autoround)',
    repo: 'GadflyII/Muse-Glimmer-30B-NInfer',
    tags: 'ginfer, nvidia, cuda, conversational',
  }),
  ginferEntry({
    id: 'muse-glimmer-30b-nvfp4',
    name: 'Muse Glimmer 30B (NVFP4)',
    repo: 'GadflyII/Muse-Glimmer-30B-nvfp4-NInfer',
    tags: 'ginfer, nvidia, cuda, conversational',
  }),
]

/**
 * Offline-only `CatalogModel` snapshot used by the Hub model page when the
 * HF API is unreachable. Kept in lockstep with `BASELINE_MODEL_CATALOG` —
 * the two are the same set of local models.
 */
export const RECOMMENDED_MODEL_FALLBACKS: Readonly<
  Record<string, CatalogModel>
> = Object.freeze(
  Object.fromEntries(BASELINE_MODEL_CATALOG.map((model) => [model.model_name, model]))
)

/**
 * Provider model capabilities - copied from token.js package
 */
export const providerModels = {
  // OpenAI — set verified against the live /v1/models response on macOS build (Apr 2026).
  // o3-mini is reasoning-only (text), so it is excluded from supportsImages.
  'openai': {
    models: [
      'gpt-5.4',
      'gpt-5.4-mini',
      'gpt-5.4-nano',
      'gpt-5',
      'gpt-5-mini',
      'gpt-4.5-preview',
      'gpt-4.1',
      'gpt-4o',
      'gpt-4o-mini',
      'o3-mini',
      'gpt-4-turbo',
    ],
    supportsCompletion: true,
    supportsStreaming: [
      'gpt-5.4',
      'gpt-5.4-mini',
      'gpt-5.4-nano',
      'gpt-5',
      'gpt-5-mini',
      'gpt-4.5-preview',
      'gpt-4.1',
      'gpt-4o',
      'gpt-4o-mini',
      'o3-mini',
      'gpt-4-turbo',
    ],
    supportsJSON: [
      'gpt-5.4',
      'gpt-5.4-mini',
      'gpt-5.4-nano',
      'gpt-5',
      'gpt-5-mini',
      'gpt-4.5-preview',
      'gpt-4.1',
      'gpt-4o',
      'gpt-4o-mini',
      'o3-mini',
      'gpt-4-turbo',
    ],
    supportsImages: [
      'gpt-5.4',
      'gpt-5.4-mini',
      'gpt-5.4-nano',
      'gpt-5',
      'gpt-5-mini',
      'gpt-4.5-preview',
      'gpt-4.1',
      'gpt-4o',
      'gpt-4o-mini',
      'gpt-4-turbo',
    ],
    supportsToolCalls: [
      'gpt-5.4',
      'gpt-5.4-mini',
      'gpt-5.4-nano',
      'gpt-5',
      'gpt-5-mini',
      'gpt-4.5-preview',
      'gpt-4.1',
      'gpt-4o',
      'gpt-4o-mini',
      'o3-mini',
      'gpt-4-turbo',
    ],
    supportsN: true,
  },
  'ai21': {
    models: ['jamba-instruct'],
    supportsCompletion: true,
    supportsStreaming: ['jamba-instruct'],
    supportsJSON: [],
    supportsImages: [],
    supportsToolCalls: [],
    supportsN: true,
  },
  // Anthropic — source: https://platform.claude.com/docs/en/about-claude/models/overview (Apr 21, 2026)
  // Only current/active models. claude-sonnet-4 & claude-opus-4 deprecated (retire 15 Jun 2026).
  // claude-3-* models retired.
  'anthropic': {
    models: [
      'claude-opus-4-7',
      'claude-sonnet-4-6',
      'claude-haiku-4-5',
      'claude-opus-4-6',
      'claude-opus-4-5',
      'claude-opus-4-1',
      'claude-sonnet-4-5',
    ],
    supportsCompletion: true,
    supportsStreaming: [
      'claude-opus-4-7',
      'claude-sonnet-4-6',
      'claude-haiku-4-5',
      'claude-opus-4-6',
      'claude-opus-4-5',
      'claude-opus-4-1',
      'claude-sonnet-4-5',
    ],
    supportsJSON: [],
    supportsImages: [
      'claude-opus-4-7',
      'claude-sonnet-4-6',
      'claude-haiku-4-5',
      'claude-opus-4-6',
      'claude-opus-4-5',
      'claude-opus-4-1',
      'claude-sonnet-4-5',
    ],
    supportsToolCalls: [
      'claude-opus-4-7',
      'claude-sonnet-4-6',
      'claude-haiku-4-5',
      'claude-opus-4-6',
      'claude-opus-4-5',
      'claude-opus-4-1',
      'claude-sonnet-4-5',
    ],
    supportsN: true,
  },
  // Gemini — source: https://ai.google.dev/gemini-api/docs/models (Apr 2026)
  // 3.x line is preview; 2.5.x stable. 2.0-* scheduled for shutdown 1 Jun 2026; 1.5-* retired.
  'gemini': {
    models: [
      'gemini-3.1-pro-preview',
      'gemini-3-flash-preview',
      'gemini-3.1-flash-lite-preview',
      'gemini-2.5-pro',
      'gemini-2.5-flash',
      'gemini-2.5-flash-lite',
    ],
    supportsCompletion: true,
    supportsStreaming: [
      'gemini-3.1-pro-preview',
      'gemini-3-flash-preview',
      'gemini-3.1-flash-lite-preview',
      'gemini-2.5-pro',
      'gemini-2.5-flash',
      'gemini-2.5-flash-lite',
    ],
    supportsJSON: [
      'gemini-3.1-pro-preview',
      'gemini-3-flash-preview',
      'gemini-3.1-flash-lite-preview',
      'gemini-2.5-pro',
      'gemini-2.5-flash',
      'gemini-2.5-flash-lite',
    ],
    supportsImages: [
      'gemini-3.1-pro-preview',
      'gemini-3-flash-preview',
      'gemini-3.1-flash-lite-preview',
      'gemini-2.5-pro',
      'gemini-2.5-flash',
      'gemini-2.5-flash-lite',
    ],
    supportsToolCalls: [
      'gemini-3.1-pro-preview',
      'gemini-3-flash-preview',
      'gemini-3.1-flash-lite-preview',
      'gemini-2.5-pro',
      'gemini-2.5-flash',
      'gemini-2.5-flash-lite',
    ],
    supportsN: true,
  },
  'cohere': {
    models: [
      'command-a-03-2025',
      'command-r-08-2024',
      'command-r-plus-08-2024',
    ],
    supportsCompletion: true,
    supportsStreaming: [
      'command-a-03-2025',
      'command-r-08-2024',
      'command-r-plus-08-2024',
    ],
    supportsJSON: [],
    supportsImages: [],
    supportsToolCalls: [
      'command-a-03-2025',
      'command-r-08-2024',
      'command-r-plus-08-2024',
    ],
    supportsN: true,
  },
  'bedrock': {
    models: [
      'anthropic.claude-3-5-sonnet-20241022-v2:0',
      'anthropic.claude-3-5-haiku-20241022-v1:0',
      'cohere.command-r-plus-v1:0',
      'cohere.command-r-v1:0',
      'meta.llama3-70b-instruct-v1:0',
      'meta.llama3-8b-instruct-v1:0',
      'mistral.mistral-large-2402-v1:0',
      'amazon.titan-text-express-v1',
    ],
    supportsCompletion: true,
    supportsStreaming: [
      'anthropic.claude-3-5-sonnet-20241022-v2:0',
      'anthropic.claude-3-5-haiku-20241022-v1:0',
      'cohere.command-r-plus-v1:0',
      'cohere.command-r-v1:0',
      'meta.llama3-70b-instruct-v1:0',
      'meta.llama3-8b-instruct-v1:0',
      'mistral.mistral-large-2402-v1:0',
      'amazon.titan-text-express-v1',
    ],
    supportsJSON: [],
    supportsImages: [
      'anthropic.claude-3-5-sonnet-20241022-v2:0',
      'anthropic.claude-3-5-haiku-20241022-v1:0',
    ],
    supportsToolCalls: [
      'anthropic.claude-3-5-sonnet-20241022-v2:0',
      'anthropic.claude-3-5-haiku-20241022-v1:0',
      'cohere.command-r-plus-v1:0',
      'cohere.command-r-v1:0',
      'mistral.mistral-large-2402-v1:0',
    ],
    supportsN: true,
  },
  'mistral': {
    models: [
      'mistral-large-2411',
      'magistral-medium-2509',
      'magistral-small-2509',
      'pixtral-large-2411',
      'pixtral-12b-2409',
      'codestral-2508',
      'mistral-small-2506',
      'mistral-nemo-2407',
    ],
    supportsCompletion: true,
    supportsStreaming: [
      'mistral-large-2411',
      'magistral-medium-2509',
      'magistral-small-2509',
      'pixtral-large-2411',
      'pixtral-12b-2409',
      'codestral-2508',
      'mistral-small-2506',
      'mistral-nemo-2407',
    ],
    supportsJSON: ['mistral-large-2411', 'codestral-2508'],
    supportsImages: [
      'magistral-medium-2509',
      'magistral-small-2509',
      'pixtral-large-2411',
      'pixtral-12b-2409',
      'mistral-small-2506',
    ],
    supportsToolCalls: ['mistral-large-2411', 'mistral-small-2506'],
    supportsN: true,
  },
  'groq': {
    models: [
      'meta-llama/llama-4-maverick-17b-128e-instruct',
      'meta-llama/llama-4-scout-17b-16e-instruct',
      'llama-3.3-70b-versatile',
      'llama-3.1-8b-instant',
      'moonshotai/kimi-k2-instruct-0905',
      'qwen/qwen3-32b',
      'openai/gpt-oss-120b',
      'whisper-large-v3-turbo',
    ],
    supportsCompletion: true,
    supportsStreaming: [
      'meta-llama/llama-4-maverick-17b-128e-instruct',
      'meta-llama/llama-4-scout-17b-16e-instruct',
      'llama-3.3-70b-versatile',
      'llama-3.1-8b-instant',
      'moonshotai/kimi-k2-instruct-0905',
      'qwen/qwen3-32b',
      'openai/gpt-oss-120b',
    ],
    supportsJSON: [
      'llama-3.3-70b-versatile',
      'llama-3.1-8b-instant',
      'openai/gpt-oss-120b',
    ],
    supportsImages: [
      'meta-llama/llama-4-maverick-17b-128e-instruct',
      'meta-llama/llama-4-scout-17b-16e-instruct',
    ],
    supportsToolCalls: [],
    supportsN: true,
  },
  // xAI — source: https://docs.x.ai/developers/models (Apr 2026)
  // grok-4.20 is flagship; 4-1-fast is cost-efficient; code-fast specialized.
  // grok-3/grok-2-vision kept as legacy for thread back-compat.
  'xai': {
    models: [
      'grok-4.20-0309-reasoning',
      'grok-4.20-0309-non-reasoning',
      'grok-4-1-fast-reasoning',
      'grok-4-1-fast-non-reasoning',
      'grok-code-fast-1',
      'grok-3',
      'grok-3-mini',
      'grok-2-vision-1212',
    ],
    supportsCompletion: true,
    supportsStreaming: [
      'grok-4.20-0309-reasoning',
      'grok-4.20-0309-non-reasoning',
      'grok-4-1-fast-reasoning',
      'grok-4-1-fast-non-reasoning',
      'grok-code-fast-1',
      'grok-3',
      'grok-3-mini',
      'grok-2-vision-1212',
    ],
    supportsJSON: [
      'grok-4.20-0309-reasoning',
      'grok-4.20-0309-non-reasoning',
      'grok-4-1-fast-reasoning',
      'grok-4-1-fast-non-reasoning',
      'grok-code-fast-1',
      'grok-3',
      'grok-3-mini',
    ],
    supportsImages: [
      'grok-4.20-0309-reasoning',
      'grok-4.20-0309-non-reasoning',
      'grok-4-1-fast-reasoning',
      'grok-4-1-fast-non-reasoning',
      'grok-2-vision-1212',
    ],
    supportsToolCalls: [
      'grok-4.20-0309-reasoning',
      'grok-4.20-0309-non-reasoning',
      'grok-4-1-fast-reasoning',
      'grok-4-1-fast-non-reasoning',
      'grok-code-fast-1',
      'grok-3',
      'grok-3-mini',
    ],
    supportsN: true,
  },
  'perplexity': {
    models: ['sonar', 'sonar-pro', 'sonar-reasoning-pro'],
    supportsCompletion: true,
    supportsStreaming: ['sonar', 'sonar-pro', 'sonar-reasoning-pro'],
    supportsJSON: ['sonar', 'sonar-pro', 'sonar-reasoning-pro'],
    supportsImages: [],
    supportsToolCalls: ['sonar', 'sonar-pro', 'sonar-reasoning-pro'],
    supportsN: true,
  },
  'minimax': {
    models: [
      'MiniMax-M2.7',
      'MiniMax-M2.7-highspeed',
      'MiniMax-M2.5',
      'MiniMax-M2.5-highspeed',
    ],
    supportsCompletion: true,
    supportsStreaming: [
      'MiniMax-M2.7',
      'MiniMax-M2.7-highspeed',
      'MiniMax-M2.5',
      'MiniMax-M2.5-highspeed',
    ],
    supportsJSON: [],
    supportsImages: [],
    supportsToolCalls: [
      'MiniMax-M2.7',
      'MiniMax-M2.7-highspeed',
      'MiniMax-M2.5',
      'MiniMax-M2.5-highspeed',
    ],
    supportsN: true,
  },
  'openrouter': {
    models: true,
    supportsCompletion: true,
    supportsStreaming: true,
    supportsJSON: true,
    supportsImages: true,
    supportsToolCalls: true,
    supportsN: true,
  },
  'nvidia': {
    models: ['moonshotai/kimi-k2.5', 'minimaxai/minimax-m2.5', 'z-ai/glm5'],
    supportsCompletion: true,
    supportsStreaming: true,
    supportsJSON: true,
    supportsImages: true,
    supportsToolCalls: true,
    supportsN: true,
  },
  'openai-compatible': {
    models: true,
    supportsCompletion: true,
    supportsStreaming: true,
    supportsJSON: true,
    supportsImages: true,
    supportsToolCalls: true,
    supportsN: true,
  },
} as const

import { type UIMessage } from '@ai-sdk/react'
import {
  convertToModelMessages,
  streamText,
  jsonSchema,
  NoSuchToolError,
  type ChatRequestOptions,
  type ChatTransport,
  type LanguageModel,
  type UIMessageChunk,
  type Tool,
  type LanguageModelUsage,
  type TextStreamPart,
} from 'ai'
import { repairToolCallArguments } from './repairToolCall'
import { chatMemoryContext, supportsGChatMemory } from './memory'
import { prepareToolResultImagesForModel } from './toolResultImages'
import {
  buildToolsRecord,
  buildCapabilityDiscoveryTools,
  splitAnthropicSerialToolUse,
} from './custom-chat-transport-helpers'
import type { MCPTool } from '@/types/completion'

// Strip leaked special-token markers before displaying or saving text.
const SPECIAL_TOKEN_REGEX = /<\|[a-zA-Z0-9_]+\|>/g

/// `streamText` transform that scrubs the special-token markers from
/// every `text-delta`. We pass `unknown` for `TOOLS` because the
/// transform doesn't introspect tools.
const stripSpecialTokensTransform = () =>
  new TransformStream<TextStreamPart<never>, TextStreamPart<never>>({
    transform(chunk, controller) {
      if (chunk.type === 'text-delta') {
        const cleaned = chunk.text.replace(SPECIAL_TOKEN_REGEX, '')
        if (cleaned.length === 0) {
          /// Emit a whitespace delta so the UI shows streaming state while
          /// reasoning / special-token-only prefixes are stripped.
          controller.enqueue({ ...chunk, text: ' ' })
          return
        }
        controller.enqueue({ ...chunk, text: cleaned })
        return
      }
      controller.enqueue(chunk)
    },
  })
import { useServiceStore } from '@/hooks/useServiceHub'
import { listAgentModelInstances } from '@/services/agent/definitions'
import { useToolAvailable } from '@/hooks/useToolAvailable'
import { ModelFactory } from './model-factory'
import { useModelProvider } from '@/hooks/useModelProvider'
import { useContextUsage } from '@/hooks/useContextUsage'
import { getSamplingParamsForThread } from '@/lib/samplingParams'
import { withRecommendedSampling, withServerSampling } from '@/lib/predefinedParams'
import { useGeneralSetting } from '@/hooks/useGeneralSetting'
import { useThreads } from '@/hooks/useThreads'
import { useAttachments } from '@/hooks/useAttachments'
import { useAppState } from '@/hooks/useAppState'
import { useConversationPolicy } from '@/hooks/useConversationPolicy'
import { ExtensionManager } from '@/lib/extension'
import { EngineManager, ExtensionTypeEnum, VectorDBExtension } from '@gchat/core'
import { ttftMark } from '@/lib/ttft-timing'
import { extractModelErrorMessage } from '@/lib/modelErrorMessage'
import { getSmartContextFailure } from '@/utils/error'
import type { ServiceHub } from '@/services'
import { ensureRemoteProviderReady } from '@/utils/ensureRemoteProviderReady'
import { isLocalProvider as isLocalProviderName } from '@/utils/registerRemoteProvider'
import {
  ginferContextPolicyForModel,
  type GInferContextState,
  type ManualContextCompactionResult,
} from '@/lib/smart-context'

const LOCAL_INFERENCE_PROVIDERS = new Set<string>(['ginfer'])

/// Whether a part may travel to the model as-is.
///
/// `image/*` is the only file part any converter we route to accepts:
/// `@ai-sdk/openai-compatible` (and `@ai-sdk/xai`) throw
/// `UnsupportedFunctionalityError` on everything else, and Anthropic — which
/// does understand `application/pdf` — would receive our `url`, a local
/// filesystem path the SDK cannot resolve, as the document body. Every other
/// attachment kind reaches the model through its own channel: documents as
/// text folded in by `mapUserAttachmentContext` or retrieved by the RAG
/// tools. So a non-image file part is never information — only a way
/// to break the request.
function isModelSupportedPart(part: unknown): boolean {
  const candidate = part as { type?: unknown; mediaType?: unknown }
  if (candidate.type !== 'file') return true
  return (
    typeof candidate.mediaType === 'string' &&
    candidate.mediaType.startsWith('image/')
  )
}

/// Return a copy of `messages` with every non-image `file` part removed.
/// Untouched messages are preserved by reference.
export function stripUnsupportedFileParts(messages: UIMessage[]): UIMessage[] {
  return messages.map((message) => {
    const parts = Array.isArray(message.parts) ? message.parts : []
    if (parts.every(isModelSupportedPart)) return message
    return {
      ...message,
      parts: parts.filter(isModelSupportedPart),
    } as UIMessage
  })
}

export type TokenUsageCallback = (
  usage: LanguageModelUsage,
  messageId: string
) => void
export type StreamingTokenSpeedCallback = (
  tokenCount: number,
  elapsedMs: number
) => void
export type OnFinishCallback = (params: {
  message: UIMessage
  isAbort?: boolean
}) => void
export type OnToolCallCallback = (params: {
  toolCall: { toolCallId: string; toolName: string; input: unknown }
}) => void

export class CustomChatTransport implements ChatTransport<UIMessage> {
  public model: LanguageModel | null = null
  public requestModelId?: string
  private tools: Record<string, Tool> = {}
  private onTokenUsage?: TokenUsageCallback
  private hasDocuments = false
  private modelSupportsTools = false
  private ragFeatureAvailable = false
  private systemMessage?: string
  private serviceHub: ServiceHub | null
  private threadId?: string
  private toolsCacheKey = ''
  private toolsCacheValid = false
  private contextState: GInferContextState = { lastCompaction: null }

  constructor(systemMessage?: string, threadId?: string) {
    this.systemMessage = systemMessage
    this.threadId = threadId
    this.serviceHub = useServiceStore.getState().serviceHub
    // Tools will be loaded when updateRagToolsAvailability is called with model capabilities
  }

  updateSystemMessage(systemMessage: string | undefined) {
    this.systemMessage = systemMessage
  }

  /** Thread this transport is bound to. RAG/project lookups key off it. */
  getThreadId(): string | undefined {
    return this.threadId
  }

  setOnTokenUsage(callback: TokenUsageCallback | undefined) {
    this.onTokenUsage = callback
  }

  /**
   * Update RAG tools availability based on thread metadata and model capabilities
   * @param hasDocuments - Whether the thread has documents attached
   * @param modelSupportsTools - Whether the current model supports tool calling
   * @param ragFeatureAvailable - Whether RAG features are available on the platform
   */
  async updateRagToolsAvailability(
    hasDocuments: boolean,
    modelSupportsTools: boolean,
    ragFeatureAvailable: boolean
  ) {
    this.hasDocuments = hasDocuments
    this.modelSupportsTools = modelSupportsTools
    this.ragFeatureAvailable = ragFeatureAvailable

    // Update tools based on current state
    await this.refreshTools()
  }

  /**
   * Refresh tools based on current state
   * Reloads both RAG and MCP tools and merges them
   * Filters out disabled tools based on thread settings
   * @private
   */
  invalidateToolsCache() {
    this.toolsCacheValid = false
  }

  private buildToolsCacheKey(
    disabledToolKeys: string[],
    hasDocuments: boolean,
    ragFeatureAvailable: boolean,
    modelSupportsTools: boolean
  ): string {
    const mcp = [...useAppState.getState().capabilityToolNames].sort().join(',')
    const rag = [...useAppState.getState().ragToolNames].sort().join(',')
    return [
      this.threadId ?? '',
      hasDocuments,
      ragFeatureAvailable,
      modelSupportsTools,
      disabledToolKeys.join(','),
      mcp,
      rag,
    ].join('|')
  }

  async refreshTools(force = false) {
    if (!this.serviceHub) {
      this.tools = {}
      this.toolsCacheValid = false
      return
    }

    const getDisabledToolsForThread =
      useToolAvailable.getState().getDisabledToolsForThread
    const disabledToolKeys = this.threadId
      ? getDisabledToolsForThread(this.threadId)
      : useToolAvailable.getState().getDefaultDisabledTools()

    const selectedModel = useModelProvider.getState().selectedModel
    const modelSupportsTools =
      selectedModel?.capabilities?.includes('tools') ?? this.modelSupportsTools

    let hasDocuments = this.hasDocuments
    let ragFeatureAvailable = this.ragFeatureAvailable

    if (!hasDocuments && this.threadId) {
      const thread = useThreads.getState().threads[this.threadId]
      hasDocuments = Boolean(thread?.metadata?.hasDocuments)
    }
    if (!ragFeatureAvailable) {
      ragFeatureAvailable = Boolean(useAttachments.getState().enabled)
    }

    const cacheKey = this.buildToolsCacheKey(
      disabledToolKeys,
      hasDocuments,
      ragFeatureAvailable,
      modelSupportsTools
    )
    if (!force && this.toolsCacheValid && cacheKey === this.toolsCacheKey) {
      return
    }

    let ragTools: MCPTool[] = []
    let capabilityTools: MCPTool[] = []

    if (modelSupportsTools) {
      if (!hasDocuments && this.threadId) {
        const thread = useThreads.getState().threads[this.threadId]
        const hasThreadDocuments = Boolean(thread?.metadata?.hasDocuments)

        const projectId = thread?.metadata?.project?.id
        if (projectId) {
          try {
            const ext = ExtensionManager.getInstance().get<VectorDBExtension>(
              ExtensionTypeEnum.VectorDB
            )
            if (ext?.listAttachmentsForProject) {
              const projectFiles =
                await ext.listAttachmentsForProject(projectId)
              hasDocuments = hasThreadDocuments || projectFiles.length > 0
            }
          } catch (error) {
            console.warn('Failed to check project files:', error)
            hasDocuments = hasThreadDocuments
          }
        } else {
          hasDocuments = hasThreadDocuments
        }
      }

      if (!ragFeatureAvailable) {
        ragFeatureAvailable = Boolean(useAttachments.getState().enabled)
      }

      // Load RAG tools if documents are available
      if (hasDocuments && ragFeatureAvailable) {
        try {
          const availableRagTools = await this.serviceHub.rag().getTools()
          if (Array.isArray(availableRagTools)) {
            ragTools = availableRagTools as MCPTool[]
          }
        } catch (error) {
          console.warn('Failed to load RAG tools:', error)
        }
      }

      // Reuse the catalog refreshed on capability changes.
      try {
        const availableMcpTools = useAppState.getState().tools
        if (Array.isArray(availableMcpTools)) {
          capabilityTools = availableMcpTools
        }
      } catch (error) {
        console.warn('Failed to load MCP tools:', error)
      }
    }

    const controlNames = new Set([
      'skill_list', 'skill_view', 'skill_invoke', 'agent_list', 'agent_run', 'agent_monitor', 'agent_cancel',
    ])
    this.tools = {
      ...buildToolsRecord(ragTools, capabilityTools.filter((tool) => controlNames.has(tool.name)), disabledToolKeys),
      ...buildCapabilityDiscoveryTools(),
    }
    this.toolsCacheKey = cacheKey
    this.toolsCacheValid = true
  }

  /**
   * Get current tools
   */
  getTools(): Record<string, Tool> {
    return this.tools
  }

  /**
   * Run the normal GInfer request serializer far enough to create or extend
   * the thread checkpoint. The local fetch adapter replaces the final answer
   * with an empty synthetic stream, so `/compact` never becomes a chat turn.
   */
  async compactContext(
    chatId: string,
    messages: UIMessage[]
  ): Promise<ManualContextCompactionResult> {
    if (!messages.length) return { status: 'nothing_to_compact' }
    if (!['ginfer', 'ginfer-lan'].includes(useModelProvider.getState().selectedProvider)) {
      throw new Error('/compact is available only for a loaded GInfer model.')
    }
    const modelId = useModelProvider.getState().selectedModel?.id
    const providerId = useModelProvider.getState().selectedProvider
    if (modelId && useAppState.getState().intentionallyStoppedModels.has(`${providerId}::${modelId}`)) {
      throw new Error('Start the selected model before compacting context.')
    }
    if (this.contextState.manualCompactionRequested) {
      throw new Error('Context compaction is already running.')
    }

    this.contextState.manualCompactionRequested = true
    this.contextState.manualCompactionResult = null
    try {
      const stream = await this.sendMessages({
        chatId,
        messages,
        abortSignal: undefined,
        trigger: 'regenerate-message',
        messageId: undefined,
      })
      const reader = stream.getReader()
      while (!(await reader.read()).done) {
        // Drain the synthetic response so the AI SDK completes its request.
      }
      const result = this.contextState.manualCompactionResult
      if (!result) {
        throw new Error('GChat did not receive a context compaction result.')
      }
      return result
    } finally {
      this.contextState.manualCompactionRequested = false
    }
  }

  async sendMessages(
    options: {
      chatId: string
      messages: UIMessage[]
      abortSignal: AbortSignal | undefined
    } & {
      trigger: 'submit-message' | 'regenerate-message'
      messageId: string | undefined
    } & ChatRequestOptions
  ): Promise<ReadableStream<UIMessageChunk>> {
    const requestStartedAt = Date.now()
    this.contextState.lastCompaction = null
    ttftMark('gammaStart')
    await this.refreshTools()
    ttftMark('gammaEnd')

    // Keep the request's provider fixed if selection changes mid-stream.
    const modelId = useModelProvider.getState().selectedModel?.id
    const providerId = useModelProvider.getState().selectedProvider
    const effectiveProviderName = providerId
    const provider = useModelProvider.getState().getProviderByName(providerId)
    this.requestModelId = providerId === 'ginfer' || providerId === 'ginfer-lan' ? modelId : undefined
    if (this.serviceHub && modelId && provider) {
      try {
        const updatedProvider = useModelProvider
          .getState()
          .getProviderByName(providerId)

        // Apply model recommendations while preserving thread sampling overrides.
        const sampling = getSamplingParamsForThread(this.threadId)
        const inferenceParams = withServerSampling(
          providerId,
          withRecommendedSampling(modelId, sampling.params, sampling.overridden),
          sampling.overridden
        )

        // Keep provider reasoning flags separate from local sampling fields.
        const { disableReasoning, reasoningBudget } =
          useGeneralSetting.getState()
        const reasoningOverride: Record<string, unknown> = {}
        if (disableReasoning || reasoningBudget === 'off') {
          switch (effectiveProviderName) {
            case 'ginfer':
              // Direct responses use `none`; enable_thinking would contradict it.
              reasoningOverride.reasoning_effort = 'none'
              break
            case 'anthropic':
              reasoningOverride.thinking = { type: 'disabled' }
              break
            case 'openai':
              reasoningOverride.reasoning_effort = 'minimal'
              break
            case 'xai':
              reasoningOverride.reasoning_effort = 'low'
              break
            case 'google':
            case 'gemini':
              reasoningOverride.reasoning_effort = 'minimal'
              reasoningOverride.extra_body = {
                google: { thinking_config: { thinking_budget: 0 } },
              }
              break
            case 'moonshot':
              // Moonshot rejects `minimal`; use its lowest supported effort.
              reasoningOverride.reasoning_effort = 'low'
              break
            default:
              // Custom providers get a template hint, avoiding unsupported effort values.
              reasoningOverride.chat_template_kwargs = {
                enable_thinking: false,
              }
          }
        } else if (effectiveProviderName === 'ginfer') {
          // ginfer maps OpenAI-compatible `reasoning_effort` onto its
          // artifact's effort template, not a fixed token budget.
          const effortByBudget: Partial<Record<typeof reasoningBudget, string>> =
            {
              low: 'low',
              medium: 'medium',
              high: 'high',
              xhigh: 'xhigh',
            }
          const effort = effortByBudget[reasoningBudget]
          if (effort) reasoningOverride.reasoning_effort = effort
        }
        const effectiveReasoningOverride = reasoningOverride
        const hasOverride = Object.keys(effectiveReasoningOverride).length > 0

        ttftMark('deltaStart')
        const effectiveProvider = updatedProvider ?? provider
        if (effectiveProviderName === 'ginfer-lan' && this.contextState.manualCompactionRequested) {
          if (!(await this.serviceHub.app().getServerStatus())) {
            throw new Error('Start the local API facade before compacting paired-host context.')
          }
        } else if (!isLocalProviderName(effectiveProvider.provider)) {
          await ensureRemoteProviderReady(effectiveProvider, this.serviceHub)
        }
        const contextPolicy = effectiveProviderName === 'ginfer' || effectiveProviderName === 'ginfer-lan'
          ? ginferContextPolicyForModel(
              this.threadId ?? options.chatId, modelId,
              updatedProvider?.models, provider.models, this.contextState
            )
          : undefined
        if (contextPolicy && effectiveProviderName === 'ginfer-lan') {
          const instance = (await listAgentModelInstances()).find((candidate) => candidate.id === modelId)
          if (!instance || typeof instance.maxContext !== 'number' || !Number.isInteger(instance.maxContext) || instance.maxContext <= 0) {
            throw new Error('The paired GInfer instance is unavailable or did not report its loaded context capacity.')
          }
          contextPolicy.configuredContextTokens = instance.maxContext
        } else if (contextPolicy) {
          const engine = EngineManager.instance().get('ginfer') as
            | { getLoadedContext?: (id: string) => Promise<number | undefined> }
            | undefined
          const loadedContext = await engine?.getLoadedContext?.(modelId)
          if (loadedContext && Number.isInteger(loadedContext) && loadedContext > 0) {
            contextPolicy.configuredContextTokens = loadedContext
          }
        }
        this.model = await ModelFactory.createModel(
          modelId,
          effectiveProvider,
          inferenceParams ?? {},
          hasOverride ? effectiveReasoningOverride : undefined,
          contextPolicy
            ? {
                ...contextPolicy,
                onUsage: (usage) => useContextUsage.getState().record(
                  this.threadId ?? options.chatId,
                  { ...usage, modelId, outputTokens: 0 }
                ),
              }
            : undefined
        )
        ttftMark('deltaEnd')
      } catch (error) {
        console.error('Failed to create model:', error)
        throw new Error(
          `Failed to create model: ${extractModelErrorMessage(error)}`
        )
      }
    } else {
      throw new Error('ServiceHub not initialized or model/provider missing.')
    }

    // Split serial tool calls to preserve Anthropic tool_use/tool_result pairing.
    const messagesToConvert =
      effectiveProviderName === 'anthropic'
        ? splitAnthropicSerialToolUse(options.messages)
        : options.messages

    // Fold document text into messages before removing unsupported file parts.
    let preparedMessages = stripUnsupportedFileParts(
      this.mapUserAttachmentContext(messagesToConvert)
    )
    // Keep tool-image base64 out of text context; Vision receives image parts.
    if (LOCAL_INFERENCE_PROVIDERS.has(effectiveProviderName)) {
      const supportsVision =
        useModelProvider
          .getState()
          .selectedModel?.capabilities?.includes('vision') ?? false
      preparedMessages = prepareToolResultImagesForModel(preparedMessages, {
        supportsVision,
      })
    }
    const baseMessages = convertToModelMessages(preparedMessages)

    const modelMessages = baseMessages

    const hasTools = Object.keys(this.tools).length > 0
    const selectedModel = useModelProvider.getState().selectedModel
    const modelSupportsTools =
      selectedModel?.capabilities?.includes('tools') ?? this.modelSupportsTools
    const shouldEnableTools = hasTools && modelSupportsTools

    const memory = supportsGChatMemory(effectiveProviderName)
      ? await chatMemoryContext(options.messages, this.threadId)
      : ''
    const policy = useConversationPolicy.getState()
    const conversationId = this.threadId ?? options.chatId
    const selectedSkill = policy.activeSkills[conversationId]
    const selectedDefinition = policy.activeDefinitions[conversationId]
    const explicitInvocation = options.messages.at(-1)?.role === 'user'
    const invocationTool = explicitInvocation ? selectedSkill ? 'skill_invoke' : selectedDefinition ? 'agent_run' : undefined : undefined
    if (invocationTool && (!shouldEnableTools || !this.tools[invocationTool])) {
      throw new Error(`Enable ${invocationTool} and choose a model with tool support to use the selected capability.`)
    }
    const workspace = policy.getWorkspace(conversationId)
    const attachedDocuments = (options.messages.findLast((message) => message.role === 'user')?.metadata as
      { file_attachments?: Array<{ name?: string; path?: string; native_reference?: boolean }> } | undefined)?.file_attachments?.filter((file) => file.native_reference)
    const capabilityGuidance = shouldEnableTools
      ? [
          this.tools.gchat_capability_search && 'Discover native and connected tools with gchat_capability_search, read an exact schema with gchat_capability_read, then invoke that exact name with gchat_capability_call. Disabled tools remain unavailable. Calls use this conversation’s permissions, approvals, folders, and cancellation.',
          this.tools.skill_list && 'GChat skills are available through skill_list. Read instructions with skill_view and apply a skill using skill_invoke.',
          this.tools.agent_list && 'Discover saved agents and worker pools with agent_list; dispatch them using agent_run.',
          attachedDocuments?.length && `Attached local documents: ${JSON.stringify(attachedDocuments.map(({name, path}) => ({name, path})))}. Read their content through capability discovery when needed; these references have not been indexed for retrieval.`,
          workspace.primaryRoot && `Conversation workspace: ${JSON.stringify(workspace.primaryRoot.path)}.`,
          workspace.externalRoots.length > 0 && `Connected folders: ${JSON.stringify(workspace.externalRoots.map(({path, canEdit}) => ({path, canEdit})))}.`,
          invocationTool === 'skill_invoke' && `Apply the selected skill ${JSON.stringify(selectedSkill)} to the current user request using skill_invoke.`,
          invocationTool === 'agent_run' && `Invoke saved agent ${JSON.stringify(selectedDefinition)} for the current request using agent_run.`,
        ].filter(Boolean).join('\n')
      : ''
    const systemMessage = [this.systemMessage, memory, capabilityGuidance].filter(Boolean).join('\n\n') || undefined
    const requestTools = invocationTool
      ? { ...this.tools, [invocationTool]: {
          ...this.tools[invocationTool],
          inputSchema: jsonSchema({
            type: 'object',
            properties: invocationTool === 'skill_invoke'
              ? { name: { type: 'string', enum: [selectedSkill] }, task: { type: 'string' } }
              : { definitionId: { type: 'string', enum: [selectedDefinition] }, task: { type: 'string' } },
            required: [invocationTool === 'skill_invoke' ? 'name' : 'definitionId', 'task'], additionalProperties: false,
          }),
        } }
      : this.tools

    // Measure fallback decode speed from the first generated delta, excluding prefill.
    let streamStartTime: number | undefined

    const maxOutputTokens = getSamplingParamsForThread(this.threadId).params
      ?.max_output_tokens as number | undefined

    const result = streamText({
      model: this.model,
      messages: modelMessages,
      abortSignal: options.abortSignal,
      tools: shouldEnableTools ? requestTools : undefined,
      toolChoice: invocationTool ? { type: 'tool', toolName: invocationTool } : shouldEnableTools ? 'auto' : undefined,
      system: systemMessage,
      maxOutputTokens,
      experimental_transform: stripSpecialTokensTransform,
      experimental_repairToolCall: async ({ toolCall, error }) => {
        if (NoSuchToolError.isInstance(error)) return null
        const repaired = repairToolCallArguments(toolCall.input)
        if (repaired === null) return null
        return { ...toolCall, input: repaired }
      },
    })

    let tokensPerSecond = 0
    let draftTokensTotal: number | null = null
    let draftTokensAccepted: number | null = null
    let ginferFinishReason: string | null = null

    const uiStream = result.toUIMessageStream({
      messageMetadata: ({ part }) => {
        if (
          !streamStartTime &&
          (part.type === 'text-delta' || part.type === 'reasoning-delta')
        ) {
          streamStartTime = Date.now()
        }

        if (part.type === 'finish-step') {
          const pm = part.providerMetadata?.providerMetadata as
            | Record<string, unknown>
            | undefined
          tokensPerSecond = (pm?.tokensPerSecond as number) || 0
          draftTokensTotal = (pm?.draftTokensTotal as number) ?? null
          draftTokensAccepted = (pm?.draftTokensAccepted as number) ?? null
          ginferFinishReason =
            (pm?.ginferFinishReason as string | undefined) ?? null
        }

        if (part.type === 'finish') {
          const finishPart = part as {
            type: 'finish'
            totalUsage: LanguageModelUsage
            finishReason: string
          }
          const usage = finishPart.totalUsage
          const durationMs = streamStartTime ? Date.now() - streamStartTime : 0
          const durationSec = durationMs / 1000

          const outputTokens = usage?.outputTokens ?? 0
          const inputTokens = usage?.inputTokens
          const contextThreadId = this.threadId ?? options.chatId
          const counted = useContextUsage.getState().requests[contextThreadId]
          const contextUsage = providerId === 'ginfer' && counted?.modelId === modelId
            ? { ...counted, outputTokens }
            : undefined
          if (contextUsage) {
            useContextUsage.getState().record(contextThreadId, contextUsage)
          }

          // Prefer provider decode speed; estimate only when timed output tokens exist.
          let tokenSpeed: number
          if (tokensPerSecond > 0) {
            tokenSpeed = tokensPerSecond
          } else if (
            streamStartTime !== undefined &&
            durationSec > 0 &&
            outputTokens > 0
          ) {
            tokenSpeed = outputTokens / durationSec
          } else {
            tokenSpeed = 0
          }

          return {
            finishReason: finishPart.finishReason,
            ginferFinishReason,
            activityDurationMs: Math.max(0, Date.now() - requestStartedAt),
            // TTFT spans request start to the first text or reasoning delta.
            ttftMs: streamStartTime
              ? Math.max(0, streamStartTime - requestStartedAt)
              : null,
            modelId,
            providerId,
            ...(contextUsage ? { contextUsage } : {}),
            usage: {
              inputTokens: inputTokens,
              outputTokens: outputTokens,
              totalTokens:
                usage?.totalTokens ?? (inputTokens ?? 0) + outputTokens,
            },
            tokenSpeed: {
              tokenSpeed: Math.round(tokenSpeed * 10) / 10, // Round to 1 decimal
              tokenCount: outputTokens,
              durationMs,
              ...(draftTokensTotal != null && draftTokensTotal > 0
                ? {
                    draftTokensTotal,
                    draftTokensAccepted: draftTokensAccepted ?? 0,
                  }
                : {}),
            },
            ...(this.contextState.lastCompaction
              ? { contextCompaction: this.contextState.lastCompaction }
              : {}),
          }
        }

        return undefined
      },
      onError: (error) => {
        const contextFailure = getSmartContextFailure(error)
        if (contextFailure) return JSON.stringify({ error: contextFailure })
        const errorMessage =
          error == null
            ? 'Unknown error'
            : typeof error === 'string'
              ? error
              : error instanceof Error
                ? error.message
                : JSON.stringify(error)

        return errorMessage
      },
      onFinish: ({ responseMessage }) => {
        if (responseMessage) {
          const metadata = responseMessage.metadata as
            | Record<string, unknown>
            | undefined
          const usage = metadata?.usage as LanguageModelUsage | undefined
          if (usage) {
            this.onTokenUsage?.(usage, responseMessage.id)
          }
        }
      },
    })

    return uiStream
  }

  async reconnectToStream(
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _options: {
      chatId: string
    } & ChatRequestOptions
  ): Promise<ReadableStream<UIMessageChunk> | null> {
    // Transport-owned streams have no resumable endpoint.
    return null
  }

  /**
   *  Map user messages to include inline attachments in the message parts
   * @param messages
   * @returns
   */
  mapUserAttachmentContext(messages: UIMessage[]): UIMessage[] {
    return messages.map((message) => {
      if (message.role !== 'user') return message
      const metadata = message.metadata as {
        inline_file_contents?: Array<{ name?: string; content?: string }>
        file_attachments?: Array<{ name?: string; path?: string; native_reference?: boolean }>
      } | undefined
      const inlineContents = (metadata?.inline_file_contents ?? [])
        .filter((file) => file.content)
        .map((file) => `File: ${file.name || 'attachment'}\n${file.content}`)
      const references = (metadata?.file_attachments ?? [])
        .filter((file) => file.native_reference && file.path)
        .map(({ name, path }) => ({ name, path }))
      const blocks = [...inlineContents, ...(references.length
        ? [`Attached local document references: ${JSON.stringify(references)}`] : [])]
      if (!blocks.length) return message
      const context = blocks.join('\n\n')
      const parts = [...message.parts]
      const lastTextIndex = parts.findLastIndex((part) => part.type === 'text')
      const lastText = parts[lastTextIndex]
      if (lastText?.type === 'text') {
        parts[lastTextIndex] = { type: 'text', text: lastText.text ? `${lastText.text}\n\n${context}` : context }
      } else {
        parts.push({ type: 'text', text: context })
      }
      return { ...message, parts }
    })
  }
}

/**
 * Default Models Service - Web implementation
 */

import { sanitizeModelId, LOCAL_GINFER_PROVIDER } from '@/lib/utils'
import {
  AIEngine,
  EngineManager,
  SessionInfo,
  SettingComponentProps,
  modelInfo,
  ThreadMessage,
  ContentType,
  events,
  DownloadEvent,
  UnloadResult,
} from '@gchat/core'
import { Model as CoreModel } from '@gchat/core'
import type {
  ModelsService,
  ModelCatalog,
  HuggingFaceRepo,
  CatalogModel,
  ModelValidationResult,
} from './types'
import { getCatalogOrFallback } from '@/services/model-catalog-registry'
import { useDownloadStore } from '@/hooks/useDownloadStore'

// The only local inference provider id. Resolving this through
// LOCAL_GINFER_PROVIDER keeps `getEngine()` calls provider-agnostic.
const defaultProvider = LOCAL_GINFER_PROVIDER
const localProviders = ['ginfer'] as const
type LocalProviderName = (typeof localProviders)[number]

export class DefaultModelsService implements ModelsService {
  private getEngine(provider: string = defaultProvider) {
    return EngineManager.instance().get(provider) as AIEngine | undefined
  }

  private async getLocalActiveModelsByProvider(): Promise<
    { provider: LocalProviderName; models: string[] }[]
  > {
    const results = await Promise.all(
      localProviders.map(async (provider) => ({
        provider,
        models: (await this.getEngine(provider)?.getLoadedModels()) ?? [],
      }))
    )

    return results.filter(
      ({ models }) => Array.isArray(models) && models.length > 0
    )
  }

  private getHuggingFaceHeaders(hfToken?: string): HeadersInit | undefined {
    return hfToken
      ? {
          Authorization: `Bearer ${hfToken}`,
        }
      : undefined
  }

  private async fetchExactHuggingFaceRepo(
    cleanRepoId: string,
    hfToken?: string
  ): Promise<HuggingFaceRepo | null> {
    const response = await fetch(
      `https://huggingface.co/api/models/${cleanRepoId}?blobs=true&files_metadata=true`,
      {
        headers: this.getHuggingFaceHeaders(hfToken),
      }
    )

    if (!response.ok) {
      if (response.status === 404) {
        return null
      }

      throw new Error(
        `Failed to fetch HuggingFace repository: ${response.status} ${response.statusText}`
      )
    }

    return response.json()
  }

  async getModel(modelId: string): Promise<modelInfo | undefined> {
    return this.getEngine()?.get(modelId)
  }

  async fetchModels(): Promise<modelInfo[]> {
    return this.getEngine()?.list() ?? []
  }

  async fetchModelCatalog(): Promise<ModelCatalog> {
    // Primary source: the GChat curated catalog (`atomic-chat-model-catalog`
    // GitHub Releases) loaded via the registry abstraction so the same
    // localStorage cache + baseline fallback machinery is shared with
    // `useModelCatalogStore`. The loader never throws — on hard failure it
    // returns the bundled baseline so callers always get *something*.
    try {
      const result = await getCatalogOrFallback()
      return result.manifest.models
    } catch (error) {
      // Defensive only. `getCatalogOrFallback` already catches network /
      // schema errors and returns a baseline result.
      console.error('Unexpected fetchModelCatalog failure:', error)
      throw new Error(
        `Failed to fetch model catalog: ${error instanceof Error ? error.message : 'Unknown error'}`
      )
    }
  }

  async fetchHuggingFaceRepo(
    repoId: string,
    hfToken?: string
  ): Promise<HuggingFaceRepo | null> {
    try {
      // Clean the repo ID to handle various input formats
      const cleanRepoId = repoId
        .replace(/^https?:\/\/huggingface\.co\//, '')
        .replace(/^huggingface\.co\//, '')
        .replace(/\/$/, '') // Remove trailing slash
        .trim()

      if (!cleanRepoId) {
        return null
      }

      if (cleanRepoId.includes('/')) {
        return await this.fetchExactHuggingFaceRepo(cleanRepoId, hfToken)
      }

      return null
    } catch (error) {
      console.error('Error fetching HuggingFace repository:', error)
      return null
    }
  }
  convertHfRepoToCatalogModel(repo: HuggingFaceRepo): CatalogModel {
    const quants = (repo.siblings ?? []).filter(file => file.rfilename.toLowerCase().endsWith('.ginfer')).map(file => ({
      model_id: sanitizeModelId(file.rfilename.replace(/\.ginfer$/i, '')),
      path: 'https://huggingface.co/' + repo.modelId + '/resolve/main/' + file.rfilename,
      file_size: file.size ? (file.size / 1024 ** 3).toFixed(1) + ' GB' : 'Unknown size',
      sha256: file.lfs?.sha256,
    }));
    return {
      model_name: repo.modelId, developer: repo.author, downloads: repo.downloads ?? 0,
      likes: repo.likes ?? 0, created_at: repo.createdAt, last_modified: repo.last_modified,
      num_quants: quants.length, quants, num_mmproj: 0, mmproj_models: [],
      readme: 'https://huggingface.co/' + repo.modelId + '/resolve/main/README.md',
      description: '**Tags**: ' + (repo.tags ?? []).join(', '),
    }
  }

  async updateModel(modelId: string, model: Partial<CoreModel>): Promise<void> {
    if (model.settings) {
      this.getEngine()?.updateSettings(
        model.settings as SettingComponentProps[]
      )
    }
    // Note: Model name/ID updates are handled at the provider level in the frontend
    // The engine doesn't have an update method for model metadata
    console.log('Model update request processed for modelId:', modelId)
  }

  async pullModel(
    id: string,
    modelPath: string,
    modelSha256?: string,
    modelSize?: number,
    resume: boolean = false,
    provider?: string
  ): Promise<void> {
    return this.getEngine(provider)?.import(id, {
      modelPath,
      modelSha256,
      modelSize,
      resume,
    })
  }

  async pullModelWithMetadata(
    id: string,
    modelPath: string,
    hfToken?: string,
    skipVerification: boolean = true,
    resume: boolean = false,
    provider?: string
  ): Promise<void> {
    let modelSha256: string | undefined
    let modelSize: number | undefined

    // Extract repo ID from model URL
    // URL format: https://huggingface.co/{repo}/resolve/main/{filename}
    const modelUrlMatch = modelPath.match(
      /https:\/\/huggingface\.co\/([^/]+\/[^/]+)\/resolve\/main\/(.+)/
    )

    if (modelUrlMatch && !skipVerification) {
      const [, repoId, modelFilename] = modelUrlMatch

      try {
        // Fetch real-time metadata from HuggingFace
        const repoInfo = await this.fetchHuggingFaceRepo(repoId, hfToken)

        if (repoInfo?.siblings) {
          // Find the specific model file
          const modelFile = repoInfo.siblings.find(
            (file) => file.rfilename === modelFilename
          )
          if (modelFile?.lfs) {
            modelSha256 = modelFile.lfs.sha256
            modelSize = modelFile.lfs.size
          }
        }
      } catch (error) {
        console.warn(
          'Failed to fetch HuggingFace metadata, proceeding without hash verification:',
          error
        )
        // Continue with download even if metadata fetch fails
      }
    }

    // ATO-154: record resume parameters at the single GGUF download-start
    // choke point so the global Download popover can resume a paused download
    // (it only knows the model id, not these HF paths/token). MLX downloads go
    // through `engine.import` directly and are pause/resume-gated out.
    useDownloadStore.getState().setResumeParams(id, {
      modelPath,
      hfToken,
      skipVerification,
      provider,
    })

    // Call the original pullModel with the fetched metadata
    try {
      return await this.pullModel(id, modelPath, modelSha256, modelSize, resume, provider)
    } catch (error) {
      // ATO-154: a paused download stops the underlying transfer (which rejects
      // this promise with a cancellation error). Swallow it so the initiator's
      // catch doesn't fire a spurious "download failed" toast or clean up the
      // row — the download-stopped listener keeps the paused entry alive and
      // the popover shows a Resume button instead.
      if (useDownloadStore.getState().pausedDownloads.has(id)) {
        return
      }
      // Emit download error event so the UI can clean up the stale downloading state
      events.emit(DownloadEvent.onFileDownloadError, {
        modelId: id,
        downloadType: 'Model',
        error: error instanceof Error ? error.message : String(error),
      })
      throw error
    }
  }

  async abortDownload(id: string): Promise<void> {
    const ginferEngine = this.getEngine('ginfer')
    try {
      await Promise.allSettled(
        [ginferEngine?.abortImport(id)].filter(Boolean)
      )
    } finally {
      events.emit(DownloadEvent.onFileDownloadStopped, {
        modelId: id,
        downloadType: 'Model',
      })
    }
  }

  async deleteModel(id: string, provider?: string): Promise<void> {
    const engine = this.getEngine(provider)
    // `getEngine()?.delete()` used to resolve to `undefined` when the provider
    // had no engine registered, so the caller reported a successful delete and
    // the weights stayed on disk. Fail loudly instead — same reasoning as the
    // `LOCAL_GINFER_PROVIDER` note above.
    if (!engine) {
      throw new Error(
        `No engine registered for provider "${provider ?? defaultProvider}"`
      )
    }
    const loadedModels = await engine.getLoadedModels()
    if (!Array.isArray(loadedModels)) throw new Error('Cannot confirm which models are loaded; files were not removed.')
    if (loadedModels.includes(id)) {
      throw new Error('Stop this model before deleting its files. Active chats and agent runs are not interrupted automatically.')
    }
    return engine.delete(id)
  }

  async getActiveModels(provider?: string): Promise<string[]> {
    if (provider) {
      const scoped = (await this.getEngine(provider)?.getLoadedModels()) ?? []
      return scoped
    }

    const activeByProvider = await this.getLocalActiveModelsByProvider()
    const union = [...new Set(activeByProvider.flatMap(({ models }) => models))]
    return union
  }

  async stopModel(
    model: string,
    provider?: string
  ): Promise<UnloadResult | undefined> {
    if (provider) {
      const { ModelFactory } = await import('@/lib/model-factory')
      ModelFactory.invalidateLocalSessionCache(provider, model)
      return this.getEngine(provider)?.unload(model)
    }

    const activeByProvider = await this.getLocalActiveModelsByProvider()
    const matchingProviders = activeByProvider.filter(({ models }) =>
      models.includes(model)
    )

    if (matchingProviders.length === 0) {
      return undefined
    }

    const { ModelFactory } = await import('@/lib/model-factory')
    for (const { provider: providerName } of matchingProviders) {
      ModelFactory.invalidateLocalSessionCache(providerName, model)
    }

    const results = await Promise.allSettled(
      matchingProviders.map(({ provider: providerName }) =>
        this.getEngine(providerName)?.unload(model)
      )
    )
    const failures = results.filter(
      (result): result is PromiseRejectedResult => result.status === 'rejected'
    )

    if (failures.length > 0) {
      return {
        success: false,
        error: failures
          .map((result) =>
            result.reason instanceof Error
              ? result.reason.message
              : String(result.reason)
          )
          .join('\n'),
      }
    }

    return results.find(
      (result): result is PromiseFulfilledResult<UnloadResult | undefined> =>
        result.status === 'fulfilled' && result.value !== undefined
    )?.value
  }

  async stopAllModels(): Promise<void> {
    const activeByProvider = await this.getLocalActiveModelsByProvider()
    const results = await Promise.all(
      activeByProvider.flatMap(({ provider, models }) =>
        models.map((model) => this.stopModel(model, provider))
      )
    )
    const failures = results.filter(
      (result): result is UnloadResult => result != null && !result.success
    )
    if (failures.length > 0) {
      throw new Error(
        failures
          .map((result) => result.error || 'A GInfer model did not stop')
          .join('\n')
      )
    }
  }

  async startModel(
    provider: ProviderObject,
    model: string,
    bypassAutoUnload: boolean = false
  ): Promise<SessionInfo | undefined> {
    const engine = this.getEngine(provider.provider)
    if (!engine) return undefined

    const loadedModels = await engine.getLoadedModels()
    if (loadedModels.includes(model)) return undefined

    const modelConfig = provider.models.find((m) => m.id === model)

    // GInfer owns a startup-fixed logical context limit and has no partial
    // CPU/GPU offload path. Do not translate its settings through the retired
    // llama.cpp contract.
    if (provider.provider === 'ginfer') {
      const contextProps =
        modelConfig?.settings?.ctx_len?.controller_props?.value
      const configuredContext = Number(contextProps)
      const declaredMaximum = Number(
        (
          modelConfig?.settings?.ctx_len?.controller_props as
            | (ControllerProps & { max?: number })
            | undefined
        )?.max
      )
      const maxContext =
        Number.isFinite(configuredContext) && configuredContext > 0
          ? configuredContext
          : declaredMaximum
      const settings =
        Number.isFinite(maxContext) && maxContext > 0
          ? { max_context: maxContext }
          : undefined

      return engine
        .load(model, settings, false, bypassAutoUnload)
        .catch((error) => {
          console.error(
            `Failed to start model ${model} for provider ${provider.provider}:`,
            error
          )
          throw error
        })
    }

    // Key mapping function to transform setting keys for non-GInfer engines.
    const mapSettingKey = (key: string): string => {
      const keyMappings: Record<string, string> = {
        ctx_len: 'ctx_size',
        ngl: 'n_gpu_layers',
      }
      return keyMappings[key] || key
    }

    const settings = modelConfig?.settings
      ? Object.fromEntries(
          Object.entries(modelConfig.settings).map(([key, value]) => [
            mapSettingKey(key),
            value.controller_props?.value,
          ])
        )
      : undefined

    return engine
      .load(model, settings, false, bypassAutoUnload)
      .catch((error) => {
        console.error(
          `Failed to start model ${model} for provider ${provider.provider}:`,
          error
        )
        throw error
      })
  }

  async isToolSupported(modelId: string): Promise<boolean> {
    const engine = this.getEngine()
    if (!engine) return false

    return engine.isToolSupported(modelId)
  }

  async checkMmprojExistsAndUpdateOffloadMMprojSetting(
    modelId: string
  ): Promise<{ exists: boolean; settingsUpdated: boolean }> {
    try {
      const exists = await this.checkMmprojExists(modelId)
      return { exists, settingsUpdated: false }
    } catch (error) {
      console.error(`Error checking mmproj for model ${modelId}:`, error)
    }
    return { exists: false, settingsUpdated: false }
  }

  async checkMmprojExists(modelId: string): Promise<boolean> {
    try {
      const engine = this.getEngine(LOCAL_GINFER_PROVIDER) as AIEngine & {
        checkMmprojExists?: (id: string) => Promise<boolean>
      }
      if (engine && typeof engine.checkMmprojExists === 'function') {
        return await engine.checkMmprojExists(modelId)
      }
    } catch (error) {
      console.error(`Error checking mmproj for model ${modelId}:`, error)
    }
    return false
  }

  private static modelSupportCache = new Map<
    string,
    { status: 'RED' | 'YELLOW' | 'GREEN' | 'GREY'; at: number }
  >()
  private static readonly MODEL_SUPPORT_CACHE_TTL_MS = 5 * 60 * 1000

  static invalidateModelSupportCache(): void {
    DefaultModelsService.modelSupportCache.clear()
  }

  async isModelSupported(
    modelPath: string,
    ctxSize?: number
  ): Promise<'RED' | 'YELLOW' | 'GREEN' | 'GREY'> {
    const cacheKey = `${modelPath}::${ctxSize ?? 'default'}`
    const cached = DefaultModelsService.modelSupportCache.get(cacheKey)
    const now = Date.now()
    if (
      cached &&
      now - cached.at < DefaultModelsService.MODEL_SUPPORT_CACHE_TTL_MS
    ) {
      return cached.status
    }

    try {
      const engine = this.getEngine(LOCAL_GINFER_PROVIDER) as AIEngine & {
        isModelSupported?: (
          path: string,
          ctx_size?: number
        ) => Promise<'RED' | 'YELLOW' | 'GREEN'>
      }
      if (engine && typeof engine.isModelSupported === 'function') {
        const status = await engine.isModelSupported(modelPath, ctxSize)
        DefaultModelsService.modelSupportCache.set(cacheKey, {
          status,
          at: now,
        })
        return status
      }
      // Fallback if method is not available
      console.warn('isModelSupported method not available in local engine')
      return 'YELLOW' // Conservative fallback
    } catch (error) {
      console.error(`Error checking model support for ${modelPath}:`, error)
      return 'GREY' // Error state, assume not supported
    }
  }

  async validateGgufFile(filePath: string): Promise<ModelValidationResult> {
    try {
      const engine = this.getEngine(LOCAL_GINFER_PROVIDER) as AIEngine & {
        validateGgufFile?: (path: string) => Promise<ModelValidationResult>
      }

      if (engine && typeof engine.validateGgufFile === 'function') {
        return await engine.validateGgufFile(filePath)
      }

      // If the specific method isn't available, we can fallback to a basic check
      console.warn('validateGgufFile method not available in local engine')
      return {
        isValid: true, // Assume valid for now
        error: 'Validation method not available',
      }
    } catch (error) {
      console.error(`Error validating GGUF file ${filePath}:`, error)
      return {
        isValid: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      }
    }
  }

  async getTokensCount(
    modelId: string,
    messages: ThreadMessage[]
  ): Promise<number> {
    try {
      // Resolve the engine that currently holds the active session for this
      // model rather than assuming the default provider.
      const activeByProvider = await this.getLocalActiveModelsByProvider()
      const ownerProvider = activeByProvider.find((p) =>
        p.models.includes(modelId)
      )
      const engineId = ownerProvider?.provider ?? LOCAL_GINFER_PROVIDER
      const engine = this.getEngine(engineId)
      const typedEngine = engine as AIEngine & {
        getTokensCount?: (opts: {
          model: string
          messages: Array<{
            role: string
            content:
              | string
              | Array<{
                  type: string
                  text?: string
                  image_url?: {
                    detail?: string
                    url?: string
                  }
                }>
          }>
          chat_template_kwargs?: {
            enable_thinking: boolean
          }
        }) => Promise<number>
      }
      console.debug(
        '[TokenCounter:service] engine found:',
        !!engine,
        'hasMethod:',
        typeof typedEngine?.getTokensCount
      )

      if (typedEngine && typeof typedEngine.getTokensCount === 'function') {
        // Transform GChat's ThreadMessage format to OpenAI chat completion format
        const transformedMessages = messages
          .map((message) => {
            // Handle different content types
            let content:
              | string
              | Array<{
                  type: string
                  text?: string
                  image_url?: {
                    detail?: string
                    url?: string
                  }
                }> = ''

            if (message.content && message.content.length > 0) {
              // Check if there are any image_url content types
              const hasImages = message.content.some(
                (content) => content.type === ContentType.Image
              )

              if (hasImages) {
                // For multimodal messages, preserve the array structure
                content = message.content.map((contentItem) => {
                  if (contentItem.type === ContentType.Text) {
                    return {
                      type: 'text',
                      text: contentItem.text?.value || '',
                    }
                  } else if (contentItem.type === ContentType.Image) {
                    return {
                      type: 'image_url',
                      image_url: {
                        detail: contentItem.image_url?.detail,
                        url: contentItem.image_url?.url || '',
                      },
                    }
                  }
                  // Fallback for unknown content types
                  return {
                    type: contentItem.type,
                    text: contentItem.text?.value,
                    image_url: contentItem.image_url,
                  }
                })
              } else {
                // For text-only messages, keep the string format
                const textContents = message.content
                  .filter(
                    (content) =>
                      content.type === ContentType.Text && content.text?.value
                  )
                  .map((content) => content.text?.value || '')

                content = textContents.join(' ')
              }
            }

            return {
              role: message.role,
              content,
            }
          })
          .filter((msg) =>
            typeof msg.content === 'string'
              ? msg.content.trim() !== ''
              : Array.isArray(msg.content) && msg.content.length > 0
          ) // Filter out empty messages

        if (transformedMessages.length === 0) {
          return 0
        }

        console.debug(
          '[TokenCounter:service] calling engine.getTokensCount with',
          { modelId, msgCount: transformedMessages.length }
        )
        const timeoutMs = 30000
        const result = await Promise.race([
          typedEngine.getTokensCount({
            model: modelId,
            messages: transformedMessages,
            chat_template_kwargs: {
              enable_thinking: false,
            },
          }),
          new Promise<never>((_, reject) =>
            setTimeout(
              () => reject(new Error('getTokensCount timed out')),
              timeoutMs
            )
          ),
        ])
        console.debug('[TokenCounter:service] engine returned', result)
        return result
      }

      console.warn(
        '[TokenCounter:service] getTokensCount method not available in local engine'
      )
      return 0
    } catch (error) {
      console.error('[TokenCounter:service] error getting tokens count:', error)
      return 0
    }
  }
}

import {
  AIEngine,
  getJanDataFolderPath,
  fs,
  joinPath,
  modelInfo,
  SessionInfo,
  UnloadResult,
  chatCompletion,
  chatCompletionChunk,
  ImportOptions,
  chatCompletionRequest,
  events,
  AppEvent,
  DownloadEvent,
  Compatibility,
} from '@gchat/core'

import { error, info, warn } from '@tauri-apps/plugin-log'
import { invoke } from '@tauri-apps/api/core'
import { basename } from '@tauri-apps/api/path'
import {
  loadGinferModel,
  unloadGinferModel,
  findSessionByModel,
  getLoadedModels,
  getAllSessions,
  getRandomPort,
  isProcessRunning,
  type GinferConfig,
} from '../../../src-tauri/plugins/tauri-plugin-ginfer/guest-js/index'
import { resolveBinaryPath, randomApiKey } from './util'
import { checkGinferHardware } from './hardware'

/**
 * Override the default app.log function to use the Tauri logging system.
 */
const logger = {
  info: function (...args: any[]) {
    console.log(...args)
    info(args.map((arg) => ` ${arg}`).join(` `))
  },
  warn: function (...args: any[]) {
    console.warn(...args)
    warn(args.map((arg) => ` ${arg}`).join(` `))
  },
  error: function (...args: any[]) {
    console.error(...args)
    error(args.map((arg) => ` ${arg}`).join(` `))
  },
}

export interface GinferModelConfig {
  model_path: string
  name: string // user-friendly
  size_bytes: number
  sha256?: string
  embedding?: boolean
  source?: string
}

interface GinferAdoptionReport {
  adopted: Array<{ modelId: string; modelPath: string }>
  rejected: Array<{ filename: string; reason: string }>
}

/**
 * Modality capabilities of the registered .ginfer artifacts: every
 * published family (Qwen, Muse Glimmer) is multimodal — media routes
 * require the serve-side `--vision` flag. `tools` is not listed here; it
 * is reported via `isToolSupported`. Restrict per family if a text-only
 * artifact ever lands in the GadflyII/ginfer-models collection.
 */
const modelCapabilities = (_modelId: string, _name?: string): string[] => [
  'vision',
]

export default class ginfer_extension extends AIEngine {
  provider: string = 'ginfer'
  readonly providerId: string = 'ginfer'

  /**
   * Declared platform contract. Ginference ships a Linux + Windows NVIDIA
   * CUDA build; it is not an Apple-silicon path.
   */
  override compatibility(): Compatibility | undefined {
    return { platform: ['linux', 'windows'], version: this.version ?? '0.1.0' }
  }

  private config: any
  private providerPath!: string
  private timeout: number = 600
  private autoUnload: boolean = true
  private loadingModels = new Map<string, Promise<SessionInfo>>()

  override async onLoad(): Promise<void> {
    super.onLoad() // Calls registerEngine() from AIEngine

    const settings = structuredClone(SETTINGS)
    await this.registerSettings(settings)

    const loadedConfig: any = {}
    for (const item of settings) {
      const defaultValue = item.controllerProps.value
      loadedConfig[item.key] = await this.getSetting<typeof defaultValue>(
        item.key,
        defaultValue
      )
    }
    this.config = loadedConfig
    this.timeout = Number(loadedConfig.timeout) || 600
    this.autoUnload = loadedConfig.auto_unload !== false
  }

  onSettingUpdate<T>(key: string, value: T): void {
    this.config[key] = value
    if (key === 'timeout') this.timeout = Number(value) || 600
    if (key === 'auto_unload') this.autoUnload = value !== false
  }

  override async onUnload(): Promise<void> {
    this.loadingModels.clear()
  }

  private buildGinferConfig(
    perLoad?: { max_context?: number }
  ): GinferConfig {
    const cfg = this.config ?? {}
    return {
      vision: cfg.vision !== false,
      spec: String(cfg.spec ?? 'auto'),
      draft_tokens: Number(cfg.draft_tokens) || 0,
      draft_tp: Number(cfg.draft_tp) || 0,
      kv_dtype: String(cfg.kv_dtype ?? 'auto'),
      max_context: Number(perLoad?.max_context ?? cfg.max_context) || 0,
      kv_arena_bytes: String(cfg.kv_arena_bytes ?? 'auto'),
      prefill_chunk: Number(cfg.prefill_chunk) || 0,
      max_concurrency: Number(cfg.max_concurrency) || 0,
      no_cuda_graph: !!cfg.no_cuda_graph,
    }
  }

  async getProviderPath(): Promise<string> {
    if (!this.providerPath) {
      const override = this.config?.model_path
      if (override && String(override).trim().length > 0) {
        this.providerPath = String(override).trim()
      } else {
        this.providerPath = await joinPath([
          await getJanDataFolderPath(),
          this.providerId,
        ])
      }
    }
    return this.providerPath
  }

  private async adoptRootArtifacts(): Promise<void> {
    const report = await invoke<GinferAdoptionReport>(
      'adopt_root_ginfer_models'
    )
    for (const adopted of report.adopted) {
      logger.info(
        `Adopted root GInfer artifact as model '${adopted.modelId}' at ${adopted.modelPath}`
      )
    }
    for (const rejected of report.rejected) {
      logger.warn(
        `Did not adopt root GInfer artifact '${rejected.filename}': ${rejected.reason}`
      )
    }
  }

  override async get(modelId: string): Promise<modelInfo | undefined> {
    await this.adoptRootArtifacts()
    const path = await joinPath([
      await this.getProviderPath(),
      'models',
      modelId,
      'model.yml',
    ])

    if (!(await fs.existsSync(path))) return undefined

    const modelConfig = await invoke<GinferModelConfig>('read_yaml', { path })
    const resolvedPath = await joinPath([
      await getJanDataFolderPath(),
      modelConfig.model_path,
    ])

    return {
      id: modelId,
      name: modelConfig.name ?? modelId,
      providerId: this.provider,
      port: 0,
      sizeBytes: modelConfig.size_bytes ?? 0,
      embedding: !!modelConfig.embedding,
      source: modelConfig.source,
      path: resolvedPath,
      missing: !(await fs.existsSync(resolvedPath).catch(() => true)),
    } as modelInfo
  }

  override async list(): Promise<modelInfo[]> {
    await this.adoptRootArtifacts()
    const modelsDir = await joinPath([await this.getProviderPath(), 'models'])
    if (!(await fs.existsSync(modelsDir))) {
      await fs.mkdir(modelsDir)
    }

    const modelIds: string[] = []
    let stack = [modelsDir]
    while (stack.length > 0) {
      const currentDir = stack.pop()!

      const modelConfigPath = await joinPath([currentDir, 'model.yml'])
      if (await fs.existsSync(modelConfigPath)) {
        modelIds.push(
          currentDir.slice(modelsDir.length + 1).replace(/\\/g, '/')
        )
        continue
      }

      const children = await fs.readdirSync(currentDir)
      for (const child of children) {
        const childPath = await joinPath([currentDir, child])
        const dirInfo = await fs.fileStat(childPath)
        if (!dirInfo.isDirectory) continue
        stack.push(childPath)
      }
    }

    const gchatDataFolderPath = await getJanDataFolderPath()
    const modelInfos: modelInfo[] = []
    for (const modelId of modelIds) {
      const path = await joinPath([modelsDir, modelId, 'model.yml'])
      const modelConfig = await invoke<GinferModelConfig>('read_yaml', {
        path,
      })
      const resolvedPath = await joinPath([
        gchatDataFolderPath,
        modelConfig.model_path,
      ])
      modelInfos.push({
        id: modelId,
        name: modelConfig.name ?? modelId,
        providerId: this.provider,
        port: 0,
        sizeBytes: modelConfig.size_bytes ?? 0,
        capabilities: modelCapabilities(modelId, modelConfig.name),
        embedding: !!modelConfig.embedding,
        source: modelConfig.source,
        path: resolvedPath,
        missing: !(await fs.existsSync(resolvedPath).catch(() => true)),
      } as modelInfo)
    }

    return modelInfos
  }

  /**
   * Hardware gate: ginfer only runs on Linux/Windows with a supported NVIDIA
   * GPU. Mirrors how mlx degrades on unsupported Macs — the provider stays
   * listed, but starting or importing a model fails with a clear, actionable
   * message instead of an opaque crash or a wasted multi-GB download.
   */
  private async assertHardware(): Promise<void> {
    const check = await checkGinferHardware()
    if (!check.ok) {
      throw new Error(check.reason ?? 'This machine does not support Ginference.')
    }
  }

  override async load(
    modelId: string,
    settings?: any,
    isEmbedding?: boolean,
    bypassAutoUnload?: boolean
  ): Promise<SessionInfo> {
    if (this.loadingModels.has(modelId)) {
      return this.loadingModels.get(modelId)!
    }

    const loadingPromise = (async () => {
      const existing = await findSessionByModel(modelId)
      if (existing) {
        return existing
      }

      await this.assertHardware()

      if (this.autoUnload && !bypassAutoUnload) {
        const loaded = await getLoadedModels()
        const others = loaded.filter((id) => id !== modelId)
        if (others.length > 0) {
          const sessions = await getAllSessions()
          for (const id of others) {
            const session = sessions.find((s) => s.model_id === id)
            if (!session) continue
            try {
              await this.unload(String(session.pid))
            } catch (e) {
              logger.warn(`Failed to auto-unload ${id}:`, e)
            }
          }
        }
      }

      const modelDir = await joinPath([
        await this.getProviderPath(),
        'models',
        modelId,
      ])
      let weightsPath = await joinPath([modelDir, 'model.ginfer'])
      const modelYmlPath = await joinPath([modelDir, 'model.yml'])
      if (await fs.existsSync(modelYmlPath)) {
        const modelConfig = await invoke<GinferModelConfig>('read_yaml', {
          path: modelYmlPath,
        })
        if (modelConfig.model_path) {
          weightsPath = await joinPath([
            await getJanDataFolderPath(),
            modelConfig.model_path,
          ])
        }
      }
      if (!(await fs.existsSync(weightsPath))) {
        throw new Error(
          `Model weights not found for ${modelId} (looked at ${weightsPath})`
        )
      }

      const binaryPath = await resolveBinaryPath(
        await getJanDataFolderPath(),
        this.config?.binary_path
      )
      const port = await getRandomPort()
      const apiKey = randomApiKey()
      const cfg = this.buildGinferConfig(settings)

      let session: SessionInfo
      try {
        session = await loadGinferModel(
          binaryPath,
          modelId,
          weightsPath,
          port,
          cfg,
          apiKey,
          !!isEmbedding,
          this.timeout
        )
      } catch (e: any) {
        const msg = e && typeof e.message === 'string' ? e.message : String(e)
        throw new Error(`Failed to load ${modelId}: ${msg}`)
      }

      return session
    })()

    this.loadingModels.set(modelId, loadingPromise)
    try {
      return await loadingPromise
    } finally {
      this.loadingModels.delete(modelId)
    }
  }

  override async unload(sessionId: string): Promise<UnloadResult> {
    const pid = Number(sessionId)
    const result = await unloadGinferModel(pid)
    return { success: result.success, error: result.error }
  }

  override async chat(
    opts: chatCompletionRequest,
    abortController?: AbortController
  ): Promise<chatCompletion | AsyncIterable<chatCompletionChunk>> {
    const sessionInfo = await findSessionByModel(opts.model)
    if (!sessionInfo) {
      throw new Error(`No active session found for model: ${opts.model}`)
    }

    const running = await isProcessRunning(sessionInfo.pid)
    if (!running) {
      throw new Error('Model have crashed! Please reload!')
    }
    try {
      await globalThis.fetch(`http://localhost:${sessionInfo.port}/health`)
    } catch (e) {
      throw new Error('Model appears to have crashed! Please reload!')
    }

    const url = `http://localhost:${sessionInfo.port}/v1/chat/completions`
    const headers = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${sessionInfo.api_key}`,
    }

    const bodyOpts = {
      ...opts,
      stream: !!opts.stream,
    }
    const body = JSON.stringify(bodyOpts)

    if (opts.stream) {
      return this.handleStreamingResponse(url, headers, body, abortController)
    }

    const response = await globalThis.fetch(url, {
      method: 'POST',
      headers,
      body,
      signal: abortController?.signal,
    })

    if (!response.ok) {
      const errorData = await response.json().catch(() => null)
      throw new Error(
        `API request failed with status ${response.status}: ${JSON.stringify(
          errorData
        )}`
      )
    }

    const completionResponse = (await response.json()) as chatCompletion
    if (completionResponse.choices?.[0]?.finish_reason === 'length') {
      throw new Error('the request exceeds the available context size.')
    }

    return completionResponse
  }

  private async *handleStreamingResponse(
    url: string,
    headers: HeadersInit,
    body: string,
    abortController?: AbortController
  ): AsyncIterable<chatCompletionChunk> {
    const response = await globalThis.fetch(url, {
      method: 'POST',
      headers,
      body,
      signal: abortController?.signal,
    })

    if (!response.ok) {
      const errorData = await response.json().catch(() => null)
      throw new Error(
        `API request failed with status ${response.status}: ${JSON.stringify(
          errorData
        )}`
      )
    }

    const reader = response.body?.getReader()
    if (!reader) {
      throw new Error('Streaming response body is not available')
    }

    const decoder = new TextDecoder()
    let buffer = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''

      for (const line of lines) {
        const trimmedLine = line.trim()
        if (!trimmedLine || !trimmedLine.startsWith('data: ')) continue
        const jsonStr = trimmedLine.slice(6)
        if (jsonStr === '[DONE]') {
          return
        }
        const chunk = JSON.parse(jsonStr) as chatCompletionChunk
        yield chunk
      }
    }

    const trailing = (buffer + decoder.decode()).trim()
    if (trailing.startsWith('data: ')) {
      const jsonStr = trailing.slice(6)
      if (jsonStr !== '[DONE]') {
        yield JSON.parse(jsonStr) as chatCompletionChunk
      }
    }
  }

  override async delete(modelId: string): Promise<void> {
    const modelDir = await joinPath([
      await this.getProviderPath(),
      'models',
      modelId,
    ])

    if (!(await fs.existsSync(await joinPath([modelDir, 'model.yml'])))) {
      throw new Error(`Model ${modelId} does not exist`)
    }

    await fs.rm(modelDir)
  }

  override async update(
    modelId: string,
    model: Partial<modelInfo>
  ): Promise<void> {
    const configPath = await joinPath([
      await this.getProviderPath(),
      'models',
      modelId,
      'model.yml',
    ])
    if (!(await fs.existsSync(configPath))) {
      throw new Error(`Model ${modelId} does not exist`)
    }
    const modelConfig = await invoke<GinferModelConfig>('read_yaml', {
      path: configPath,
    })
    if (model.name) modelConfig.name = model.name
    await invoke<void>('write_yaml', {
      data: modelConfig,
      savePath: configPath,
    })
  }

  override async import(modelId: string, opts: ImportOptions): Promise<void> {
    if (!modelId) {
      throw new Error('Model id is required for import')
    }
    if (!opts?.modelPath) {
      throw new Error(
        'Model path is required for import (HTTP(S) URL or local file path)'
      )
    }

    // Gate before any bytes move: an unsupported machine should get a clear
    // message, not a 16-23 GiB download it can never load.
    await this.assertHardware()

    const modelsDir = await joinPath([
      await this.getProviderPath(),
      'models',
      modelId,
    ])
    const savePath = await joinPath([modelsDir, 'model.ginfer'])
    // Data-folder-relative location of the weights, used for the download
    // manager and recorded in model.yml (resolved against the data folder).
    const relativePath = `${this.providerId}/models/${modelId}/model.ginfer`

    const isRemote =
      opts.modelPath.startsWith('http://') ||
      opts.modelPath.startsWith('https://')

    if (isRemote) {
      const downloadManager = window.core.extensionManager.getByName(
        '@gchat/download-extension'
      )
      if (!downloadManager?.downloadFiles) {
        throw new Error(
          'Download extension is unavailable; cannot import model from a URL'
        )
      }

      const downloadItems = [
        {
          url: opts.modelPath,
          save_path: relativePath,
          sha256: opts.modelSha256,
          size: opts.modelSize,
          model_id: modelId,
        },
      ]

      const onProgress = (transferred: number, total: number) => {
        events.emit(DownloadEvent.onFileDownloadUpdate, {
          modelId,
          percent: total > 0 ? transferred / total : 0,
          size: { transferred, total },
          downloadType: 'Model',
        })
      }

      try {
        await downloadManager.downloadFiles(
          downloadItems,
          this.createDownloadTaskId(modelId),
          onProgress,
          opts.resume ?? false
        )
        // downloadFiles only resolves once the file is downloaded and
        // validated, so this is the completion signal for the UI.
        events.emit(DownloadEvent.onFileDownloadAndVerificationSuccess, {
          modelId,
          downloadType: 'Model',
        })
      } catch (error) {
        const errorMessage =
          error && typeof error.message === 'string'
            ? error.message
            : String(error)

        const isCancellationError =
          errorMessage.includes('Download cancelled') ||
          errorMessage.includes('Validation cancelled') ||
          errorMessage.includes('Hash computation cancelled') ||
          errorMessage.includes('cancelled') ||
          errorMessage.includes('aborted')

        const isValidationError =
          errorMessage.includes('Hash verification failed') ||
          errorMessage.includes('Size verification failed') ||
          errorMessage.includes('Failed to verify file')

        if (!isCancellationError) {
          logger.error('Error downloading model:', modelId, errorMessage)
        }

        if (isCancellationError) {
          logger.info('Download cancelled for model:', modelId)
          events.emit(DownloadEvent.onFileDownloadStopped, {
            modelId,
            downloadType: 'Model',
          })
        } else if (isValidationError) {
          logger.error(
            'Validation failed for model:',
            modelId,
            'Error:',
            errorMessage
          )
          try {
            await this.abortImport(modelId)
          } catch (cancelError) {
            logger.warn('Failed to cancel download task:', cancelError)
          }
          events.emit(DownloadEvent.onModelValidationFailed, {
            modelId,
            downloadType: 'Model',
            error: errorMessage,
            reason: 'validation_failed',
          })
        } else {
          events.emit(DownloadEvent.onFileDownloadError, {
            modelId,
            downloadType: 'Model',
            error: errorMessage,
          })
        }
        throw error
      }
    } else {
      if (!(await fs.existsSync(opts.modelPath))) {
        throw new Error(`Model file not found: ${opts.modelPath}`)
      }
      await fs.mkdir(modelsDir)
      await fs.copyFile(opts.modelPath, savePath)
    }

    // Both branches end with the weights in place at savePath.
    if (!(await fs.existsSync(savePath))) {
      throw new Error(`Imported model file is missing: ${savePath}`)
    }

    const size_bytes = (await fs.fileStat(savePath)).size

    // Merge into an existing model.yml: a user-renamed model keeps its name.
    const ymlPath = await joinPath([modelsDir, 'model.yml'])
    let existing: Partial<GinferModelConfig> = {}
    if (await fs.existsSync(ymlPath)) {
      existing = await invoke<GinferModelConfig>('read_yaml', { path: ymlPath })
    }

    const modelConfig: GinferModelConfig = {
      ...existing,
      model_path: relativePath,
      name: existing.name && existing.name !== modelId ? existing.name : modelId,
      size_bytes,
      sha256: opts.modelSha256,
      source: opts.source,
    }
    await invoke<void>('write_yaml', {
      data: modelConfig,
      savePath: ymlPath,
    })

    events.emit(AppEvent.onModelImported, {
      modelId,
      modelPath: savePath,
      size_bytes,
      model_sha256: opts.modelSha256,
      model_size_bytes: opts.modelSize,
      source: opts.source,
    })
  }

  override async abortImport(modelId: string): Promise<void> {
    const taskId = this.createDownloadTaskId(modelId)
    const downloadManager = window.core.extensionManager.getByName(
      '@gchat/download-extension'
    )
    try {
      await downloadManager.cancelDownload(taskId)
    } catch (cancelError) {
      logger.warn('Failed to cancel download task:', cancelError)
    }
  }

  private createDownloadTaskId(modelId: string): string {
    return `ginfer-${modelId}`
  }

  override async getLoadedModels(): Promise<string[]> {
    return getLoadedModels()
  }

  override async isToolSupported(modelId: string): Promise<boolean> {
    return true
  }
}

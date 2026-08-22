/**
 * Coverage that the model-service engine lookups (pullModel,
 * validateGgufFile, isModelSupported, abortDownload) resolve the default
 * local provider (`ginfer`) rather than a hard-coded engine id.
 *
 * Background: `DefaultModelsService` routes every engine call through
 * `LOCAL_LLAMACPP_PROVIDER` (the single local backend). If that id were ever
 * hard-coded to a removed engine, these methods would silently no-op —
 * visible to users as "Download stuck at 0%" and misleading success toasts.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

import { LOCAL_LLAMACPP_PROVIDER } from '@/lib/utils'

const { mockEvents, mockDownloadEvent } = vi.hoisted(() => ({
  mockEvents: {
    emit: vi.fn(),
  },
  mockDownloadEvent: {
    onFileDownloadStopped: 'onFileDownloadStopped',
  } as Record<string, string>,
}))

vi.mock('@gchat/core', () => ({
  EngineManager: {
    instance: vi.fn(),
  },
  events: mockEvents,
  DownloadEvent: mockDownloadEvent,
}))

import { DefaultModelsService } from '../models/default'
import { EngineManager } from '@gchat/core'

describe('DefaultModelsService — local engine routing', () => {
  let modelsService: DefaultModelsService

  const ginferEngine = {
    import: vi.fn().mockResolvedValue(undefined),
    abortImport: vi.fn().mockResolvedValue(undefined),
    isModelSupported: vi
      .fn<
        (path: string, ctxSize?: number) => Promise<'RED' | 'YELLOW' | 'GREEN'>
      >()
      .mockResolvedValue('GREEN'),
    validateGgufFile: vi.fn().mockResolvedValue({ isValid: true }),
    checkMmprojExists: vi.fn().mockResolvedValue(true),
  }

  const engineManagerGet = vi.fn((provider: string) =>
    provider === LOCAL_LLAMACPP_PROVIDER ? ginferEngine : undefined
  )

  beforeEach(() => {
    vi.clearAllMocks()
    ;(EngineManager.instance as ReturnType<typeof vi.fn>).mockReturnValue({
      get: engineManagerGet,
    })
    modelsService = new DefaultModelsService()
  })

  it('pullModel resolves the local engine', async () => {
    await modelsService.pullModel('m1', '/abs/m1.gguf')

    expect(engineManagerGet).toHaveBeenCalledWith(LOCAL_LLAMACPP_PROVIDER)
    expect(ginferEngine.import).toHaveBeenCalledWith(
      'm1',
      expect.objectContaining({ modelPath: '/abs/m1.gguf' })
    )
  })

  it('validateGgufFile delegates to the local engine', async () => {
    const result = await modelsService.validateGgufFile('/abs/m1.gguf')

    expect(ginferEngine.validateGgufFile).toHaveBeenCalledWith('/abs/m1.gguf')
    expect(result).toEqual({ isValid: true })
  })

  it('isModelSupported delegates to the local engine', async () => {
    const status = await modelsService.isModelSupported('/abs/m1.gguf', 4096)

    expect(ginferEngine.isModelSupported).toHaveBeenCalledWith(
      '/abs/m1.gguf',
      4096
    )
    expect(status).toBe('GREEN')
  })

  it('abortDownload tries the local engine', async () => {
    await modelsService.abortDownload('m1')

    expect(engineManagerGet).toHaveBeenCalledWith(LOCAL_LLAMACPP_PROVIDER)
    expect(ginferEngine.abortImport).toHaveBeenCalledWith('m1')
  })
})

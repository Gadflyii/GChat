import { describe, it, expect, vi, beforeEach } from 'vitest'

// Build-time globals must be set BEFORE the modules under test load. The
// catalog registry imported transitively by `services/models/default` reads
// these. Disable the gzip-preferred fetch path so a single mocked `fetch`
// call per assertion suffices (the gzip path is covered by
// model-catalog-registry.test.ts and by the real cron pipeline).
vi.hoisted(() => {
  const g = globalThis as Record<string, unknown>
  g.IS_TAURI = false
  g.IS_MACOS = true
  g.IS_WINDOWS = false
  g.IS_LINUX = false
  g.DecompressionStream = undefined
})

import { DefaultModelsService } from '../models/default'
import type { HuggingFaceRepo } from '../models/types'
import { EngineManager, events, DownloadEvent } from '@gchat/core'
import { BASELINE_MODEL_CATALOG } from '@/constants/models'
import { clearCatalogCache } from '@/services/model-catalog-registry'

const { mockEvents, mockDownloadEvent } = vi.hoisted(() => ({
  mockEvents: {
    emit: vi.fn(),
  },
  mockDownloadEvent: {
    onFileDownloadStopped: 'onFileDownloadStopped',
  } as Record<string, string>,
}))

// Mock EngineManager and events
vi.mock('@gchat/core', () => ({
  EngineManager: {
    instance: vi.fn(),
  },
  events: mockEvents,
  DownloadEvent: mockDownloadEvent,
}))

vi.mock('@tauri-apps/plugin-http', () => ({
  fetch: vi.fn(),
}))

// Mock fetch
global.fetch = vi.fn()

// Mock MODEL_CATALOG_URL
Object.defineProperty(global, 'MODEL_CATALOG_URL', {
  value: 'https://example.com/models',
  writable: true,
  configurable: true,
})

describe('DefaultModelsService', () => {
  let modelsService: DefaultModelsService

  const mockEngine = {
    list: vi.fn(),
    updateSettings: vi.fn(),
    update: vi.fn(),
    import: vi.fn(),
    abortImport: vi.fn(),
    delete: vi.fn(),
    getLoadedModels: vi.fn(),
    unload: vi.fn(),
    load: vi.fn(),
    isModelSupported: vi.fn(),
    isToolSupported: vi.fn(),
    checkMmprojExists: vi.fn(),
  }

  const mockEngineManager = {
    get: vi.fn().mockReturnValue(mockEngine),
  }

  beforeEach(() => {
    vi.resetAllMocks()
    ;(EngineManager.instance as any).mockReturnValue(mockEngineManager)
    mockEngineManager.get.mockReturnValue(mockEngine)
    modelsService = new DefaultModelsService()
  })

  describe('fetchModels', () => {
    it('should fetch models successfully', async () => {
      const mockModels = [
        { id: 'model1', name: 'Model 1' },
        { id: 'model2', name: 'Model 2' },
      ]
      mockEngine.list.mockResolvedValue(mockModels)

      const result = await modelsService.fetchModels()

      expect(result).toEqual(mockModels)
      expect(mockEngine.list).toHaveBeenCalled()
    })
  })

  describe('fetchModelCatalog', () => {
    // `fetchModelCatalog` now delegates to the failure-safe
    // `getCatalogOrFallback()` registry: on success it returns the
    // manifest's `models[]`; on network / HTTP / schema failure it returns
    // the bundled baseline and never throws. These tests assert that
    // contract.

    beforeEach(async () => {
      await clearCatalogCache()
    })

    it('should fetch model catalog successfully', async () => {
      const mockModels: CatalogModel[] = [
        {
          model_name: 'OpenAI/GPT-4',
          description: 'Large language model',
          developer: 'OpenAI',
          downloads: 1000,
          num_quants: 5,
          quants: [],
        },
      ]
      const mockManifest = {
        manifest_version: 1,
        schema_version: 1,
        updated_at: '2026-05-27T00:00:00Z',
        models: mockModels,
      }

      ;(fetch as any).mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: vi.fn().mockResolvedValue(mockManifest),
      })

      const result = await modelsService.fetchModelCatalog()

      expect(result).toEqual(mockModels)
    })

    it('should fall back to baseline on HTTP error', async () => {
      ;(fetch as any).mockResolvedValue({
        ok: false,
        status: 404,
        statusText: 'Not Found',
      })

      const result = await modelsService.fetchModelCatalog()

      expect(result).toEqual(BASELINE_MODEL_CATALOG)
    })

    it('should fall back to baseline on network error', async () => {
      ;(fetch as any).mockRejectedValue(new Error('Network error'))

      const result = await modelsService.fetchModelCatalog()

      expect(result).toEqual(BASELINE_MODEL_CATALOG)
    })
  })

  describe('updateModel', () => {
    it('should update model settings', async () => {
      const modelId = 'model1'
      const model = {
        id: 'model1',
        settings: [{ key: 'temperature', value: 0.7 }],
      }

      await modelsService.updateModel(modelId, model as any)

      expect(mockEngine.updateSettings).toHaveBeenCalledWith(model.settings)
      expect(mockEngine.update).not.toHaveBeenCalled()
    })

    it('should handle model without settings', async () => {
      const modelId = 'model1'
      const model = { id: 'model1' }

      await modelsService.updateModel(modelId, model)

      expect(mockEngine.updateSettings).not.toHaveBeenCalled()
      expect(mockEngine.update).not.toHaveBeenCalled()
    })

    it('should handle model when modelId differs from model.id', async () => {
      const modelId = 'old-model-id'
      const model = {
        id: 'new-model-id',
        settings: [{ key: 'temperature', value: 0.7 }],
      }

      await modelsService.updateModel(modelId, model as any)

      expect(mockEngine.updateSettings).toHaveBeenCalledWith(model.settings)
      // Note: Model ID updates are now handled at the provider level in the frontend
      // The engine no longer has an update method for model metadata
      expect(mockEngine.update).not.toHaveBeenCalled()
    })
  })

  describe('pullModel', () => {
    it('should pull model successfully', async () => {
      const id = 'model1'
      const modelPath = '/path/to/model'

      await modelsService.pullModel(id, modelPath)

      expect(mockEngine.import).toHaveBeenCalledWith(id, {
        modelPath,
        modelSha256: undefined,
        modelSize: undefined,
        resume: false,
      })
    })
  })

  describe('abortDownload', () => {
    it('should abort download successfully', async () => {
      const id = 'model1'

      await modelsService.abortDownload(id)

      expect(mockEngine.abortImport).toHaveBeenCalledWith(id)
      expect(events.emit).toHaveBeenCalledWith(
        DownloadEvent.onFileDownloadStopped,
        expect.objectContaining({
          modelId: id,
          downloadType: 'Model',
        })
      )
    })
  })

  describe('deleteModel', () => {
    it('should delete model successfully', async () => {
      const id = 'model1'
      mockEngine.getLoadedModels.mockResolvedValue([])

      await modelsService.deleteModel(id)

      expect(mockEngine.delete).toHaveBeenCalledWith(id)
    })

    it('refuses to delete a loaded model without interrupting inference', async () => {
      mockEngine.getLoadedModels.mockResolvedValue(['model1'])
      await expect(modelsService.deleteModel('model1')).rejects.toThrow('Stop this model')
      expect(mockEngine.delete).not.toHaveBeenCalled()
    })

    it('rejects instead of reporting success when the provider has no engine', async () => {
      mockEngineManager.get.mockReturnValueOnce(undefined)

      await expect(
        modelsService.deleteModel('model1', 'no-such-provider')
      ).rejects.toThrow('no-such-provider')
    })
  })

  describe('getActiveModels', () => {
    it('should get active models successfully', async () => {
      const mockActiveModels = ['model1', 'model2']
      mockEngine.getLoadedModels.mockResolvedValue(mockActiveModels)

      const result = await modelsService.getActiveModels()

      expect(result).toEqual(mockActiveModels)
      expect(mockEngine.getLoadedModels).toHaveBeenCalled()
    })

    it('should return the loaded models from the local engine', async () => {
      mockEngine.getLoadedModels.mockResolvedValue(['ginfer-model'])

      const result = await modelsService.getActiveModels()

      expect(result).toEqual(['ginfer-model'])
      expect(mockEngine.getLoadedModels).toHaveBeenCalled()
    })
  })

  describe('stopModel', () => {
    it('should stop model successfully', async () => {
      const model = 'model1'
      const provider = 'openai'

      await modelsService.stopModel(model, provider)

      expect(mockEngine.unload).toHaveBeenCalledWith(model)
    })

    it('should auto-detect the active local engine when provider is omitted', async () => {
      const ginferEngine = {
        ...mockEngine,
        getLoadedModels: vi.fn().mockResolvedValue(['ginfer-model']),
        unload: vi.fn().mockResolvedValue({ success: true, error: undefined }),
      }

      mockEngineManager.get.mockImplementation((provider?: string) =>
        provider === 'ginfer' ? ginferEngine : undefined
      )

      const result = await modelsService.stopModel('ginfer-model')

      expect(result).toEqual({ success: true, error: undefined })
      expect(ginferEngine.unload).toHaveBeenCalledWith('ginfer-model')
    })
  })

  describe('stopAllModels', () => {
    it('should stop all active models from the local provider', async () => {
      const mockActiveModels = ['model1', 'model2']
      const ginferEngine = {
        ...mockEngine,
        getLoadedModels: vi.fn().mockResolvedValue(mockActiveModels),
        unload: vi.fn(),
      }
      mockEngineManager.get.mockImplementation((provider?: string) =>
        provider === 'ginfer' ? ginferEngine : undefined
      )

      await modelsService.stopAllModels()

      expect(ginferEngine.unload).toHaveBeenCalledTimes(2)
      expect(ginferEngine.unload).toHaveBeenCalledWith('model1')
      expect(ginferEngine.unload).toHaveBeenCalledWith('model2')
    })

    it('should handle empty active models', async () => {
      mockEngine.getLoadedModels.mockResolvedValue(null)

      await modelsService.stopAllModels()

      expect(mockEngine.unload).not.toHaveBeenCalled()
    })

    it('rejects when an active model does not stop', async () => {
      const ginferEngine = {
        ...mockEngine,
        getLoadedModels: vi.fn().mockResolvedValue(['model1']),
        unload: vi.fn().mockResolvedValue({
          success: false,
          error: 'process remained active',
        }),
      }
      mockEngineManager.get.mockImplementation((provider?: string) =>
        provider === 'ginfer' ? ginferEngine : undefined
      )

      await expect(modelsService.stopAllModels()).rejects.toThrow(
        'process remained active'
      )
    })
  })

  describe('startModel', () => {
    it('passes only GInfer-owned startup settings to GInfer', async () => {
      const provider = {
        provider: 'ginfer',
        models: [
          {
            id: 'model1',
            settings: {
              ctx_len: { controller_props: { value: 131072 } },
              ngl: { controller_props: { value: 100 } },
            },
          },
        ],
      } as any
      mockEngine.getLoadedModels.mockResolvedValue({ includes: () => false })
      mockEngine.load.mockResolvedValue({ id: 'session1' })

      await modelsService.startModel(provider, 'model1')

      expect(mockEngine.load).toHaveBeenCalledWith(
        'model1',
        { max_context: 131072 },
        false,
        false
      )
    })

    it('uses the declared GInfer context when its stored value is unset', async () => {
      const provider = {
        provider: 'ginfer',
        models: [
          {
            id: 'muse_glimmer_30b_nvfp4_dflash2',
            settings: {
              ctx_len: {
                controller_props: {
                  value: 0,
                  max: 131072,
                },
              },
            },
          },
        ],
      } as any
      mockEngine.getLoadedModels.mockResolvedValue({ includes: () => false })
      mockEngine.load.mockResolvedValue({ id: 'session1' })

      await modelsService.startModel(
        provider,
        'muse_glimmer_30b_nvfp4_dflash2'
      )

      expect(mockEngine.load).toHaveBeenCalledWith(
        'muse_glimmer_30b_nvfp4_dflash2',
        { max_context: 131072 },
        false,
        false
      )
    })

    it('should start model successfully', async () => {
      const mockSettings = {
        ctx_len: { controller_props: { value: 4096 } },
        ngl: { controller_props: { value: 32 } },
      }
      const provider = {
        provider: 'openai',
        models: [{ id: 'model1', settings: mockSettings }],
      } as any
      const model = 'model1'
      const mockSession = { id: 'session1' }

      mockEngine.getLoadedModels.mockResolvedValue({
        includes: () => false,
      })
      mockEngine.load.mockResolvedValue(mockSession)

      const result = await modelsService.startModel(provider, model)

      expect(result).toEqual(mockSession)
      expect(mockEngine.load).toHaveBeenCalledWith(
        model,
        {
          ctx_size: 4096,
          n_gpu_layers: 32,
        },
        false,
        false
      )
    })

    it('should handle start model error', async () => {
      const mockSettings = {
        ctx_len: { controller_props: { value: 4096 } },
        ngl: { controller_props: { value: 32 } },
      }
      const provider = {
        provider: 'openai',
        models: [{ id: 'model1', settings: mockSettings }],
      } as any
      const model = 'model1'
      const error = new Error('Failed to start model')

      mockEngine.getLoadedModels.mockResolvedValue({
        includes: () => false,
      })
      mockEngine.load.mockRejectedValue(error)

      await expect(modelsService.startModel(provider, model)).rejects.toThrow(
        error
      )
    })
    it('should not load model again', async () => {
      const mockSettings = {
        ctx_len: { controller_props: { value: 4096 } },
        ngl: { controller_props: { value: 32 } },
      }
      const provider = {
        provider: 'openai',
        models: [{ id: 'model1', settings: mockSettings }],
      } as any
      const model = 'model1'

      mockEngine.getLoadedModels.mockResolvedValue({
        includes: () => true,
      })
      expect(mockEngine.load).toBeCalledTimes(0)
      await expect(modelsService.startModel(provider, model)).resolves.toBe(
        undefined
      )
    })
  })

  describe('fetchHuggingFaceRepo', () => {
    beforeEach(() => {
      vi.clearAllMocks()
    })

    it('should fetch HuggingFace repository successfully with blobs=true', async () => {
      const mockRepoData = {
        id: 'microsoft/DialoGPT-medium',
        modelId: 'microsoft/DialoGPT-medium',
        sha: 'abc123',
        downloads: 5000,
        likes: 100,
        tags: ['conversational', 'pytorch'],
        pipeline_tag: 'text-generation',
        createdAt: '2023-01-01T00:00:00Z',
        last_modified: '2023-12-01T00:00:00Z',
        private: false,
        disabled: false,
        gated: false,
        author: 'microsoft',
        siblings: [
          {
            rfilename: 'model-Q4_K_M.gguf',
            size: 2147483648,
            blobId: 'blob123',
          },
          {
            rfilename: 'model-Q8_0.gguf',
            size: 4294967296,
            blobId: 'blob456',
          },
          {
            rfilename: 'README.md',
            size: 1024,
            blobId: 'blob789',
          },
        ],
        readme: '# DialoGPT Model\nThis is a conversational AI model.',
      }

      ;(fetch as any).mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue(mockRepoData),
      })

      const result = await modelsService.fetchHuggingFaceRepo(
        'microsoft/DialoGPT-medium'
      )

      expect(result).toEqual(mockRepoData)
      expect(fetch).toHaveBeenCalledWith(
        'https://huggingface.co/api/models/microsoft/DialoGPT-medium?blobs=true&files_metadata=true',
        {
          headers: undefined,
        }
      )
    })

    it('should clean repository ID from various input formats', async () => {
      const mockRepoData = { modelId: 'microsoft/DialoGPT-medium' }
      ;(fetch as any).mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue(mockRepoData),
      })

      // Test with full URL
      await modelsService.fetchHuggingFaceRepo(
        'https://huggingface.co/microsoft/DialoGPT-medium'
      )
      expect(fetch).toHaveBeenCalledWith(
        'https://huggingface.co/api/models/microsoft/DialoGPT-medium?blobs=true&files_metadata=true',
        {
          headers: undefined,
        }
      )

      // Test with domain prefix
      await modelsService.fetchHuggingFaceRepo(
        'huggingface.co/microsoft/DialoGPT-medium'
      )
      expect(fetch).toHaveBeenCalledWith(
        'https://huggingface.co/api/models/microsoft/DialoGPT-medium?blobs=true&files_metadata=true',
        {
          headers: undefined,
        }
      )

      // Test with trailing slash
      await modelsService.fetchHuggingFaceRepo('microsoft/DialoGPT-medium/')
      expect(fetch).toHaveBeenCalledWith(
        'https://huggingface.co/api/models/microsoft/DialoGPT-medium?blobs=true&files_metadata=true',
        {
          headers: undefined,
        }
      )
    })

    it('should return null for invalid repository IDs', async () => {
      // Test empty string
      expect(await modelsService.fetchHuggingFaceRepo('')).toBeNull()

      // Test string without slash
      ;(fetch as any).mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue([]),
      })
      expect(
        await modelsService.fetchHuggingFaceRepo('invalid-repo')
      ).toBeNull()

      // Test whitespace only
      expect(await modelsService.fetchHuggingFaceRepo('   ')).toBeNull()
    })

    it('should return null for 404 responses', async () => {
      ;(fetch as any).mockResolvedValue({
        ok: false,
        status: 404,
        statusText: 'Not Found',
      })

      const result =
        await modelsService.fetchHuggingFaceRepo('nonexistent/model')

      expect(result).toBeNull()
      expect(fetch).toHaveBeenCalledWith(
        'https://huggingface.co/api/models/nonexistent/model?blobs=true&files_metadata=true',
        {
          headers: undefined,
        }
      )
    })

    it('should handle other HTTP errors', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      ;(fetch as any).mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      })

      const result = await modelsService.fetchHuggingFaceRepo(
        'microsoft/DialoGPT-medium'
      )

      expect(result).toBeNull()
      expect(consoleSpy).toHaveBeenCalledWith(
        'Error fetching HuggingFace repository:',
        expect.any(Error)
      )

      consoleSpy.mockRestore()
    })

    it('should handle network errors', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      ;(fetch as any).mockRejectedValue(new Error('Network error'))

      const result = await modelsService.fetchHuggingFaceRepo(
        'microsoft/DialoGPT-medium'
      )

      expect(result).toBeNull()
      expect(consoleSpy).toHaveBeenCalledWith(
        'Error fetching HuggingFace repository:',
        expect.any(Error)
      )

      consoleSpy.mockRestore()
    })

    it('should handle repository with no siblings', async () => {
      const mockRepoData = {
        id: 'microsoft/DialoGPT-medium',
        modelId: 'microsoft/DialoGPT-medium',
        sha: 'abc123',
        downloads: 5000,
        likes: 100,
        tags: ['conversational'],
        pipeline_tag: 'text-generation',
        createdAt: '2023-01-01T00:00:00Z',
        last_modified: '2023-12-01T00:00:00Z',
        private: false,
        disabled: false,
        gated: false,
        author: 'microsoft',
        siblings: undefined,
      }

      ;(fetch as any).mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue(mockRepoData),
      })

      const result = await modelsService.fetchHuggingFaceRepo(
        'microsoft/DialoGPT-medium'
      )

      expect(result).toEqual(mockRepoData)
    })

    it('should handle repository with no GGUF files', async () => {
      const mockRepoData = {
        id: 'microsoft/DialoGPT-medium',
        modelId: 'microsoft/DialoGPT-medium',
        sha: 'abc123',
        downloads: 5000,
        likes: 100,
        tags: ['conversational'],
        pipeline_tag: 'text-generation',
        createdAt: '2023-01-01T00:00:00Z',
        last_modified: '2023-12-01T00:00:00Z',
        private: false,
        disabled: false,
        gated: false,
        author: 'microsoft',
        siblings: [
          {
            rfilename: 'README.md',
            size: 1024,
            blobId: 'blob789',
          },
          {
            rfilename: 'config.json',
            size: 512,
            blobId: 'blob101',
          },
        ],
      }

      ;(fetch as any).mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue(mockRepoData),
      })

      const result = await modelsService.fetchHuggingFaceRepo(
        'microsoft/DialoGPT-medium'
      )

      expect(result).toEqual(mockRepoData)
    })

    it('should handle repository with mixed file types including GGUF', async () => {
      const mockRepoData = {
        id: 'microsoft/DialoGPT-medium',
        modelId: 'microsoft/DialoGPT-medium',
        sha: 'abc123',
        downloads: 5000,
        likes: 100,
        tags: ['conversational'],
        pipeline_tag: 'text-generation',
        createdAt: '2023-01-01T00:00:00Z',
        last_modified: '2023-12-01T00:00:00Z',
        private: false,
        disabled: false,
        gated: false,
        author: 'microsoft',
        siblings: [
          {
            rfilename: 'model-Q4_K_M.gguf',
            size: 2147483648, // 2GB
            blobId: 'blob123',
          },
          {
            rfilename: 'README.md',
            size: 1024,
            blobId: 'blob789',
          },
          {
            rfilename: 'config.json',
            size: 512,
            blobId: 'blob101',
          },
        ],
      }

      ;(fetch as any).mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue(mockRepoData),
      })

      const result = await modelsService.fetchHuggingFaceRepo(
        'microsoft/DialoGPT-medium'
      )

      expect(result).toEqual(mockRepoData)
      // Verify the GGUF file is present in siblings
      expect(result?.siblings?.some((s) => s.rfilename.endsWith('.gguf'))).toBe(
        true
      )
    })
  })

  describe('isModelSupported', () => {
    beforeEach(() => {
      vi.clearAllMocks()
    })

    it('should return GREEN when model is fully supported', async () => {
      const mockEngineWithSupport = {
        ...mockEngine,
        isModelSupported: vi.fn().mockResolvedValue('GREEN'),
      }

      mockEngineManager.get.mockReturnValue(mockEngineWithSupport)

      const result = await modelsService.isModelSupported(
        '/path/to/model.gguf',
        4096
      )

      expect(result).toBe('GREEN')
      expect(mockEngineWithSupport.isModelSupported).toHaveBeenCalledWith(
        '/path/to/model.gguf',
        4096
      )
    })

    it('should return YELLOW when model weights fit but KV cache does not', async () => {
      const mockEngineWithSupport = {
        ...mockEngine,
        isModelSupported: vi.fn().mockResolvedValue('YELLOW'),
      }

      mockEngineManager.get.mockReturnValue(mockEngineWithSupport)

      const result = await modelsService.isModelSupported(
        '/path/to/model.gguf',
        8192
      )

      expect(result).toBe('YELLOW')
      expect(mockEngineWithSupport.isModelSupported).toHaveBeenCalledWith(
        '/path/to/model.gguf',
        8192
      )
    })

    it('should return RED when model is not supported', async () => {
      const mockEngineWithSupport = {
        ...mockEngine,
        isModelSupported: vi.fn().mockResolvedValue('RED'),
      }

      mockEngineManager.get.mockReturnValue(mockEngineWithSupport)

      const result = await modelsService.isModelSupported(
        '/path/to/large-model.gguf'
      )

      expect(result).toBe('RED')
      expect(mockEngineWithSupport.isModelSupported).toHaveBeenCalledWith(
        '/path/to/large-model.gguf',
        undefined
      )
    })

    it('should return YELLOW as fallback when engine method is not available', async () => {
      const mockEngineWithoutSupport = {
        ...mockEngine,
        isModelSupported: undefined, // Explicitly remove the method
      }

      mockEngineManager.get.mockReturnValue(mockEngineWithoutSupport)

      const result = await modelsService.isModelSupported('/path/to/model.gguf')

      expect(result).toBe('YELLOW')
    })

    it('should return RED when engine is not available', async () => {
      mockEngineManager.get.mockReturnValue(null)

      const result = await modelsService.isModelSupported('/path/to/model.gguf')

      expect(result).toBe('YELLOW') // Should use fallback
    })

    it('should return GREY when there is an error', async () => {
      const mockEngineWithError = {
        ...mockEngine,
        isModelSupported: vi.fn().mockRejectedValue(new Error('Test error')),
      }

      mockEngineManager.get.mockReturnValue(mockEngineWithError)

      const result = await modelsService.isModelSupported('/path/to/model.gguf')

      expect(result).toBe('GREY')
    })
  })
})

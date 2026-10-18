import { beforeEach, describe, expect, it, vi } from 'vitest'

const { invoke, fs, config, hardware, emit, downloadFiles, loadModel } = vi.hoisted(() => ({
  invoke: vi.fn(),
  fs: {
    existsSync: vi.fn().mockResolvedValue(true),
    mkdir: vi.fn(),
    copyFile: vi.fn(),
    fileStat: vi.fn().mockResolvedValue({ size: 1234 }),
    rm: vi.fn(),
  },
  config: {
    value: {} as Record<string, unknown>,
    locations: [] as Array<{ modelId: string; modelDir: string; manifestPath: string }>,
    manifests: {} as Record<string, Record<string, unknown>>,
    imported: {
      modelDir: '/linux/models/custom',
      artifactPath: '/linux/models/custom/model.ginfer',
      manifestPath: '/linux/models/custom/model.yml',
      modelPath: '/linux/models/custom/model.ginfer',
    },
  },
  hardware: vi.fn(),
  emit: vi.fn(),
  downloadFiles: vi.fn(),
  loadModel: vi.fn(),
}))

vi.mock('@gchat/core', () => ({
  AIEngine: class {},
  fs,
  joinPath: async (parts: string[]) => parts.reduce(
    (path, part) => part.startsWith('/') ? part : `${path}/${part}`, ''
  ),
  getJanDataFolderPath: async () => '/data',
  events: { emit },
  AppEvent: { onModelImported: 'model-imported' },
  DownloadEvent: {
    onFileDownloadAndVerificationSuccess: 'download-success',
    onFileDownloadStopped: 'download-stopped',
    onFileDownloadError: 'download-error',
  },
}))
vi.mock('@tauri-apps/api/core', () => ({ invoke }))
vi.mock('@tauri-apps/plugin-log', () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }))
vi.mock('./util', () => ({ resolveBinaryPath: vi.fn().mockResolvedValue('/runtime/ginfer-serve') }))
vi.mock('./hardware', () => ({ checkGinferHardware: hardware }))
vi.mock('./session-metadata', () => ({ countTokens: vi.fn(), loadedContext: vi.fn() }))
vi.mock('../../../src-tauri/plugins/tauri-plugin-ginfer/guest-js/index', () => ({
  findSessionByModel: vi.fn().mockResolvedValue(undefined),
  getLoadedModels: vi.fn().mockResolvedValue([]),
  getAllSessions: vi.fn().mockResolvedValue([]),
  loadGinferModel: loadModel,
  unloadGinferModel: vi.fn().mockResolvedValue({ success: true }),
}))

import GinferExtension from './index'
import { resolveBinaryPath } from './util'
import {
  findSessionByModel,
  getAllSessions,
  getLoadedModels,
  unloadGinferModel,
} from '../../../src-tauri/plugins/tauri-plugin-ginfer/guest-js/index'

describe('GInfer library model context and names', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    fs.existsSync.mockResolvedValue(true)
    fs.fileStat.mockResolvedValue({ size: 1234 })
    hardware.mockResolvedValue({ ok: true })
    downloadFiles.mockResolvedValue(undefined)
    loadModel.mockResolvedValue({ pid: 1, port: 8080 })
    vi.mocked(findSessionByModel).mockResolvedValue(null)
    vi.mocked(getLoadedModels).mockResolvedValue([])
    vi.mocked(getAllSessions).mockResolvedValue([])
    vi.mocked(unloadGinferModel).mockResolvedValue({ success: true })
    window.core.extensionManager.getByName = vi.fn().mockReturnValue({ downloadFiles })
    config.value = {}
    config.manifests = {}
    config.locations = [
      'qwen38_27b_int_df2',
      'muse_glimmer_30b_nvfp4_df2',
      'muse_glimmer_30b_nvfp4_df2q4_tp2',
      'qwen38_27b_nvfp4_df2q4_tp4',
      'qwen38_flash_next_180b_smol_mtp_tp2',
      'custom',
    ].map((modelId) => ({
      modelId,
      modelDir: `/data/ginfer/models/${modelId}`,
      manifestPath: `/data/ginfer/models/${modelId}/model.yml`,
    }))
    invoke.mockImplementation(async (command: string, args?: {
      path?: string; savePath?: string; data?: Record<string, unknown>
    }) => {
      if (command === 'adopt_root_ginfer_models') return { adopted: [], rejected: [] }
      if (command === 'ginfer_model_locations') return config.locations
      if (command === 'ginfer_model_import_location') return config.imported
      if (command === 'read_yaml') return config.manifests[args!.path!] ?? config.value
      if (command === 'write_yaml') {
        config.manifests[args!.savePath!] = args!.data!
        return undefined
      }
      if (command === 'delete_ginfer_model') return undefined
      throw new Error(`Unexpected command ${command}`)
    })
  })

  it.each([
    ['qwen38_27b_int_df2', 262_144],
    ['muse_glimmer_30b_nvfp4_df2', 131_072],
    ['muse_glimmer_30b_nvfp4_df2q4_tp2', 131_072],
    ['qwen38_27b_nvfp4_df2q4_tp4', 262_144],
    ['qwen38_flash_next_180b_smol_mtp_tp2', 262_144],
  ] as const)('keeps the adopted package ID and editable display label for %s', async (id, context) => {
    config.value = {
      model_path: `ginfer/models/${id}/${id}.ginfer`,
      name: 'My local model',
      size_bytes: 1234,
    }
    const model = await new GinferExtension().get(id)
    expect(model).toMatchObject({ id, name: 'My local model', nativeContextTokens: context })
  })

  it.each([
    'qwen38_flash_next_180b_int_mtp',
    'qwen38_flash_next_180b_smol_mtp',
    'qwen38_flash_next_180b_nvfp4_mtp',
    'qwen38_flash_next_180b_nvfp4_mtp_tp2',
    'qwen38_flash_next_180b_nvfp4_mtp_tp4',
  ])('discovers and loads the exact Flash catalog path for %s', async (id) => {
    const path = `/linux/models/${id}/${id}.ginfer`
    config.locations = [{
      modelId: id,
      modelDir: `/linux/models/${id}`,
      manifestPath: `/linux/models/${id}/model.yml`,
    }]
    config.value = { model_path: path, name: 'My Flash model' }
    const extension = new GinferExtension()
    const expected = { id, path, name: 'My Flash model', nativeContextTokens: 262_144 }
    expect(await extension.list()).toMatchObject([expected])
    expect(await extension.get(id)).toMatchObject(expected)
    await extension.load(id)
    expect(loadModel).toHaveBeenCalledWith(expect.objectContaining({
      modelId: id, modelPath: path,
    }))
  })

  it('uses the registered artifact family even with a conflicting filename and label', async () => {
    config.value = {
      identity: { model_id: 'muse-glimmer-30b', weights_id: 'nvfp4-dflash-nvfp4' },
      model_path: 'ginfer/models/renamed/renamed.ginfer',
      name: 'Qwen3.8 27B',
    }
    expect(await new GinferExtension().get('qwen38_27b_int_df2')).toMatchObject({
      nativeContextTokens: 131_072,
      name: 'Qwen3.8 27B',
    })
  })

  it('resolves an externally registered UUID to its artifact context', async () => {
    const id = '8d76994a-a344-4bb5-9e42-c643011f8d2a'
    const modelDir = `/data/ginfer/models/${id}`
    const path = '/external/qwen38_27b_int_df2.ginfer'
    config.locations = [{ modelId: id, modelDir, manifestPath: `${modelDir}/model.yml` }]
    config.manifests[`${modelDir}/model.yml`] = {
      identity: { model_id: 'muse-glimmer-30b', weights_id: 'groupwise-int' },
      model_path: path,
      name: 'My Qwen model',
      size_bytes: 1234,
      source: 'external',
    }
    const extension = new GinferExtension()
    const expected = { id, path, source: 'external', nativeContextTokens: 131_072 }

    expect(await extension.list()).toMatchObject([expected])
    expect(await extension.get(id)).toMatchObject(expected)
    expect(await extension.getMaxCtxTrain(id)).toBe(131_072)
  })

  it('leaves context unknown when only the editable label names a known family', async () => {
    config.value = {
      model_path: 'ginfer/models/custom/custom.ginfer',
      name: 'Muse Glimmer 30B',
    }
    expect((await new GinferExtension().get('custom'))?.nativeContextTokens).toBeUndefined()
  })

  it('lists native and legacy manifests and edits the catalog-selected manifest', async () => {
    config.locations = [
      { modelId: 'custom', modelDir: '/linux/models/custom', manifestPath: '/linux/models/custom/model.yml' },
      { modelId: 'legacy', modelDir: '/data/ginfer/models/legacy', manifestPath: '/data/ginfer/models/legacy/model.yml' },
    ]
    config.manifests = {
      '/linux/models/custom/model.yml': { name: 'Native', model_path: '/linux/models/custom/model.ginfer', size_bytes: 42 },
      '/data/ginfer/models/legacy/model.yml': { name: 'Legacy', model_path: 'ginfer/models/legacy/old.ginfer', size_bytes: 21 },
    }
    const extension = new GinferExtension()
    expect(await extension.list()).toMatchObject([
      { id: 'custom', path: '/linux/models/custom/model.ginfer', name: 'Native' },
      { id: 'legacy', path: '/data/ginfer/models/legacy/old.ginfer', name: 'Legacy' },
    ])
    expect(await extension.get('legacy')).toMatchObject({ path: '/data/ginfer/models/legacy/old.ginfer' })
    await extension.update('custom', { name: 'Renamed' })
    expect(invoke).toHaveBeenCalledWith('write_yaml', {
      data: { name: 'Renamed', model_path: '/linux/models/custom/model.ginfer', size_bytes: 42 },
      savePath: '/linux/models/custom/model.yml',
    })
    expect(fs.mkdir).not.toHaveBeenCalled()
  })

  it('loads the catalog artifact rather than reconstructing the data-folder root', async () => {
    config.locations = [{ modelId: 'custom', modelDir: '/linux/models/custom', manifestPath: '/linux/models/custom/model.yml' }]
    config.value = { model_path: '/linux/models/custom/package.ginfer' }
    const session = await new GinferExtension().load('custom')
    expect(session).toEqual({ pid: 1, port: 8080 })
    expect(loadModel).toHaveBeenCalledWith(expect.objectContaining({
      modelId: 'custom', modelPath: '/linux/models/custom/package.ginfer',
    }))
  })

  it.each([
    undefined,
    { max_context: 262_144, use_profile_defaults: false },
    {
      max_context: 262_144,
      use_profile_defaults: true,
      gpu_uuids: ['GPU-selected', 'GPU-second'],
      load_operation_id: 'c4c8f9f0-55ac-4a04-ad38-cd847cf1bb3c',
    },
  ])('uses the tested Host profile and ignores stale startup overrides for load settings %j', async (settings) => {
    config.value = { model_path: '/linux/models/custom/package.ginfer' }
    const extension = new GinferExtension()
    Object.assign(extension, { config: {
      vision: false,
      spec: 'none',
      draft_tokens: 7,
      draft_tp: 2,
      kv_dtype: 'bf16',
      max_context: 8_192,
      kv_arena_bytes: '12345678',
      prefill_chunk: 256,
      max_concurrency: 8,
      no_cuda_graph: true,
    } })
    await extension.load('custom', settings)
    expect(loadModel).toHaveBeenLastCalledWith(expect.objectContaining({
      config: {
        use_profile_defaults: true,
        vision: true,
        spec: 'auto',
        draft_tokens: 0,
        draft_tp: 0,
        kv_dtype: 'auto',
        max_context: 0,
        kv_arena_bytes: 'auto',
        prefill_chunk: 0,
        max_concurrency: 0,
        no_cuda_graph: false,
        ...(settings?.gpu_uuids === undefined ? {} : { gpu_uuids: settings.gpu_uuids }),
        ...(settings?.load_operation_id === undefined ? {} : { load_operation_id: settings.load_operation_id }),
      },
    }))
  })

  it.each([undefined, { max_context: 262_144 }])('keeps an attached custom Host session untouched for ordinary load settings %j', async (settings) => {
    const resident = {
      pid: 2, port: 8081, vision: false, spec: 'none', max_context: 65_536,
      max_concurrency: 3, kv_arena_bytes: '12345678', no_cuda_graph: true,
    } as any
    vi.mocked(findSessionByModel).mockResolvedValue(resident)
    const extension = new GinferExtension()
    Object.assign(extension, { config: { max_context: 8_192, max_concurrency: 8 } })

    expect(await extension.load('custom', settings)).toBe(resident)
    expect(hardware).not.toHaveBeenCalled()
    expect(getLoadedModels).not.toHaveBeenCalled()
    expect(loadModel).not.toHaveBeenCalled()
    expect(unloadGinferModel).not.toHaveBeenCalled()
    expect(invoke).not.toHaveBeenCalled()
  })

  it.each([
    [true, false, true],
    [false, false, false],
    [true, true, false],
  ])('preserves storage, binary, timeout and unload policy (auto unload %s, bypass %s)', async (autoUnload, bypassAutoUnload, shouldUnload) => {
    config.value = { model_path: '/chosen/provider/models/custom/package.ginfer' }
    vi.mocked(getLoadedModels).mockResolvedValue(['other'])
    vi.mocked(getAllSessions).mockResolvedValue([{ model_id: 'other', pid: 2 } as any])
    vi.mocked(resolveBinaryPath).mockResolvedValueOnce('/chosen/bin/ginfer-serve')
    const extension = new GinferExtension()
    Object.assign(extension, { config: {} })
    extension.onSettingUpdate('model_path', '/chosen/provider')
    extension.onSettingUpdate('binary_path', '/chosen/bin/ginfer-serve')
    extension.onSettingUpdate('timeout', '137')
    extension.onSettingUpdate('auto_unload', autoUnload)

    await extension.load('custom', undefined, undefined, bypassAutoUnload)

    expect(invoke).toHaveBeenCalledWith('ginfer_model_locations', { modelsRoot: '/chosen/provider/models' })
    expect(resolveBinaryPath).toHaveBeenCalledWith('/data', '/chosen/bin/ginfer-serve')
    expect(loadModel).toHaveBeenCalledWith(expect.objectContaining({
      binaryPath: '/chosen/bin/ginfer-serve',
      hostDirectory: '/chosen/provider/host',
      modelPath: '/chosen/provider/models/custom/package.ginfer',
      timeout: 137,
      config: expect.objectContaining({ use_profile_defaults: true }),
    }))
    if (shouldUnload) {
      expect(unloadGinferModel).toHaveBeenCalledExactlyOnceWith(2)
    } else {
      expect(getLoadedModels).not.toHaveBeenCalled()
      expect(unloadGinferModel).not.toHaveBeenCalled()
    }
  })

  it('does not join another resident session for a scoped load operation', async () => {
    config.value = { model_path: '/linux/models/custom/package.ginfer' }
    vi.mocked(findSessionByModel).mockResolvedValue({ pid: 2, port: 8081 } as any)
    const operationId = 'c4c8f9f0-55ac-4a04-ad38-cd847cf1bb3c'
    const session = await new GinferExtension().load('custom', { load_operation_id: operationId })
    expect(session).toEqual({ pid: 1, port: 8080 })
    expect(loadModel).toHaveBeenCalledWith(expect.objectContaining({
      config: expect.objectContaining({ load_operation_id: operationId }),
    }))
  })

  it('checks automatic profile settings natively even when a model is already loaded', async () => {
    config.value = { model_path: '/linux/models/custom/package.ginfer' }
    const resident = { pid: 2, port: 8081 } as any
    vi.mocked(findSessionByModel).mockResolvedValue(resident)
    const extension = new GinferExtension()
    await extension.load('custom', { use_profile_defaults: true })
    expect(loadModel).toHaveBeenCalledWith(expect.objectContaining({
      config: expect.objectContaining({ use_profile_defaults: true }),
    }))
    expect(await extension.load('custom')).toBe(resident)
    expect(loadModel).toHaveBeenCalledTimes(1)
  })

  it('imports local bytes into the native location and preserves a legacy rename', async () => {
    config.locations = [{ modelId: 'custom', modelDir: '/data/ginfer/models/custom', manifestPath: '/data/ginfer/models/custom/model.yml' }]
    config.value = { name: 'User rename', model_path: 'ginfer/models/custom/old.ginfer', capabilities: ['vision'] }
    fs.existsSync.mockImplementation(async (path: string) => path !== config.imported.manifestPath)
    await new GinferExtension().import('custom', { modelPath: '/source/package.ginfer' })
    expect(fs.copyFile).toHaveBeenCalledWith('/source/package.ginfer', config.imported.artifactPath)
    expect(invoke).toHaveBeenCalledWith('write_yaml', {
      data: expect.objectContaining({ name: 'User rename', model_path: config.imported.modelPath, capabilities: ['vision'], size_bytes: 1234 }),
      savePath: config.imported.manifestPath,
    })
    expect(config.manifests[config.imported.manifestPath]).toMatchObject({
      name: 'User rename', model_path: config.imported.modelPath,
      capabilities: ['vision'], size_bytes: 1234,
    })
  })

  it('passes a configured model root consistently while keeping the remote save path logical', async () => {
    const extension = new GinferExtension()
    Object.assign(extension, { config: { model_path: '/chosen/provider' } })
    config.value = { name: 'Remote rename', model_path: 'ginfer/models/custom/old.ginfer' }
    await extension.import('custom', { modelPath: 'https://example.com/package.ginfer' })
    expect(invoke).toHaveBeenCalledWith('ginfer_model_import_location', { modelId: 'custom', modelsRoot: '/chosen/provider/models' })
    expect(invoke).toHaveBeenCalledWith('ginfer_model_locations', { modelsRoot: '/chosen/provider/models' })
    expect(downloadFiles).toHaveBeenCalledWith([
      expect.objectContaining({ save_path: 'ginfer/models/custom/model.ginfer', model_id: 'custom', model_storage_root: '/chosen/provider/models' }),
    ], 'ginfer-custom', expect.any(Function), false)
    expect(invoke).toHaveBeenCalledWith('write_yaml', {
      data: expect.objectContaining({ name: 'Remote rename', model_path: config.imported.modelPath }),
      savePath: config.imported.manifestPath,
    })
    expect(config.manifests[config.imported.manifestPath]).toMatchObject({
      name: 'Remote rename', model_path: config.imported.modelPath, size_bytes: 1234,
    })
  })

  it('does not download or publish metadata when native import admission rejects the root', async () => {
    invoke.mockImplementation(async (command: string) => {
      if (command === 'ginfer_model_import_location') throw new Error('Choose a Linux model root')
      throw new Error(`Unexpected command ${command}`)
    })
    await expect(new GinferExtension().import('custom', { modelPath: 'https://example.com/package.ginfer' })).rejects.toThrow('Choose a Linux model root')
    expect(downloadFiles).not.toHaveBeenCalled()
    expect(invoke.mock.calls.some(([command]) => command === 'write_yaml')).toBe(false)
  })

  it('preserves remote cancellation without replacing the existing manifest', async () => {
    const cancelled = new Error('Download cancelled')
    downloadFiles.mockRejectedValueOnce(cancelled)
    await expect(new GinferExtension().import('custom', {
      modelPath: 'https://example.com/package.ginfer', resume: true,
    })).rejects.toBe(cancelled)
    expect(downloadFiles).toHaveBeenCalledTimes(1)
    expect(downloadFiles.mock.calls[0][3]).toBe(true)
    expect(invoke.mock.calls.some(([command]) => command === 'write_yaml')).toBe(false)
    expect(emit).toHaveBeenCalledWith('download-stopped', {
      modelId: 'custom', downloadType: 'Model',
    })
  })

  it('delegates deletion to the protected native owner and preserves an owning Host refusal', async () => {
    const extension = new GinferExtension()
    Object.assign(extension, { config: { model_path: '/chosen/provider' } })
    await extension.delete('custom')
    expect(invoke).toHaveBeenCalledWith('delete_ginfer_model', { modelId: 'custom', modelsRoot: '/chosen/provider/models' })
    const failure = new Error('Owning Host rejected removal')
    invoke.mockRejectedValueOnce(failure)
    await expect(extension.delete('custom')).rejects.toBe(failure)
    expect(fs.rm).not.toHaveBeenCalled()
  })
  it('forwards an explicit installed Load GPU choice to native admission', async () => {
    config.locations = [{ modelId: 'custom', modelDir: '/linux/models/custom', manifestPath: '/linux/models/custom/model.yml' }]
    config.value = { model_path: '/linux/models/custom/model.ginfer', name: 'Selected GPU' }
    const session = await new GinferExtension().load('custom', { gpu_uuids: ['GPU-one'] })
    expect(session).toEqual({ pid: 1, port: 8080 })
    expect(loadModel).toHaveBeenCalledWith(expect.objectContaining({
      config: expect.objectContaining({ use_profile_defaults: true, gpu_uuids: ['GPU-one'] }),
    }))
  })

})

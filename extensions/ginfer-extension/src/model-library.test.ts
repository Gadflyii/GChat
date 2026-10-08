import { beforeEach, describe, expect, it, vi } from 'vitest'

const { invoke, fs, config } = vi.hoisted(() => ({
  invoke: vi.fn(),
  fs: {
    existsSync: vi.fn().mockResolvedValue(true),
  },
  config: { value: {} as Record<string, unknown> },
}))

vi.mock('@gchat/core', () => ({
  AIEngine: class {},
  fs,
  joinPath: async (parts: string[]) => parts.join('/'),
  getJanDataFolderPath: async () => '/data',
}))
vi.mock('@tauri-apps/api/core', () => ({ invoke }))
vi.mock('@tauri-apps/plugin-log', () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }))
vi.mock('./util', () => ({ resolveBinaryPath: vi.fn() }))
vi.mock('./hardware', () => ({ checkGinferHardware: vi.fn() }))
vi.mock('./session-metadata', () => ({ countTokens: vi.fn(), loadedContext: vi.fn() }))
vi.mock('../../../src-tauri/plugins/tauri-plugin-ginfer/guest-js/index', () => ({}))

import GinferExtension from './index'

describe('GInfer library model context and names', () => {
  beforeEach(() => {
    invoke.mockImplementation(async (command: string) => {
      if (command === 'adopt_root_ginfer_models') return { adopted: [], rejected: [] }
      if (command === 'read_yaml') return config.value
      throw new Error(`Unexpected command ${command}`)
    })
  })

  it.each([
    ['qwen38_27b_int_df2', 262_144],
    ['muse_glimmer_30b_nvfp4_df2', 131_072],
    ['muse_glimmer_30b_nvfp4_df2q4_tp2', 131_072],
    ['qwen38_27b_nvfp4_df2q4_tp4', 262_144],
    ['qwen38_flash_smol_mtp_tp2', 262_144],
  ] as const)('keeps the adopted package ID and editable display label for %s', async (id, context) => {
    config.value = {
      model_path: `ginfer/models/${id}/${id}.ginfer`,
      name: 'My local model',
      size_bytes: 1234,
    }
    const model = await new GinferExtension().get(id)
    expect(model).toMatchObject({ id, name: 'My local model', nativeContextTokens: context })
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

  it('leaves context unknown when only the editable label names a known family', async () => {
    config.value = {
      model_path: 'ginfer/models/custom/custom.ginfer',
      name: 'Muse Glimmer 30B',
    }
    expect((await new GinferExtension().get('custom'))?.nativeContextTokens).toBeUndefined()
  })
})

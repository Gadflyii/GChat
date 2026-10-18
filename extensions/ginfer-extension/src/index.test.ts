import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect } from 'vitest'
import { normalizeGinferConfig } from '../../../src-tauri/plugins/tauri-plugin-ginfer/guest-js/index'
import { loadFailure } from './util'

const settings = JSON.parse(
  readFileSync(resolve(process.cwd(), 'settings.json'), 'utf8')
)

const setting = (key: string) => settings.find((item: any) => item.key === key)

describe('bundled GInfer profile', () => {
  it('preserves explicit profile intent and GPU choice across the native boundary', () => {
    const operationId = 'c4c8f9f0-55ac-4a04-ad38-cd847cf1bb3c'
    expect(normalizeGinferConfig({ use_profile_defaults: true, gpu_uuids: ['GPU-selected'], load_operation_id: operationId }))
      .toMatchObject({ use_profile_defaults: true, gpu_uuids: ['GPU-selected'], load_operation_id: operationId })
    for (const value of [undefined, false, 'true']) {
      expect(normalizeGinferConfig({ use_profile_defaults: value }))
        .not.toHaveProperty('use_profile_defaults')
    }
    expect(normalizeGinferConfig({})).not.toHaveProperty('load_operation_id')
    for (const value of ['', ' ', true, 123]) {
      expect(() => normalizeGinferConfig({ load_operation_id: value })).toThrow('nonempty identifier')
    }
  })

  it('keeps storage and application behavior settings without global launch overrides', () => {
    expect(settings.map((item: any) => item.key)).toEqual([
      'model_path', 'binary_path', 'auto_unload', 'timeout',
    ])
    expect(setting('model_path').controllerProps.value).toBe('')
    expect(setting('binary_path').controllerProps.value).toBe('')
    expect(setting('auto_unload').controllerProps.value).toBe(true)
    expect(setting('timeout').controllerProps.value).toBe('600')
  })
})

describe('Host load failures', () => {
  it('exposes a leading Host code as error.code and keeps the message plain', () => {
    const failure = loadFailure('Qwen', new Error('[no_qualified_profile] No qualified automatic profile is available.'))
    expect(failure.message).toBe('Failed to load Qwen: No qualified automatic profile is available.')
    expect((failure as Error & { code?: string }).code).toBe('no_qualified_profile')
    expect(loadFailure('Qwen', 'boom')).toMatchObject({ message: 'Failed to load Qwen: boom' })
    expect((loadFailure('Qwen', 'boom') as Error & { code?: string }).code).toBeUndefined()
  })
})

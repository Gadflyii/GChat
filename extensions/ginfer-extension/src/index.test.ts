import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect } from 'vitest'

const settings = JSON.parse(
  readFileSync(resolve(process.cwd(), 'settings.json'), 'utf8')
)

const setting = (key: string) => settings.find((item: any) => item.key === key)
const values = (key: string) =>
  setting(key).controllerProps.options.map((option: any) => option.value)

describe('bundled GInfer profile', () => {
  it('starts registered multimodal packages with engine-owned automatic defaults', () => {
    expect(setting('vision').controllerProps.value).toBe(true)
    expect(setting('spec').controllerProps.value).toBe('auto')
    expect(setting('draft_tp').controllerProps.value).toBe('auto')
    expect(setting('kv_dtype').controllerProps.value).toBe('auto')
    expect(setting('kv_arena_bytes').controllerProps.value).toBe('auto')
  })

  it('exposes only current GInfer speculative and KV choices', () => {
    expect(values('spec')).toEqual(['auto', 'none', 'dflash'])
    expect(values('draft_tp')).toEqual(['auto', '1', '2', '4'])
    expect(values('kv_dtype')).toEqual(['auto', 'bf16', 'int8', 'nvfp4'])
    expect(setting('lm_head_draft')).toBeUndefined()
    expect(setting('kv_capacity')).toBeUndefined()
  })
})

import { describe, it, expect } from 'vitest'
import { evaluateGinferHardware } from './hardware'
import type { SystemInfo } from '../../../src-tauri/plugins/tauri-plugin-hardware/guest-js/index'

const nvidiaGpu = (cc?: string) => ({
  name: 'NVIDIA GPU',
  total_memory: 24576,
  vendor: 'NVIDIA',
  uuid: 'abc',
  driver_version: '550.0',
  nvidia_info: cc ? { index: 0, compute_capability: cc } : undefined,
})

const info = (os_type: string, gpus: SystemInfo['gpus']): SystemInfo =>
  ({
    cpu: { name: 'cpu', core_count: 8, arch: 'x86_64', extensions: [] },
    os_type,
    os_name: 'OS',
    total_memory: 32768,
    gpus,
  }) as SystemInfo

const evaluate = (os_type: string, gpus: SystemInfo['gpus']) =>
  evaluateGinferHardware(info(os_type, gpus))

describe('evaluateGinferHardware', () => {
  it('accepts a supported OS with an NVIDIA GPU of a target SM', () => {
    expect(evaluate('linux', [nvidiaGpu('8.6')])).toEqual({ ok: true })
    expect(evaluate('windows', [nvidiaGpu('8.9')])).toEqual({ ok: true })
    expect(evaluate('linux', [nvidiaGpu('12.0')])).toEqual({ ok: true })
  })

  it('accepts an NVIDIA GPU whose compute capability is not readable', () => {
    // NVML unavailable -> capability unknown. Not proof of incompatibility, so
    // the engine is allowed to attempt the load and surface any real error.
    expect(evaluate('linux', [nvidiaGpu()])).toEqual({ ok: true })
  })

  it('rejects an unsupported OS', () => {
    const result = evaluate('macos', [nvidiaGpu('8.6')])
    expect(result.ok).toBe(false)
    expect(result.reason).toMatch(/Linux or Windows/)
  })

  it('rejects a machine with no NVIDIA GPU', () => {
    const amdGpu = {
      name: 'AMD GPU',
      total_memory: 16384,
      vendor: 'AMD',
      uuid: 'def',
      driver_version: '1.0',
    }
    const result = evaluate('linux', [amdGpu])
    expect(result.ok).toBe(false)
    expect(result.reason).toMatch(/NVIDIA CUDA GPU/)
  })

  it('rejects a known unsupported compute capability', () => {
    const result = evaluate('linux', [nvidiaGpu('7.5')])
    expect(result.ok).toBe(false)
    expect(result.reason).toMatch(/compute capability/)
    expect(result.reason).toMatch(/7\.5/)
  })

  it('passes when any of several NVIDIA GPUs targets a supported SM', () => {
    expect(evaluate('linux', [nvidiaGpu('7.5'), nvidiaGpu('8.9')])).toEqual({
      ok: true,
    })
  })
})

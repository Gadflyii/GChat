import { describe, expect, it, vi } from 'vitest'
import type { HardwareData } from '@/hooks/useHardware'
import {
  evaluateCodeHardware,
  TerminalFlowController,
} from '@/lib/codeTerminal'

const hardware = (overrides: Partial<HardwareData> = {}): HardwareData => ({
  os_type: 'linux',
  os_name: 'Linux',
  total_memory: 64 * 1024 ** 3,
  cpu: { arch: 'x86_64', core_count: 16, extensions: [], name: 'CPU', usage: 0 },
  gpus: [
    {
      name: 'RTX 5090',
      total_memory: 32 * 1024 ** 3,
      vendor: 'NVIDIA',
      uuid: 'gpu-1',
      driver_version: '590',
      nvidia_info: { index: 0, compute_capability: '12.0' },
      vulkan_info: {
        index: 0,
        device_id: 0,
        device_type: 'discrete',
        api_version: '1.3',
      },
    },
  ],
  ...overrides,
})

describe('evaluateCodeHardware', () => {
  it('accepts a registered NVIDIA target', () => {
    expect(evaluateCodeHardware(hardware())).toEqual({ supported: true })
  })

  it('rejects unsupported operating systems and GPUs', () => {
    expect(evaluateCodeHardware(hardware({ os_type: 'macos' })).supported).toBe(false)
    expect(evaluateCodeHardware(hardware({ gpus: [] })).supported).toBe(false)
  })
})

describe('TerminalFlowController', () => {
  it('pauses at the high watermark and resumes only after the low watermark', () => {
    const onFlowChange = vi.fn()
    const flow = new TerminalFlowController(onFlowChange, 100, 25)
    const drainFirst = flow.enqueue(60)
    const drainSecond = flow.enqueue(50)

    expect(onFlowChange).toHaveBeenCalledWith(true)
    drainFirst()
    expect(onFlowChange).toHaveBeenCalledTimes(1)
    drainSecond()
    expect(onFlowChange).toHaveBeenLastCalledWith(false)
  })

  it('counts each xterm write callback once', () => {
    const onFlowChange = vi.fn()
    const flow = new TerminalFlowController(onFlowChange, 10, 2)
    const drain = flow.enqueue(10)
    drain()
    drain()
    expect(onFlowChange.mock.calls).toEqual([[true], [false]])
  })
})

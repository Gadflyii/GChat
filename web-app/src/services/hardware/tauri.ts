/**
 * Tauri Hardware Service - Desktop implementation
 */

import { invoke } from '@tauri-apps/api/core'
import type { HardwareData, SystemUsage } from './types'
import { DefaultHardwareService } from './default'

export class TauriHardwareService extends DefaultHardwareService {
  async getHardwareInfo(): Promise<HardwareData | null> {
    return invoke('plugin:hardware|get_system_info') as Promise<HardwareData>
  }

  async getSystemUsage(): Promise<SystemUsage | null> {
    return invoke('plugin:hardware|get_system_usage') as Promise<SystemUsage>
  }

  async setActiveGpus(data: { gpus: number[] }): Promise<void> {
    // TODO: llama.cpp extension should handle this
    console.log(data)
  }

  async refreshHardwareInfo(): Promise<void> {
    await invoke('plugin:hardware|refresh_system_info')
  }
}

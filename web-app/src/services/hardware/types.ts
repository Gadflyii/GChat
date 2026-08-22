/**
 * Hardware Service Types
 */

import type { HardwareData, SystemUsage } from '@/hooks/useHardware'

export interface HardwareService {
  getHardwareInfo(): Promise<HardwareData | null>
  getSystemUsage(): Promise<SystemUsage | null>
  setActiveGpus(data: { gpus: number[] }): Promise<void>
  /** Invalidates cached GPU detection so next getHardwareInfo() re-detects. Use after system resume (e.g. Linux sleep). */
  refreshHardwareInfo(): Promise<void>
}

// Re-export hardware types for convenience
export type { HardwareData, SystemUsage }

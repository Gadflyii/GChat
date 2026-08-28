import type { HardwareData } from '@/hooks/useHardware'

const SUPPORTED_OS = new Set(['linux', 'windows'])
const SUPPORTED_COMPUTE_CAPABILITIES = new Set(['8.6', '8.9', '12.0'])

export type CodeHardwareReadiness =
  | { supported: true }
  | { supported: false; reason: string }

/**
 * The Code tab uses the same explicit CUDA product matrix as ginfer. Unknown
 * compute capability is deferred to the engine because an unavailable NVML
 * probe is not evidence that a supported GPU is absent.
 */
export function evaluateCodeHardware(
  hardware: HardwareData
): CodeHardwareReadiness {
  if (!SUPPORTED_OS.has(hardware.os_type.toLowerCase())) {
    return {
      supported: false,
      reason: 'Code requires the Linux or Windows GInfer runtime.',
    }
  }

  const nvidia = hardware.gpus.filter(
    (gpu) => gpu.vendor?.toLowerCase() === 'nvidia'
  )
  if (nvidia.length === 0) {
    return {
      supported: false,
      reason: 'Code requires an NVIDIA CUDA GPU supported by GInfer.',
    }
  }

  const reported = nvidia
    .map((gpu) => gpu.nvidia_info?.compute_capability)
    .filter((value): value is string => Boolean(value))
  if (
    reported.length > 0 &&
    !reported.some((value) => SUPPORTED_COMPUTE_CAPABILITIES.has(value))
  ) {
    return {
      supported: false,
      reason: `Code requires NVIDIA compute capability 8.6, 8.9, or 12.0; this system reports ${reported.join(', ')}.`,
    }
  }

  return { supported: true }
}

/**
 * Bounds the amount of terminal output queued in xterm's parser. Crossing the
 * high watermark pauses the Rust reader; draining through the low watermark
 * resumes it, which propagates pressure back to the OS PTY.
 */
export class TerminalFlowController {
  private pendingBytes = 0
  private paused = false

  constructor(
    private readonly onFlowChange: (paused: boolean) => void,
    private readonly highWatermark = 256 * 1024,
    private readonly lowWatermark = 64 * 1024
  ) {
    if (lowWatermark >= highWatermark) {
      throw new Error('Terminal low watermark must be below the high watermark')
    }
  }

  enqueue(byteLength: number): () => void {
    this.pendingBytes += byteLength
    if (!this.paused && this.pendingBytes >= this.highWatermark) {
      this.paused = true
      this.onFlowChange(true)
    }

    let drained = false
    return () => {
      if (drained) return
      drained = true
      this.pendingBytes = Math.max(0, this.pendingBytes - byteLength)
      if (this.paused && this.pendingBytes <= this.lowWatermark) {
        this.paused = false
        this.onFlowChange(false)
      }
    }
  }

  reset(): void {
    const wasPaused = this.paused
    this.pendingBytes = 0
    this.paused = false
    if (wasPaused) this.onFlowChange(false)
  }
}

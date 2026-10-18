/**
 * Helpers for the "System Monitor / Settings → Hardware" GPU card, built
 * from the `hardware` plugin (NVML for NVIDIA, Vulkan loader for
 * everything else).
 *
 * The hardware plugin is the app's source of truth for GPU presence:
 * it can report GPUs even on hosts where live per-device VRAM stats are
 * unavailable, in which case the UI renders the known cards and signals
 * that live stats are limited — instead of a misleading "No GPUs
 * detected".
 *
 * Probe aliases are reconciled by physical identity in the native plugin.
 */

import type { GPU } from '@/hooks/useHardware'

/**
 * Shape consumed by the GPU card. Presence remains available even when a
 * driver does not provide live VRAM telemetry.
 */
export interface FallbackGpuDevice {
  id: string
  name: string
  vendor: string
  totalMemoryMiB: number
}

/**
 * Convert a hardware-plugin `GPU` to the minimal shape rendered by the
 * fallback card. Keep unidentified entries separate too: a model name is
 * not a physical identity.
 */
export function adaptGpuToFallbackDevice(
  gpu: GPU,
  index: number
): FallbackGpuDevice {
  const source = gpu.nvidia_info
    ? `nvml:${gpu.nvidia_info.index}`
    : gpu.vulkan_info
      ? `vulkan:${gpu.vulkan_info.index}`
      : `hardware:${index}`
  return {
    id: `${source}:${gpu.uuid}`,
    name: gpu.name,
    vendor: gpu.vendor,
    totalMemoryMiB: gpu.total_memory,
  }
}

/**
 * Composite helper used by both `system-monitor.tsx` and
 * `settings/hardware.tsx`: adapt the physical inventory and sort by total memory
 * descending (largest VRAM first, which on hybrid laptops puts the
 * dGPU above the iGPU).
 */
export function buildFallbackDevices(gpus: readonly GPU[]): FallbackGpuDevice[] {
  return gpus
    .map(adaptGpuToFallbackDevice)
    .sort((a, b) => b.totalMemoryMiB - a.totalMemoryMiB)
}

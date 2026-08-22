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
 * See the 2026-05-27 ADR in `AGENTS.md` § 7.
 */

import type { GPU } from '@/hooks/useHardware'

/**
 * Shape consumed by the GPU card. We deliberately omit `free` / `used` —
 * for these entries we have no reliable live-VRAM signal (see `Bug #2` in
 * the ADR: NVML and Vulkan UUIDs are not byte-identical, so
 * `systemUsage.gpus[*]` cannot always be matched back to the
 * Vulkan-sourced duplicate).
 */
export interface FallbackGpuDevice {
  id: string
  name: string
  vendor: string
  totalMemoryMiB: number
}

/**
 * UI-side deduplication for the case where the hardware plugin
 * enumerated the same physical NVIDIA card twice: once via NVML
 * (`vendor === 'NVIDIA'`, `nvidia_info` present) and once via Vulkan
 * (`vendor === 'NVIDIA'` derived from PCI vendor_id 0x10DE,
 * `nvidia_info` absent). The Rust-side dedup in `commands.rs` keys on
 * `uuid`, but NVML's CUDA UUID and Vulkan's
 * `VkPhysicalDeviceIDProperties.deviceUUID` are not guaranteed to be
 * byte-identical for the same physical GPU — a documented NVIDIA quirk.
 *
 * This helper is a SAFE fallback dedup that works for the 99% case of
 * one physical GPU per host: collapse entries with the same
 * `(vendor, name, total_memory)` tuple, preferring the entry that
 * carries a vendor-specific info blob (`nvidia_info` for NVIDIA) since
 * that one has the richer telemetry. It will incorrectly collapse two
 * identical cards in a multi-GPU rig — out of scope for this fix; the
 * proper PCI-BDF-based dedup is queued as a separate ADR (Fix D in the
 * 2026-05-27 plan).
 */
export function dedupeGpusForFallback(gpus: readonly GPU[]): GPU[] {
  const buckets = new Map<string, GPU>()
  for (const gpu of gpus) {
    const key = `${gpu.vendor}::${gpu.name}::${gpu.total_memory}`
    const existing = buckets.get(key)
    if (!existing) {
      buckets.set(key, gpu)
      continue
    }
    // Prefer the entry that has the richer vendor blob (NVML wins over
    // Vulkan for NVIDIA cards because we can pull live VRAM from it
    // elsewhere in the app via `nvidia_info.index`).
    const existingScore = existing.nvidia_info ? 1 : 0
    const candidateScore = gpu.nvidia_info ? 1 : 0
    if (candidateScore > existingScore) {
      buckets.set(key, gpu)
    }
  }
  return Array.from(buckets.values())
}

/**
 * Convert a hardware-plugin `GPU` to the minimal shape rendered by the
 * fallback card. UUID is used as the React key; for entries whose UUID
 * is empty / missing, fall back to the `(vendor, name)` tuple.
 */
export function adaptGpuToFallbackDevice(gpu: GPU): FallbackGpuDevice {
  const id = gpu.uuid && gpu.uuid.length > 0 ? gpu.uuid : `${gpu.vendor}::${gpu.name}`
  return {
    id,
    name: gpu.name,
    vendor: gpu.vendor,
    totalMemoryMiB: gpu.total_memory,
  }
}

/**
 * Composite helper used by both `system-monitor.tsx` and
 * `settings/hardware.tsx`: dedupe + adapt + sort by total memory
 * descending (largest VRAM first, which on hybrid laptops puts the
 * dGPU above the iGPU).
 */
export function buildFallbackDevices(gpus: readonly GPU[]): FallbackGpuDevice[] {
  return dedupeGpusForFallback(gpus)
    .map(adaptGpuToFallbackDevice)
    .sort((a, b) => b.totalMemoryMiB - a.totalMemoryMiB)
}

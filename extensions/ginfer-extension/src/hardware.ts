import { getSystemInfo, type SystemInfo } from '../../../src-tauri/plugins/tauri-plugin-hardware/guest-js/index'

/**
 * Ginference is compiled for the Linux + Windows NVIDIA CUDA stack only.
 * `os_type` is reported by tauri-plugin-hardware as one of
 * "windows" | "macos" | "linux" | "unknown".
 */
const SUPPORTED_OS = ['linux', 'windows']

/**
 * Compute capabilities (SM) the bundled ginfer kernels target:
 *   8.6  — Ampere   (RTX 30 / A100)
 *   8.9  — Ada      (RTX 40)
 *   12.0 — Blackwell (RTX 50, "SM 120a")
 * `nvidia_info.compute_capability` is the NVML major.minor string (e.g. "8.6").
 */
const SUPPORTED_COMPUTE_CAPABILITIES = ['8.6', '8.9', '12.0']

export interface GinferHardwareCheck {
  ok: boolean
  /** Human-readable reason when `ok` is false, safe to show in a toast. */
  reason?: string
}

/**
 * Pure eligibility check over a tauri-plugin-hardware snapshot. Kept separate
 * from the live probe so the decision rules can be unit-tested without Tauri.
 *
 * A machine is eligible when it runs a supported OS and exposes at least one
 * NVIDIA GPU. When the NVIDIA GPU reports a compute capability, that value
 * must be one the bundled kernels target; a GPU with no readable capability
 * (NVML unavailable) is let through and the engine surfaces any SM mismatch
 * at load time.
 */
export function evaluateGinferHardware(info: SystemInfo): GinferHardwareCheck {
  if (!SUPPORTED_OS.includes(info.os_type)) {
    return {
      ok: false,
      reason: `Ginference requires Linux or Windows (this machine reports "${info.os_type}").`,
    }
  }

  const nvidiaGpus = (info.gpus ?? []).filter(
    (gpu) => gpu.vendor?.toLowerCase() === 'nvidia'
  )

  if (nvidiaGpus.length === 0) {
    return {
      ok: false,
      reason:
        'Ginference requires an NVIDIA CUDA GPU. No NVIDIA GPU was detected on this machine.',
    }
  }

  const reported = nvidiaGpus
    .map((gpu) => gpu.nvidia_info?.compute_capability)
    .filter((cc): cc is string => typeof cc === 'string' && cc.length > 0)

  // Only reject on a *known* unsupported SM. An unknown capability is not
  // proof of incompatibility (NVML can be unavailable on valid GPUs).
  if (reported.length > 0 && !reported.some((cc) => SUPPORTED_COMPUTE_CAPABILITIES.includes(cc))) {
    return {
      ok: false,
      reason: `Ginference targets NVIDIA compute capability ${SUPPORTED_COMPUTE_CAPABILITIES.join(', ')} (SM 86 / 89 / 120a); this GPU reports ${reported.join(', ')}.`,
    }
  }

  return { ok: true }
}

/**
 * Live probe of the current machine via tauri-plugin-hardware.
 *
 * When the probe itself is unavailable (web preview, tests, a build without
 * the plugin) it returns `{ ok: true }` rather than blocking: the ginfer
 * engine then surfaces any real incompatibility at load time.
 */
export async function checkGinferHardware(): Promise<GinferHardwareCheck> {
  try {
    const info = await getSystemInfo()
    return evaluateGinferHardware(info)
  } catch (error) {
    console.warn('[ginfer] hardware probe unavailable; deferring to the engine:', error)
    return { ok: true }
  }
}

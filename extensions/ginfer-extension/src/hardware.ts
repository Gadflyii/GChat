import { getSystemInfo, type SystemInfo } from '../../../src-tauri/plugins/tauri-plugin-hardware/guest-js/index'

/**
 * Ginference is compiled for the Linux + Windows NVIDIA CUDA stack only.
 * `os_type` is reported by tauri-plugin-hardware as one of
 * "windows" | "macos" | "linux" | "unknown".
 */
const SUPPORTED_OS = ['linux', 'windows']

/**
 * Compute capabilities (SM) the bundled ginfer kernels target:
 *   8.0  — Ampere   (A100 / CMP 170HX; Linux)
 *   8.6  — Ampere   (RTX 30)
 *   8.9  — Ada      (RTX 40)
 *   12.0 — Blackwell (RTX 50, "SM 120a")
 * `nvidia_info.compute_capability` is the NVML major.minor string (e.g. "8.6").
 */
const SUPPORTED_COMPUTE_CAPABILITIES = {
  linux: ['8.0', '8.6', '8.9', '12.0'],
  windows: ['8.6', '8.9', '12.0'],
} as const

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
  // Linux runs models on the CPU device when no graphics card can: x86-64 with AVX2 (an
  // unreported extension list is not proof of a missing one). Windows CPU serving waits
  // for its native Engine build.
  const cpuDevice = info.os_type === 'linux' && ['x86_64', 'x86-64', 'amd64'].includes(String(info.cpu?.arch ?? '').toLowerCase())
    && (!info.cpu?.extensions?.length || info.cpu.extensions.some((extension) => extension.toLowerCase() === 'avx2'))

  const nvidiaGpus = (info.gpus ?? []).filter(
    (gpu) => gpu.vendor?.toLowerCase() === 'nvidia'
  )

  if (nvidiaGpus.length === 0) {
    if (cpuDevice) return { ok: true }
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
  const supported = info.os_type === 'linux'
    ? SUPPORTED_COMPUTE_CAPABILITIES.linux
    : SUPPORTED_COMPUTE_CAPABILITIES.windows
  if (reported.length > 0 && !reported.some((cc) => supported.some((target) => target === cc))) {
    if (cpuDevice) return { ok: true }
    return {
      ok: false,
      reason: `Ginference targets NVIDIA compute capability ${supported.join(', ')}; this GPU reports ${reported.join(', ')}.`,
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

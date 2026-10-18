export type ModelRelease = {
  name: string
  identity: { model_id: string; weights_id: string }
  url: string
  sha256: string
  bytes: number
  tp: 1 | 2 | 4
  qualified_sm: string[]
  min_vram_mib_per_gpu: number
  capabilities: string[]
  // Producer profile payloads are validated by the destination host before transfer.
  launch_profiles?: Record<string, unknown>[]
}
export type ModelDownload = {
  id: string; release: ModelRelease; status: string; received: number
  bytes_per_second: number; error: string | null; path: string | null
}
export type ModelGpu = {
  display_name?: string | null
  uuid: string; name: string; memory_mib: number; compute_capability?: string | null
}

export function validRelease(value: unknown): value is ModelRelease {
  if (!value || typeof value !== 'object') return false
  const r = value as ModelRelease
  try {
    const u = new URL(r.url)
    if (u.username || u.password || u.search || u.hash) return false
    const published = u.protocol === 'https:' && u.hostname === 'huggingface.co' &&
      /^\/[^/]+\/[^/]+\/resolve\/[a-fA-F0-9]{40}\/.+\.ginfer$/.test(u.pathname)
    let privateDevelopment = false
    if (!published && import.meta.env.DEV && import.meta.env.VITE_MODEL_CATALOG_URL) {
      const catalog = new URL(import.meta.env.VITE_MODEL_CATALOG_URL)
      const octets = catalog.hostname.split('.').map(Number)
      const privateIpv4 = octets.length === 4 && octets.every(octet => Number.isInteger(octet) && octet >= 0 && octet <= 255) &&
        (octets[0] === 10 || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
          (octets[0] === 192 && octets[1] === 168))
      privateDevelopment = catalog.protocol === 'http:' &&
        (catalog.hostname === '127.0.0.1' || privateIpv4) &&
        !catalog.username && !catalog.password && !catalog.search && !catalog.hash &&
        u.origin === catalog.origin && u.pathname.endsWith('.ginfer')
    }
    if (!published && !privateDevelopment) return false
  } catch { return false }
  return typeof r.name === 'string' && r.name.trim().length > 0 && r.name.length <= 160 &&
    typeof r.identity?.model_id === 'string' && typeof r.identity?.weights_id === 'string' &&
    /^[a-f0-9]{64}$/.test(r.sha256) && Number.isSafeInteger(r.bytes) && r.bytes >= 16 &&
    [1, 2, 4].includes(r.tp) && Number.isSafeInteger(r.min_vram_mib_per_gpu) && r.min_vram_mib_per_gpu > 0 &&
    Array.isArray(r.qualified_sm) && r.qualified_sm.length > 0 && r.qualified_sm.every(s => /^\d+\.\d+$/.test(s)) &&
    Array.isArray(r.capabilities) && r.capabilities.every(c => typeof c === 'string') &&
    (r.launch_profiles === undefined || (Array.isArray(r.launch_profiles) &&
      r.launch_profiles.every(p => p !== null && typeof p === 'object' && !Array.isArray(p))))
}

/** The one rule for offering a release: well-formed and published with a tested launch profile. Models and Welcome both use it. */
export const releaseVerified = (release: unknown): release is ModelRelease =>
  validRelease(release) && !!release.launch_profiles?.length

export function releaseReadiness(release: unknown, gpus: ModelGpu[]) {
  if (!releaseVerified(release)) return { available: false, reason: 'This model is not ready to download. The publisher still needs to provide verified download details and tested settings.', gpuIds: [] as string[] }
  if (!gpus.length) return { available: false, reason: 'No NVIDIA graphics card was found on the selected computer. Choose a paired computer with a supported NVIDIA graphics card.', gpuIds: [] as string[] }
  const groups = new Map<string, ModelGpu[]>()
  for (const gpu of gpus) {
    if (!gpu.compute_capability || !release.qualified_sm.includes(gpu.compute_capability) || gpu.memory_mib < release.min_vram_mib_per_gpu) continue
    const key = `${gpu.name}:${gpu.compute_capability}`
    groups.set(key, [...(groups.get(key) ?? []), gpu])
  }
  const group = [...groups.values()].find(g => g.length >= release.tp)
  if (!group) return { available: false, reason: `Needs ${release.tp} ${release.tp > 1 ? 'matching supported NVIDIA graphics cards, each' : 'supported NVIDIA graphics card'} with at least ${(release.min_vram_mib_per_gpu / 1024).toFixed(0)} GiB of memory.`, gpuIds: [] as string[] }
  return { available: true, reason: release.tp === 1 ? 'Your graphics card has enough memory and is supported by this model. GChat will check the model file when you load it.' : `Your ${release.tp} matching graphics cards have enough memory. GChat will check that they can work together when you load the model.`, gpuIds: group.slice(0, release.tp).map(g => g.uuid) }
}

// Below 1 GiB, GiB with one decimal reads 0.0 for the first ~50 MiB of a download.
export const formatModelBytes = (bytes: number) => bytes < 1024 ** 3
  ? `${Math.round(bytes / 1024 ** 2)} MiB` : `${(bytes / 1024 ** 3).toFixed(1)} GiB`

const downloadStatusLabels = new Map<string, string>([
  ['queued', 'Waiting to download'], ['downloading', 'Downloading model'],
  ['pausing', 'Saving progress before pausing'], ['paused', 'Paused; resume to continue'],
  ['verifying', 'Checking the downloaded file'], ['installed', 'Download complete'],
  ['failed', 'Download stopped'],
])
export const downloadStatusLabel = (status: string) => downloadStatusLabels.get(status) ?? 'Download status unavailable'

/** Keep diagnostic details separate from the explanation and recovery action. */
export function downloadFailureMessage(error: string | null): string {
  const message = error ?? ''
  if (/not enough (?:free )?(?:disk )?space|insufficient (?:disk )?space|no space left|disk (?:is )?full|os error (?:28|112)\b/i.test(message)) {
    return 'There isn’t enough space in the model folder. Free some disk space, then resume the download.'
  }
  if (/checksum|sha-?256/i.test(message)) {
    return 'The downloaded file is damaged or incomplete. Remove this incomplete download, then download the model again.'
  }
  if (/\bhttp(?:\/[\d.]+)?(?:\s+(?:status|error))?\s*:?\s*[45]\d\d\b|download server returned [45]\d\d\b|\bstatus(?: code)?\s*:?\s*[45]\d\d\b/i.test(message)) {
    return 'The download site couldn’t provide this model. Refresh the model list or try again later.'
  }
  if (/network|connect|dns|timed? out|timeout|did not respond|stalled|error sending request|error decoding response body|request or response body|download ended before the declared size/i.test(message)) {
    return 'The download was interrupted. Check your internet connection, then resume the download.'
  }
  return 'The download couldn’t finish. Try resuming it, or open the details below for more information.'
}

/** Hardware measurement and speed tuning write temporary files next to the models. */
export const WORKING_SPACE_BYTES = 2 * 1024 ** 3

/** Plain warning when the chosen models plus working space may not fit; `block` when even the download cannot fit. */
export function diskSpaceWarning(needed: number, free: number | null | undefined): { text: string; block: boolean } | undefined {
  if (free == null || needed <= 0 || free >= needed + WORKING_SPACE_BYTES) return undefined
  const block = free < needed
  return {
    block,
    text: `${block ? 'Not enough free disk space.' : 'Free disk space is low.'} The selected models need ${formatModelBytes(needed)}, plus about ${formatModelBytes(WORKING_SPACE_BYTES)} of working space while GInfer measures your hardware. Only ${formatModelBytes(free)} is free in this folder. ${block ? 'Free some space or choose another folder before downloading.' : 'Free some space or choose another folder to avoid running out of disk.'}`,
  }
}

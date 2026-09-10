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
  uuid: string; name: string; memory_mib: number; compute_capability?: string | null
}

export function validRelease(value: unknown): value is ModelRelease {
  if (!value || typeof value !== 'object') return false
  const r = value as ModelRelease
  try {
    const u = new URL(r.url)
    if (u.protocol !== 'https:' || u.hostname !== 'huggingface.co' || u.username || u.password || u.search || u.hash ||
      !/^\/[^/]+\/[^/]+\/resolve\/[a-fA-F0-9]{40}\/.+\.ginfer$/.test(u.pathname)) return false
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

export function releaseReadiness(release: unknown, gpus: ModelGpu[]) {
  if (!validRelease(release)) return { available: false, reason: 'Release not published with verified compatibility, size and checksum.', gpuIds: [] as string[] }
  if (!gpus.length) return { available: false, reason: 'No NVIDIA GPU detected on this host. Select a paired LAN host.', gpuIds: [] as string[] }
  const groups = new Map<string, ModelGpu[]>()
  for (const gpu of gpus) {
    if (!gpu.compute_capability || !release.qualified_sm.includes(gpu.compute_capability) || gpu.memory_mib < release.min_vram_mib_per_gpu) continue
    const key = `${gpu.name}:${gpu.compute_capability}`
    groups.set(key, [...(groups.get(key) ?? []), gpu])
  }
  const group = [...groups.values()].find(g => g.length >= release.tp)
  if (!group) return { available: false, reason: `Requires ${release.tp} matching GPU${release.tp > 1 ? 's' : ''}, SM ${release.qualified_sm.join(' / ')}, and at least ${(release.min_vram_mib_per_gpu / 1024).toFixed(0)} GiB on each GPU.`, gpuIds: [] as string[] }
  return { available: true, reason: release.tp === 1 ? 'Qualified hardware match. The engine validates the package when loading.' : 'Hardware matches; peer connectivity must pass the engine’s TP check before loading.', gpuIds: group.slice(0, release.tp).map(g => g.uuid) }
}

export const formatModelBytes = (bytes: number) => `${(bytes / 1024 ** 3).toFixed(1)} GiB`

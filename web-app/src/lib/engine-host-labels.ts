import type { EngineInstance, EngineModel, EngineSnapshot } from '@/services/engines'

/** Trailing package hashes in catalog names, e.g. "Qwen 27B 2-bit mix (483343c2...)". */
export const plainModelName = (name: string) => name.replace(/\s*\([a-f0-9]{64}\)\s*$/i, '')

/** Profile names come from the Host; older Hosts still say SMOL for the 2-bit packages. */
export const plainProfileName = (name: string) =>
  name.replace(/\bFlash SMOL\b/g, 'Flash pure 2-bit').replace(/\bSMOL\b/g, '2-bit mix')

const familyName = (modelId: string) => {
  if (/^qwen3\.8-27b$/i.test(modelId)) return 'Qwen 3.8 27B'
  if (/^muse-glimmer-30b$/i.test(modelId)) return 'Muse 30B'
  if (/^qwen3\.8-flash-next/i.test(modelId)) return 'Qwen 3.8 Flash'
  return modelId.replace(/^muse-glimmer-/i, 'Muse ').replace(/^qwen/i, 'Qwen ').replace(/-/g, ' ').replace(/(\d)b\b/gi, '$1B')
}

/** The plain name of a package format: "2-bit mix" (Qwen 27B, Muse 30B), "pure 2-bit" (Flash), INT or NVFP4. */
export function plainWeightsName(modelId: string, weightsId: string): string {
  const id = weightsId.toLowerCase()
  if (id.includes('smol')) return /flash/i.test(modelId) ? 'pure 2-bit' : '2-bit mix'
  if (id.includes('nvfp4')) return 'NVFP4'
  if (/(^|[-_])(int|groupwise)/.test(id) || id.startsWith('int')) return 'INT'
  return weightsId.split(/[-_]/).map(part => part.toUpperCase()).join(' ')
}

/** The speculative-decoding drafter built into a package, for a details line only. */
export function weightsDrafterDetail(weightsId: string): string | undefined {
  const match = weightsId.toLowerCase().match(/dflash2?|mtp/)
  return match ? `Speculative drafter: ${match[0] === 'mtp' ? 'MTP' : match[0] === 'dflash2' ? 'DFlash2' : 'DFlash'}` : undefined
}

export const identityLabel = (identity: { model_id: string; weights_id: string }) =>
  `${familyName(identity.model_id)} — ${plainWeightsName(identity.model_id, identity.weights_id)}`

export function hostModelLabel(model: EngineModel): string {
  return identityLabel(model.metadata.identity)
}

/** The instance's name: its own, unless the Host only filled in an id or the package identity. */
export function hostInstanceName(instance: EngineInstance, snapshot: EngineSnapshot): string {
  const modelId = instance.profile?.model_id ?? instance.upstream_model_id
  const model = snapshot.models?.find((candidate) => candidate.id === modelId)
  const generated = !instance.display_name || instance.display_name === modelId ||
    instance.display_name === instance.instance_id || /[a-f0-9]{24,}|^[a-f0-9-]{36}$/i.test(instance.display_name) ||
    (!!model && instance.display_name === `${model.metadata.identity.model_id}/${model.metadata.identity.weights_id}`)
  return generated ? (model ? hostModelLabel(model) : 'Model unavailable') : instance.display_name
}

export function hostInstanceLabel(instance: EngineInstance, snapshot: EngineSnapshot): string {
  const name = hostInstanceName(instance, snapshot)
  const config = instance.profile ?? instance.configuration
  const gpuNumbers = config.gpu_uuids.map((uuid) => {
    const index = snapshot.gpus.findIndex((gpu) => gpu.uuid === uuid)
    return index >= 0 ? String(index + 1) : 'unavailable'
  })
  const index = snapshot.instances.findIndex((candidate) => candidate.instance_id === instance.instance_id) + 1
  const concurrency = config.concurrency > 0 ? `${config.concurrency} concurrent` : 'Automatic concurrency'
  const context = config.max_context > 0 ? `${config.max_context.toLocaleString()} context` : 'Automatic context'
  return `Instance ${index} · ${name} · ${concurrency} · ${context} · GPU ${gpuNumbers.join(', ') || 'automatic'}`
}

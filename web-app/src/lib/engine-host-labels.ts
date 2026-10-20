import type { EngineInstance, EngineModel, EngineSnapshot } from '@/services/engines'

/** Model naming (Ron, October 20): 2-bit packages are SMOL; 4-bit packages are INT or NVFP4.
 *  Older catalogs and Hosts still say "2-bit mix" or "pure 2-bit". */
const smolName = (name: string) => name.replace(/\b(?:2-bit mix|pure 2-bit)\b/gi, 'SMOL')

/** Catalog names without a trailing package hash, e.g. "Qwen 27B SMOL (483343c2...)". */
export const plainModelName = (name: string) => smolName(name.replace(/\s*\([a-f0-9]{64}\)\s*$/i, ''))

/** Profile names come from the Host and catalogs. */
export const plainProfileName = (name: string) => smolName(name)

const familyName = (modelId: string) => {
  if (/^qwen3\.8-27b$/i.test(modelId)) return 'Qwen 3.8 27B'
  if (/^muse-glimmer-30b$/i.test(modelId)) return 'Muse 30B'
  if (/^qwen3\.8-flash-next/i.test(modelId)) return 'Qwen 3.8 Flash'
  return modelId.replace(/^muse-glimmer-/i, 'Muse ').replace(/^qwen/i, 'Qwen ').replace(/-/g, ' ').replace(/(\d)b\b/gi, '$1B')
}

/** The plain name of a package format: SMOL (2-bit), INT or NVFP4. */
export function plainWeightsName(_modelId: string, weightsId: string): string {
  const id = weightsId.toLowerCase()
  if (id.includes('smol')) return 'SMOL'
  if (id.includes('nvfp4')) return 'NVFP4'
  if (/(^|[-_])(int|groupwise)/.test(id) || id.startsWith('int')) return 'INT'
  return weightsId.split(/[-_]/).map(part => part.toUpperCase()).join(' ')
}

/** The speculative-decoding drafter built into a package, for a details line only. */
export function weightsDrafterDetail(weightsId: string): string | undefined {
  const match = weightsId.toLowerCase().match(/dflash2?|mtp/)
  return match ? `Speculative drafter: ${match[0] === 'mtp' ? 'MTP' : match[0] === 'dflash2' ? 'DFlash2' : 'DFlash'}` : undefined
}

/** A startup profile's "model/package" id as a readable name; ids without a package stay as they are. */
export function plainStartupModelName(id: string): string {
  const [modelId, weightsId] = id.split('/')
  return weightsId ? identityLabel({ model_id: modelId, weights_id: weightsId }) : id
}

/** A graphics card's readable name; "card n of m" is added only when several cards share a name. */
export function gpuCardName(gpus: { name: string; display_name?: string | null }[], index: number): string {
  const name = gpus[index].display_name ?? gpus[index].name
  const same = gpus.filter(gpu => (gpu.display_name ?? gpu.name) === name).length > 1
  return same ? `${name} (card ${index + 1} of ${gpus.length})` : name
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
  const concurrency = config.concurrency > 0 ? `${config.concurrency} requests at once` : 'Concurrency: automatic'
  const context = config.max_context > 0 ? `${config.max_context.toLocaleString()} context tokens` : 'Context length: automatic'
  return `Model server ${index} · ${name} · ${concurrency} · ${context} · Graphics cards ${gpuNumbers.join(', ') || 'chosen automatically'}`
}

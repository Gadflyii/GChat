import type { EngineInstance, EngineModel, EngineSnapshot } from '@/services/engines'

export function hostModelLabel(model: EngineModel): string {
  const identity = model.metadata.identity
  const name = identity.model_id
    .replace(/^muse-glimmer-/i, 'Muse Glimmer ')
    .replace(/^qwen/i, 'Qwen')
    .replace(/-/g, ' ')
    .replace(/(\d)b\b/gi, '$1B')
  const weights = identity.weights_id.split(/[-_]/).map((part) => {
    if (part === 'groupwise') return 'Groupwise'
    if (part === 'dflash2') return 'DFlash2'
    if (part === 'dflash') return 'DFlash'
    return part.toUpperCase()
  }).join(' ')
  return `${name} · ${weights}`
}

export function hostInstanceLabel(instance: EngineInstance, snapshot: EngineSnapshot): string {
  const modelId = instance.profile?.model_id ?? instance.upstream_model_id
  const model = snapshot.models.find((candidate) => candidate.id === modelId)
  const generated = !instance.display_name || instance.display_name === modelId ||
    instance.display_name === instance.instance_id || /[a-f0-9]{24,}|^[a-f0-9-]{36}$/i.test(instance.display_name)
  const name = generated ? (model ? hostModelLabel(model) : 'Model unavailable') : instance.display_name
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

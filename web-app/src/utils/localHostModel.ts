import { engineAlias, engineCommand, type EngineSnapshot } from '@/services/engines'
import { useEngineHosts } from '@/stores/engine-hosts-store'
import { MODEL_LOAD_WATCHDOG_MS, withTimeout } from '@/lib/utils'
import { isLocalProvider } from '@/utils/registerRemoteProvider'

export function localHostModel(modelId: string) {
  const [prefix, hostId, instanceId, extra] = modelId.split('/')
  if (prefix !== 'ginfer' || !instanceId || extra !== undefined) return undefined
  return useEngineHosts.getState().hosts.find(host => host.local && host.host_id === hostId)
    ? { host_id: hostId, instance_id: instanceId }
    : undefined
}

export function isLocallyOwnedModel(provider: string | undefined | null, model: string) {
  return isLocalProvider(provider) || (provider === 'ginfer-lan' && !!localHostModel(model))
}

export function readyLocalHostModels(): string[] {
  const state = useEngineHosts.getState()
  return state.hosts.filter(host => host.local && !state.errors[host.host_id]).flatMap(host =>
    (state.snapshots[host.host_id]?.instances ?? []).filter(instance => instance.status === 'ready')
      .map(instance => engineAlias(host.host_id, instance.instance_id)))
}

export async function controlLocalHostModel(modelId: string, operation: 'start' | 'stop' | 'restart') {
  const target = localHostModel(modelId)
  if (!target) throw new Error('This model does not belong to the local Host.')
  const deadline = Date.now() + MODEL_LOAD_WATCHDOG_MS
  const snapshot = () => withTimeout(engineCommand<EngineSnapshot>('snapshot', { host_id: target.host_id }),
    Math.max(1, deadline - Date.now()), 'Timed out waiting for the local Host model.')
  let result = await snapshot()
  const current = result.instances.find(instance => instance.instance_id === target.instance_id)
  if (!current) throw new Error('The local Host instance is no longer available.')
  if (!(operation === 'start' && ['ready', 'starting'].includes(current.status))) {
    result = await engineCommand<EngineSnapshot>(operation, {
      ...target, body: { expected_session_id: current.session_id, force: false },
    })
  }
  const session = result.instances.find(instance => instance.instance_id === target.instance_id)?.session_id
  while (true) {
    useEngineHosts.getState().publishSnapshot(target.host_id, result)
    const instance = result.instances.find(instance => instance.instance_id === target.instance_id)
    if (!instance || instance.session_id !== session) throw new Error('The local Host session changed.')
    if (operation === 'stop') {
      if (instance.status !== 'stopped') throw new Error('The local Host did not confirm the model stopped.')
      return
    }
    if (instance.status === 'ready') return
    if (instance.status !== 'starting') throw new Error(instance.last_error || 'The local Host model did not become ready.')
    if (Date.now() >= deadline) throw new Error('Timed out waiting for the local Host model.')
    await new Promise(resolve => setTimeout(resolve, 1000))
    if (Date.now() >= deadline) throw new Error('Timed out waiting for the local Host model.')
    result = await snapshot()
  }
}

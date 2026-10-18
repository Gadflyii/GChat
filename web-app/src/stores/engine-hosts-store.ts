import { create } from 'zustand'
import { engineCommand, type EngineHost, type NearbyHost, type EngineSnapshot, type EngineHardwareProfile } from '@/services/engines'
import { engineAlias } from '@/services/engines'
import { hostInstanceName } from '@/lib/engine-host-labels'
import { useModelProvider } from '@/hooks/useModelProvider'
import { useLocalApiServer } from '@/hooks/useLocalApiServer'

type State = {
  hosts: EngineHost[]; nearby: NearbyHost[]; snapshots: Record<string, EngineSnapshot>;
  errors: Record<string, string>; refreshing: boolean; discoveryError: string | null;
  refresh: () => Promise<void>; discover: (enabled: boolean) => Promise<void>
  publishSnapshot: (hostId: string, snapshot: EngineSnapshot) => void
  publishHardwareProfile: (hostId: string, profile: EngineHardwareProfile) => void
}
export const hasReadyHostInstance = (state: Pick<State, 'hosts' | 'snapshots' | 'errors'>) =>
  state.hosts.some((host) => !state.errors[host.host_id] &&
    state.snapshots[host.host_id]?.instances.some((instance) => instance.status === 'ready'))

function projectHostModels(hosts: EngineHost[], snapshots: Record<string, EngineSnapshot>, errors: Record<string, string>) {
  const settings = useLocalApiServer.getState()
  const provider: ModelProvider = {
    provider: 'ginfer-lan', active: true, settings: [],
    base_url: `http://127.0.0.1:${settings.serverPort}/${settings.apiPrefix.replace(/^\/+|\/+$/g, '')}`,
    api_key: settings.apiKey,
    models: hosts.filter(host => !errors[host.host_id]).flatMap(host => (snapshots[host.host_id]?.instances ?? [])
      .filter(instance => instance.status === 'ready')
      .map(instance => ({ id: engineAlias(host.host_id, instance.instance_id),
        displayName: `${hostInstanceName(instance, snapshots[host.host_id])} — ${snapshots[host.host_id].display_name}`,
        format: 'ginfer', capabilities: ['tools', 'reasoning', ...(instance.configuration.vision ? ['vision'] : [])],
      }))),
  }
  const providers = useModelProvider.getState()
  const existing = providers.getProviderByName(provider.provider)
  if (existing) {
    const projection = { provider: existing.provider, active: existing.active, settings: existing.settings, base_url: existing.base_url, api_key: existing.api_key, models: existing.models }
    if (JSON.stringify(projection) !== JSON.stringify(provider)) providers.updateProvider(provider.provider, provider)
  } else if (provider.models.length) providers.addProvider(provider)
  // With nothing chosen yet, the one ready model is the chat model; an explicit
  // choice (any selected model) is never replaced.
  if (provider.models.length === 1 && !useModelProvider.getState().selectedModel) {
    useModelProvider.getState().selectModelProvider(provider.provider, provider.models[0].id)
  }
}

export const useEngineHosts = create<State>((set, get) => {
  const fullPublications = new Map<string, EngineSnapshot>()
  return {
    hosts: [], nearby: [], snapshots: {}, errors: {}, refreshing: false, discoveryError: null,
    publishSnapshot: (hostId, snapshot) => {
      fullPublications.set(hostId, snapshot)
      const state = get()
      const snapshots = { ...state.snapshots, [hostId]: snapshot }
      const errors = { ...state.errors }
      delete errors[hostId]
      projectHostModels(state.hosts, snapshots, errors)
      set({ snapshots, errors })
    },
    publishHardwareProfile: (hostId, profile) => {
      const snapshots = get().snapshots
      const snapshot = snapshots[hostId]
      if (!snapshot) return
      set({ snapshots: { ...snapshots, [hostId]: { ...snapshot, hardware_profile: profile } } })
    },
    discover: async (enabled) => {
      try { await engineCommand('discovery', { enabled }); set({ discoveryError: null }) }
      catch (e) { set({ discoveryError: String(e) }) }
    },
    refresh: async () => {
      if (get().refreshing) return
      set({ refreshing: true })
      try {
        const listed = await engineCommand<{ registered: EngineHost[]; discovered: NearbyHost[] }>('list')
        const initialSnapshots = get().snapshots
        const initialPublications = new Map(fullPublications)
        const snapshots = { ...initialSnapshots }; const errors: Record<string, string> = {}
        await Promise.all(listed.registered.map(async (host) => {
          try { snapshots[host.host_id] = await engineCommand<EngineSnapshot>('snapshot', { host_id: host.host_id }) }
          catch (e) { errors[host.host_id] = String(e) }
        }))
        // Full lifecycle responses own the newer view, even after a Host restart.
        // A profile response owns only that field, not newer models or instances.
        const published = get().snapshots
        for (const host of listed.registered) {
          const current = published[host.host_id]
          const read = snapshots[host.host_id]
          if (!current) continue
          if (fullPublications.get(host.host_id) !== initialPublications.get(host.host_id)) {
            snapshots[host.host_id] = current
            delete errors[host.host_id]
          } else if (read && current.hardware_profile !== initialSnapshots[host.host_id]?.hardware_profile &&
            read.boot_id === current.boot_id) {
            snapshots[host.host_id] = { ...read, hardware_profile: current.hardware_profile }
          }
        }
        for (const id of Object.keys(snapshots)) if (!listed.registered.some((h) => h.host_id === id)) delete snapshots[id]
        // This is a picker projection of the native host registry, not a second
        // registration authority. The facade resolves each opaque instance alias.
        projectHostModels(listed.registered, snapshots, errors)
        set({ hosts: listed.registered, nearby: listed.discovered, snapshots, errors })
      } finally { set({ refreshing: false }) }
    },
  }
})

// The facade can receive an OS-assigned port. Keep existing picker routes in
// sync immediately rather than waiting for the next network snapshot poll.
useLocalApiServer.subscribe((settings, previous) => {
  if (settings.serverPort === previous.serverPort && settings.apiPrefix === previous.apiPrefix && settings.apiKey === previous.apiKey) return
  const providers = useModelProvider.getState()
  if (providers.getProviderByName('ginfer-lan')) providers.updateProvider('ginfer-lan', {
    base_url: `http://127.0.0.1:${settings.serverPort}/${settings.apiPrefix.replace(/^\/+|\/+$/g, '')}`,
    api_key: settings.apiKey,
  })
})

import { create } from 'zustand'
import { engineCommand, type EngineHost, type NearbyHost, type EngineSnapshot } from '@/services/engines'
import { engineAlias } from '@/services/engines'
import { useModelProvider } from '@/hooks/useModelProvider'
import { useLocalApiServer } from '@/hooks/useLocalApiServer'

type State = {
  hosts: EngineHost[]; nearby: NearbyHost[]; snapshots: Record<string, EngineSnapshot>;
  errors: Record<string, string>; refreshing: boolean; discoveryError: string | null;
  refresh: () => Promise<void>; discover: (enabled: boolean) => Promise<void>
}
export const hasReadyLanInstance = (state: Pick<State, 'snapshots' | 'errors'>) =>
  Object.values(state.snapshots).some((snapshot) => !state.errors[snapshot.host_id] &&
    snapshot.instances.some((instance) => instance.status === 'ready'))

export const useEngineHosts = create<State>((set, get) => ({
  hosts: [], nearby: [], snapshots: {}, errors: {}, refreshing: false, discoveryError: null,
  discover: async (enabled) => {
    try { await engineCommand('discovery', { enabled }); set({ discoveryError: null }) }
    catch (e) { set({ discoveryError: String(e) }) }
  },
  refresh: async () => {
    if (get().refreshing) return
    set({ refreshing: true })
    try {
      const listed = await engineCommand<{ registered: EngineHost[]; discovered: NearbyHost[] }>('list')
      const snapshots = { ...get().snapshots }; const errors: Record<string, string> = {}
      await Promise.all(listed.registered.map(async (host) => {
        try { snapshots[host.host_id] = await engineCommand<EngineSnapshot>('snapshot', { host_id: host.host_id }) }
        catch (e) { errors[host.host_id] = String(e) }
      }))
      for (const id of Object.keys(snapshots)) if (!listed.registered.some((h) => h.host_id === id)) delete snapshots[id]
      // This is a picker projection of the native host registry, not a second
      // registration authority. The facade resolves each opaque instance alias.
      const settings = useLocalApiServer.getState()
      const provider: ModelProvider = {
        provider: 'ginfer-lan', active: true, settings: [],
        base_url: `http://127.0.0.1:${settings.serverPort}/${settings.apiPrefix.replace(/^\/+|\/+$/g, '')}`,
        api_key: settings.apiKey,
        models: Object.values(snapshots).flatMap((snapshot) => snapshot.instances
          .filter((instance) => instance.status === 'ready')
          .map((instance) => ({ id: engineAlias(snapshot.host_id, instance.instance_id),
            displayName: `${instance.display_name} — ${snapshot.display_name}${errors[snapshot.host_id] ? ' (offline)' : ''}`,
            // Registered GInfer targets support tools/reasoning; Vision is an
            // explicit startup option, advertised only after that launch is ready.
            format: 'ginfer', capabilities: ['tools', 'reasoning', ...(instance.configuration.vision ? ['vision'] : [])],
          }))),
      }
      const providers = useModelProvider.getState()
      const existing = providers.getProviderByName(provider.provider)
      if (existing) {
        const projection = { provider: existing.provider, active: existing.active, settings: existing.settings, base_url: existing.base_url, api_key: existing.api_key, models: existing.models }
        if (JSON.stringify(projection) !== JSON.stringify(provider)) providers.updateProvider(provider.provider, provider)
      }
      else if (provider.models.length) providers.addProvider(provider)
      set({ hosts: listed.registered, nearby: listed.discovered, snapshots, errors })
    } finally { set({ refreshing: false }) }
  },
}))

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

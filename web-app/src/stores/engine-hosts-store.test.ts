import { describe, expect, it, vi } from 'vitest'
import { useLocalApiServer } from '@/hooks/useLocalApiServer'
import { useEngineHosts, hasReadyLanInstance } from '@/stores/engine-hosts-store'
import { engineCommand } from '@/services/engines'

const providers = vi.hoisted(() => ({
  getProviderByName: vi.fn(() => ({ provider: 'ginfer-lan' })),
  updateProvider: vi.fn(),
}))
vi.mock('@/hooks/useModelProvider', () => ({
  useModelProvider: { getState: () => providers },
}))
vi.mock('@/services/engines', async (original) => ({
  ...(await original<object>()),
  engineCommand: vi.fn(),
}))

describe('LAN facade address projection', () => {
  it('keeps local hosts in infrastructure but excludes their models from LAN choices', async () => {
    const hosts = [
      { host_id: 'local', local: true, name: 'This computer' },
      { host_id: 'remote', local: false, name: 'Server' },
    ]
    vi.mocked(engineCommand).mockImplementation(async (action, args) => {
      if (action === 'list') return { registered: hosts, discovered: [] } as never
      return { host_id: args?.host_id, display_name: args?.host_id, instances: [{
        instance_id: 'one', display_name: 'Muse', status: 'ready', configuration: {},
      }] } as never
    })
    providers.updateProvider.mockClear()
    await useEngineHosts.getState().refresh()
    const projection = providers.updateProvider.mock.calls.at(-1)?.[1]
    expect(projection.models.map((m: { id: string }) => m.id)).toEqual(['ginfer/remote/one'])
    expect(useEngineHosts.getState().hosts).toHaveLength(2)
    expect(hasReadyLanInstance(useEngineHosts.getState())).toBe(true)
    expect(hasReadyLanInstance({ ...useEngineHosts.getState(), hosts: useEngineHosts.getState().hosts.filter(h => h.local) })).toBe(false)
  })
  it('does not republish an unchanged provider projection during capacity refresh', async () => {
    const settings = useLocalApiServer.getState()
    const existing = {
      provider: 'ginfer-lan',
      active: true,
      settings: [],
      models: [],
      base_url: `http://127.0.0.1:${settings.serverPort}/${settings.apiPrefix.replace(/^\/+|\/+$/g, '')}`,
      api_key: settings.apiKey,
    }
    providers.getProviderByName.mockReturnValue(existing)
    providers.updateProvider.mockClear()
    vi.mocked(engineCommand).mockResolvedValue({
      registered: [],
      discovered: [],
    })
    await useEngineHosts.getState().refresh()
    expect(useEngineHosts.getState().refreshing).toBe(false)
    expect(useEngineHosts.getState().hosts).toEqual([])
    expect(providers.updateProvider).not.toHaveBeenCalled()
  })
  it('removes unavailable hosts from chat choices while retaining their saved inventory', async () => {
    const host = { host_id: 'remote', name: 'Server', local: false }
    vi.mocked(engineCommand).mockImplementation(async action => {
      if (action === 'list') return { registered: [host], discovered: [] } as never
      return { host_id: 'remote', display_name: 'Server', instances: [
        { instance_id: 'ready', display_name: 'Running model', status: 'ready', configuration: {} },
        { instance_id: 'saved', display_name: 'Saved model', status: 'stopped', configuration: {} },
      ] } as never
    })
    await useEngineHosts.getState().refresh()
    expect(providers.updateProvider.mock.calls.at(-1)?.[1].models).toHaveLength(1)
    providers.getProviderByName.mockReturnValue(providers.updateProvider.mock.calls.at(-1)?.[1])
    vi.mocked(engineCommand).mockImplementation(async action => {
      if (action === 'list') return { registered: [host], discovered: [] } as never
      throw new Error('Host offline')
    })
    await useEngineHosts.getState().refresh()
    expect(providers.updateProvider.mock.calls.at(-1)?.[1].models).toEqual([])
    expect(useEngineHosts.getState().snapshots.remote.instances).toHaveLength(2)
  })
  it('updates existing model routes immediately when the facade assigns a port or changes credentials', () => {
    useLocalApiServer.setState({
      serverPort: 14567,
      apiPrefix: '/v1/',
      apiKey: 'local-test-key',
    })
    expect(providers.updateProvider).toHaveBeenLastCalledWith('ginfer-lan', {
      base_url: 'http://127.0.0.1:14567/v1',
      api_key: 'local-test-key',
    })
  })
})

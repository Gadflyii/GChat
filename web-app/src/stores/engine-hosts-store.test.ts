import { describe, expect, it, vi } from 'vitest'
import { useLocalApiServer } from '@/hooks/useLocalApiServer'
import { useEngineHosts, hasReadyHostInstance } from '@/stores/engine-hosts-store'
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

describe('Host facade address projection', () => {
  it.each([21, 1])('retains a lifecycle Stop publication at revision %s when an earlier read finishes late', async revision => {
    const host = { host_id: 'local', local: true, name: 'This computer' }
    const ready = { host_id: 'local', revision: 20, instances: [{ instance_id: 'one', status: 'ready', configuration: {} }] }
    const stopped = { ...ready, revision, instances: [{ ...ready.instances[0], status: 'stopped' }] }
    useEngineHosts.setState({ hosts: [host] as never, snapshots: { local: ready } as never, refreshing: false, errors: {} })
    let releaseSnapshot: (snapshot: unknown) => void = () => {}
    let readStarted: () => void = () => {}
    const started = new Promise<void>(resolve => { readStarted = resolve })
    vi.mocked(engineCommand).mockImplementation(async action => {
      if (action === 'list') return { registered: [host], discovered: [] } as never
      return new Promise(resolve => { releaseSnapshot = resolve; readStarted() })
    })
    const refresh = useEngineHosts.getState().refresh()
    await started
    useEngineHosts.getState().publishSnapshot('local', stopped as never)
    releaseSnapshot(ready)
    await refresh
    expect(useEngineHosts.getState().snapshots.local.instances[0].status).toBe('stopped')
    expect(useEngineHosts.getState().snapshots.local.revision).toBe(revision)
    expect(providers.updateProvider.mock.calls.at(-1)?.[1].models).toEqual([])
    expect(hasReadyHostInstance(useEngineHosts.getState())).toBe(false)
  })
  it('projects ready local and remote instances and treats either as host readiness', async () => {
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
    expect(projection.models.map((m: { id: string }) => m.id)).toEqual([
      'ginfer/local/one',
      'ginfer/remote/one',
    ])
    expect(useEngineHosts.getState().hosts).toHaveLength(2)
    expect(hasReadyHostInstance(useEngineHosts.getState())).toBe(true)
    const localOnly = { ...useEngineHosts.getState(), hosts: useEngineHosts.getState().hosts.filter(h => h.local) }
    expect(hasReadyHostInstance(localOnly)).toBe(true)
    expect(hasReadyHostInstance({ ...localOnly, errors: { local: 'offline' } })).toBe(false)
    expect(hasReadyHostInstance({ ...localOnly, snapshots: { local: { host_id: 'local', instances: [{ status: 'stopped' }] } as never } })).toBe(false)
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
  it('removes stopped and offline local or remote instances from chat choices', async () => {
    const hosts = [
      { host_id: 'local', name: 'This computer', local: true },
      { host_id: 'remote', name: 'Server', local: false },
    ]
    vi.mocked(engineCommand).mockImplementation(async (action, args) => {
      if (action === 'list') return { registered: hosts, discovered: [] } as never
      const hostId = args?.host_id
      return { host_id: hostId, display_name: hostId, instances: [
        { instance_id: 'ready', display_name: 'Running model', status: 'ready', configuration: {} },
        { instance_id: 'saved', display_name: 'Saved model', status: 'stopped', configuration: {} },
      ] } as never
    })
    await useEngineHosts.getState().refresh()
    expect(providers.updateProvider.mock.calls.at(-1)?.[1].models.map((m: { id: string }) => m.id)).toEqual([
      'ginfer/local/ready',
      'ginfer/remote/ready',
    ])
    providers.getProviderByName.mockReturnValue(providers.updateProvider.mock.calls.at(-1)?.[1])
    vi.mocked(engineCommand).mockImplementation(async (action, args) => {
      if (action === 'list') return { registered: hosts, discovered: [] } as never
      const hostId = args?.host_id
      if (hostId === 'local') throw new Error('Host offline')
      return { host_id: hostId, display_name: hostId, instances: [
        { instance_id: 'ready', display_name: 'Running model', status: 'ready', configuration: {} },
        { instance_id: 'saved', display_name: 'Saved model', status: 'stopped', configuration: {} },
      ] } as never
    })
    await useEngineHosts.getState().refresh()
    expect(providers.updateProvider.mock.calls.at(-1)?.[1].models.map((m: { id: string }) => m.id)).toEqual([
      'ginfer/remote/ready',
    ])
    expect(useEngineHosts.getState().snapshots.local.instances).toHaveLength(2)
    expect(useEngineHosts.getState().hosts).toHaveLength(2)

    vi.mocked(engineCommand).mockImplementation(async (action, args) => {
      if (action === 'list') return { registered: hosts, discovered: [] } as never
      const hostId = args?.host_id
      return { host_id: hostId, display_name: hostId, instances: hostId === 'local' ? [
        { instance_id: 'ready', display_name: 'Stopped model', status: 'stopped', configuration: {} },
      ] : [
        { instance_id: 'ready', display_name: 'Running model', status: 'ready', configuration: {} },
      ] } as never
    })
    await useEngineHosts.getState().refresh()
    expect(providers.updateProvider.mock.calls.at(-1)?.[1].models.map((m: { id: string }) => m.id)).toEqual([
      'ginfer/remote/ready',
    ])

    vi.mocked(engineCommand).mockImplementation(async (action, args) => {
      if (action === 'list') return { registered: hosts, discovered: [] } as never
      const hostId = args?.host_id
      if (hostId === 'remote') throw new Error('Host offline')
      return { host_id: hostId, display_name: hostId, instances: [
        { instance_id: 'ready', display_name: 'Stopped model', status: 'stopped', configuration: {} },
      ] } as never
    })
    await useEngineHosts.getState().refresh()
    expect(providers.updateProvider.mock.calls.at(-1)?.[1].models).toEqual([])
    expect(useEngineHosts.getState().snapshots.remote.instances).toHaveLength(1)
    expect(useEngineHosts.getState().hosts).toHaveLength(2)
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

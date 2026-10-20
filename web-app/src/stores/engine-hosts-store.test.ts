import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useLocalApiServer } from '@/hooks/useLocalApiServer'
import { useEngineHosts, hasReadyHostInstance } from '@/stores/engine-hosts-store'
import { engineCommand, type EngineHardwareProfile, type EngineHost, type EngineSnapshot } from '@/services/engines'

const providers = vi.hoisted(() => ({
  getProviderByName: vi.fn(() => ({ provider: 'ginfer-lan' })),
  updateProvider: vi.fn(),
  selectModelProvider: vi.fn(),
  selectedModel: null as unknown,
}))
vi.mock('@/hooks/useModelProvider', () => ({
  useModelProvider: { getState: () => providers },
}))
vi.mock('@/services/engines', async (original) => ({
  ...(await original<object>()),
  engineCommand: vi.fn(),
}))

describe('Host hardware-profile publication', () => {
  const host: EngineHost = { host_id: 'local', local: true, name: 'This computer',
    base_url: 'https://localhost', certificate_sha256: '', client_id: 'client' }
  const idle: EngineHardwareProfile = {
    status: 'idle', job_id: null, pid: null, reprofile: false,
    started_unix_ms: null, finished_unix_ms: null, profile_path: '/hardware.json',
    gpu_uuids: ['GPU-one'], engine_path: '/bin/ginfer', pending_gpu_groups: [], stale_groups: [],
    checkpoint_available: false, diagnostic_tail: '', error: null, available: true,
  }
  const cancelled: EngineHardwareProfile = { ...idle, status: 'cancelled', job_id: 'job',
    started_unix_ms: 100, finished_unix_ms: 200 }
  const initial: EngineSnapshot = {
    host_id: 'local', display_name: 'This computer', revision: 20, boot_id: 'first-boot', gpus: [],
    models: [{ id: 'old-model', path: '/old.ginfer', artifact_set: false,
      metadata: { identity: { model_id: 'qwen3.8-27b', weights_id: 'nvfp4' }, tp_size: 1, draft_tp: 0, size_bytes: 1 } }],
    instances: [{ instance_id: 'old-instance', session_id: 'old-session', display_name: 'Old model',
      upstream_model_id: 'old-model', status: 'ready', configuration: { gpu_uuids: ['GPU-one'], max_context: 4096, concurrency: 1 } }],
    hardware_profile: idle,
  }
  beforeEach(() => {
    useEngineHosts.setState({ hosts: [host], snapshots: { local: initial }, refreshing: false, errors: {} })
    providers.getProviderByName.mockReturnValue({ provider: 'ginfer-lan' })
    providers.updateProvider.mockClear()
    providers.selectModelProvider.mockClear()
  })
  const pendingRead = () => {
    let resolve!: (snapshot: EngineSnapshot) => void
    let reject!: (error: Error) => void
    let readStarted!: () => void
    const started = new Promise<void>(done => { readStarted = done })
    const response = new Promise<EngineSnapshot>((done, fail) => { resolve = done; reject = fail })
    vi.mocked(engineCommand).mockImplementation(async action => {
      if (action === 'list') return { registered: [host], discovered: [] } as never
      readStarted()
      return response as never
    })
    return { started, resolve, reject }
  }

  it('publishes accepted setup status onto the latest snapshot without changing errors or chat models', () => {
    const latest = { ...initial, revision: 21, instances: [{ ...initial.instances[0], status: 'stopped' as const }] }
    useEngineHosts.getState().publishSnapshot('local', latest)
    useEngineHosts.setState({ errors: { local: 'Snapshot unavailable' } })
    providers.updateProvider.mockClear()
    providers.selectModelProvider.mockClear()

    useEngineHosts.getState().publishHardwareProfile('local', cancelled)

    expect(useEngineHosts.getState().snapshots.local).toEqual({ ...latest, hardware_profile: cancelled })
    expect(useEngineHosts.getState().snapshots.local.models).toBe(latest.models)
    expect(useEngineHosts.getState().snapshots.local.instances).toBe(latest.instances)
    expect(useEngineHosts.getState().errors).toEqual({ local: 'Snapshot unavailable' })
    expect(providers.updateProvider).not.toHaveBeenCalled()
    expect(providers.selectModelProvider).not.toHaveBeenCalled()
  })

  it('does not fabricate a snapshot when an accepted setup response outlives its Host', () => {
    useEngineHosts.setState({ hosts: [], snapshots: {} })
    useEngineHosts.getState().publishHardwareProfile('local', cancelled)
    expect(useEngineHosts.getState().snapshots).toEqual({})
    expect(providers.updateProvider).not.toHaveBeenCalled()
  })

  it('merges accepted setup status without losing newer model and instance data from an in-flight read', async () => {
    const read = pendingRead()
    const refreshing = useEngineHosts.getState().refresh()
    await read.started
    const newer: EngineSnapshot = { ...initial, revision: 22,
      models: [{ ...initial.models[0], id: 'new-model', path: '/new.ginfer' }],
      instances: [{ ...initial.instances[0], instance_id: 'new-instance', session_id: 'new-session', upstream_model_id: 'new-model' }] }

    useEngineHosts.getState().publishHardwareProfile('local', cancelled)
    read.resolve(newer)
    await refreshing

    expect(useEngineHosts.getState().snapshots.local).toEqual({ ...newer, hardware_profile: cancelled })
    expect(useEngineHosts.getState().snapshots.local.models).toBe(newer.models)
    expect(useEngineHosts.getState().snapshots.local.instances).toBe(newer.instances)
    expect(providers.updateProvider.mock.calls.at(-1)?.[1].models.map((model: { id: string }) => model.id))
      .toEqual(['ginfer/local/new-instance'])
  })

  it('retains accepted setup status and offline protection when an in-flight snapshot read fails', async () => {
    const read = pendingRead()
    const refreshing = useEngineHosts.getState().refresh()
    await read.started
    useEngineHosts.getState().publishHardwareProfile('local', cancelled)
    read.reject(new Error('Snapshot connection lost'))
    await refreshing

    expect(useEngineHosts.getState().snapshots.local.hardware_profile).toBe(cancelled)
    expect(useEngineHosts.getState().snapshots.local.instances).toBe(initial.instances)
    expect(useEngineHosts.getState().errors.local).toBe('Error: Snapshot connection lost')
    expect(hasReadyHostInstance(useEngineHosts.getState())).toBe(false)
    expect(providers.updateProvider.mock.calls.at(-1)?.[1].models).toEqual([])
  })

  it('lets a later successful refresh replace accepted setup status with actual completion', async () => {
    const running: EngineHardwareProfile = { ...cancelled, status: 'running', finished_unix_ms: null }
    useEngineHosts.getState().publishHardwareProfile('local', running)
    const completed: EngineHardwareProfile = { ...running, status: 'completed', finished_unix_ms: 300 }
    const newer = { ...initial, revision: 22, hardware_profile: completed }
    vi.mocked(engineCommand).mockImplementation(async action => action === 'list'
      ? { registered: [host], discovered: [] } as never : newer as never)

    await useEngineHosts.getState().refresh()

    expect(useEngineHosts.getState().snapshots.local).toBe(newer)
    expect(useEngineHosts.getState().snapshots.local.hardware_profile).toBe(completed)
  })

  it('does not overlay old setup status onto an in-flight snapshot from a restarted Host', async () => {
    const read = pendingRead()
    const refreshing = useEngineHosts.getState().refresh()
    await read.started
    useEngineHosts.getState().publishHardwareProfile('local', cancelled)
    const restarted = { ...initial, revision: 1, boot_id: 'second-boot' }
    read.resolve(restarted)
    await refreshing

    expect(useEngineHosts.getState().snapshots.local).toBe(restarted)
    expect(useEngineHosts.getState().snapshots.local.hardware_profile).toBe(idle)
  })

  it.each(['before', 'after'] as const)('preserves a full lifecycle publication when setup status arrives %s it during a read', async order => {
    const read = pendingRead()
    const refreshing = useEngineHosts.getState().refresh()
    await read.started
    const stopped: EngineSnapshot = { ...initial, revision: 1,
      instances: [{ ...initial.instances[0], status: 'stopped' }] }
    if (order === 'before') useEngineHosts.getState().publishHardwareProfile('local', cancelled)
    useEngineHosts.getState().publishSnapshot('local', stopped)
    if (order === 'after') useEngineHosts.getState().publishHardwareProfile('local', cancelled)
    read.resolve(initial)
    await refreshing

    expect(useEngineHosts.getState().snapshots.local).toEqual({ ...stopped,
      hardware_profile: order === 'before' ? idle : cancelled })
    expect(useEngineHosts.getState().errors).toEqual({})
    expect(providers.updateProvider.mock.calls.at(-1)?.[1].models).toEqual([])
    expect(hasReadyHostInstance(useEngineHosts.getState())).toBe(false)
  })
})

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

  it('names a ready instance in the picker by its model, not the raw package identity', async () => {
    const host = { host_id: 'local', local: true, name: 'This computer' }
    vi.mocked(engineCommand).mockImplementation(async action => action === 'list'
      ? { registered: [host], discovered: [] } as never
      : { host_id: 'local', display_name: 'Ron-PC', gpus: [],
        models: [{ id: 'host-model', path: '/m.ginfer', artifact_set: false,
          metadata: { identity: { model_id: 'qwen3.8-27b', weights_id: 'smol-q2g64-mix-dflash2-q4' }, tp_size: 1, draft_tp: 0, size_bytes: 1 } }],
        instances: [{ instance_id: 'one', display_name: 'qwen3.8-27b/smol-q2g64-mix-dflash2-q4', status: 'ready',
          configuration: {}, profile: { model_id: 'host-model' } }] } as never)
    providers.updateProvider.mockClear()
    await useEngineHosts.getState().refresh()
    const projection = providers.updateProvider.mock.calls.at(-1)?.[1]
    expect(projection.models[0].displayName).toBe('Qwen 3.8 27B — SMOL — Ron-PC')
  })
  describe('chat model selection from the running instance', () => {
    const host = { host_id: 'local', local: true, name: 'This computer' }
    const snapshot = (ids: string[]) => ({ host_id: 'local', display_name: 'This computer',
      instances: ids.map(id => ({ instance_id: id, display_name: id, status: 'ready', configuration: {} })) })
    it('selects the only ready model when nothing is chosen', () => {
      providers.selectModelProvider.mockClear()
      providers.selectedModel = null
      useEngineHosts.setState({ hosts: [host] as never, errors: {} })
      useEngineHosts.getState().publishSnapshot('local', snapshot(['one']) as never)
      expect(providers.selectModelProvider.mock.calls).toEqual([['ginfer-lan', 'ginfer/local/one']])
    })
    it('keeps an explicit choice and does not guess among several ready models', () => {
      providers.selectModelProvider.mockClear()
      useEngineHosts.setState({ hosts: [host] as never, errors: {} })
      providers.selectedModel = { id: 'chosen' }
      useEngineHosts.getState().publishSnapshot('local', snapshot(['one']) as never)
      providers.selectedModel = null
      useEngineHosts.getState().publishSnapshot('local', snapshot(['one', 'two']) as never)
      expect(providers.selectModelProvider.mock.calls).toEqual([])
    })
  })
})

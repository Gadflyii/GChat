import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { toast } from 'sonner'
import { useAppState } from '@/hooks/useAppState'
import { useModelProvider } from '@/hooks/useModelProvider'
import { useLocalApiServer } from '@/hooks/useLocalApiServer'
import type { ModelsService } from '@/services/models/types'
import type { AppService } from '@/services/app/types'
import { resetServiceHubStore, seedServiceHub } from '@/test/service-hub'
import { ServerQuickActions } from '../ServerQuickActions'
import { shouldAttemptAutoStart, switchToModel } from '@/utils/switchModel'
import { useEngineHosts } from '@/stores/engine-hosts-store'
import { engineCommand, type EngineSnapshot } from '@/services/engines'
import DropdownModelProvider from '@/containers/DropdownModelProvider'
import { useGeneralSetting } from '@/hooks/useGeneralSetting'
import { hydrateActiveModelsForRunningServer } from '@/utils/activeModelsSync'
import { ensureLocalApiServerRunning } from '@/utils/ensureLocalApiServerRunning'

const models = vi.hoisted(() => ({
  stopModel: vi.fn(),
  startModel: vi.fn(),
  getActiveModels: vi.fn(),
  stopAllModels: vi.fn(),
}))

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), dismiss: vi.fn() },
}))
vi.mock('@tanstack/react-router', async () => ({
  ...await vi.importActual('@tanstack/react-router'), useNavigate: () => vi.fn(),
}))
vi.mock('@/services/engines', async () => ({
  ...await vi.importActual('@/services/engines'), engineCommand: vi.fn(),
}))

vi.mock('@/components/ui/dropdown-menu', () => ({
  DropdownMenu: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuItem: ({ children, onSelect }: { children: React.ReactNode; onSelect: () => void }) => (
    <button onClick={onSelect}>{children}</button>
  ),
}))

vi.mock('@/components/ui/sidebar', () => ({
  SidebarMenuItem: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SidebarMenuButton: ({ children, disabled }: { children: React.ReactNode; disabled: boolean }) => (
    <button disabled={disabled}>{children}</button>
  ),
}))

describe('sidebar server shortcut', () => {
  const stopServer = vi.fn()
  const startServer = vi.fn()
  const getServerStatus = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    useEngineHosts.setState({ hosts: [], snapshots: {}, errors: {} })
    getServerStatus.mockResolvedValue(false)
    seedServiceHub({ models: models as unknown as ModelsService,
      app: { getServerStatus } as unknown as AppService })
    window.core = { api: { stopServer, startServer } } as typeof window.core
    stopServer.mockResolvedValue(undefined)
    startServer.mockResolvedValue(1337)
    models.stopModel.mockResolvedValue({ success: true })
    models.startModel.mockResolvedValue(undefined)
    models.stopAllModels.mockResolvedValue(undefined)
    models.getActiveModels.mockResolvedValue(['other-model'])
    useModelProvider.setState({
      selectedProvider: 'ginfer',
      selectedModel: { id: 'shortcut-model' } as Model,
      providers: [{
        provider: 'ginfer',
        models: [{ id: 'shortcut-model' }, { id: 'other-model' }, { id: 'switch-model' }, { id: 'later-model' }],
      }] as ModelProvider[],
    })
    useAppState.setState({
      serverStatus: 'running',
      activeModels: ['shortcut-model', 'other-model'],
      intentionallyStoppedModels: new Set(),
      pendingModelStops: 0,
    })
    useLocalApiServer.setState({
      defaultModelLocalApiServer: { model: 'shortcut-model', provider: 'ginfer' },
      lastServerModels: [],
    })
  })

  afterEach(() => {
    cleanup()
    resetServiceHubStore()
  })

  it('stops the API and only the shortcut model, then refreshes loaded models', async () => {
    render(<ServerQuickActions />)
    fireEvent.click(screen.getByRole('button', { name: /Stop server/ }))

    await waitFor(() => expect(models.getActiveModels).toHaveBeenCalledOnce())
    expect(stopServer).toHaveBeenCalledOnce()
    expect(models.stopModel).toHaveBeenCalledExactlyOnceWith('shortcut-model', 'ginfer')
    expect(stopServer.mock.invocationCallOrder[0]).toBeLessThan(
      models.stopModel.mock.invocationCallOrder[0]
    )
    expect(useAppState.getState().serverStatus).toBe('stopped')
    expect(useAppState.getState().activeModels).toEqual(['other-model'])
    expect(shouldAttemptAutoStart('ginfer', 'shortcut-model')).toBe(false)
    expect(shouldAttemptAutoStart('ginfer', 'other-model')).toBe(true)
    expect(toast.success).toHaveBeenCalledWith('Local API Server and model stopped')
  })

  it('reports an unload failure while keeping the API stopped and refreshed state', async () => {
    models.stopModel.mockResolvedValue({ success: false, error: 'Host refused unload' })
    models.getActiveModels.mockResolvedValue(['shortcut-model', 'other-model'])
    render(<ServerQuickActions />)
    fireEvent.click(screen.getByRole('button', { name: /Stop server/ }))

    await waitFor(() => expect(toast.error).toHaveBeenCalled())
    expect(useAppState.getState().serverStatus).toBe('stopped')
    expect(useAppState.getState().activeModels).toEqual(['shortcut-model', 'other-model'])
    expect(toast.error).toHaveBeenCalledWith(
      'Local API Server stopped, but the model could not be unloaded',
      expect.objectContaining({ description: expect.stringContaining('Host refused unload') })
    )
    expect(toast.success).not.toHaveBeenCalled()
    expect(shouldAttemptAutoStart('ginfer', 'shortcut-model')).toBe(false)
  })

  const localId = '4941572e-7ccf-48b7-a950-de8d4dd731c6'
  const instanceId = '00e0ffab-31fd-48fa-9b00-9caf1c20e69c'
  const localAlias = `ginfer/${localId}/${instanceId}`
  function hostAlias(hostId = localId, status = 'ready', session = 'original-session') {
    const alias = `ginfer/${hostId}/${instanceId}`
    const snapshot = { host_id: hostId, display_name: 'Local Host', instances: [{ instance_id: instanceId,
      display_name: 'Muse Glimmer 30B', session_id: session, status,
      configuration: { vision: false, gpu_uuids: [], max_context: 8192, concurrency: 1 } }] } as EngineSnapshot
    useEngineHosts.setState({
      hosts: [{ local: true, host_id: localId, name: 'Local Host', base_url: '', client_id: '', certificate_sha256: '' }],
      snapshots: { [hostId]: snapshot },
    })
    useModelProvider.setState({ selectedProvider: 'ginfer-lan', selectedModel: { id: alias } as Model,
      providers: [{ provider: 'ginfer-lan', models: [{ id: alias }] }] as ModelProvider[] })
    useAppState.setState({ activeModels: [alias] })
    useLocalApiServer.setState({ defaultModelLocalApiServer: { model: alias, provider: 'ginfer-lan' } })
    models.getActiveModels.mockResolvedValue([])
    return snapshot
  }

  it('stops the exact local Host alias and prevents automatic reload after projection refresh', async () => {
    const ready = hostAlias()
    vi.mocked(engineCommand).mockImplementation(async action => action === 'snapshot' ? ready : {
      ...ready, instances: [{ ...ready.instances[0], status: 'stopped' }],
    })
    render(<ServerQuickActions />)
    fireEvent.click(screen.getByRole('button', { name: /Stop server/ }))
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Local API Server and model stopped'))
    expect(engineCommand).toHaveBeenCalledWith('stop', {
      host_id: localId, instance_id: instanceId,
      body: { expected_session_id: 'original-session', force: false },
    })
    expect(stopServer).toHaveBeenCalledOnce()
    expect(models.stopModel).not.toHaveBeenCalled()
    expect(useAppState.getState().activeModels).toEqual([])
    expect(shouldAttemptAutoStart('ginfer-lan', localAlias)).toBe(false)
    expect(screen.getByText('Server stopped')).toBeInTheDocument()
  })

  it('recognizes a Ready imported local alias even without ModelsService active models', async () => {
    const ready = hostAlias()
    useAppState.setState({ serverStatus: 'stopped', activeModels: [] })
    vi.mocked(engineCommand).mockImplementation(async action => action === 'snapshot' ? ready : {
      ...ready, instances: [{ ...ready.instances[0], status: 'stopped' }],
    })
    render(<ServerQuickActions />)
    expect(screen.getByText('Model loaded')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Stop model/ }))
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Model stopped'))
    expect(stopServer).not.toHaveBeenCalled()
    expect(engineCommand).toHaveBeenCalledWith('stop', expect.objectContaining({ host_id: localId, instance_id: instanceId }))
    expect(shouldAttemptAutoStart('ginfer-lan', localAlias)).toBe(false)
  })

  it('stops only the facade for a paired remote alias', async () => {
    const alias = `ginfer/remote-host/${instanceId}`
    hostAlias('remote-host')
    render(<ServerQuickActions />)
    expect(screen.queryByRole('button', { name: /Reload model/ })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Stop server/ }))
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Local API Server stopped'))
    expect(stopServer).toHaveBeenCalledOnce()
    expect(engineCommand).not.toHaveBeenCalled()
    expect(models.stopModel).not.toHaveBeenCalled()
    expect(useAppState.getState().activeModels).toEqual([alias])
    expect(shouldAttemptAutoStart('ginfer-lan', alias)).toBe(true)
  })

  it('explicitly starts the saved local Host instance after its Ready-only picker entry disappears', async () => {
    const stopped = hostAlias(localId, 'stopped')
    useModelProvider.setState({ selectedProvider: '', selectedModel: null, providers: [{ provider: 'ginfer-lan', models: [] }] as ModelProvider[] })
    useAppState.setState({ serverStatus: 'stopped', activeModels: [] })
    useAppState.getState().setIntentionalModelStop('ginfer-lan', localAlias, true)
    vi.mocked(engineCommand).mockImplementation(async action => action === 'snapshot' ? stopped : {
      ...stopped, instances: [{ ...stopped.instances[0], status: 'ready', session_id: 'new-session' }],
    })
    render(<ServerQuickActions />)
    fireEvent.click(screen.getByRole('button', { name: /Start server/ }))
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Local API Server started'))
    expect(engineCommand).toHaveBeenCalledWith('start', expect.objectContaining({
      host_id: localId, instance_id: instanceId, body: { expected_session_id: 'original-session', force: false },
    }))
    expect(startServer).toHaveBeenCalledOnce()
    expect(models.startModel).not.toHaveBeenCalled()
    expect(useAppState.getState().activeModels).toEqual([localAlias])
    expect(shouldAttemptAutoStart('ginfer-lan', localAlias)).toBe(true)
    expect(useModelProvider.getState().selectedModel?.id).toBe(localAlias)
    expect(useModelProvider.getState().selectedProvider).toBe('ginfer-lan')
    expect(screen.getByText('Server running')).toBeInTheDocument()
  })

  it('keeps the restored local selection after the real picker finishes an older empty active-model read', async () => {
    const stopped = hostAlias(localId, 'stopped')
    useGeneralSetting.setState({ preloadModelOnStartup: false })
    useModelProvider.setState({ selectedProvider: '', selectedModel: null,
      providers: [{ provider: 'ginfer-lan', active: true, settings: [], models: [] }] as ModelProvider[] })
    useAppState.setState({ serverStatus: 'stopped', activeModels: [] })
    let releaseOldRead: (models: string[]) => void = () => {}
    models.getActiveModels.mockImplementationOnce(() => new Promise<string[]>(resolve => { releaseOldRead = resolve }))
      .mockResolvedValue([])
    vi.mocked(engineCommand).mockImplementation(async action => action === 'snapshot' ? stopped : {
      ...stopped, instances: [{ ...stopped.instances[0], status: 'ready', session_id: 'current-session' }],
    })
    render(<><DropdownModelProvider showSampler={false} /><ServerQuickActions /></>)
    await waitFor(() => expect(models.getActiveModels).toHaveBeenCalledOnce())
    fireEvent.click(screen.getByRole('button', { name: /Start server/ }))
    await waitFor(() => expect(screen.getByText('Server running')).toBeInTheDocument())
    await act(async () => { releaseOldRead([]) })
    expect(screen.getByTitle(localAlias)).toHaveTextContent('Muse Glimmer 30B — Local Host')
    expect(useModelProvider.getState().selectedProvider).toBe('ginfer-lan')
    expect(useModelProvider.getState().selectedModel?.id).toBe(localAlias)
    await act(async () => { await hydrateActiveModelsForRunningServer(models as unknown as ModelsService) })
    expect(useAppState.getState().activeModels).toEqual([localAlias])
    expect(startServer).toHaveBeenCalledOnce()
    expect(toast.error).not.toHaveBeenCalled()
  })

  it('does not hydrate a stopped local Host default as a credentialed cloud model', async () => {
    hostAlias(localId, 'stopped')
    useModelProvider.getState().updateProvider('ginfer-lan', { api_key: 'local-facade-key' })
    useAppState.setState({ activeModels: [] })
    await hydrateActiveModelsForRunningServer(models as unknown as ModelsService)
    expect(useAppState.getState().activeModels).toEqual([])
  })

  it('does not reopen the facade when Stop overtakes a delayed Ready-edge status probe', async () => {
    const ready = hostAlias()
    useAppState.setState({ serverStatus: 'stopped' })
    let releaseStatus: (running: boolean) => void = () => {}
    getServerStatus.mockImplementationOnce(() => new Promise<boolean>(resolve => { releaseStatus = resolve }))
    const serviceHub = seedServiceHub({ models: models as unknown as ModelsService,
      app: { getServerStatus } as unknown as AppService })
    const startup = ensureLocalApiServerRunning(serviceHub)
    await waitFor(() => expect(getServerStatus).toHaveBeenCalledOnce())
    vi.mocked(engineCommand).mockImplementation(async action => action === 'snapshot' ? ready : {
      ...ready, instances: [{ ...ready.instances[0], status: 'stopped', session_id: null }],
    })
    models.getActiveModels.mockResolvedValue([])
    render(<ServerQuickActions />)
    fireEvent.click(screen.getByRole('button', { name: /Stop model/ }))
    await waitFor(() => expect(useAppState.getState().pendingModelStops).toBe(1))
    await act(async () => { releaseStatus(false); await startup })
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Model stopped'))
    expect(startServer).not.toHaveBeenCalled()
    expect(stopServer).toHaveBeenCalledOnce()
    expect(useAppState.getState().serverStatus).toBe('stopped')
    expect(useAppState.getState().activeModels).toEqual([])
    expect(shouldAttemptAutoStart('ginfer-lan', localAlias)).toBe(false)
  })

  it('restarts the local Host with its current session rather than a missing engine adapter', async () => {
    const ready = hostAlias()
    vi.mocked(engineCommand).mockImplementation(async action => action === 'snapshot' ? ready : {
      ...ready, instances: [{ ...ready.instances[0], session_id: 'new-session' }],
    })
    render(<ServerQuickActions />)
    fireEvent.click(screen.getByRole('button', { name: /Reload model/ }))
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Model reloaded'))
    expect(engineCommand).toHaveBeenCalledWith('restart', expect.objectContaining({
      host_id: localId, instance_id: instanceId, body: { expected_session_id: 'original-session', force: false },
    }))
    expect(models.stopModel).not.toHaveBeenCalled()
    expect(models.startModel).not.toHaveBeenCalled()
    expect(useAppState.getState().activeModels).toEqual([localAlias])
  })

  it('rejects a replaced session during reload without replaying a lifecycle mutation', async () => {
    const ready = hostAlias()
    let snapshots = 0
    vi.mocked(engineCommand).mockImplementation(async action => {
      if (action === 'snapshot' && ++snapshots === 1) return ready
      return { ...ready, instances: [{ ...ready.instances[0],
        status: action === 'restart' ? 'starting' : 'ready',
        session_id: action === 'restart' ? 'requested-session' : 'replacement-session' }] }
    })
    render(<ServerQuickActions />)
    fireEvent.click(screen.getByRole('button', { name: /Reload model/ }))
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Could not reload model',
      expect.objectContaining({ description: expect.stringContaining('session changed') })), { timeout: 2500 })
    expect(vi.mocked(engineCommand).mock.calls.filter(([action]) => action === 'restart')).toHaveLength(1)
    expect(vi.mocked(engineCommand).mock.calls.some(([action]) => action === 'start' || action === 'stop')).toBe(false)
    expect(toast.success).not.toHaveBeenCalled()
  })

  it('restores the selected alias after Restart passes through Starting to Ready', async () => {
    const ready = hostAlias()
    let snapshots = 0
    vi.mocked(engineCommand).mockImplementation(async action => {
      if (action === 'snapshot' && ++snapshots === 1) return ready
      return { ...ready, instances: [{ ...ready.instances[0],
        status: action === 'restart' ? 'starting' : 'ready', session_id: 'new-session' }] }
    })
    render(<ServerQuickActions />)
    fireEvent.click(screen.getByRole('button', { name: /Reload model/ }))
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Model reloaded'), { timeout: 2500 })
    expect(useModelProvider.getState().selectedModel?.id).toBe(localAlias)
    expect(useAppState.getState().activeModels).toEqual([localAlias])
  })

  it('offers Stop model when the API is already stopped', async () => {
    useAppState.setState({ serverStatus: 'stopped' })
    render(<ServerQuickActions />)
    expect(screen.getByText('Model loaded')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Start server/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Reload model/ })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Stop model/ }))

    await waitFor(() => expect(models.stopModel).toHaveBeenCalledOnce())
    expect(stopServer).not.toHaveBeenCalled()
    expect(models.stopModel).toHaveBeenCalledWith('shortcut-model', 'ginfer')
    expect(useAppState.getState().activeModels).toEqual(['other-model'])
    expect(toast.success).toHaveBeenCalledWith('Model stopped')
    expect(shouldAttemptAutoStart('ginfer', 'shortcut-model')).toBe(false)
  })

  it('does not unload a model when API shutdown fails', async () => {
    stopServer.mockRejectedValue(new Error('port shutdown failed'))
    render(<ServerQuickActions />)
    fireEvent.click(screen.getByRole('button', { name: /Stop server/ }))

    await waitFor(() => expect(toast.error).toHaveBeenCalled())
    expect(useAppState.getState().serverStatus).toBe('running')
    expect(models.stopModel).not.toHaveBeenCalled()
    expect(models.getActiveModels).not.toHaveBeenCalled()
    expect(shouldAttemptAutoStart('ginfer', 'shortcut-model')).toBe(true)
  })

  it('lets explicit Start reload the stopped model and resume automatic recovery', async () => {
    useAppState.setState({ serverStatus: 'stopped', activeModels: [] })
    useAppState.getState().setIntentionalModelStop('ginfer', 'shortcut-model', true)
    models.getActiveModels.mockResolvedValueOnce([]).mockResolvedValue(['shortcut-model'])
    render(<ServerQuickActions />)
    fireEvent.click(screen.getByRole('button', { name: /Start server/ }))

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Local API Server started'))
    expect(models.startModel).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'ginfer' }), 'shortcut-model', true
    )
    expect(startServer).toHaveBeenCalledOnce()
    expect(useAppState.getState().serverStatus).toBe('running')
    expect(shouldAttemptAutoStart('ginfer', 'shortcut-model')).toBe(true)
  })

  it('stops the resolved model after an in-flight switch and lets a later explicit switch start', async () => {
    let releaseProbe: (running: boolean) => void = () => {}
    const getServerStatus = vi.fn()
      .mockImplementationOnce(() => new Promise<boolean>((resolve) => {
        releaseProbe = resolve
      }))
      .mockResolvedValue(false)
    let loaded = ['shortcut-model']
    models.getActiveModels.mockImplementation(async () => [...loaded])
    models.stopAllModels.mockImplementation(async () => { loaded = [] })
    models.startModel.mockImplementation(async (_provider: ModelProvider, id: string) => {
      loaded = [id]
    })
    models.stopModel.mockImplementation(async (id: string) => {
      loaded = loaded.filter((model) => model !== id)
      return { success: true }
    })
    const serviceHub = seedServiceHub({
      models: models as unknown as ModelsService,
      app: { getServerStatus } as unknown as AppService,
    })
    render(<ServerQuickActions />)

    let firstSwitch: ReturnType<typeof switchToModel>
    await act(async () => {
      firstSwitch = switchToModel({
        modelId: 'switch-model', providerName: 'ginfer', serviceHub,
      })
    })
    await waitFor(() => expect(getServerStatus).toHaveBeenCalledOnce())
    fireEvent.click(screen.getByRole('button', { name: /Stop server/ }))
    expect(useAppState.getState().pendingModelStops).toBe(1)
    expect(shouldAttemptAutoStart('ginfer', 'switch-model')).toBe(false)

    await act(async () => {
      const laterSwitch = switchToModel({
        modelId: 'later-model', providerName: 'ginfer', serviceHub,
      })
      releaseProbe(false)
      await Promise.all([firstSwitch, laterSwitch])
    })
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Local API Server and model stopped'))

    expect(models.stopModel).toHaveBeenCalledExactlyOnceWith('switch-model', 'ginfer')
    expect(models.startModel.mock.calls.map(([, id]) => id)).toEqual(['switch-model', 'later-model'])
    expect(models.stopModel.mock.invocationCallOrder[0]).toBeGreaterThan(
      models.startModel.mock.invocationCallOrder[0]
    )
    expect(models.stopModel.mock.invocationCallOrder[0]).toBeLessThan(
      models.startModel.mock.invocationCallOrder[1]
    )
    expect(useAppState.getState().pendingModelStops).toBe(0)
    expect(shouldAttemptAutoStart('ginfer', 'switch-model')).toBe(false)
    expect(shouldAttemptAutoStart('ginfer', 'later-model')).toBe(true)
  })
})

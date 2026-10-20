import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { spyConfirm } from '@/test/confirm'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useState } from 'react'
import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from '@tanstack/react-router'
import { ModelManagement as ModelManagementView, type ModelManagementTab } from '@/containers/ModelManagement'
import { Route } from '../index'
import { useLocalModelDownloads } from '@/stores/local-model-downloads-store'
import { useAppState } from '@/hooks/useAppState'
import type { ModelDownload, ModelRelease } from '@/lib/model-release'
import type { EngineSnapshot, LocalModelLoadProgress } from '@/services/engines'
import type { DialogOpenOptions } from '@/services/dialog/types'
type TestProvider = { provider: string; settings?: ProviderSetting[]; models: { id: string; displayName: string; path: string; source?: string }[] }
const mocks = vi.hoisted(() => ({
  refreshCatalog: vi.fn(async () => {}),
  command: vi.fn<(action: string, args?: Record<string, unknown>) => Promise<unknown>>(async () => []), refresh: vi.fn(async () => {}),
  switchModel: vi.fn<(params: { options?: { loadOperationId?: string }; signal?: AbortSignal }) => Promise<void>>(async () => {}),
  selectedGpuUuids: null as string[] | null, setSelectedGpuUuids: vi.fn(),
  selectedDevice: 'auto' as 'auto' | 'gpu' | 'cpu', setSelectedDevice: vi.fn(),
  providers: [] as TestProvider[],
  getProviders: vi.fn<() => Promise<TestProvider[]>>(), setProviders: vi.fn<(providers: TestProvider[], revision?: number) => void>(),
  inventoryRevision: 0, recordModelInstall: vi.fn<(modelId: string) => void>(),
  open: vi.fn<(options?: DialogOpenOptions) => Promise<string | string[] | null>>(),
  joinPath: vi.fn<(parts: string[]) => Promise<string>>(),
  catalog: [] as unknown[], catalogError: null as string | null, errors: {} as Record<string, string>,
  resources: { ready: true as boolean | null, error: '' },
  localSnapshot: null as null | Record<string, unknown>,
  remoteDownloads: [] as ModelDownload[],
  publishSnapshot: vi.fn<(hostId: string, snapshot: EngineSnapshot) => void>(),
  controlHost: vi.fn(async () => {}),
  getActiveModels: vi.fn<(provider?: string) => Promise<string[]>>(),
  stopModel: vi.fn<(model: string, provider?: string) => Promise<{ success: boolean; error?: string } | undefined>>(),
  stopAllModels: vi.fn(async () => {}),
}))
vi.mock('@gchat/core', async importOriginal => ({
  ...await importOriginal<typeof import('@gchat/core')>(), joinPath: mocks.joinPath,
}))
vi.mock('@/utils/localHostModel', async importOriginal => ({
  ...await importOriginal<typeof import('@/utils/localHostModel')>(),
  controlLocalHostModel: mocks.controlHost,
}))
vi.mock('@/containers/HeaderPage', () => ({ default: ({ children }: { children: React.ReactNode }) => <header>{children}</header> }))
vi.mock('@/containers/EngineHostModels', () => ({ HostCard: ({ host }: { host: { name: string } }) => <section>Installed on {host.name}</section> }))
vi.mock('@/containers/hub/DeleteModelAction', () => ({ DeleteModelAction: () => null }))
vi.mock('@tanstack/react-router', async importOriginal => ({
  ...await importOriginal<typeof import('@tanstack/react-router')>(),
  Link: ({ to, children }: { to: string; children: React.ReactNode }) => <a href={to}>{children}</a>,
}))
vi.mock('@/utils/switchModel', () => ({ switchToModel: mocks.switchModel }))
vi.mock('@/services/engines', async importOriginal => ({
  ...await importOriginal<typeof import('@/services/engines')>(),
  engineCommand: mocks.command, engineAlias: (host: string, instance: string) => `ginfer/${host}/${instance}` }))
vi.mock('@/hooks/useServiceHub', () => ({ isServiceHubInitialized: () => false, useServiceHub: () => ({
  models: () => ({ getActiveModels: mocks.getActiveModels, stopModel: mocks.stopModel, stopAllModels: mocks.stopAllModels }),
  providers: () => ({ getProviders: mocks.getProviders }),
  dialog: () => ({ open: mocks.open }),
}) }))
vi.mock('@/hooks/useBundledResources', () => ({ useBundledResources: (enabled = true) => enabled ? mocks.resources : { ready: true, error: '' } }))
vi.mock('@/hooks/useModelProvider', () => {
  const state = { get providers() { return mocks.providers }, get inventoryRevision() { return mocks.inventoryRevision }, recordModelInstall: mocks.recordModelInstall, selectModelProvider: vi.fn(), setProviders: mocks.setProviders }
  const hook = (selector: (s: typeof state) => unknown) => selector(state)
  hook.getState = () => state
  return { useModelProvider: hook }
})
vi.mock('@/hooks/useHardware', () => ({ useHardware: (selector: (s: unknown) => unknown) => selector({
  selectedGpuUuids: mocks.selectedGpuUuids, setSelectedGpuUuids: mocks.setSelectedGpuUuids,
  selectedDevice: mocks.selectedDevice, setSelectedDevice: mocks.setSelectedDevice,
  hardwareReady: true, hardwareData: { gpus: [{ uuid: 'local-gpu', name: 'Local GPU', total_memory: 16384, nvidia_info: { compute_capability: '8.6' } }] },
}) }))
vi.mock('@/stores/model-catalog-store', () => ({ useModelCatalogStore: (selector: (s: unknown) => unknown) => selector({ catalog: mocks.catalog, error: mocks.catalogError, refresh: mocks.refreshCatalog }) }))
vi.mock('@/stores/engine-hosts-store', () => {
  const state = () => ({
    hosts: [{ host_id: 'remote', name: 'Lab server' }, ...(mocks.localSnapshot ? [{ host_id: 'local-host', name: 'This computer', local: true }] : [])], errors: mocks.errors, refresh: mocks.refresh, publishSnapshot: mocks.publishSnapshot,
    snapshots: { ...(mocks.localSnapshot ? { 'local-host': mocks.localSnapshot } : {}), remote: { host_id: 'remote', gpus: [{ uuid: 'remote-gpu', name: 'Remote GPU', memory_mib: 32768, compute_capability: '12.0' }], models: [], instances: [], model_management: { version: 1, downloads: mocks.remoteDownloads } } },
  })
  const hook = (selector: (s: ReturnType<typeof state>) => unknown) => selector(state())
  hook.getState = state
  return { useEngineHosts: hook }
})
const release: ModelRelease = { name: 'Blackwell model', identity: { model_id: 'muse', weights_id: 'nvfp4' },
  url: `https://huggingface.co/test/model/resolve/${'a'.repeat(40)}/model.ginfer`, sha256: 'b'.repeat(64), bytes: 4096,
  tp: 1, qualified_sm: ['12.0'], min_vram_mib_per_gpu: 32768, capabilities: ['tools'], launch_profiles: [{ id: 'c1' }] }

function ModelManagement({ initialQuery }: { initialQuery?: string }) {
  const [tab, setTab] = useState<ModelManagementTab>('Installed')
  return <ModelManagementView initialQuery={initialQuery} tab={tab} onTabChange={setTab} />
}

function renderModelsRoute(initialEntry: string) {
  const root = createRootRoute()
  const models = Route.update({
    id: '/hub/', path: '/hub/', getParentRoute: () => root,
  })
  const router = createRouter({
    routeTree: root.addChildren([models]),
    history: createMemoryHistory({ initialEntries: [initialEntry] }),
    defaultPendingMs: 0,
  })
  render(<RouterProvider router={router} />)
  return router
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((accept, fail) => { resolve = accept; reject = fail })
  return { promise, resolve, reject }
}

function customSnapshot(extra: Record<string, unknown> = {}) {
  return { host_id: 'local-host', gpus: [{ uuid: 'gpu-1', name: 'NVIDIA GeForce RTX 5070 Ti', memory_mib: 16303, compute_capability: '12.0' }],
    models: [{ id: 'host-model', path: '/models/local.ginfer', artifact_set: false,
      metadata: { identity: { model_id: 'qwen3.8-27b', weights_id: 'smol-q2g64-mix-dflash2-q4' }, tp_size: 1, draft_tp: 1, size_bytes: 10667321600 } }],
    instances: [], model_management: { version: 1, downloads: [] }, ...extra }
}
function savedProfile(id: string, name: string, status: string) {
  return { id, name, status, package_sha256: '4'.repeat(64), identity: { model_id: 'qwen3.8-27b', weights_id: 'smol-q2g64-mix-dflash2-q4' },
    model_path: '/models/local.ginfer', hardware: [{ uuid: status === 'ready' ? 'gpu-1' : 'gpu-old', name: 'Old', memory_mib: 1 }],
    gpu_uuids: [status === 'ready' ? 'gpu-1' : 'gpu-old'], max_context: 98304, concurrency: 1, model_id: 'host-model',
    options: { vision: false, structured_outputs: true, spec: 'none', draft_tokens: 0, draft_tp: 0, kv_dtype: 'int8', kv_arena_bytes: null, host_kv_cache_bytes: null, prefill_chunk: 0, no_cuda_graph: false },
    created_unix_ms: 1, updated_unix_ms: 1 }
}

describe('host-scoped Models', () => {
  beforeEach(() => {
    vi.clearAllMocks(); mocks.errors = {}; mocks.selectedGpuUuids = null; mocks.selectedDevice = 'auto'
    useAppState.setState({ activeModels: [] })
    mocks.localSnapshot = null
    useLocalModelDownloads.setState({ jobs: [], loaded: false, error: null })
    mocks.remoteDownloads = []
    mocks.publishSnapshot.mockImplementation((hostId, snapshot) => {
      if (hostId === 'remote') mocks.remoteDownloads = snapshot.model_management?.downloads ?? []
      if (hostId === 'local-host') mocks.localSnapshot = snapshot as unknown as Record<string, unknown>
      delete mocks.errors[hostId]
    })
    mocks.resources = { ready: true, error: '' }
    mocks.inventoryRevision = 0
    mocks.recordModelInstall.mockImplementation(() => { mocks.inventoryRevision += 1 })
    mocks.command.mockReset().mockImplementation(async (action, args) => {
      if (action === 'local_model_register') return { modelId: 'registered-model', modelPath: args?.path }
      if (action === 'local_model_adopt') return { adopted: [], rejected: [] }
      if (action === 'snapshot') return mocks.localSnapshot
      return []
    })
    mocks.refresh.mockReset().mockResolvedValue(undefined)
    mocks.switchModel.mockResolvedValue(undefined)
    mocks.getActiveModels.mockReset().mockResolvedValue(['another-model'])
    mocks.stopModel.mockReset().mockResolvedValue({ success: true })
    mocks.controlHost.mockReset().mockImplementation(async () => {
      const snapshot = mocks.localSnapshot as unknown as EngineSnapshot | null
      if (snapshot) mocks.publishSnapshot('local-host', {
        ...snapshot, instances: snapshot.instances.map(instance => ({ ...instance, status: 'stopped' })),
      })
    })
    mocks.providers = [{ provider: 'ginfer', models: [{ id: 'local-model', displayName: 'Installed locally', path: '/models/local.ginfer' }] }]
    mocks.getProviders.mockImplementation(async () => mocks.providers)
    mocks.setProviders.mockImplementation(providers => { mocks.providers = providers })
    mocks.open.mockResolvedValue(null)
    mocks.joinPath.mockImplementation(async parts => parts.join('/'))
    mocks.catalogError = null
    mocks.catalog = [{ library_name: 'ginfer', model_name: 'test/model', releases: [release] }]
  })
  afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers() })
  it('opens a direct Downloads link with its transfer controls and preserves later tab choices through history', async () => {
    mocks.command.mockImplementation(async action => action === 'local_model_downloads'
      ? [{ id: 'job', release, status: 'paused', received: 1024, bytes_per_second: 0, error: null, path: null }] : [])
    const router = renderModelsRoute('/hub/?tab=Downloads&q=Blackwell')
    expect(await screen.findByRole('button', { name: 'Resume download' })).toBeVisible()
    expect(screen.getByRole('tab', { name: 'Downloads' })).toHaveAttribute('aria-selected', 'true')

    fireEvent.click(screen.getByRole('tab', { name: 'Installed' }))
    await waitFor(() => expect(screen.getByRole('tab', { name: 'Installed' })).toHaveAttribute('aria-selected', 'true'))
    expect(screen.queryByRole('button', { name: 'Resume download' })).not.toBeInTheDocument()
    expect(router.state.location.search).toMatchObject({ tab: 'Installed', q: 'Blackwell' })

    fireEvent.click(screen.getByRole('tab', { name: 'Recommended' }))
    await waitFor(() => expect(screen.getByRole('tab', { name: 'Recommended' })).toHaveAttribute('aria-selected', 'true'))
    await act(async () => { router.history.back() })
    await waitFor(() => expect(screen.getByRole('tab', { name: 'Installed' })).toHaveAttribute('aria-selected', 'true'))
    await act(async () => { router.history.back() })
    expect(await screen.findByRole('button', { name: 'Resume download' })).toBeVisible()
    await act(async () => { router.history.forward() })
    await waitFor(() => expect(screen.getByRole('tab', { name: 'Installed' })).toHaveAttribute('aria-selected', 'true'))
  })
  it.each(['/hub/', '/hub/?tab=unknown'])('defaults to Installed without a supported tab (%s)', async entry => {
    renderModelsRoute(entry)
    expect(await screen.findByRole('tab', { name: 'Installed' })).toHaveAttribute('aria-selected', 'true')
    fireEvent.click(screen.getByRole('tab', { name: 'Downloads' }))
    await waitFor(() => expect(screen.getByRole('tab', { name: 'Downloads' })).toHaveAttribute('aria-selected', 'true'))
  })
  it.each([null, 'Catalog is unavailable'])('adds an existing file with empty Installed and no release catalog (%s)', async catalogError => {
    mocks.providers = [{ provider: 'ginfer', models: [] }]
    mocks.catalog = []
    mocks.catalogError = catalogError
    const path = '/external/My model.ginfer'
    const registered = [{ provider: 'ginfer', models: [{ id: 'registered-model', displayName: 'My local model', path, source: 'external' }] }]
    mocks.open.mockResolvedValue(path)
    mocks.getProviders.mockResolvedValue(registered)
    render(<ModelManagement />)
    expect(screen.getByText('No installed models found.')).toBeVisible()
    expect(screen.getByText('Add an existing .ginfer file. The file stays in its current location.')).toBeVisible()
    await waitFor(() => expect(mocks.command).toHaveBeenCalledWith('local_model_downloads'))
    mocks.refresh.mockClear()
    fireEvent.click(screen.getByRole('button', { name: 'Add local model' }))
    expect(await screen.findByText('My local model')).toBeVisible()
    expect(mocks.open).toHaveBeenCalledExactlyOnceWith({
      multiple: false, directory: false, filters: [{ name: 'GInfer model', extensions: ['ginfer'] }],
    })
    expect(mocks.command.mock.calls.filter(([action]) => action === 'local_model_register')).toEqual([
      ['local_model_register', { path }],
    ])
    expect(mocks.getProviders).toHaveBeenCalledOnce()
    expect(mocks.recordModelInstall).toHaveBeenCalledExactlyOnceWith('registered-model')
    expect(mocks.setProviders).toHaveBeenCalledExactlyOnceWith(registered, 1)
    expect(mocks.refresh).toHaveBeenCalledOnce()
    expect(mocks.switchModel).not.toHaveBeenCalled()
    expect(mocks.controlHost).not.toHaveBeenCalled()
    expect(screen.getByRole('tab', { name: 'Installed' })).toHaveAttribute('aria-selected', 'true')
  })
  it('leaves inventory alone when the file chooser is cancelled', async () => {
    render(<ModelManagement />)
    await waitFor(() => expect(mocks.command).toHaveBeenCalledWith('local_model_downloads'))
    mocks.refresh.mockClear()
    fireEvent.click(screen.getByRole('button', { name: 'Add local model' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Add local model' })).toBeEnabled())
    expect(mocks.open).toHaveBeenCalledOnce()
    expect(mocks.command.mock.calls.some(([action]) => action === 'local_model_register')).toBe(false)
    expect(mocks.getProviders).not.toHaveBeenCalled()
    expect(mocks.setProviders).not.toHaveBeenCalled()
    expect(mocks.refresh).not.toHaveBeenCalled()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
  it('passes the configured GInfer catalog when checking duplicate registration', async () => {
    mocks.providers[0].settings = [{
      key: 'model_path', title: 'Model folder', description: '', controller_type: 'input',
      controller_props: { value: '  D:\\GInfer library  ' },
    }]
    const path = 'E:\\Existing models\\muse.ginfer'
    const modelsRoot = 'D:\\GInfer library\\models'
    mocks.open.mockResolvedValue(path)
    mocks.joinPath.mockResolvedValue(modelsRoot)
    render(<ModelManagement />)
    fireEvent.click(screen.getByRole('button', { name: 'Add local model' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Add local model' })).toBeEnabled())
    expect(mocks.joinPath).toHaveBeenCalledExactlyOnceWith(['D:\\GInfer library', 'models'])
    expect(mocks.command).toHaveBeenCalledWith('local_model_register', { path, modelsRoot })
    expect(mocks.getProviders).toHaveBeenCalledOnce()
    expect(mocks.switchModel).not.toHaveBeenCalled()
  })
  it('shows a rejected registration and lets the user choose another file', async () => {
    mocks.open.mockResolvedValue('/external/broken.ginfer')
    mocks.command.mockImplementation(async action => {
      if (action === 'local_model_register') throw new Error('This file is not a valid .ginfer model.')
      return []
    })
    render(<ModelManagement />)
    await waitFor(() => expect(mocks.command).toHaveBeenCalledWith('local_model_downloads'))
    mocks.refresh.mockClear()
    fireEvent.click(screen.getByRole('button', { name: 'Add local model' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('This file is not a valid .ginfer model.')
    expect(screen.getByRole('button', { name: 'Add local model' })).toBeEnabled()
    expect(mocks.getProviders).not.toHaveBeenCalled()
    expect(mocks.setProviders).not.toHaveBeenCalled()
    expect(mocks.refresh).not.toHaveBeenCalled()
    expect(mocks.switchModel).not.toHaveBeenCalled()
    expect(mocks.recordModelInstall).not.toHaveBeenCalled()
    mocks.open.mockResolvedValue(null)
    fireEvent.click(screen.getByRole('button', { name: 'Add local model' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Add local model' })).toBeEnabled())
    expect(mocks.open).toHaveBeenCalledTimes(2)
    expect(screen.getByRole('alert')).toHaveTextContent('This file is not a valid .ginfer model.')
  })
  it.each(['provider inventory', 'Host status'] as const)('recovers an accepted registration after a failed %s read without adding or loading again', async failedRead => {
    mocks.providers = [{ provider: 'ginfer', models: [] }]
    mocks.catalog = []
    const path = '/external/Added model.ginfer'
    const registered = [{ provider: 'ginfer', models: [{ id: 'registered-model', displayName: 'Added local model', path, source: 'external' }] }]
    const guidance = 'The model was added, but the model list could not be refreshed. Choose Refresh installed models to try again.'
    const initialError = `${failedRead} request failed`
    const retryError = `${failedRead} retry failed`
    let rejectInitial!: (error: Error) => void
    mocks.open.mockResolvedValue(path)
    mocks.getProviders.mockResolvedValue(registered)
    render(<ModelManagement />)
    await waitFor(() => expect(mocks.command).toHaveBeenCalledWith('local_model_downloads'))
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalledOnce())
    mocks.refresh.mockClear()
    if (failedRead === 'provider inventory') {
      mocks.getProviders.mockImplementationOnce(() => {
        expect(mocks.recordModelInstall).toHaveBeenCalledExactlyOnceWith('registered-model')
        return new Promise((_resolve, reject) => { rejectInitial = reject })
      })
    } else {
      mocks.refresh.mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectInitial = reject }))
    }

    fireEvent.click(screen.getByRole('button', { name: 'Add local model' }))
    await waitFor(() => expect(failedRead === 'provider inventory' ? mocks.getProviders : mocks.refresh).toHaveBeenCalledOnce())
    expect(screen.getByRole('button', { name: 'Adding local model…' })).toBeDisabled()
    await act(async () => { rejectInitial(new Error(initialError)) })
    expect(await screen.findByText(guidance)).toBeVisible()
    expect(screen.getByRole('alert')).not.toHaveTextContent('Could not add this model.')
    expect(screen.getByText('Technical details').closest('details')).not.toHaveAttribute('open')
    expect(screen.getByText(initialError)).not.toBeVisible()
    expect(screen.getByRole('button', { name: 'Add local model' })).toBeEnabled()
    if (failedRead === 'Host status') expect(screen.getByText('Added local model')).toBeVisible()

    let finishInventory!: (providers: TestProvider[]) => void
    let rejectInventory!: (error: Error) => void
    let rejectHosts!: (error: Error) => void
    mocks.getProviders.mockImplementationOnce(() => new Promise((resolve, reject) => {
      finishInventory = resolve
      rejectInventory = reject
    }))
    if (failedRead === 'Host status') {
      mocks.refresh.mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectHosts = reject }))
    }
    const refresh = screen.getByRole('button', { name: 'Refresh installed models' })
    act(() => { fireEvent.click(refresh); fireEvent.click(refresh) })
    expect(mocks.getProviders).toHaveBeenCalledTimes(2)
    expect(refresh).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Add local model' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Model destination' })).toBeDisabled()
    expect(screen.getByText(guidance)).toBeVisible()
    if (failedRead === 'provider inventory') {
      await act(async () => { rejectInventory(new Error(retryError)) })
    } else {
      await act(async () => { finishInventory(registered) })
      expect(mocks.refresh).toHaveBeenCalledTimes(2)
      expect(refresh).toBeDisabled()
      fireEvent.click(refresh)
      expect(mocks.getProviders).toHaveBeenCalledTimes(2)
      await act(async () => { rejectHosts(new Error(retryError)) })
    }
    expect(screen.getByText(guidance)).toBeVisible()
    expect(screen.getByText(retryError)).not.toBeVisible()
    expect(screen.getByText('Technical details').closest('details')).not.toHaveAttribute('open')
    expect(refresh).toBeEnabled()

    fireEvent.click(refresh)
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument())
    expect(screen.getByText('Added local model')).toBeVisible()
    expect(refresh).toBeEnabled()
    expect(mocks.getProviders).toHaveBeenCalledTimes(3)
    expect(mocks.setProviders).toHaveBeenCalledTimes(failedRead === 'provider inventory' ? 1 : 3)
    expect(mocks.setProviders).toHaveBeenLastCalledWith(registered, 1)
    expect(mocks.recordModelInstall).toHaveBeenCalledExactlyOnceWith('registered-model')
    expect(mocks.refresh).toHaveBeenCalledTimes(failedRead === 'provider inventory' ? 1 : 3)
    expect(mocks.open).toHaveBeenCalledOnce()
    expect(mocks.command.mock.calls.filter(([action]) => action !== 'local_model_downloads')).toEqual([
      ['local_model_register', { path }],
    ])
    expect(mocks.switchModel).not.toHaveBeenCalled()
    expect(mocks.controlHost).not.toHaveBeenCalled()
  })
  it('guards repeated clicks before the chooser, registration and inventory refresh finish', async () => {
    let choose!: (path: string) => void
    let register!: (result: unknown) => void
    let inventory!: (providers: TestProvider[]) => void
    mocks.open.mockImplementationOnce(() => new Promise(resolve => { choose = resolve }))
    mocks.command.mockImplementation(action => action === 'local_model_register'
      ? new Promise(resolve => { register = resolve }) : Promise.resolve([]))
    mocks.getProviders.mockImplementationOnce(() => new Promise(resolve => { inventory = resolve }))
    render(<ModelManagement />)
    const add = screen.getByRole('button', { name: 'Add local model' })
    act(() => { fireEvent.click(add); fireEvent.click(add) })
    expect(mocks.open).toHaveBeenCalledOnce()
    expect(screen.getByRole('button', { name: 'Choose a model file…' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Model destination' })).toBeDisabled()
    await act(async () => { choose('/external/model.ginfer') })
    expect(screen.getByRole('button', { name: 'Adding local model…' })).toBeDisabled()
    fireEvent.click(add)
    expect(mocks.command.mock.calls.filter(([action]) => action === 'local_model_register')).toHaveLength(1)
    expect(screen.getByRole('button', { name: 'Load model' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Refresh installed models' })).toBeDisabled()
    await act(async () => { register({ modelId: 'local-model', modelPath: '/external/model.ginfer' }) })
    expect(mocks.getProviders).toHaveBeenCalledOnce()
    expect(mocks.recordModelInstall).toHaveBeenCalledExactlyOnceWith('local-model')
    mocks.inventoryRevision += 1 // A different install completes while this read is pending.
    expect(screen.getByRole('button', { name: 'Adding local model…' })).toBeDisabled()
    await act(async () => { inventory(mocks.providers) })
    expect(mocks.setProviders).toHaveBeenCalledExactlyOnceWith(mocks.providers, 1)
    expect(screen.getByRole('button', { name: 'Add local model' })).toBeEnabled()
    expect(mocks.open).toHaveBeenCalledOnce()
    expect(mocks.switchModel).not.toHaveBeenCalled()
  })
  it('offers local registration only on This computer > Installed', async () => {
    const user = userEvent.setup()
    render(<ModelManagement />)
    expect(screen.getByRole('button', { name: 'Add local model' })).toBeEnabled()
    fireEvent.click(screen.getByRole('tab', { name: 'Recommended' }))
    expect(screen.queryByRole('button', { name: 'Add local model' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: 'Downloads' }))
    expect(screen.queryByRole('button', { name: 'Add local model' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: 'Installed' }))
    await user.click(screen.getByRole('button', { name: 'Model destination' }))
    await user.click(screen.getByRole('menuitemradio', { name: 'Lab server' }))
    expect(screen.getByText('Installed on Lab server')).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Add local model' })).not.toBeInTheDocument()
    expect(mocks.open).not.toHaveBeenCalled()
  })
  it('uses local inventory and never offers the remote GPU package locally', async () => {
    render(<ModelManagement />)
    expect(screen.getByText('Installed locally')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: 'Recommended' }))
    expect(screen.getByText('No recommended model for these graphics cards yet')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Download to/ })).not.toBeInTheDocument()
    await waitFor(() => expect(mocks.command).toHaveBeenCalledWith('local_model_downloads'))
  })
  it('announces download status and ten-percent progress without announcing changing speed or estimates', async () => {
    render(<ModelManagement />)
    fireEvent.click(screen.getByRole('tab', { name: 'Downloads' }))
    await waitFor(() => expect(useLocalModelDownloads.getState().loaded).toBe(true))
    const job: ModelDownload = { id: 'accessible-download', release, status: 'downloading', received: 1024, bytes_per_second: 1024, error: null, path: null }
    act(() => useLocalModelDownloads.setState({ jobs: [job] }))
    const row = screen.getByRole('heading', { name: 'Blackwell model' }).closest('section')!
    const status = within(row).getByRole('status')
    expect(status).toHaveAttribute('aria-live', 'polite')
    expect(status).toHaveAttribute('aria-atomic', 'true')
    expect(status).toHaveTextContent('Blackwell model:')
    expect(status).toHaveTextContent('20%')
    const firstAnnouncement = status.textContent
    act(() => useLocalModelDownloads.setState({ jobs: [{ ...job, received: 1100, bytes_per_second: 2048 }] }))
    expect(status.textContent).toBe(firstAnnouncement)
    expect(within(row).getByRole('progressbar', { name: 'Blackwell model download' })).toHaveAttribute('value', '1100')
    act(() => useLocalModelDownloads.setState({ jobs: [{ ...job, received: 2048 }] }))
    expect(status).toHaveTextContent('50%')
    expect(status).not.toHaveTextContent(/MiB\/s|seconds left/)
    act(() => useLocalModelDownloads.setState({ jobs: [{ ...job, received: 4096, status: 'installed' }] }))
    expect(status).toHaveTextContent('Download complete')
    expect(status).not.toHaveTextContent('%')
  })
  it('keeps the host selector clear of the window edge', () => {
    render(<ModelManagement />)
    const header = screen.getByRole('heading', { name: 'Models' }).parentElement
    expect(header).toHaveClass('pr-4')
  })
  it.each([true, null, false])('downloads to the selected host without invoking a local transfer (local runtime ready: %s)', async ready => {
    mocks.resources = { ready, error: '' }
    const user = userEvent.setup()
    render(<ModelManagement />)
    await user.click(screen.getByRole('button', { name: 'Model destination' }))
    await user.click(screen.getByRole('menuitemradio', { name: 'Lab server' }))
    expect(screen.getByText('Installed on Lab server')).toBeInTheDocument()
    expect(screen.queryByText('Preparing GInfer to run models on this computer…')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: 'Recommended' }))
    expect(screen.getByRole('button', { name: 'Download to Lab server' })).toBeEnabled()
    fireEvent.click(screen.getByRole('button', { name: 'Download to Lab server' }))
    await waitFor(() => expect(mocks.command).toHaveBeenCalledWith('download', { host_id: 'remote', body: release }))
    expect(mocks.command.mock.calls.some(call => call[0] === 'local_model_download')).toBe(false)
    expect(mocks.switchModel).not.toHaveBeenCalled()
    expect(screen.getByRole('tab', { name: 'Downloads' })).toHaveAttribute('aria-selected', 'true')
  })
  it.each(['start', 'pause', 'resume', 'discard'] as const)('recovers an accepted local %s request with status reads only', async operation => {
    const usableRelease = { ...release, qualified_sm: ['8.6', '12.0'], min_vram_mib_per_gpu: 8192 }
    mocks.catalog = [{ library_name: 'ginfer', model_name: 'test/model', releases: [usableRelease] }]
    const job: ModelDownload = { id: 'action-job', release: usableRelease, status: operation === 'pause' ? 'downloading' : 'paused', received: 1024, bytes_per_second: 0, error: null, path: null }
    const initialJobs = operation === 'start' ? [] : [job]
    const accepted = deferred<unknown>()
    const followingRead = deferred<ModelDownload[]>()
    let readJobs = () => Promise.resolve(initialJobs)
    mocks.command.mockImplementation((action) => {
      if (action === 'local_model_downloads') return readJobs()
      if (action === 'local_model_download' || action === 'local_model_download_action') return accepted.promise
      return Promise.resolve([])
    })
    spyConfirm().mockReturnValue(true)
    render(<ModelManagement />)
    await waitFor(() => expect(useLocalModelDownloads.getState().loaded).toBe(true))
    fireEvent.click(screen.getByRole('tab', { name: operation === 'start' ? 'Recommended' : 'Downloads' }))
    const labels = { start: 'Download to this computer', pause: 'Pause download', resume: 'Resume download', discard: 'Delete partial download' }
    const request = screen.getByRole('button', { name: labels[operation] })
    const mutations = () => mocks.command.mock.calls.filter(([action]) => action === 'local_model_download' || action === 'local_model_download_action')
    readJobs = () => followingRead.promise
    act(() => { fireEvent.click(request); fireEvent.click(request) })
    await waitFor(() => expect(mutations()).toHaveLength(1))
    expect(request).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Model destination' })).toBeDisabled()
    expect(mutations()).toEqual(operation === 'start'
      ? [['local_model_download', { host_id: 'local', body: usableRelease }]]
      : [['local_model_download_action', { id: job.id, operation }]])
    await act(async () => { accepted.resolve({ ...job, status: 'queued' }) })
    await waitFor(() => expect(mocks.command.mock.calls.filter(([action]) => action === 'local_model_downloads')).toHaveLength(2))
    expect(screen.getByRole('button', { name: 'Refresh downloads' })).toBeDisabled()
    await act(async () => { followingRead.reject(new Error('accepted-action status read failed')) })
    const guidance = 'The download request was accepted, but its status could not be refreshed. Choose Refresh downloads to check its current state.'
    const alert = (await screen.findByText(guidance)).closest('[role="alert"]') as HTMLElement
    expect(within(alert).getByText('Technical details').closest('details')).not.toHaveAttribute('open')
    expect(within(alert).getByText('accepted-action status read failed')).not.toBeVisible()
    if (operation === 'start') {
      expect(screen.getByText('Download status is unavailable. Choose Refresh downloads to check it.')).toBeVisible()
      expect(screen.queryByText('No downloads on this computer yet. Choose Recommended to find a model.')).not.toBeInTheDocument()
      expect(screen.queryByText(/of unfinished downloads/)).not.toBeInTheDocument()
    }
    expect(screen.queryByText(/Could not (start the download|pause the download|resume the download|delete the partial download)/)).not.toBeInTheDocument()
    for (const button of screen.queryAllByRole('button', { name: /^(Pause download|Resume download|Delete partial download)$/ })) expect(button).toBeDisabled()
    fireEvent.click(screen.getByRole('tab', { name: 'Recommended' }))
    expect(screen.getByRole('button', { name: 'Download to this computer' })).toBeDisabled()
    fireEvent.click(screen.getByRole('tab', { name: 'Downloads' }))

    const failedRetry = deferred<ModelDownload[]>()
    readJobs = () => failedRetry.promise
    const beforeRetry = mocks.command.mock.calls.length
    const refresh = screen.getByRole('button', { name: 'Refresh downloads' })
    act(() => { fireEvent.click(refresh); fireEvent.click(refresh) })
    await waitFor(() => expect(mocks.command.mock.calls.slice(beforeRetry)).toEqual([['local_model_downloads']]))
    expect(refresh).toBeDisabled()
    await act(async () => { failedRetry.reject(new Error('read-only retry still unavailable')) })
    expect(screen.getByText(guidance)).toBeVisible()
    expect(screen.getByRole('button', { name: 'Refresh downloads' })).toBeEnabled()
    const retryAlert = screen.getByText(guidance).closest('[role="alert"]') as HTMLElement
    expect(within(retryAlert).getByText('read-only retry still unavailable')).not.toBeVisible()
    expect(within(retryAlert).getByText('Technical details').closest('details')).not.toHaveAttribute('open')

    const successfulRetry = deferred<ModelDownload[]>()
    readJobs = () => successfulRetry.promise
    fireEvent.click(screen.getByRole('button', { name: 'Refresh downloads' }))
    await act(async () => { successfulRetry.resolve(operation === 'discard' ? [] : [{ ...job, status: operation === 'pause' ? 'paused' : 'queued' }]) })
    expect(screen.queryByText(guidance)).not.toBeInTheDocument()
    expect(screen.queryByText('read-only retry still unavailable')).not.toBeInTheDocument()
    expect(await screen.findByText(operation === 'discard' ? 'No downloads on this computer yet. Choose Recommended to find a model.' : operation === 'pause' ? 'Paused; resume to continue' : 'Waiting to download')).toBeVisible()
    expect(mocks.command.mock.calls.slice(beforeRetry)).toEqual([['local_model_downloads'], ['local_model_downloads']])
    expect(mutations()).toHaveLength(1)
    fireEvent.click(screen.getByRole('tab', { name: 'Recommended' }))
    expect(screen.getByRole('button', { name: 'Download to this computer' })).toBeEnabled()
    expect(mocks.getProviders).not.toHaveBeenCalled()
    expect(mocks.switchModel).not.toHaveBeenCalled()
    expect(mocks.controlHost).not.toHaveBeenCalled()
  })
  it('keeps accepted paired-computer recovery with that computer while another remains available', async () => {
    const user = userEvent.setup()
    const usableRelease = { ...release, qualified_sm: ['8.6', '12.0'], min_vram_mib_per_gpu: 8192 }
    mocks.catalog = [{ library_name: 'ginfer', model_name: 'test/model', releases: [usableRelease] }]
    mocks.remoteDownloads = [{ id: 'remote-job', release: usableRelease, status: 'downloading', received: 1024, bytes_per_second: 0, error: null, path: null }]
    const accepted = deferred<unknown>()
    const followingRead = deferred<EngineSnapshot>()
    let readSnapshot = () => followingRead.promise
    mocks.command.mockImplementation(action => action === 'download_action' ? accepted.promise : action === 'snapshot' ? readSnapshot() : Promise.resolve([]))
    render(<ModelManagement />)
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalledOnce())
    await user.click(screen.getByRole('button', { name: 'Model destination' }))
    await user.click(screen.getByRole('menuitemradio', { name: 'Lab server' }))
    fireEvent.click(screen.getByRole('tab', { name: 'Downloads' }))
    const pause = screen.getByRole('button', { name: 'Pause download' })
    act(() => { fireEvent.click(pause); fireEvent.click(pause) })
    await act(async () => { accepted.resolve(undefined) })
    expect(mocks.command.mock.calls.filter(([action]) => action === 'download_action')).toEqual([
      ['download_action', { host_id: 'remote', body: { id: 'remote-job', action: 'pause' } }],
    ])
    expect(mocks.command).toHaveBeenCalledWith('snapshot', { host_id: 'remote' })
    await act(async () => { followingRead.reject(new Error('paired status read failed')) })
    const guidance = 'The download request was accepted, but its status could not be refreshed. Choose Refresh downloads to check its current state.'
    const alert = (await screen.findByText(guidance)).closest('[role="alert"]') as HTMLElement
    expect(within(alert).getByText('paired status read failed')).not.toBeVisible()
    expect(within(alert).getByText('Technical details').closest('details')).not.toHaveAttribute('open')
    expect(screen.getByRole('button', { name: 'Pause download' })).toBeDisabled()
    fireEvent.click(screen.getByRole('tab', { name: 'Recommended' }))
    expect(screen.getByRole('button', { name: 'Download to Lab server' })).toBeDisabled()

    await user.click(screen.getByRole('button', { name: 'Model destination' }))
    await user.click(screen.getByRole('menuitemradio', { name: 'This computer' }))
    expect(screen.queryByText(guidance)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Download to this computer' })).toBeEnabled()
    await user.click(screen.getByRole('button', { name: 'Model destination' }))
    await user.click(screen.getByRole('menuitemradio', { name: 'Lab server' }))
    expect(screen.getByText(guidance)).toBeVisible()
    expect(screen.getByRole('button', { name: 'Download to Lab server' })).toBeDisabled()
    fireEvent.click(screen.getByRole('tab', { name: 'Downloads' }))
    const failedRetry = deferred<EngineSnapshot>()
    readSnapshot = () => failedRetry.promise
    mocks.errors = { remote: 'previous fleet status unavailable' }
    fireEvent.click(screen.getByRole('button', { name: 'Refresh downloads' }))
    await act(async () => { failedRetry.reject(new Error('paired retry failed')) })
    const retryAlert = (await screen.findByText('paired retry failed')).closest('[role="alert"]') as HTMLElement
    expect(within(retryAlert).getByText(guidance)).toBeVisible()
    expect(screen.getByRole('button', { name: 'Refresh downloads' })).toBeEnabled()
    const finalRead = deferred<EngineSnapshot>()
    readSnapshot = () => finalRead.promise
    const refresh = screen.getByRole('button', { name: 'Refresh downloads' })
    act(() => { fireEvent.click(refresh); fireEvent.click(refresh) })
    expect(refresh).toBeDisabled()
    const updatedSnapshot: EngineSnapshot = {
      host_id: 'remote', display_name: 'Lab server', revision: 2,
      gpus: [{ uuid: 'remote-gpu', name: 'Remote GPU', memory_mib: 32768, compute_capability: '12.0' }], models: [], instances: [],
      model_management: { version: 1, managed_root: '/models', engine_presets_available: true, downloads: [] },
    }
    await act(async () => { finalRead.resolve(updatedSnapshot) })
    expect(await screen.findByText('No downloads on this computer yet. Choose Recommended to find a model.')).toBeVisible()
    expect(screen.queryByText(guidance)).not.toBeInTheDocument()
    expect(mocks.refresh).toHaveBeenCalledOnce()
    expect(mocks.publishSnapshot).toHaveBeenCalledExactlyOnceWith('remote', updatedSnapshot)
    expect(mocks.errors).toEqual({})
    expect(mocks.command.mock.calls.filter(([action]) => action !== 'local_model_downloads')).toEqual([
      ['download_action', { host_id: 'remote', body: { id: 'remote-job', action: 'pause' } }],
      ['snapshot', { host_id: 'remote' }],
      ['snapshot', { host_id: 'remote' }],
      ['snapshot', { host_id: 'remote' }],
    ])
    expect(mocks.switchModel).not.toHaveBeenCalled()
    expect(mocks.controlHost).not.toHaveBeenCalled()
  })
  it('keeps a rejected download request retryable without claiming it was accepted', async () => {
    const job: ModelDownload = { id: 'rejected-job', release, status: 'downloading', received: 1024, bytes_per_second: 0, error: null, path: null }
    const rejected = deferred<unknown>()
    let response = rejected.promise
    mocks.command.mockImplementation(action => action === 'local_model_downloads' ? Promise.resolve([job]) : response)
    render(<ModelManagement />)
    fireEvent.click(screen.getByRole('tab', { name: 'Downloads' }))
    const pause = await screen.findByRole('button', { name: 'Pause download' })
    act(() => { fireEvent.click(pause); fireEvent.click(pause) })
    await act(async () => { rejected.reject(new Error('pause request rejected')) })
    expect(await screen.findByText('Could not pause the download. Try again when this computer is connected.')).toBeVisible()
    expect(screen.queryByText(/The download request was accepted/)).not.toBeInTheDocument()
    expect(screen.getByText('pause request rejected')).not.toBeVisible()
    expect(screen.getByRole('button', { name: 'Pause download' })).toBeEnabled()
    expect(mocks.command.mock.calls.filter(([action]) => action === 'local_model_downloads')).toHaveLength(1)
    const retry = deferred<unknown>()
    response = retry.promise
    fireEvent.click(screen.getByRole('button', { name: 'Pause download' }))
    await act(async () => { job.status = 'paused'; retry.resolve(undefined) })
    expect(await screen.findByText('Paused; resume to continue')).toBeVisible()
    expect(screen.queryByText('pause request rejected')).not.toBeInTheDocument()
    expect(mocks.command.mock.calls.filter(([action]) => action === 'local_model_download_action')).toEqual([
      ['local_model_download_action', { id: 'rejected-job', operation: 'pause' }],
      ['local_model_download_action', { id: 'rejected-job', operation: 'pause' }],
    ])
  })
  it('describes downloads and recommendations in plain words', async () => {
    mocks.command.mockImplementation(async action => action === 'local_model_downloads'
      ? [{ id: 'job', release, status: 'paused', received: 1024, bytes_per_second: 0, error: null, path: null }] : [])
    render(<ModelManagement />)
    expect(screen.getByText(/Load model picks settings for you: tested settings for your graphics card when they exist, then your saved settings, then the longest conversation that fits/)).toBeInTheDocument()
    expect(screen.getByText(/Choose the graphics cards to load the model onto/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: 'Downloads' }))
    expect(await screen.findByText('Paused; resume to continue')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Resume download' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Delete partial download' })).toBeInTheDocument()
    expect(screen.getByText(/Only one model downloads at a time/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: 'Recommended' }))
    expect(screen.getByText(/No model in the list supports these graphics cards and fits their memory/)).toBeInTheDocument()
    expect(document.body).not.toHaveTextContent(/CUDA_VISIBLE_DEVICES|\bTP\b|VRAM|Smol/)
  })
  it.each(['SHA256 mismatch', 'not a GInfer version-3 container'])('discards unusable saved bytes instead of retrying them: %s', async (error) => {
    const usableRelease = { ...release, qualified_sm: ['8.6'], min_vram_mib_per_gpu: 8192 }
    mocks.catalog = [{ library_name: 'ginfer', model_name: 'test/model', releases: [usableRelease] }]
    spyConfirm().mockReturnValueOnce(true)
    let discarded = false
    let fresh = false
    mocks.command.mockImplementation(async (action, args) => {
      if (action === 'local_model_download_action') {
        expect(args).toEqual({ id: 'job', operation: 'discard' })
        discarded = true
      }
      const job = { id: fresh ? 'new-job' : 'job', release: usableRelease, status: fresh ? 'queued' : 'failed', received: fresh ? 0 : 4096, bytes_per_second: 0, error: fresh ? null : error, path: null }
      if (action === 'local_model_download') {
        fresh = true
        return { ...job, id: 'new-job', status: 'queued', received: 0, error: null }
      }
      return action === 'local_model_downloads' && (!discarded || fresh) ? [job] : []
    })
    render(<ModelManagement />)
    fireEvent.click(screen.getByRole('tab', { name: 'Downloads' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('The downloaded file is damaged or isn’t a GInfer model. Choose Delete partial download, then download the model again from Recommended.')
    expect(screen.queryByRole('button', { name: 'Retry download' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Resume download' })).not.toBeInTheDocument()
    expect(screen.getByText(error)).not.toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Delete partial download' }))
    expect(await screen.findByText('No downloads on this computer yet. Choose Recommended to find a model.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: 'Recommended' }))
    fireEvent.click(screen.getByRole('button', { name: 'Download to this computer' }))
    await waitFor(() => expect(mocks.command).toHaveBeenCalledWith('local_model_download', { host_id: 'local', body: usableRelease }))
    expect(await screen.findByText('Waiting to download')).toBeInTheDocument()
    expect(screen.getByRole('progressbar')).toHaveAttribute('value', '0')
    expect(mocks.command.mock.calls.some(call => call[0] === 'local_model_download_action' && call[1]?.operation === 'resume')).toBe(false)
  })
  it.each([
    ['connection reset by peer', 'The download was interrupted. Check your internet connection, then choose Retry download.'],
    ['No space left on device (os error 28)', 'There isn’t enough space in the model folder. Free some disk space, then choose Retry download.'],
    ['unrecognized failure', 'The download couldn’t finish. Choose Retry download, or open Technical details for more information.'],
  ])('names and exercises the retry control for a failed download: %s', async (error, guidance) => {
    let status = 'failed'
    mocks.command.mockImplementation(async (action, args) => {
      if (action === 'local_model_download_action') {
        expect(args).toEqual({ id: 'job', operation: 'resume' })
        status = 'queued'
      }
      return action === 'local_model_downloads'
        ? [{ id: 'job', release, status, received: 1024, bytes_per_second: 0, error: status === 'failed' ? error : null, path: null }] : []
    })
    render(<ModelManagement />)
    fireEvent.click(screen.getByRole('tab', { name: 'Downloads' }))
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(guidance)
    expect(screen.getByText(error)).not.toBeVisible()
    const details = screen.getByText('Technical details').closest('details')
    expect(details).not.toHaveAttribute('open')
    fireEvent.click(screen.getByRole('button', { name: 'Retry download' }))
    expect(await screen.findByText('Waiting to download')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Pause download' })).toBeInTheDocument()
    expect(screen.getByRole('progressbar')).toHaveAttribute('value', '1024')
    expect(mocks.command).toHaveBeenCalledWith('local_model_download_action', { id: 'job', operation: 'resume' })
  })
  it('says it is checking, not that there are no downloads, until the Host has answered', async () => {
    useLocalModelDownloads.setState({ jobs: [], loaded: false, error: null })
    let answer!: (jobs: unknown[]) => void
    mocks.command.mockImplementation(action => action === 'local_model_downloads'
      ? new Promise(resolve => { answer = resolve }) : Promise.resolve([]))
    render(<ModelManagement />)
    fireEvent.click(screen.getByRole('tab', { name: 'Downloads' }))
    try {
      expect(screen.getByText('Checking for downloads…')).toBeInTheDocument()
      expect(screen.queryByText('No downloads on this computer yet. Choose Recommended to find a model.')).not.toBeInTheDocument()
      expect(screen.queryByText(/of unfinished downloads/)).not.toBeInTheDocument()
    } finally {
      await act(async () => { answer([]) })
    }
    expect(await screen.findByText('No downloads on this computer yet. Choose Recommended to find a model.')).toBeInTheDocument()
    expect(screen.getByText(/0 MiB of unfinished downloads · 0 MiB of downloaded models/)).toBeVisible()
  })
  it('keeps the first failed inventory unknown until Refresh downloads succeeds', async () => {
    mocks.command.mockRejectedValue(new Error('Host is still starting'))
    render(<ModelManagement />)
    fireEvent.click(screen.getByRole('tab', { name: 'Downloads' }))
    expect(await screen.findByText('Could not check your downloads. Open Downloads and choose Refresh downloads to try again.')).toBeVisible()
    expect(screen.queryByText('Checking for downloads…')).not.toBeInTheDocument()
    expect(screen.queryByText('No downloads on this computer yet. Choose Recommended to find a model.')).not.toBeInTheDocument()
    expect(screen.queryByText(/of unfinished downloads/)).not.toBeInTheDocument()

    mocks.command.mockResolvedValue([])
    fireEvent.click(screen.getByRole('button', { name: 'Refresh downloads' }))
    expect(await screen.findByText('No downloads on this computer yet. Choose Recommended to find a model.')).toBeVisible()
    expect(screen.getByText(/0 MiB of unfinished downloads · 0 MiB of downloaded models/)).toBeVisible()
    expect(screen.queryByText('Could not check your downloads. Open Downloads and choose Refresh downloads to try again.')).not.toBeInTheDocument()
  })
  it('moves between the model tabs with the arrow keys and keeps one tab stop', async () => {
    const user = userEvent.setup()
    render(<ModelManagement />)
    const installed = screen.getByRole('tab', { name: 'Installed' })
    expect(installed).toHaveAttribute('tabindex', '0')
    expect(screen.getByRole('tab', { name: 'Recommended' })).toHaveAttribute('tabindex', '-1')
    installed.focus()
    await user.keyboard('{ArrowRight}')
    expect(screen.getByRole('tab', { name: 'Recommended' })).toHaveFocus()
    expect(screen.getByRole('tab', { name: 'Recommended' })).toHaveAttribute('aria-selected', 'true')
    await user.keyboard('{End}')
    expect(screen.getByRole('tab', { name: 'Downloads' })).toHaveFocus()
    await user.keyboard('{ArrowRight}')
    expect(screen.getByRole('tab', { name: 'Installed' })).toHaveFocus()
  })
  it('shows a failed load as a plain message, without the stale-inventory note', async () => {
    spyConfirm().mockReturnValueOnce(true)
    mocks.switchModel.mockRejectedValue(new Error('Failed to load Qwen: Not enough graphics memory.'))
    render(<ModelManagement />)
    fireEvent.click(screen.getByRole('button', { name: 'Load model' }))
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Could not load this model. Check that the selected graphics cards are available and have enough memory, then try again.')
    expect(screen.getByText('Failed to load Qwen: Not enough graphics memory.')).not.toBeVisible()
    fireEvent.click(screen.getByText('Technical details'))
    expect(screen.getByText('Failed to load Qwen: Not enough graphics memory.')).toBeVisible()
    expect(alert).not.toHaveTextContent(/^Error:/)
    expect(alert).not.toHaveTextContent('Saved inventory may be out of date')
    expect(screen.getByRole('status', { name: 'Model load status' })).toHaveTextContent('Model could not be loaded. Check the error below before trying again.')
    mocks.switchModel.mockResolvedValue(undefined)
  })
  it('says plainly why Automatic could not start a model and offers custom settings', async () => {
    spyConfirm().mockReturnValueOnce(true)
    const message = 'These settings need 3.2 GB more GPU memory than is free. Try a shorter context length: 131,072 tokens or less fits.'
    mocks.switchModel.mockRejectedValue(Object.assign(new Error(`Failed to load Installed locally: ${message}`), { code: 'does_not_fit' }))
    mocks.localSnapshot = customSnapshot()
    render(<ModelManagement />)
    fireEvent.click(screen.getByRole('button', { name: 'Load model' }))
    const alert = await screen.findByRole('alert')
    expect(within(alert).getByText(message)).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Choose custom settings' }))
    expect(screen.getByRole('region', { name: 'Custom settings for Installed locally' })).toBeInTheDocument()
    mocks.switchModel.mockResolvedValue(undefined)
  })
  it('loads on the CPU through the same Automatic load, without measuring graphics cards or sending the user to GInfer Hosts', async () => {
    spyConfirm().mockReturnValueOnce(true)
    const model = { id: 'host-model', path: '/models/local.ginfer', devices: ['cpu'], metadata: { identity: { model_id: 'qwen3.6-35b-a3b', weights_id: 'groupwise-int' }, tp_size: 1 } }
    mocks.localSnapshot = { host_id: 'local-host', gpus: [], models: [model], instances: [],
      cpu: { label: 'CPU AVX-512', total_ram_bytes: 64 * 1024 ** 3, gpu_inventory_note: null } }
    const actions: string[] = []
    mocks.command.mockImplementation(async action => { actions.push(action); return action === 'snapshot' ? mocks.localSnapshot : [] })
    render(<ModelManagement />)
    expect(screen.getByText(/This computer’s processor: CPU AVX-512/)).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: /Device/ })).toHaveAccessibleDescription(/CPU uses the processor and system memory/)
    fireEvent.click(screen.getByRole('button', { name: 'Load model' }))
    await waitFor(() => expect(screen.getByRole('status', { name: 'Model load status' })).toHaveTextContent('Model loaded and ready to use.'))
    expect(mocks.switchModel).toHaveBeenCalledWith(expect.objectContaining({ options: expect.objectContaining({ useProfileDefaults: true, device: 'auto' }) }))
    expect(actions).not.toContain('hardware_profile')
    expect(screen.queryByRole('link', { name: 'Open GInfer Hosts' })).toBeNull()
  })
  it('explains a CPU memory shortfall with the amounts and never offers GInfer Hosts', async () => {
    spyConfirm().mockReturnValueOnce(true)
    mocks.selectedDevice = 'cpu'
    mocks.switchModel.mockRejectedValue(Object.assign(new Error('Failed to load Installed locally: Not enough memory (RAM) to run this model on the CPU with these settings: it needs 24.0 GB, and 21.0 GB is free after leaving 4.3 GB for the rest of the computer (3.0 GB short). Close other programs, or choose a shorter Context length. Engine: CPU route Host memory: short'), { code: 'cpu_ram' }))
    mocks.localSnapshot = customSnapshot({ gpus: [] })
    render(<ModelManagement />)
    expect(screen.queryByText('Graphics cards to use when loading a model')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Load model' }))
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Not enough memory (RAM) to run this model on the CPU with these settings: it needs 24.0 GB')
    expect(alert).not.toHaveTextContent('[cpu_ram]')
    expect(mocks.switchModel).toHaveBeenCalledWith(expect.objectContaining({ options: expect.objectContaining({ device: 'cpu' }) }))
    expect(screen.queryByRole('link', { name: 'Open GInfer Hosts' })).toBeNull()
    mocks.switchModel.mockResolvedValue(undefined)
  })
  it('names the INT or SMOL version when an NVFP4 package is chosen for the CPU', async () => {
    spyConfirm().mockReturnValueOnce(true)
    mocks.selectedDevice = 'cpu'
    mocks.switchModel.mockRejectedValue(Object.assign(new Error('Failed to load Installed locally: This version of the model (NVFP4) only runs on NVIDIA graphics cards. To run it on the CPU, use the INT or SMOL version.'), { code: 'no_cpu_format' }))
    const model = { id: 'host-model', path: '/models/local.ginfer', devices: ['gpu'], metadata: { identity: { model_id: 'qwen3.8-27b', weights_id: 'nvfp4-dflash2-nvfp4' }, tp_size: 1 } }
    mocks.localSnapshot = { host_id: 'local-host', gpus: [], models: [model], instances: [] }
    render(<ModelManagement />)
    fireEvent.click(screen.getByRole('button', { name: 'Load model' }))
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('This version of the model (NVFP4) only runs on NVIDIA graphics cards. To run it on the CPU, use the INT or SMOL version.')
    expect(screen.getByRole('button', { name: 'Add the INT or SMOL version (.ginfer file)' })).toBeEnabled()
    mocks.switchModel.mockResolvedValue(undefined)
  })
  it('checks custom settings, saves them as a profile and starts the model with them', async () => {
    mocks.getActiveModels.mockResolvedValue([])
    mocks.localSnapshot = customSnapshot()
    const quotes: number[] = []
    mocks.command.mockImplementation(async (action, args) => {
      const body = args?.body as Record<string, unknown> | undefined
      if (action === 'snapshot') return mocks.localSnapshot
      if (action === 'quote') {
        quotes.push(body!.max_context as number)
        return (body!.max_context as number) > 16384
          ? { instance_count: 1, kv_arena_bytes: null, fit: { fits: false, max_context: 20480, message: 'These settings need 1.0 GB more GPU memory than is free. Try a shorter context length: 20,480 tokens or less fits.' } }
          : { instance_count: 1, kv_arena_bytes: null, fit: { fits: true } }
      }
      if (action === 'custom_profile') return { profile: { id: 'saved-1' } }
      if (action === 'launch') return { instance_id: 'i1' }
      return []
    })
    render(<ModelManagement />)
    fireEvent.click(screen.getByRole('button', { name: 'Custom settings' }))
    const panel = screen.getByRole('region', { name: 'Custom settings for Installed locally' })
    for (const name of ['Device', 'K/V cache']) expect(within(panel).getByRole('button', { name })).toBeInTheDocument()
    for (const name of ['Enable Speculative Decoding', 'Enable Vision', 'Structured outputs', 'CUDA Graphs'])
      expect(within(panel).getByRole('checkbox', { name })).toHaveAccessibleDescription(/\w/)
    expect(within(panel).getByText('Tensor parallel: 1')).toBeInTheDocument()
    expect(within(panel).getByRole('spinbutton', { name: 'Context length (tokens)' })).toHaveAccessibleDescription(/How much text the model keeps in mind/)
    fireEvent.click(within(panel).getByRole('button', { name: 'Check settings' }))
    expect(await within(panel).findByRole('alert')).toHaveTextContent('These settings need 1.0 GB more GPU memory than is free. Try a shorter context length: 20,480 tokens or less fits.')
    expect(within(panel).queryByRole('button', { name: 'Save as profile' })).toBeNull()
    fireEvent.change(within(panel).getByRole('spinbutton', { name: 'Context length (tokens)' }), { target: { value: '16384' } })
    fireEvent.click(within(panel).getByRole('button', { name: 'Check settings' }))
    expect(await within(panel).findByText(/These settings fit\./)).toBeInTheDocument()
    expect(quotes).toEqual([32768, 16384])
    fireEvent.change(within(panel).getByRole('textbox', { name: 'Profile name' }), { target: { value: 'Short chats' } })
    fireEvent.click(within(panel).getByRole('button', { name: 'Save as profile' }))
    await waitFor(() => expect(mocks.command).toHaveBeenCalledWith('custom_profile', { host_id: 'local-host', body: {
      action: 'save', name: 'Short chats', settings: expect.objectContaining({ model_id: 'host-model', gpu_uuids: ['gpu-1'], max_context: 16384, concurrency: 1 }) } }))
    fireEvent.click(within(panel).getByRole('button', { name: 'Start with these settings' }))
    await waitFor(() => expect(mocks.switchModel).toHaveBeenCalled())
    expect(mocks.command).toHaveBeenCalledWith('launch', { host_id: 'local-host', body: expect.objectContaining({
      model_id: 'host-model', gpu_uuids: ['gpu-1'], max_context: 16384, concurrency: 1, remaining_instances: 1, load_operation_id: expect.any(String) }) })
    expect(mocks.switchModel).toHaveBeenCalledWith(expect.objectContaining({ modelId: 'local-model', gpuUuids: ['gpu-1'],
      options: expect.objectContaining({ useProfileDefaults: true }) }))
    expect(await screen.findByRole('status', { name: 'Model load status' })).toHaveTextContent('Model loaded and ready to use.')
  })
  it('lists tested and saved settings, labelled, and never applies a saved profile whose cards changed', async () => {
    const user = userEvent.setup()
    mocks.localSnapshot = customSnapshot({
      launch_profiles: [{ model_id: 'host-model', gpu_groups: [['gpu-1']], compatible_gpu_groups: [['gpu-1']], profile: {
        id: 'tested-1', name: 'Tested', tp: 1, max_context: 65536, concurrency: 4, options: { vision: false, structured_outputs: false, spec: 'dflash', draft_tokens: 7, draft_tp: 1, kv_dtype: 'int8', kv_arena_bytes: null, host_kv_cache_bytes: null, prefill_chunk: 0, no_cuda_graph: false },
        qualification: { tier: 'screened-startup', engine_revision: 'abc' } } }],
      custom_profiles: [savedProfile('ready-1', 'Long chats', 'ready'), savedProfile('old-1', 'Old card', 'hardware_changed')],
    })
    render(<ModelManagement />)
    fireEvent.click(screen.getByRole('button', { name: 'Custom settings' }))
    const panel = screen.getByRole('region', { name: 'Custom settings for Installed locally' })
    await user.click(within(panel).getByRole('button', { name: 'Saved settings' }))
    expect(screen.getByRole('menuitemradio', { name: 'Tested · Short conversations tested · 4 replies at once · 64K tokens · Text only' })).toBeInTheDocument()
    expect(screen.getByRole('menuitemradio', { name: 'Custom · Long chats' })).toBeInTheDocument()
    await user.click(screen.getByRole('menuitemradio', { name: 'Custom · Old card · check again' }))
    expect(within(panel).getByRole('alert')).toHaveTextContent('The graphics cards on this computer changed since you saved these settings. Check them again before using them.')
    expect(within(panel).getByRole('button', { name: 'Save changes' })).toBeDisabled()
    expect(within(panel).getByRole('spinbutton', { name: 'Context length (tokens)' })).toHaveValue(98304)
  })
  it('shows a model started from GInfer Hosts as running and stops that Host instance', async () => {
    mocks.localSnapshot = { host_id: 'local-host', gpus: [], models: [{ id: 'host-model', path: '/models/local.ginfer' }],
      instances: [{ instance_id: 'inst', status: 'ready', profile: { model_id: 'host-model' } }], model_management: { version: 1, downloads: [] } }
    try {
      render(<ModelManagement />)
      expect(screen.getByText(/^Running · /)).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Load model' })).toBeDisabled()
      fireEvent.click(screen.getByRole('button', { name: 'Stop model' }))
      await waitFor(() => expect(mocks.controlHost).toHaveBeenCalledWith('ginfer/local-host/inst', 'stop'))
      await waitFor(() => expect(screen.getByText(/^Installed · /)).toBeVisible())
      expect(screen.getByRole('button', { name: 'Stop model' })).toBeDisabled()
    } finally { mocks.localSnapshot = null }
  })
  it.each([
    { route: 'desktop', failedRead: 'active inventory' },
    { route: 'local Host', failedRead: 'active inventory' },
    { route: 'desktop', failedRead: 'Host snapshot' },
  ] as const)('recovers a confirmed $route Stop after a failed $failedRead without replaying mutations', async ({ route, failedRead }) => {
    const user = userEvent.setup()
    const alias = 'ginfer/local-host/inst'
    const otherAlias = 'ginfer/local-host/other-inst'
    const readySnapshot = { host_id: 'local-host', gpus: [], models: [
      { id: 'host-model', path: '/models/local.ginfer' }, { id: 'other-host-model', path: '/models/another-host.ginfer' },
    ], instances: [
      { instance_id: 'inst', status: 'ready', profile: { model_id: 'host-model' } },
      { instance_id: 'other-inst', status: 'ready', profile: { model_id: 'other-host-model' } },
    ], model_management: { version: 1, downloads: [] } }
    const stoppedSnapshot = { ...readySnapshot, instances: readySnapshot.instances.map(instance =>
      instance.instance_id === 'inst' ? { ...instance, status: 'stopped' } : instance) } as unknown as EngineSnapshot
    mocks.localSnapshot = readySnapshot
    mocks.providers[0].models.push({ id: 'other-model', displayName: 'Another active model', path: '/models/other.ginfer' })
    mocks.providers.push({ provider: 'openai', models: [{ id: 'cloud-model', displayName: 'Cloud model', path: '' }] })
    useAppState.setState({ activeModels: [...(route === 'desktop' ? ['local-model'] : []), alias, 'other-model', 'cloud-model', otherAlias] })
    const stop = deferred<{ success: boolean }>()
    const hostStop = deferred<void>()
    const firstRead = deferred<string[]>()
    const firstSnapshot = deferred<EngineSnapshot>()
    mocks.stopModel.mockReturnValueOnce(stop.promise)
    mocks.controlHost.mockImplementationOnce(async () => {
      await hostStop.promise
      mocks.publishSnapshot('local-host', stoppedSnapshot)
    })
    mocks.getActiveModels.mockReturnValueOnce(firstRead.promise)
    let snapshotReads = 0
    mocks.command.mockImplementation(async action => {
      if (action === 'snapshot') {
        snapshotReads++
        return failedRead === 'Host snapshot' && snapshotReads === 1 ? firstSnapshot.promise : stoppedSnapshot
      }
      return []
    })
    render(<ModelManagement />)
    await waitFor(() => expect(mocks.command).toHaveBeenCalledWith('local_model_downloads'))
    const downloadReads = mocks.command.mock.calls.filter(([action]) => action === 'local_model_downloads').length
    const stoppedRow = within(screen.getByRole('heading', { name: 'Installed locally' }).closest('section')!)
    const otherRow = within(screen.getByRole('heading', { name: 'Another active model' }).closest('section')!)
    const stopButton = stoppedRow.getByRole('button', { name: 'Stop model' })
    act(() => { fireEvent.click(stopButton); fireEvent.click(stopButton) })
    expect(route === 'desktop' ? mocks.stopModel : mocks.controlHost).toHaveBeenCalledOnce()
    expect(mocks.getActiveModels).not.toHaveBeenCalled()
    expect(useAppState.getState().activeModels).toContain(alias)
    expect(stopButton).toBeDisabled()
    await act(async () => { if (route === 'desktop') stop.resolve({ success: true }); else hostStop.resolve() })
    await waitFor(() => expect(mocks.getActiveModels).toHaveBeenCalledOnce())
    // Desktop Stop confirms its model id; only a fresh snapshot can resolve the cached Host alias.
    expect(useAppState.getState().activeModels).toEqual([...(route === 'desktop' ? [alias] : []), 'other-model', 'cloud-model', otherAlias])
    expect(stoppedRow.getByText(/^Checking status · /)).toBeVisible()
    expect(otherRow.getByText(/^Running · /)).toBeVisible()
    for (const button of screen.getAllByRole('button', { name: /^(Load|Stop) model$/ })) expect(button).toBeDisabled()

    const initialError = `${failedRead} connection failed after Stop`
    if (failedRead === 'Host snapshot') {
      await act(async () => { firstRead.resolve(['other-model']) })
      await waitFor(() => expect(mocks.command).toHaveBeenCalledWith('snapshot', { host_id: 'local-host' }))
      await act(async () => { firstSnapshot.reject(new Error(initialError)) })
    } else {
      await act(async () => { firstRead.reject(new Error(initialError)) })
    }
    const guidance = 'The model stopped, but the running model list could not be refreshed. Choose Refresh model status before loading or stopping another model.'
    expect(await screen.findByText(guidance)).toBeVisible()
    expect(screen.getByRole('alert')).not.toHaveTextContent('Could not stop this model.')
    expect(screen.getByText('Technical details').closest('details')).not.toHaveAttribute('open')
    expect(screen.getByText(initialError)).not.toBeVisible()
    expect(stoppedRow.getByText(/^Status unavailable · /)).toBeVisible()
    for (const button of screen.getAllByRole('button', { name: /^(Load|Stop) model$/ })) expect(button).toBeDisabled()
    expect(mocks.command.mock.calls.filter(([action]) => action !== 'snapshot')).toHaveLength(downloadReads)
    expect(mocks.command.mock.calls.filter(([action]) => action === 'local_model_downloads')).toHaveLength(downloadReads)

    await user.click(screen.getByRole('button', { name: 'Model destination' }))
    await user.click(screen.getByRole('menuitemradio', { name: 'Lab server' }))
    expect(screen.getByText('Installed on Lab server')).toBeVisible()
    expect(screen.queryByText(guidance)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Refresh model status' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('tab', { name: 'Recommended' }))
    expect(screen.getByRole('button', { name: 'Download to Lab server' })).toBeEnabled()
    await user.click(screen.getByRole('button', { name: 'Model destination' }))
    await user.click(screen.getAllByRole('menuitemradio', { name: 'This computer' })[0])
    await user.click(screen.getByRole('tab', { name: 'Installed' }))
    expect(screen.getByText(guidance)).toBeVisible()
    // Returning to this computer refreshes its download inventory independently of Stop.
    const navigationDownloadReads = downloadReads + 1
    await waitFor(() => expect(mocks.command.mock.calls.filter(([action]) => action === 'local_model_downloads')).toHaveLength(navigationDownloadReads))

    const retryRead = deferred<string[]>()
    mocks.getActiveModels.mockReturnValueOnce(retryRead.promise)
    const retry = screen.getByRole('button', { name: 'Refresh model status' })
    act(() => { fireEvent.click(retry); fireEvent.click(retry) })
    expect(mocks.getActiveModels).toHaveBeenCalledTimes(2)
    expect(retry).toBeDisabled()
    for (const button of screen.getAllByRole('button', { name: /^(Load|Stop) model$/ })) expect(button).toBeDisabled()
    await act(async () => { retryRead.reject(new Error('Status retry connection failed')) })
    expect(screen.getByText(guidance)).toBeVisible()
    expect(screen.getByText('Status retry connection failed')).not.toBeVisible()
    expect(retry).toBeEnabled()
    const finalRead = deferred<string[]>()
    mocks.getActiveModels.mockReturnValueOnce(finalRead.promise)
    act(() => { fireEvent.click(retry); fireEvent.click(retry) })
    expect(mocks.getActiveModels).toHaveBeenCalledTimes(3)
    await act(async () => { finalRead.resolve(['other-model']) })
    await waitFor(() => expect(screen.queryByText(guidance)).not.toBeInTheDocument())
    const refreshedRow = within(screen.getByRole('heading', { name: 'Installed locally' }).closest('section')!)
    expect(refreshedRow.getByRole('button', { name: 'Load model' })).toBeEnabled()
    expect(refreshedRow.getByRole('button', { name: 'Stop model' })).toBeDisabled()
    expect(within(screen.getByRole('heading', { name: 'Another active model' }).closest('section')!).getByRole('button', { name: 'Stop model' })).toBeEnabled()
    expect(useAppState.getState().activeModels).toEqual(['other-model', otherAlias, 'cloud-model'])
    expect(mocks.stopModel).toHaveBeenCalledTimes(route === 'desktop' ? 1 : 0)
    expect(mocks.controlHost).toHaveBeenCalledTimes(route === 'local Host' ? 1 : 0)
    expect(mocks.publishSnapshot).toHaveBeenCalledWith('local-host', stoppedSnapshot)
    expect(mocks.command.mock.calls.filter(([action]) => action !== 'snapshot')).toHaveLength(navigationDownloadReads)
    expect(mocks.command.mock.calls.filter(([action]) => action === 'local_model_downloads')).toHaveLength(navigationDownloadReads)
    expect(mocks.switchModel).not.toHaveBeenCalled()
    expect(mocks.getProviders).not.toHaveBeenCalled()
    expect(mocks.open).not.toHaveBeenCalled()
  })
  it.each(['desktop rejection', 'desktop unsuccessful result', 'desktop missing confirmation', 'local Host rejection'] as const)(
    'keeps an unconfirmed Stop active and allows an explicit retry (%s)', async failure => {
      const host = failure === 'local Host rejection'
      if (host) mocks.localSnapshot = { host_id: 'local-host', gpus: [], models: [{ id: 'host-model', path: '/models/local.ginfer' }],
        instances: [{ instance_id: 'inst', status: 'ready', profile: { model_id: 'host-model' } }], model_management: { version: 1, downloads: [] } }
      const activeId = host ? 'ginfer/local-host/inst' : 'local-model'
      useAppState.setState({ activeModels: [activeId] })
      const failureDetail = failure === 'desktop missing confirmation' ? 'The engine did not confirm that this model stopped.' : 'Stop was not confirmed by the engine'
      if (host) mocks.controlHost.mockRejectedValueOnce(new Error(failureDetail))
      else if (failure === 'desktop rejection') mocks.stopModel.mockRejectedValueOnce(new Error(failureDetail))
      else mocks.stopModel.mockResolvedValueOnce(failure === 'desktop missing confirmation' ? undefined : { success: false, error: failureDetail })
      mocks.getActiveModels.mockResolvedValue([])
      mocks.command.mockImplementation(async action => action === 'snapshot' ? mocks.localSnapshot : [])
      render(<ModelManagement />)
      await waitFor(() => expect(mocks.command).toHaveBeenCalledWith('local_model_downloads'))
      const downloadReads = mocks.command.mock.calls.length
      const stopButton = screen.getByRole('button', { name: 'Stop model' })
      fireEvent.click(stopButton)
      expect(await screen.findByRole('alert')).toHaveTextContent('Could not stop this model. Check that the computer is connected, then try Stop model again.')
      expect(screen.getByText(failureDetail)).not.toBeVisible()
      expect(screen.getByText('Technical details').closest('details')).not.toHaveAttribute('open')
      expect(screen.queryByRole('button', { name: 'Refresh model status' })).not.toBeInTheDocument()
      expect(useAppState.getState().activeModels).toEqual([activeId])
      expect(screen.getByText(/^Running · /)).toBeVisible()
      expect(stopButton).toBeEnabled()
      expect(screen.getByRole('button', { name: 'Load model' })).toBeDisabled()
      expect(mocks.getActiveModels).not.toHaveBeenCalled()
      fireEvent.click(stopButton)
      await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument())
      expect(host ? mocks.controlHost : mocks.stopModel).toHaveBeenCalledTimes(2)
      expect(mocks.getActiveModels).toHaveBeenCalledOnce()
      expect(useAppState.getState().activeModels).toEqual([])
      expect(screen.getByText(/^Installed · /)).toBeVisible()
      expect(screen.getByRole('button', { name: 'Load model' })).toBeEnabled()
      expect(stopButton).toBeDisabled()
      expect(mocks.command.mock.calls.filter(([action]) => action !== 'snapshot')).toHaveLength(downloadReads)
      expect(mocks.switchModel).not.toHaveBeenCalled()
      expect(mocks.getProviders).not.toHaveBeenCalled()
    },
  )
  it('disables mutations against an offline host even with saved inventory', async () => {
    const user = userEvent.setup()
    mocks.errors = { remote: 'Connection lost' }
    render(<ModelManagement />)
    await user.click(screen.getByRole('button', { name: 'Model destination' }))
    await user.click(screen.getByRole('menuitemradio', { name: 'Lab server (offline)' }))
    fireEvent.click(screen.getByRole('tab', { name: 'Recommended' }))
    expect(screen.getByRole('button', { name: 'Download to Lab server' })).toBeDisabled()
    expect(screen.getByRole('alert')).toHaveTextContent('Cannot reach Lab server. Check that it is on and GInfer Host is running, then reconnect in GInfer Hosts.')
    expect(screen.getByText('Connection lost')).not.toBeVisible()
  })
  it('loads an installed model with profile defaults and automatic GPU selection', async () => {
    spyConfirm().mockReturnValueOnce(true)
    render(<ModelManagement />)
    fireEvent.click(screen.getByRole('button', { name: 'Load model' }))
    await waitFor(() => expect(mocks.switchModel).toHaveBeenCalledWith({
      modelId: 'local-model', providerName: 'ginfer', serviceHub: expect.anything(),
      options: { useProfileDefaults: true, loadOperationId: expect.any(String), device: 'auto' },
      signal: expect.any(AbortSignal),
    }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Load model' })).toBeEnabled())
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    vi.restoreAllMocks()
  })
  it.each([null, false])('waits for local runtime preparation before loading an installed model (ready: %s)', async ready => {
    mocks.resources = { ready, error: '' }
    spyConfirm().mockReturnValueOnce(true)
    const view = render(<ModelManagement />)
    const loadButton = screen.getByRole('button', { name: 'Load model' })
    expect(loadButton).toBeDisabled()
    expect(screen.getByText('Preparing GInfer to run models on this computer…')).toHaveAttribute('role', 'status')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    fireEvent.click(loadButton)
    expect(mocks.switchModel).not.toHaveBeenCalled()

    mocks.resources = { ready: true, error: '' }
    view.rerender(<ModelManagement />)
    expect(screen.queryByText('Preparing GInfer to run models on this computer…')).not.toBeInTheDocument()
    expect(loadButton).toBeEnabled()
    fireEvent.click(loadButton)
    await waitFor(() => expect(mocks.switchModel).toHaveBeenCalledWith({
      modelId: 'local-model', providerName: 'ginfer', serviceHub: expect.anything(),
      options: { useProfileDefaults: true, loadOperationId: expect.any(String), device: 'auto' },
      signal: expect.any(AbortSignal),
    }))
    expect(mocks.switchModel).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(loadButton).toBeEnabled())
  })
  it.each([null, true])('keeps Load disabled after a local runtime error until readiness recovers (ready: %s)', async ready => {
    mocks.resources = { ready, error: 'Runtime extraction failed' }
    spyConfirm().mockReturnValueOnce(true)
    const view = render(<ModelManagement />)
    const loadButton = screen.getByRole('button', { name: 'Load model' })
    expect(loadButton).toBeDisabled()
    expect(screen.getByRole('alert')).toHaveTextContent('Could not prepare GInfer to run models on this computer. Restart GChat to try again.')
    expect(screen.queryByText('Preparing GInfer to run models on this computer…')).not.toBeInTheDocument()
    fireEvent.click(loadButton)
    expect(mocks.switchModel).not.toHaveBeenCalled()

    mocks.resources = { ready: true, error: '' }
    view.rerender(<ModelManagement />)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(loadButton).toBeEnabled()
    fireEvent.click(loadButton)
    await waitFor(() => expect(mocks.switchModel).toHaveBeenCalledTimes(1))
    expect(mocks.switchModel).toHaveBeenCalledWith(expect.objectContaining({
      modelId: 'local-model', providerName: 'ginfer',
      options: { useProfileDefaults: true, loadOperationId: expect.any(String), device: 'auto' },
      signal: expect.any(AbortSignal),
    }))
    await waitFor(() => expect(loadButton).toBeEnabled())
  })
  it('shows an unavailable selected GPU error and restores Load after forwarding the choice', async () => {
    mocks.selectedGpuUuids = ['local-gpu']
    mocks.switchModel.mockRejectedValueOnce(new Error('Selected GPU is unavailable'))
    spyConfirm().mockReturnValueOnce(true)
    render(<ModelManagement />)
    const loadButton = screen.getByRole('button', { name: 'Load model' })
    fireEvent.click(loadButton)
    expect(loadButton).toBeDisabled()
    expect(await screen.findByRole('alert')).toHaveTextContent('Selected GPU is unavailable')
    await waitFor(() => expect(loadButton).toBeEnabled())
    expect(mocks.switchModel).toHaveBeenCalledWith(expect.objectContaining({
      modelId: 'local-model', providerName: 'ginfer', gpuUuids: ['local-gpu'],
      options: { useProfileDefaults: true, loadOperationId: expect.any(String), device: 'auto' },
      signal: expect.any(AbortSignal),
    }))
    vi.restoreAllMocks()
  })
  it.each([{ selection: [] }, { selection: ['missing-gpu'] }])('disables Load for unavailable explicit selection $selection', ({ selection }) => {
    mocks.selectedGpuUuids = selection
    render(<ModelManagement />)
    expect(screen.getByRole('button', { name: 'Load model' })).toBeDisabled()
    expect(mocks.switchModel).not.toHaveBeenCalled()
  })
  it('does not switch away from another local model without confirmation', async () => {
    const confirmSpy = spyConfirm()
    confirmSpy.mockReturnValueOnce(false)
    render(<ModelManagement />)
    fireEvent.click(screen.getByRole('button', { name: 'Load model' }))
    await waitFor(() => expect(confirmSpy).toHaveBeenCalled())
    expect(mocks.switchModel).not.toHaveBeenCalled()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Load model' })).toBeEnabled())
    vi.restoreAllMocks()
  })

  it('shows scoped verification, profiling and elapsed progress while a long Load stays pending', async () => {
    vi.useFakeTimers()
    const clock = vi.spyOn(performance, 'now').mockReturnValue(1000)
    spyConfirm().mockReturnValue(true)
    let finish!: () => void
    mocks.switchModel.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve }))
    let phase: LocalModelLoadProgress['phase'] = 'verification'
    mocks.command.mockImplementation(async (action, args) => action === 'local_model_load_status'
      ? { operation_id: args!.operation_id, status: 'running', phase,
        detail: phase === 'verification' ? 'Reading verified package bytes' : 'Selected-model CPU experts',
        ...(phase === 'verification' ? { completed_bytes: 1024, total_bytes: 4096 } : {}) } : [])
    render(<ModelManagement />)
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Load model' })) })
    expect(screen.getByRole('status')).toHaveTextContent('Checking the model file')
    expect(screen.getByRole('progressbar', { name: 'Model file check' })).toHaveAttribute('value', '1024')
    expect(screen.getByRole('checkbox', { name: 'Automatic (all available graphics cards)' })).toBeDisabled()
    phase = 'profiling'
    clock.mockReturnValue(602000)
    await act(async () => { await vi.advanceTimersByTimeAsync(1000) })
    expect(screen.getByRole('status')).toHaveTextContent('Finding settings for your graphics cards')
    expect(screen.getByText('Selected-model CPU experts')).not.toBeVisible()
    fireEvent.click(screen.getByText('Startup details'))
    expect(screen.getByText('Selected-model CPU experts')).toBeVisible()
    expect(screen.getByText('Time since you chose Load model: 601 seconds')).toBeVisible()
    expect(screen.getByRole('status')).not.toHaveTextContent('Time since')
    expect(screen.getByRole('status')).not.toHaveTextContent('Selected-model CPU experts')
    expect(screen.getByRole('status')).not.toHaveTextContent(/remaining|expected/i)
    expect(screen.getByRole('button', { name: 'Load model' })).toBeDisabled()
    await act(async () => { finish() })
    expect(screen.getByRole('status', { name: 'Model load status' })).toHaveTextContent('Model loaded and ready to use.')
    expect(screen.getByRole('status')).toHaveAttribute('aria-live', 'polite')
    expect(screen.getByRole('status')).toHaveAttribute('aria-atomic', 'true')
    expect(screen.queryByText(/Time since you chose Load model/)).not.toBeInTheDocument()
    expect(mocks.switchModel).toHaveBeenCalledTimes(1)
  })

  it('ignores another operation status and keeps the load alive through a polling error', async () => {
    vi.useFakeTimers()
    spyConfirm().mockReturnValue(true)
    let finish!: () => void
    let polls = 0
    mocks.switchModel.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve }))
    mocks.command.mockImplementation(async (action, args) => {
      if (action !== 'local_model_load_status') return []
      if (++polls === 1) throw new Error('Private server response')
      return { operation_id: polls === 2 ? 'another-operation' : args!.operation_id,
        status: 'running', phase: 'starting', detail: 'Waiting for model readiness' }
    })
    render(<ModelManagement />)
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Load model' })) })
    expect(screen.getByRole('status')).toHaveTextContent('Cannot check progress right now')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByRole('status')).not.toHaveTextContent('Private server response')
    await act(async () => { await vi.advanceTimersByTimeAsync(1000) })
    expect(screen.getByRole('status')).not.toHaveTextContent('Waiting for model readiness')
    await act(async () => { await vi.advanceTimersByTimeAsync(1000) })
    expect(screen.getByRole('status')).toHaveTextContent('Loading the model into memory')
    expect(screen.getByRole('status')).not.toHaveTextContent('Cannot check progress right now')
    await act(async () => { finish() })
    const finishedPolls = polls
    await act(async () => { await vi.advanceTimersByTimeAsync(10000) })
    expect(polls).toBe(finishedPolls)
    expect(mocks.switchModel).toHaveBeenCalledTimes(1)
  })

  it('cancels only its own load and waits for native cleanup before restoring Load', async () => {
    spyConfirm().mockReturnValue(true)
    let reject!: (reason: unknown) => void
    mocks.switchModel.mockImplementationOnce(() => new Promise<void>((_, fail) => { reject = fail }))
    render(<ModelManagement />)
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Load model' })) })
    const request = mocks.switchModel.mock.calls[0][0]
    fireEvent.click(screen.getByRole('button', { name: 'Cancel load' }))
    expect(request.signal!.aborted).toBe(true)
    expect(mocks.command).toHaveBeenCalledWith('local_model_load_cancel', { operation_id: request.options!.loadOperationId })
    expect(screen.getByRole('status')).toHaveTextContent('Cancelling model startup…')
    expect(screen.getByRole('button', { name: 'Load model' })).toBeDisabled()
    await act(async () => { reject(new DOMException('Cancelled', 'AbortError')) })
    expect(screen.getByRole('button', { name: 'Load model' })).toBeEnabled()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByRole('status', { name: 'Model load status' })).toHaveTextContent('Model startup cancelled.')
    expect(mocks.command.mock.calls.filter(([action]) => action === 'local_model_load_cancel')).toHaveLength(1)
  })

  it('cancels a pending operation when the Models route unmounts', async () => {
    spyConfirm().mockReturnValue(true)
    let reject!: (reason: unknown) => void
    mocks.switchModel.mockImplementationOnce(() => new Promise<void>((_, fail) => { reject = fail }))
    const view = render(<ModelManagement />)
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Load model' })) })
    const request = mocks.switchModel.mock.calls[0][0]
    view.unmount()
    expect(request.signal!.aborted).toBe(true)
    expect(mocks.command).toHaveBeenCalledWith('local_model_load_cancel', { operation_id: request.options!.loadOperationId })
    await act(async () => { reject(new DOMException('Cancelled', 'AbortError')) })
  })

  it('does not cancel a Ready operation when the route unmounts', async () => {
    spyConfirm().mockReturnValue(true)
    let finish!: () => void
    mocks.switchModel.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve }))
    mocks.command.mockImplementation(async (action, args) => action === 'local_model_load_status'
      ? { operation_id: args!.operation_id, status: 'ready', phase: 'starting' } : [])
    const view = render(<ModelManagement />)
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Load model' })) })
    expect(screen.getByRole('button', { name: 'Cancel load' })).toBeDisabled()
    view.unmount()
    expect(mocks.command.mock.calls.some(([action]) => action === 'local_model_load_cancel')).toBe(false)
    expect(mocks.switchModel.mock.calls[0][0].signal!.aborted).toBe(false)
    await act(async () => { finish() })
  })

  it('refreshes downloads without searching for installed files', async () => {
    render(<ModelManagement />)
    await waitFor(() => expect(mocks.command).toHaveBeenCalledWith('local_model_downloads'))
    fireEvent.click(screen.getByRole('tab', { name: 'Downloads' }))
    mocks.command.mockClear()
    fireEvent.click(screen.getByRole('button', { name: 'Refresh downloads' }))
    await waitFor(() => expect(mocks.command).toHaveBeenCalledWith('local_model_downloads'))
    expect(mocks.command.mock.calls.some(([action]) => action === 'local_model_adopt')).toBe(false)
  })
  it('explains a recommendation refresh failure and keeps diagnostics optional', async () => {
    mocks.catalogError = 'HTTP 503 from catalog host'
    render(<ModelManagement />)
    fireEvent.click(screen.getByRole('tab', { name: 'Recommended' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Could not get the latest model recommendations.')
    expect(screen.getByText('HTTP 503 from catalog host')).not.toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Refresh recommendations' }))
    await waitFor(() => expect(mocks.refreshCatalog).toHaveBeenCalledOnce())
  })
  it.each([
    ['queued', 'Waiting to download', 'Pause download'],
    ['downloading', 'Downloading model', 'Pause download'],
    ['pausing', 'Saving progress before pausing', null],
    ['paused', 'Paused; resume to continue', 'Resume download'],
    ['verifying', 'Checking the downloaded file', null],
    ['installed', 'Download complete', 'Show in Installed'],
    ['failed', 'Download stopped', 'Retry download'],
  ])('explains a %s download and offers the supported next action', async (status, label, action) => {
    mocks.command.mockImplementation(async command => command === 'local_model_downloads'
      ? [{ id: 'job', release, status, received: 1024, bytes_per_second: 0, error: status === 'failed' ? 'connection reset by peer' : null, path: null }] : [])
    render(<ModelManagement />)
    fireEvent.click(screen.getByRole('tab', { name: 'Downloads' }))
    expect(await screen.findByText(label!)).toBeVisible()
    if (action) expect(screen.getByRole('button', { name: action })).toBeEnabled()
    else expect(screen.queryByRole('button', { name: /Pause download|Resume download|Retry download|Show in Installed/ })).not.toBeInTheDocument()
    if (status === 'failed') {
      expect(screen.getByRole('alert')).toHaveTextContent('Check your internet connection, then choose Retry download.')
      expect(screen.getByText('connection reset by peer')).not.toBeVisible()
    }
  })

})

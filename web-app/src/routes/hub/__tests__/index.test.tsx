import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { spyConfirm } from '@/test/confirm'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useState } from 'react'
import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from '@tanstack/react-router'
import { ModelManagement as ModelManagementView, type ModelManagementTab } from '@/containers/ModelManagement'
import { Route } from '../index'
import { useLocalModelDownloads } from '@/stores/local-model-downloads-store'
import type { ModelRelease } from '@/lib/model-release'
import type { LocalModelLoadProgress } from '@/services/engines'
import type { DialogOpenOptions } from '@/services/dialog/types'
type TestProvider = { provider: string; settings?: ProviderSetting[]; models: { id: string; displayName: string; path: string; source?: string }[] }
const mocks = vi.hoisted(() => ({
  refreshCatalog: vi.fn(async () => {}),
  command: vi.fn<(action: string, args?: Record<string, unknown>) => Promise<unknown>>(async () => []), refresh: vi.fn(async () => {}),
  switchModel: vi.fn<(params: { options?: { loadOperationId?: string }; signal?: AbortSignal }) => Promise<void>>(async () => {}),
  selectedGpuUuids: null as string[] | null, setSelectedGpuUuids: vi.fn(),
  providers: [] as TestProvider[],
  getProviders: vi.fn<() => Promise<TestProvider[]>>(), setProviders: vi.fn<(providers: TestProvider[]) => void>(),
  open: vi.fn<(options?: DialogOpenOptions) => Promise<string | string[] | null>>(),
  joinPath: vi.fn<(parts: string[]) => Promise<string>>(),
  catalog: [] as unknown[], catalogError: null as string | null, errors: {} as Record<string, string>,
  resources: { ready: true as boolean | null, error: '' },
  localSnapshot: null as null | Record<string, unknown>,
  controlHost: vi.fn(async () => {}),
}))
vi.mock('@gchat/core', async importOriginal => ({
  ...await importOriginal<typeof import('@gchat/core')>(), joinPath: mocks.joinPath,
}))
vi.mock('@/utils/localHostModel', () => ({ controlLocalHostModel: mocks.controlHost }))
vi.mock('@/containers/HeaderPage', () => ({ default: ({ children }: { children: React.ReactNode }) => <header>{children}</header> }))
vi.mock('@/containers/EngineHostModels', () => ({ HostCard: ({ host }: { host: { name: string } }) => <section>Installed on {host.name}</section> }))
vi.mock('@/containers/hub/DeleteModelAction', () => ({ DeleteModelAction: () => null }))
vi.mock('@tanstack/react-router', async importOriginal => ({
  ...await importOriginal<typeof import('@tanstack/react-router')>(),
  Link: ({ to, children }: { to: string; children: React.ReactNode }) => <a href={to}>{children}</a>,
}))
vi.mock('@/utils/switchModel', () => ({ switchToModel: mocks.switchModel }))
vi.mock('@/services/engines', () => ({ engineCommand: mocks.command, engineAlias: (host: string, instance: string) => `ginfer/${host}/${instance}` }))
vi.mock('@/hooks/useServiceHub', () => ({ isServiceHubInitialized: () => false, useServiceHub: () => ({
  models: () => ({ getActiveModels: async () => ['another-model'] }),
  providers: () => ({ getProviders: mocks.getProviders }),
  dialog: () => ({ open: mocks.open }),
}) }))
vi.mock('@/hooks/useBundledResources', () => ({ useBundledResources: (enabled = true) => enabled ? mocks.resources : { ready: true, error: '' } }))
vi.mock('@/hooks/useModelProvider', () => {
  const state = { get providers() { return mocks.providers }, selectModelProvider: vi.fn(), setProviders: mocks.setProviders }
  const hook = (selector: (s: typeof state) => unknown) => selector(state)
  hook.getState = () => state
  return { useModelProvider: hook }
})
vi.mock('@/hooks/useHardware', () => ({ useHardware: (selector: (s: unknown) => unknown) => selector({
  selectedGpuUuids: mocks.selectedGpuUuids, setSelectedGpuUuids: mocks.setSelectedGpuUuids,
  hardwareReady: true, hardwareData: { gpus: [{ uuid: 'local-gpu', name: 'Local GPU', total_memory: 16384, nvidia_info: { compute_capability: '8.6' } }] },
}) }))
vi.mock('@/stores/model-catalog-store', () => ({ useModelCatalogStore: (selector: (s: unknown) => unknown) => selector({ catalog: mocks.catalog, error: mocks.catalogError, refresh: mocks.refreshCatalog }) }))
vi.mock('@/stores/engine-hosts-store', () => ({ useEngineHosts: (selector: (s: unknown) => unknown) => selector({
  hosts: [{ host_id: 'remote', name: 'Lab server' }, ...(mocks.localSnapshot ? [{ host_id: 'local-host', name: 'This computer', local: true }] : [])], errors: mocks.errors, refresh: mocks.refresh,
  snapshots: { ...(mocks.localSnapshot ? { 'local-host': mocks.localSnapshot } : {}), remote: { host_id: 'remote', gpus: [{ uuid: 'remote-gpu', name: 'Remote GPU', memory_mib: 32768, compute_capability: '12.0' }], models: [], instances: [], model_management: { version: 1, downloads: [] } } },
}) }))
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

describe('host-scoped Models', () => {
  beforeEach(() => {
    vi.clearAllMocks(); mocks.errors = {}; mocks.selectedGpuUuids = null
    useLocalModelDownloads.setState({ jobs: [], loaded: false, error: null })
    mocks.resources = { ready: true, error: '' }
    mocks.command.mockResolvedValue([])
    mocks.switchModel.mockResolvedValue(undefined)
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
    const registered = [{ provider: 'ginfer', models: [{ id: 'host-model-id', displayName: 'My local model', path, source: 'external' }] }]
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
    expect(mocks.setProviders).toHaveBeenCalledExactlyOnceWith(registered)
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
    mocks.open.mockResolvedValue(null)
    fireEvent.click(screen.getByRole('button', { name: 'Add local model' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Add local model' })).toBeEnabled())
    expect(mocks.open).toHaveBeenCalledTimes(2)
    expect(screen.getByRole('alert')).toHaveTextContent('This file is not a valid .ginfer model.')
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
    await act(async () => { register({}) })
    expect(mocks.getProviders).toHaveBeenCalledOnce()
    expect(screen.getByRole('button', { name: 'Adding local model…' })).toBeDisabled()
    await act(async () => { inventory(mocks.providers) })
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
  it('describes downloads and recommendations in plain words', async () => {
    mocks.command.mockImplementation(async action => action === 'local_model_downloads'
      ? [{ id: 'job', release, status: 'paused', received: 1024, bytes_per_second: 0, error: null, path: null }] : [])
    render(<ModelManagement />)
    expect(screen.getByText(/Load model uses tested settings for your selected graphics cards/)).toBeInTheDocument()
    expect(screen.getByText(/Choose the graphics cards to load the model onto/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: 'Downloads' }))
    expect(await screen.findByText('Paused; resume to continue')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Resume download' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Delete partial download' })).toBeInTheDocument()
    expect(screen.getByText(/Only one model downloads at a time/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: 'Recommended' }))
    expect(screen.getByText(/only recommended once it has been tested on your graphics card/)).toBeInTheDocument()
    expect(document.body).not.toHaveTextContent(/CUDA_VISIBLE_DEVICES|\bTP\b|VRAM|Smol/)
  })
  it('explains a failed download and offers a retry that matches it', async () => {
    mocks.command.mockImplementation(async action => action === 'local_model_downloads'
      ? [{ id: 'job', release, status: 'failed', received: 4096, bytes_per_second: 0, error: 'SHA256 mismatch', path: null }] : [])
    render(<ModelManagement />)
    fireEvent.click(screen.getByRole('tab', { name: 'Downloads' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('The downloaded file is damaged or incomplete. Remove this incomplete download, then download the model again.')
    expect(screen.getByRole('button', { name: 'Retry download' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Resume download' })).not.toBeInTheDocument()
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
    mocks.switchModel.mockResolvedValue(undefined)
  })
  it('explains a model with no saved startup settings by name and links to GInfer Hosts', async () => {
    spyConfirm().mockReturnValueOnce(true)
    mocks.switchModel.mockRejectedValue(Object.assign(new Error('Failed to load 483343c2deadbeef: No qualified automatic profile is available for this model.'), { code: 'no_qualified_profile' }))
    render(<ModelManagement />)
    fireEvent.click(screen.getByRole('button', { name: 'Load model' }))
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Installed locally has no saved startup settings yet.')
    expect(alert).not.toHaveTextContent('483343c2')
    expect(screen.getByRole('link', { name: 'Open GInfer Hosts' })).toHaveAttribute('href', '/engines/')
    mocks.switchModel.mockResolvedValue(undefined)
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
    } finally { mocks.localSnapshot = null }
  })
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
      options: { useProfileDefaults: true, loadOperationId: expect.any(String) },
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
    expect(screen.getByRole('status')).toHaveTextContent('Preparing GInfer to run models on this computer…')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    fireEvent.click(loadButton)
    expect(mocks.switchModel).not.toHaveBeenCalled()

    mocks.resources = { ready: true, error: '' }
    view.rerender(<ModelManagement />)
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(loadButton).toBeEnabled()
    fireEvent.click(loadButton)
    await waitFor(() => expect(mocks.switchModel).toHaveBeenCalledWith({
      modelId: 'local-model', providerName: 'ginfer', serviceHub: expect.anything(),
      options: { useProfileDefaults: true, loadOperationId: expect.any(String) },
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
      options: { useProfileDefaults: true, loadOperationId: expect.any(String) },
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
      options: { useProfileDefaults: true, loadOperationId: expect.any(String) },
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
    expect(screen.getByRole('status')).toHaveTextContent('Time since you chose Load model: 601 seconds')
    expect(screen.getByRole('status')).not.toHaveTextContent(/remaining|expected/i)
    expect(screen.getByRole('button', { name: 'Load model' })).toBeDisabled()
    await act(async () => { finish() })
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
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
      expect(screen.getByRole('alert')).toHaveTextContent('Check your internet connection, then resume the download.')
      expect(screen.getByText('connection reset by peer')).not.toBeVisible()
    }
  })

})

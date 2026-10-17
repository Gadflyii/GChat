import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ModelManagement } from '@/containers/ModelManagement'
import type { ModelRelease } from '@/lib/model-release'
const mocks = vi.hoisted(() => ({
  command: vi.fn(async () => []), refresh: vi.fn(async () => {}),
  switchModel: vi.fn(async () => {}),
  selectedGpuUuids: null as string[] | null, setSelectedGpuUuids: vi.fn(),
  providers: [{ provider: 'ginfer', models: [{ id: 'local-model', displayName: 'Installed locally' }] }],
  catalog: [] as unknown[], errors: {} as Record<string, string>,
}))
vi.mock('@/containers/HeaderPage', () => ({ default: ({ children }: { children: React.ReactNode }) => <header>{children}</header> }))
vi.mock('@/containers/EngineHostModels', () => ({ HostCard: ({ host }: { host: { name: string } }) => <section>Installed on {host.name}</section> }))
vi.mock('@/containers/hub/DeleteModelAction', () => ({ DeleteModelAction: () => null }))
vi.mock('@/utils/switchModel', () => ({ switchToModel: mocks.switchModel }))
vi.mock('@/services/engines', () => ({ engineCommand: mocks.command }))
vi.mock('@/hooks/useServiceHub', () => ({ useServiceHub: () => ({ models: () => ({ getActiveModels: async () => ['another-model'] }) }) }))
vi.mock('@/hooks/useModelProvider', () => {
  const state = { providers: mocks.providers, selectModelProvider: vi.fn() }
  const hook = (selector: (s: typeof state) => unknown) => selector(state)
  hook.getState = () => state
  return { useModelProvider: hook }
})
vi.mock('@/hooks/useHardware', () => ({ useHardware: (selector: (s: unknown) => unknown) => selector({
  selectedGpuUuids: mocks.selectedGpuUuids, setSelectedGpuUuids: mocks.setSelectedGpuUuids,
  hardwareReady: true, hardwareData: { gpus: [{ uuid: 'local-gpu', name: 'Local GPU', total_memory: 16384, nvidia_info: { compute_capability: '8.6' } }] },
}) }))
vi.mock('@/stores/model-catalog-store', () => ({ useModelCatalogStore: (selector: (s: unknown) => unknown) => selector({ catalog: mocks.catalog }) }))
vi.mock('@/stores/engine-hosts-store', () => ({ useEngineHosts: (selector: (s: unknown) => unknown) => selector({
  hosts: [{ host_id: 'remote', name: 'Lab server' }], errors: mocks.errors, refresh: mocks.refresh,
  snapshots: { remote: { host_id: 'remote', gpus: [{ uuid: 'remote-gpu', name: 'Remote GPU', memory_mib: 32768, compute_capability: '12.0' }], models: [], instances: [], model_management: { version: 1, downloads: [] } } },
}) }))
const release: ModelRelease = { name: 'Blackwell model', identity: { model_id: 'muse', weights_id: 'nvfp4' },
  url: `https://huggingface.co/test/model/resolve/${'a'.repeat(40)}/model.ginfer`, sha256: 'b'.repeat(64), bytes: 4096,
  tp: 1, qualified_sm: ['12.0'], min_vram_mib_per_gpu: 32768, capabilities: ['tools'] }
describe('host-scoped Models', () => {
  beforeEach(() => {
    vi.clearAllMocks(); mocks.errors = {}; mocks.selectedGpuUuids = null
    mocks.command.mockResolvedValue([])
    mocks.catalog = [{ library_name: 'ginfer', model_name: 'test/model', releases: [release] }]
  })
  it('uses local inventory and never offers the remote GPU package locally', async () => {
    render(<ModelManagement />)
    expect(screen.getByText('Installed locally')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: 'Recommended' }))
    expect(screen.getByText('No published recommendation for this hardware yet')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Download to/ })).not.toBeInTheDocument()
    await waitFor(() => expect(mocks.command).toHaveBeenCalledWith('local_model_downloads'))
  })
  it('downloads to the selected host without invoking a local transfer', async () => {
    const user = userEvent.setup()
    render(<ModelManagement />)
    await user.click(screen.getByRole('button', { name: 'Model destination' }))
    await user.click(screen.getByRole('menuitemradio', { name: 'Lab server' }))
    expect(screen.getByText('Installed on Lab server')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: 'Recommended' }))
    fireEvent.click(screen.getByRole('button', { name: 'Download to Lab server' }))
    await waitFor(() => expect(mocks.command).toHaveBeenCalledWith('download', { host_id: 'remote', body: release }))
    expect(mocks.command.mock.calls.some(call => call[0] === 'local_model_download')).toBe(false)
    expect(screen.getByRole('tab', { name: 'Downloads' })).toHaveAttribute('aria-selected', 'true')
  })
  it('disables mutations against an offline host even with saved inventory', async () => {
    const user = userEvent.setup()
    mocks.errors = { remote: 'Connection lost' }
    render(<ModelManagement />)
    await user.click(screen.getByRole('button', { name: 'Model destination' }))
    await user.click(screen.getByRole('menuitemradio', { name: 'Lab server (offline)' }))
    fireEvent.click(screen.getByRole('tab', { name: 'Recommended' }))
    expect(screen.getByRole('button', { name: 'Download to Lab server' })).toBeDisabled()
    expect(screen.getByRole('alert')).toHaveTextContent('Connection lost')
  })
  it('loads an installed model with profile defaults and automatic GPU selection', async () => {
    vi.spyOn(window, 'confirm').mockReturnValueOnce(true)
    render(<ModelManagement />)
    fireEvent.click(screen.getByRole('button', { name: 'Load model' }))
    await waitFor(() => expect(mocks.switchModel).toHaveBeenCalledWith({
      modelId: 'local-model', providerName: 'ginfer', serviceHub: expect.anything(),
      options: { useProfileDefaults: true },
    }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Load model' })).toBeEnabled())
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    vi.restoreAllMocks()
  })
  it('shows an unavailable selected GPU error and restores Load after forwarding the choice', async () => {
    mocks.selectedGpuUuids = ['local-gpu']
    mocks.switchModel.mockRejectedValueOnce(new Error('Selected GPU is unavailable'))
    vi.spyOn(window, 'confirm').mockReturnValueOnce(true)
    render(<ModelManagement />)
    const loadButton = screen.getByRole('button', { name: 'Load model' })
    fireEvent.click(loadButton)
    expect(loadButton).toBeDisabled()
    expect(await screen.findByRole('alert')).toHaveTextContent('Selected GPU is unavailable')
    await waitFor(() => expect(loadButton).toBeEnabled())
    expect(mocks.switchModel).toHaveBeenCalledWith(expect.objectContaining({
      modelId: 'local-model', providerName: 'ginfer', gpuUuids: ['local-gpu'],
      options: { useProfileDefaults: true },
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
    vi.spyOn(window, 'confirm').mockReturnValueOnce(false)
    render(<ModelManagement />)
    fireEvent.click(screen.getByRole('button', { name: 'Load model' }))
    await waitFor(() => expect(window.confirm).toHaveBeenCalled())
    expect(mocks.switchModel).not.toHaveBeenCalled()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Load model' })).toBeEnabled())
    vi.restoreAllMocks()
  })
})

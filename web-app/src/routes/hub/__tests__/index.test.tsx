import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ModelManagement } from '@/containers/ModelManagement'
import type { ModelRelease } from '@/lib/model-release'
import type { LocalModelLoadProgress } from '@/services/engines'
const mocks = vi.hoisted(() => ({
  command: vi.fn<(action: string, args?: Record<string, unknown>) => Promise<unknown>>(async () => []), refresh: vi.fn(async () => {}),
  switchModel: vi.fn<(params: { options?: { loadOperationId?: string }; signal?: AbortSignal }) => Promise<void>>(async () => {}),
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
    mocks.switchModel.mockResolvedValue(undefined)
    mocks.catalog = [{ library_name: 'ginfer', model_name: 'test/model', releases: [release] }]
  })
  afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers() })
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
      options: { useProfileDefaults: true, loadOperationId: expect.any(String) },
      signal: expect.any(AbortSignal),
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
    vi.spyOn(window, 'confirm').mockReturnValueOnce(false)
    render(<ModelManagement />)
    fireEvent.click(screen.getByRole('button', { name: 'Load model' }))
    await waitFor(() => expect(window.confirm).toHaveBeenCalled())
    expect(mocks.switchModel).not.toHaveBeenCalled()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Load model' })).toBeEnabled())
    vi.restoreAllMocks()
  })

  it('shows scoped verification, profiling and elapsed progress while a long Load stays pending', async () => {
    vi.useFakeTimers()
    const clock = vi.spyOn(performance, 'now').mockReturnValue(1000)
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    let finish!: () => void
    mocks.switchModel.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve }))
    let phase: LocalModelLoadProgress['phase'] = 'verification'
    mocks.command.mockImplementation(async (action, args) => action === 'local_model_load_status'
      ? { operation_id: args!.operation_id, status: 'running', phase,
        detail: phase === 'verification' ? 'Reading verified package bytes' : 'Selected-model CPU experts',
        ...(phase === 'verification' ? { completed_bytes: 1024, total_bytes: 4096 } : {}) } : [])
    render(<ModelManagement />)
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Load model' })) })
    expect(screen.getByRole('status')).toHaveTextContent('Verifying installed model')
    expect(screen.getByRole('progressbar', { name: 'Installed model verification' })).toHaveAttribute('value', '1024')
    expect(screen.getByRole('checkbox', { name: 'Automatic (visible GPUs only)' })).toBeDisabled()
    phase = 'profiling'
    clock.mockReturnValue(602000)
    await act(async () => { await vi.advanceTimersByTimeAsync(1000) })
    expect(screen.getByRole('status')).toHaveTextContent('Profiling installed model')
    expect(screen.getByRole('status')).toHaveTextContent('Selected-model CPU experts')
    expect(screen.getByRole('status')).toHaveTextContent('Load request elapsed: 601s')
    expect(screen.getByRole('status')).not.toHaveTextContent(/remaining|expected/i)
    expect(screen.getByRole('button', { name: 'Load model' })).toBeDisabled()
    await act(async () => { finish() })
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(mocks.switchModel).toHaveBeenCalledTimes(1)
  })

  it('ignores another operation status and keeps the load alive through a polling error', async () => {
    vi.useFakeTimers()
    vi.spyOn(window, 'confirm').mockReturnValue(true)
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
    expect(screen.getByRole('status')).toHaveTextContent('Startup status is temporarily unavailable')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByRole('status')).not.toHaveTextContent('Private server response')
    await act(async () => { await vi.advanceTimersByTimeAsync(1000) })
    expect(screen.getByRole('status')).not.toHaveTextContent('Waiting for model readiness')
    await act(async () => { await vi.advanceTimersByTimeAsync(1000) })
    expect(screen.getByRole('status')).toHaveTextContent('Starting installed model')
    expect(screen.getByRole('status')).not.toHaveTextContent('temporarily unavailable')
    await act(async () => { finish() })
    const finishedPolls = polls
    await act(async () => { await vi.advanceTimersByTimeAsync(10000) })
    expect(polls).toBe(finishedPolls)
    expect(mocks.switchModel).toHaveBeenCalledTimes(1)
  })

  it('cancels only its own load and waits for native cleanup before restoring Load', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    let reject!: (reason: unknown) => void
    mocks.switchModel.mockImplementationOnce(() => new Promise<void>((_, fail) => { reject = fail }))
    render(<ModelManagement />)
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Load model' })) })
    const request = mocks.switchModel.mock.calls[0][0]
    fireEvent.click(screen.getByRole('button', { name: 'Cancel load' }))
    expect(request.signal!.aborted).toBe(true)
    expect(mocks.command).toHaveBeenCalledWith('local_model_load_cancel', { operation_id: request.options!.loadOperationId })
    expect(screen.getByRole('status')).toHaveTextContent('Cancelling installed model load')
    expect(screen.getByRole('button', { name: 'Load model' })).toBeDisabled()
    await act(async () => { reject(new DOMException('Cancelled', 'AbortError')) })
    expect(screen.getByRole('button', { name: 'Load model' })).toBeEnabled()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(mocks.command.mock.calls.filter(([action]) => action === 'local_model_load_cancel')).toHaveLength(1)
  })

  it('cancels a pending operation when the Models route unmounts', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
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
    vi.spyOn(window, 'confirm').mockReturnValue(true)
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

})

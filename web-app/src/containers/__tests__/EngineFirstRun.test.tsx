import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { EngineFirstRun } from '../EngineFirstRun'

const mocks = vi.hoisted(() => ({ command: vi.fn(), refresh: vi.fn(), state: {} as Record<string, unknown> }))
vi.mock('@/services/engines', () => ({ engineCommand: mocks.command }))
vi.mock('@/stores/engine-hosts-store', () => ({ useEngineHosts: (selector: (state: unknown) => unknown) => selector(mocks.state) }))
const release = { name: 'Muse', sha256: 'a'.repeat(64), bytes: 1024 ** 3 }
const profile = { download_id: 'download', model_id: 'muse', gpu_uuids: ['GPU-one'], concurrency: 4, max_context: 32768, kv_arena_bytes: null, instance_count: 1, quote: null, error: null }
const flow = (step: string, extra = {}) => ({ step, gpu_uuids: [], hardware_profile: { status: 'running' }, storage: { path: '/models', recommended_path: '/fast', available_bytes: 1024 ** 4 }, models: [], selected_downloads: [], startup_profiles: [], ...extra })
beforeEach(() => {
  mocks.command.mockReset()
  mocks.refresh.mockReset().mockResolvedValue(undefined)
  mocks.state = { hosts: [{ host_id: 'local', local: true }], snapshots: { local: { gpus: [{ uuid: 'GPU-one', name: 'RTX 5090', memory_mib: 32768, compute_capability: '12.0' }] } }, errors: {}, refresh: mocks.refresh }
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })

it('saves explicit GPU selection before choosing storage without starting profiling', async () => {
  mocks.command.mockImplementation((_operation, args) => Promise.resolve(args.action ? flow('storage', { gpu_uuids: ['GPU-one'], hardware_profile: { status: 'idle' } }) : flow('gpu')))
  render(<EngineFirstRun />)
  const start = await screen.findByRole('button', { name: 'Use selected GPUs' })
  expect(start).toBeDisabled()
  expect(mocks.command).toHaveBeenCalledExactlyOnceWith('first_run', { host_id: 'local' })
  fireEvent.click(screen.getByRole('checkbox'))
  await waitFor(() => expect(start).toBeEnabled())
  fireEvent.click(start)
  expect(await screen.findByLabelText('Model download folder')).toBeInTheDocument()
  expect(screen.queryByText('Hardware profiling: running')).not.toBeInTheDocument()
  expect(mocks.command).toHaveBeenLastCalledWith('first_run', { host_id: 'local', action: 'profile', gpu_uuids: ['GPU-one'] })
  expect(screen.getByText(/Selected-model profiling and Engine memory checks are still required/)).toBeInTheDocument()
})

it('uses chosen storage, retries the shared catalog and resumes saved downloads', async () => {
  let saved = flow('storage', { storage: { path: '/models', recommended_path: '/fast', available_bytes: null, error: 'Disk measurement unavailable', candidates: [{ path: '/full', available_bytes: 0, eligible: false, reason: 'Not enough free space' }] } })
  mocks.command.mockImplementation((_operation, args) => {
    if (args.action === 'storage') saved = flow('models', { catalog_loaded: false })
    if (args.action === 'refresh_catalog') saved = flow('models', { catalog_loaded: true, models: [{ release, recommended: true, reason: 'Published for this GPU group' }] })
    if (args.action === 'models') saved = flow('downloads', { selected_downloads: [{ id: 'download', release, status: 'failed', received: 1024, bytes_per_second: 0, error: 'Connection interrupted' }] })
    if (args.action === 'resume') saved = flow('downloads', { selected_downloads: [{ id: 'download', release, status: 'downloading', received: 2048, bytes_per_second: 1024 ** 2 }] })
    return Promise.resolve(saved)
  })
  render(<EngineFirstRun />)
  expect(await screen.findByText('Disk measurement unavailable')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '/full · 0.0 GiB free' })).toBeDisabled()
  await waitFor(() => expect(screen.getByLabelText('Model download folder')).toHaveValue('/fast'))
  fireEvent.change(screen.getByLabelText('Model download folder'), { target: { value: '/chosen' } })
  expect(screen.getByLabelText('Model download folder')).toHaveValue('/chosen')
  fireEvent.click(screen.getByRole('button', { name: 'Use this folder' }))
  expect(await screen.findByText('Loading published model catalog…')).toBeInTheDocument()
  expect(mocks.command).toHaveBeenLastCalledWith('first_run', { host_id: 'local', action: 'storage', path: '/chosen' })
  fireEvent.click(screen.getByRole('button', { name: 'Refresh model catalog' }))
  const download = await screen.findByRole('button', { name: 'Download selected models' })
  await waitFor(() => expect(download).toBeEnabled())
  fireEvent.click(download)
  expect(await screen.findByText('Connection interrupted')).toBeInTheDocument()
  expect(mocks.command).toHaveBeenLastCalledWith('first_run', { host_id: 'local', action: 'models', release_ids: [release.sha256] })
  fireEvent.click(screen.getByRole('button', { name: 'Resume downloads' }))
  await screen.findByText(/Muse · downloading/)
  expect(screen.getByText(/Selected-model profiling begins after the downloads are verified/)).toBeInTheDocument()
  expect(mocks.command).toHaveBeenLastCalledWith('first_run', { host_id: 'local', action: 'resume' })
})

it('observes verified downloads before selected profiling and retains its retry across reopening', async () => {
  const installed = { id: 'download', release, status: 'installed', received: release.bytes, bytes_per_second: 0 }
  let saved = flow('downloads', {
    gpu_uuids: ['GPU-one'], selected_downloads: [{ ...installed, status: 'verifying' }],
    hardware_profile: { status: 'idle' },
  })
  mocks.command.mockImplementation((_operation, args) => {
    if (args.action === 'resume') saved = flow('profiling', {
      ...saved, hardware_profile: {
        status: 'running', scope: 'artifact', scope_complete: false, all_formats_complete: false,
        elapsed_ms: 180_000, expected_duration_ms: 600_000, duration_source: 'measured_history',
      },
    })
    return Promise.resolve(saved)
  })
  const view = render(<EngineFirstRun />)
  expect(await screen.findByText(/Muse · verifying/)).toBeInTheDocument()
  expect(screen.queryByText(/Selected-model profiling:/)).not.toBeInTheDocument()
  saved = flow('profiling', {
    gpu_uuids: ['GPU-one'], selected_downloads: [installed],
    hardware_profile: { status: 'failed', scope: 'artifact', scope_complete: false, all_formats_complete: false, error: 'Selected profile interrupted' },
  })
  expect(await screen.findByText('Selected profile interrupted', {}, { timeout: 3000 })).toBeInTheDocument()
  expect(screen.getByText('Selected-model profiling: failed')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Resume hardware profiling' }))
  expect(await screen.findByText('Selected-model profiling: running')).toBeInTheDocument()
  expect(screen.getByText(/Broader model-format coverage is deferred/)).toBeInTheDocument()
  expect(screen.getByText(/Completion time is unknown for this GPU group/)).toBeInTheDocument()
  expect(screen.queryByText(/remaining, based on/)).not.toBeInTheDocument()
  expect(screen.queryByLabelText('Model download folder')).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Save folder choice' })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Save model choices' })).not.toBeInTheDocument()
  expect(screen.getByText(/Your verified model downloads and saved choices are retained/)).toBeInTheDocument()
  view.unmount()
  mocks.command.mockClear()
  render(<EngineFirstRun />)
  expect(await screen.findByText('Selected-model profiling: running')).toBeInTheDocument()
  expect(screen.queryByLabelText('Model download folder')).not.toBeInTheDocument()
  expect(mocks.command).toHaveBeenCalledExactlyOnceWith('first_run', { host_id: 'local' })
  expect(screen.queryByRole('button', { name: 'Finish local setup' })).not.toBeInTheDocument()
})

it('requires an Engine quote and saves approved startup overrides without launching', async () => {
  const onComplete = vi.fn()
  mocks.command.mockImplementation((_operation, args) => Promise.resolve(args.action === 'complete' ? flow('complete') : flow('startup', {
    hardware_profile: { status: 'completed', scope: 'artifact', scope_complete: true, base_complete: true, all_formats_complete: false },
    startup_profiles: [{ ...profile, ...(args.action === 'startup' ? { concurrency: 2, quote: { fits: true } } : {}) }],
  })))
  render(<EngineFirstRun onComplete={onComplete} />)
  const finish = await screen.findByRole('button', { name: 'Finish local setup' })
  expect(finish).toBeDisabled()
  expect(screen.getByText(/Selected-model profiling is complete/)).toBeInTheDocument()
  expect(screen.getByText(/Broader model-format coverage is deferred/)).toBeInTheDocument()
  expect(screen.getByText('Checking these settings with the Engine…')).toBeInTheDocument()
  fireEvent.change(screen.getByLabelText('muse concurrent requests'), { target: { value: '2' } })
  fireEvent.click(screen.getByRole('button', { name: 'Check startup settings' }))
  await waitFor(() => expect(finish).toBeEnabled())
  expect(mocks.command).toHaveBeenLastCalledWith('first_run', { host_id: 'local', action: 'startup', download_id: 'download', concurrency: 2, max_context: 32768, instance_count: 1, kv_arena_bytes: null })
  fireEvent.click(finish)
  await waitFor(() => expect(onComplete).toHaveBeenCalledOnce())
  expect(mocks.command).toHaveBeenLastCalledWith('first_run', { host_id: 'local', action: 'complete' })
  expect(screen.queryByRole('region', { name: 'Set up local GInfer' })).not.toBeInTheDocument()
})

it('preserves a typed storage override when the shared catalog finishes loading', async () => {
  mocks.command.mockImplementation((_operation, args) => Promise.resolve(flow('storage', {
    catalog_loaded: mocks.command.mock.calls.length > 1,
    storage: { path: '/models', recommended_path: mocks.command.mock.calls.length > 1 ? '/new-recommendation' : '/fast', available_bytes: 1024 ** 4 },
    ...(args.action ? { step: 'models' } : {}),
  })))
  render(<EngineFirstRun />)
  const folder = await screen.findByLabelText('Model download folder')
  fireEvent.change(folder, { target: { value: '/my-selected-disk' } })
  await screen.findByText('Recommended: /new-recommendation', {}, { timeout: 3000 })
  expect(folder).toHaveValue('/my-selected-disk')
  fireEvent.click(screen.getByRole('button', { name: 'Use this folder' }))
  await waitFor(() => expect(mocks.command).toHaveBeenLastCalledWith('first_run', {
    host_id: 'local', action: 'storage', path: '/my-selected-disk',
  }))
})

it('saves folder and model choices during profiling and restores them after reopening', async () => {
  let saved = flow('profiling', {
    gpu_uuids: ['GPU-one'], catalog_loaded: true,
    models: [{ release, recommended: false, reason: 'Capacity checks wait for profiling' }],
  })
  mocks.command.mockImplementation((_operation, args) => {
    if (args.action === 'storage') saved = flow('profiling', { ...saved, storage: { ...saved.storage, requested_path: args.path, accepted: false } })
    if (args.action === 'models') saved = flow('profiling', { ...saved, selected_release_ids: args.release_ids })
    return Promise.resolve(saved)
  })
  const view = render(<EngineFirstRun />)
  const folder = await screen.findByLabelText('Model download folder')
  expect(screen.getByRole('checkbox', { name: /Muse/ })).not.toBeChecked()
  fireEvent.change(folder, { target: { value: '/queued-models' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save folder choice' }))
  expect(await screen.findByText('Saved folder choice: /queued-models')).toBeInTheDocument()
  await waitFor(() => expect(screen.getByRole('button', { name: 'Save folder choice' })).toBeEnabled())
  fireEvent.click(screen.getByRole('checkbox', { name: /Muse/ }))
  fireEvent.click(screen.getByRole('button', { name: 'Save model choices' }))
  expect(await screen.findByText('Model choices saved. Downloads wait for hardware profiling and validated storage.')).toBeInTheDocument()
  expect(screen.getByText('Hardware profiling: running')).toBeInTheDocument()
  expect(screen.queryByText('Downloading models')).not.toBeInTheDocument()
  expect(mocks.command.mock.calls.map(([, args]) => args.action).filter(Boolean)).toEqual(['storage', 'models'])
  expect(mocks.command).toHaveBeenLastCalledWith('first_run', { host_id: 'local', action: 'models', release_ids: [release.sha256] })
  view.unmount()
  render(<EngineFirstRun />)
  await waitFor(() => expect(screen.getByLabelText('Model download folder')).toHaveValue('/queued-models'))
  await waitFor(() => expect(screen.getByRole('checkbox', { name: /Muse/ })).toBeChecked())
  expect(screen.getByText('Hardware profiling: running')).toBeInTheDocument()
  expect(screen.queryByText('Downloading models')).not.toBeInTheDocument()
})

it('keeps edited folder and package choices when a pending profile completes', async () => {
  let reads = 0
  mocks.command.mockImplementation(() => {
    const ready = ++reads > 1
    return Promise.resolve(flow(ready ? 'models' : 'profiling', {
      gpu_uuids: ['GPU-one'],
      storage: { path: '/accepted', recommended_path: ready ? '/new-recommendation' : '/fast', available_bytes: ready ? 1024 ** 4 : null },
      selected_release_ids: ready ? [release.sha256] : [],
      models: [{ release, recommended: true, reason: ready ? 'Fits measured memory' : 'Capacity checks wait for profiling' }],
    }))
  })
  render(<EngineFirstRun />)
  const folder = await screen.findByLabelText('Model download folder')
  const choice = screen.getByRole('checkbox', { name: /Muse/ })
  await waitFor(() => expect(choice).toBeChecked())
  fireEvent.change(folder, { target: { value: '/my-edited-folder' } })
  fireEvent.click(choice)
  expect(choice).not.toBeChecked()
  await screen.findByRole('button', { name: 'Download selected models' }, { timeout: 3000 })
  expect(screen.getByText('Recommended: /new-recommendation')).toBeInTheDocument()
  expect(folder).toHaveValue('/my-edited-folder')
  expect(choice).not.toBeChecked()
  expect(screen.getByRole('button', { name: 'Download selected models' })).toBeDisabled()
  expect(mocks.command.mock.calls.every(([, args]) => !args.action)).toBe(true)
})

it.each([-3_600_000, 3_600_000])('uses reported elapsed despite Host clock offset %i ms and keeps honest history guidance', async (clockOffset) => {
  const now = 2_000_000
  vi.spyOn(Date, 'now').mockReturnValue(now)
  let updates = 0
  mocks.command.mockImplementation((_operation, args) => {
    if (args.action === 'refresh_catalog') updates++
    return Promise.resolve(flow('profiling', {
      gpu_uuids: ['GPU-one'],
      hardware_profile: {
        status: 'running', phase: 'cpu_experts', phase_detail: 'Completed node 0, FP16 grid',
        started_unix_ms: now + clockOffset, elapsed_ms: 180_000,
        ...(updates === 1 ? { expected_duration_ms: 600_000, remaining_ms: 420_000, duration_source: 'measured_history' } : {}),
        ...(updates >= 2 ? { expected_duration_ms: 120_000, remaining_ms: null, duration_source: 'measured_history' } : {}),
      },
    }))
  })
  render(<EngineFirstRun />)
  expect(await screen.findByText('CPU expert calibration · Last reported elapsed: 3 min')).toBeInTheDocument()
  expect(screen.getByText('Completed node 0, FP16 grid')).toBeInTheDocument()
  expect(screen.getByText(/Completion time is unknown for this GPU group/)).toBeInTheDocument()
  expect(screen.queryByText(/remaining, based on/)).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Refresh model catalog' }))
  expect(await screen.findByText(/About 7 min remaining, based on a previous matching calibration of this GPU group; CPU resources may differ/)).toBeInTheDocument()
  await waitFor(() => expect(screen.getByRole('button', { name: 'Refresh model catalog' })).toBeEnabled())
  fireEvent.click(screen.getByRole('button', { name: 'Refresh model catalog' }))
  expect(await screen.findByText(/taking longer than the previous matching calibration; completion time is unknown/)).toBeInTheDocument()
  expect(screen.queryByText(/About 0 min remaining/)).not.toBeInTheDocument()
})

it('does not derive elapsed or a history estimate from Host timestamps when reported elapsed is absent', async () => {
  const now = 2_000_000
  vi.spyOn(Date, 'now').mockReturnValue(now)
  mocks.command.mockResolvedValue(flow('profiling', {
    hardware_profile: {
      status: 'running', phase: 'cpu_experts', started_unix_ms: now - 3_600_000,
      expected_duration_ms: 600_000, duration_source: 'measured_history',
    },
  }))
  render(<EngineFirstRun />)
  expect(await screen.findByText('CPU expert calibration')).toBeInTheDocument()
  expect(screen.queryByText(/Last reported elapsed:/)).not.toBeInTheDocument()
  expect(screen.getByText(/Completion time is unknown for this GPU group/)).toBeInTheDocument()
  expect(screen.queryByText(/remaining, based on/)).not.toBeInTheDocument()
  expect(screen.queryByText(/taking longer than the previous matching calibration/)).not.toBeInTheDocument()
})

it('shows pending work before the Host returns initial startup profiles', async () => {
  mocks.command.mockResolvedValue(flow('startup'))
  render(<EngineFirstRun />)
  expect(await screen.findByText('Preparing startup settings and checking Engine memory…')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Finish local setup' })).toBeDisabled()
})

it('surfaces unsupported and unavailable hosts with an actionable state', async () => {
  mocks.state = { ...mocks.state, snapshots: { local: { gpus: [] } } }
  mocks.command.mockResolvedValue(flow('gpu'))
  const view = render(<EngineFirstRun />)
  expect(await screen.findByText(/No supported NVIDIA GPUs detected/)).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Use selected GPUs' })).toBeDisabled()
  view.unmount()
  mocks.state = { ...mocks.state, hosts: [] }
  render(<EngineFirstRun />)
  expect(await screen.findByText(/Local GInfer is unavailable/)).toBeInTheDocument()
})

it('honors setup already completed in Manager without starting new work', async () => {
  const onComplete = vi.fn()
  mocks.command.mockResolvedValue(flow('complete'))
  render(<EngineFirstRun onComplete={onComplete} />)
  await waitFor(() => expect(onComplete).toHaveBeenCalledOnce())
  expect(mocks.command).toHaveBeenCalledExactlyOnceWith('first_run', { host_id: 'local' })
  expect(screen.queryByRole('region', { name: 'Set up local GInfer' })).not.toBeInTheDocument()
})

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { EngineFirstRun } from '../EngineFirstRun'
import { EngineHardwareProfile } from '../EngineHardwareProfile'
import type { EngineHardwareProfile as HardwareProfileStatus } from '@/services/engines'

const mocks = vi.hoisted(() => ({ command: vi.fn(), refresh: vi.fn(), state: {} as Record<string, unknown> }))
vi.mock('@/services/engines', async importOriginal => ({
  ...await importOriginal<typeof import('@/services/engines')>(), engineCommand: mocks.command,
}))
vi.mock('@/stores/engine-hosts-store', () => ({ useEngineHosts: (selector: (state: unknown) => unknown) => selector(mocks.state) }))
const release = { name: 'Muse', sha256: 'a'.repeat(64), bytes: 1024 ** 3 }
const profile = { download_id: 'download', model_id: 'muse', gpu_uuids: ['GPU-one'], concurrency: 4, max_context: 32768, kv_arena_bytes: null, instance_count: 1, quote: null, error: null }
const flow = (step: string, extra = {}) => ({ step, gpu_uuids: [], hardware_profile: { status: 'running' }, storage: { path: '/models', recommended_path: '/fast', available_bytes: 1024 ** 4 }, models: [], selected_downloads: [], startup_profiles: [], ...extra })
const hardwareStatus = (status: HardwareProfileStatus['status']): HardwareProfileStatus => ({
  status, pending_gpu_groups: [], stale_groups: [], gpu_uuids: ['GPU-one'], engine_path: '/bin/ginfer', job_id: 'job', pid: null,
  reprofile: false, started_unix_ms: null, finished_unix_ms: null, profile_path: '/hardware.json',
  checkpoint_available: true, diagnostic_tail: '', error: null, available: true,
})
const manualControls = (status: HardwareProfileStatus['status'], action = vi.fn().mockResolvedValue(undefined)) =>
  <EngineHardwareProfile profile={hardwareStatus(status)} gpus={[{ uuid: 'GPU-one', name: 'RTX 5090', memory_mib: 32768, compute_capability: '12.0' }]} offline={false} disabled={false} action={action} />
beforeEach(() => {
  mocks.command.mockReset()
  mocks.refresh.mockReset().mockResolvedValue(undefined)
  mocks.state = { hosts: [{ host_id: 'local', local: true }], snapshots: { local: { gpus: [{ uuid: 'GPU-one', name: 'RTX 5090', memory_mib: 32768, compute_capability: '12.0' }] } }, errors: {}, refresh: mocks.refresh }
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })

it('saves explicit GPU selection before choosing storage without starting profiling', async () => {
  mocks.command.mockImplementation((_operation, args) => Promise.resolve(args.action ? flow('storage', { gpu_uuids: ['GPU-one'], hardware_profile: { status: 'idle' } }) : flow('gpu')))
  // Finish restoring the saved GPU group before simulating the user's edit.
  await act(async () => { render(<EngineFirstRun />) })
  const start = await screen.findByRole('button', { name: 'Use selected graphics cards' })
  expect(start).toBeDisabled()
  expect(screen.getByText(/each combination needs its own hardware profile/)).toBeVisible()
  const technicalIdentity = screen.getByText(/RTX 5090: GPU-one/ )
  expect(technicalIdentity).not.toBeVisible()
  fireEvent.click(screen.getByText('Graphics card details'))
  expect(technicalIdentity).toBeVisible()
  expect(screen.getByRole('checkbox')).not.toHaveAccessibleName(/GPU-one/)
  expect(mocks.command).toHaveBeenCalledExactlyOnceWith('first_run', { host_id: 'local' })
  fireEvent.click(screen.getByRole('checkbox'))
  await waitFor(() => expect(start).toBeEnabled())
  fireEvent.click(start)
  expect(await screen.findByLabelText('Model download folder')).toBeInTheDocument()
  expect(screen.queryByText('Building your hardware profile…')).not.toBeInTheDocument()
  expect(mocks.command).toHaveBeenLastCalledWith('first_run', { host_id: 'local', action: 'profile', gpu_uuids: ['GPU-one'] })
  expect(screen.getByText(/GInfer checks the downloaded files, builds the profile needed by each selected model/)).toBeInTheDocument()
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
  fireEvent.click(screen.getByText('Choose another folder'))
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
  expect(screen.getByText(/GInfer checks the downloaded files, then measures the hardware/)).toBeInTheDocument()
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
  expect(screen.queryByText(/Building your hardware profile/)).not.toBeInTheDocument()
  saved = flow('profiling', {
    gpu_uuids: ['GPU-one'], selected_downloads: [installed],
    hardware_profile: { status: 'failed', scope: 'artifact', scope_complete: false, all_formats_complete: false, error: 'Selected profile interrupted' },
  })
  expect(await screen.findByText('Selected profile interrupted', {}, { timeout: 3000 })).toBeInTheDocument()
  expect(screen.getByText('Hardware profile could not finish')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Resume building profile' }))
  expect(await screen.findByText('Building your hardware profile…')).toBeInTheDocument()
  expect(screen.getByText(/Other model types can be measured later/)).toBeInTheDocument()
  expect(screen.getByText(/GInfer cannot yet estimate the time left for these graphics cards/)).toBeInTheDocument()
  expect(screen.queryByText(/remaining, based on/)).not.toBeInTheDocument()
  expect(screen.queryByLabelText('Model download folder')).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Save folder choice' })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Save model choices' })).not.toBeInTheDocument()
  expect(screen.getByText(/Your downloaded models and saved choices are kept/)).toBeInTheDocument()
  view.unmount()
  mocks.command.mockClear()
  render(<EngineFirstRun />)
  expect(await screen.findByText('Building your hardware profile…')).toBeInTheDocument()
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
  expect(screen.getByText(/Your hardware profile is ready for the selected models/)).toBeInTheDocument()
  expect(screen.getByText(/Other model types can be measured later/)).toBeInTheDocument()
  expect(screen.getByText('Checking that this model has enough memory to start…')).toBeInTheDocument()
  fireEvent.click(screen.getByText('Advanced settings and memory details'))
  fireEvent.change(screen.getByLabelText('muse concurrent requests'), { target: { value: '2' } })
  fireEvent.click(screen.getByRole('button', { name: 'Check startup settings' }))
  await waitFor(() => expect(finish).toBeEnabled())
  expect(screen.getByText('Ready to start with these settings.')).toBeVisible()
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
  await waitFor(() => expect(folder).toHaveValue('/fast'))
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
  await waitFor(() => expect(folder).toHaveValue('/fast'))
  expect(screen.getByRole('checkbox', { name: /Muse/ })).not.toBeChecked()
  fireEvent.change(folder, { target: { value: '/queued-models' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save folder choice' }))
  expect(await screen.findByText('Saved folder choice: /queued-models')).toBeInTheDocument()
  await waitFor(() => expect(screen.getByRole('button', { name: 'Save folder choice' })).toBeEnabled())
  fireEvent.click(screen.getByRole('checkbox', { name: /Muse/ }))
  fireEvent.click(screen.getByRole('button', { name: 'Save model choices' }))
  expect(await screen.findByText('Model choices saved. Downloads will begin after the hardware measurement and folder check finish.')).toBeInTheDocument()
  expect(screen.getByText('Building your hardware profile…')).toBeInTheDocument()
  expect(screen.queryByText('Downloading models')).not.toBeInTheDocument()
  expect(mocks.command.mock.calls.map(([, args]) => args.action).filter(Boolean)).toEqual(['storage', 'models'])
  expect(mocks.command).toHaveBeenLastCalledWith('first_run', { host_id: 'local', action: 'models', release_ids: [release.sha256] })
  view.unmount()
  render(<EngineFirstRun />)
  await waitFor(() => expect(screen.getByLabelText('Model download folder')).toHaveValue('/queued-models'))
  await waitFor(() => expect(screen.getByRole('checkbox', { name: /Muse/ })).toBeChecked())
  expect(screen.getByText('Building your hardware profile…')).toBeInTheDocument()
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
  expect(await screen.findByText('Measuring processor and memory performance · Time so far: 3 min')).toBeInTheDocument()
  expect(screen.getByText('Completed node 0, FP16 grid')).not.toBeVisible()
  fireEvent.click(screen.getByText('Details'))
  expect(screen.getByText('Completed node 0, FP16 grid')).toBeVisible()
  expect(screen.getByText(/GInfer cannot yet estimate the time left for these graphics cards/)).toBeInTheDocument()
  expect(screen.queryByText(/remaining, based on/)).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Refresh model catalog' }))
  expect(await screen.findByText(/About 7 min remaining, based on an earlier profile for these graphics cards/)).toBeInTheDocument()
  await waitFor(() => expect(screen.getByRole('button', { name: 'Refresh model catalog' })).toBeEnabled())
  fireEvent.click(screen.getByRole('button', { name: 'Refresh model catalog' }))
  expect(await screen.findByText(/This is taking longer than the earlier profile/)).toBeInTheDocument()
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
  expect(await screen.findByText('Measuring processor and memory performance')).toBeInTheDocument()
  expect(screen.queryByText(/Time so far:/)).not.toBeInTheDocument()
  expect(screen.getByText(/GInfer cannot yet estimate the time left for these graphics cards/)).toBeInTheDocument()
  expect(screen.queryByText(/remaining, based on/)).not.toBeInTheDocument()
  expect(screen.queryByText(/This is taking longer than the earlier profile/)).not.toBeInTheDocument()
})

it('shows pending work before the Host returns initial startup profiles', async () => {
  mocks.command.mockResolvedValue(flow('startup'))
  render(<EngineFirstRun />)
  expect(await screen.findByText('Preparing settings and checking that each model has enough memory…')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Finish local setup' })).toBeDisabled()
})

it('surfaces unsupported and unavailable hosts with an actionable state', async () => {
  mocks.state = { ...mocks.state, snapshots: { local: { gpus: [] } } }
  mocks.command.mockResolvedValue(flow('gpu'))
  const view = render(<EngineFirstRun />)
  expect(await screen.findByText(/No supported NVIDIA graphics cards were found/)).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Use selected graphics cards' })).toBeDisabled()
  view.unmount()
  mocks.state = { ...mocks.state, hosts: [] }
  render(<EngineFirstRun />)
  expect(await screen.findByText(/GInfer could not connect on this computer/)).toBeInTheDocument()
})

it('honors setup already completed in Manager without starting new work', async () => {
  const onComplete = vi.fn()
  mocks.command.mockResolvedValue(flow('complete'))
  render(<EngineFirstRun onComplete={onComplete} />)
  await waitFor(() => expect(onComplete).toHaveBeenCalledOnce())
  expect(mocks.command).toHaveBeenCalledExactlyOnceWith('first_run', { host_id: 'local' })
  expect(screen.queryByRole('region', { name: 'Set up local GInfer' })).not.toBeInTheDocument()
})


it('keeps existing model guidance available when there is no download catalog', async () => {
  mocks.command.mockResolvedValue(flow('models', { catalog_loaded: true }))
  render(<EngineFirstRun />)
  expect(await screen.findByText(/Downloads are optional: use an existing .ginfer model from Installed models, or add its folder there/)).toBeVisible()
  expect(screen.getByRole('button', { name: 'Download selected models' })).toBeDisabled()
  expect(screen.getByRole('button', { name: 'Refresh model catalog' })).toBeEnabled()
  expect(mocks.command).toHaveBeenCalledExactlyOnceWith('first_run', { host_id: 'local' })
})

it('shows one GPU selection surface and preserves the guided choice across manual recovery', async () => {
  mocks.command.mockResolvedValue(flow('gpu', { hardware_profile: hardwareStatus('idle') }))
  await act(async () => { render(<EngineFirstRun hardwareProfileControls={manualControls('idle')} />) })
  const guided = await screen.findByRole('group', { name: 'Select graphics cards' })
  fireEvent.click(screen.getByRole('checkbox'))
  expect(screen.getByRole('button', { name: 'Use selected graphics cards' })).toBeEnabled()
  expect(screen.getByRole('checkbox')).toBeChecked()
  expect(screen.getByText('Advanced hardware profile options').closest('details')).not.toHaveAttribute('open')
  expect(screen.queryByRole('group', { name: 'Select GPU group' })).not.toBeInTheDocument()
  fireEvent.click(screen.getByText('Advanced hardware profile options'))
  expect(await screen.findByRole('group', { name: 'Select GPU group' })).toBeVisible()
  await waitFor(() => expect(guided).not.toBeInTheDocument())
  expect(screen.getAllByRole('checkbox')).toHaveLength(1)
  expect(screen.getByRole('button', { name: 'Build profile' })).toBeDisabled()
  fireEvent.click(screen.getByRole('checkbox'))
  expect(screen.getByRole('button', { name: 'Build profile' })).toBeEnabled()
  fireEvent.click(screen.getByText('Advanced hardware profile options'))
  expect(await screen.findByRole('group', { name: 'Select graphics cards' })).toBeVisible()
  expect(screen.getByRole('checkbox')).toBeChecked()
  expect(screen.getByRole('button', { name: 'Use selected graphics cards' })).toBeEnabled()
  expect(mocks.command).toHaveBeenCalledExactlyOnceWith('first_run', { host_id: 'local' })
})

it('keeps manual profile recovery accessible with an empty catalog and setup errors', async () => {
  mocks.command.mockResolvedValue(flow('models', { catalog_loaded: true, hardware_profile: hardwareStatus('cancelled') }))
  const view = render(<EngineFirstRun hardwareProfileControls={manualControls('cancelled')} />)
  expect(await screen.findByText(/Downloads are optional: use an existing .ginfer model/)).toBeVisible()
  fireEvent.click(screen.getByText('Advanced hardware profile options'))
  expect(await screen.findByRole('button', { name: 'Resume profiling' })).toBeEnabled()
  expect(screen.getByText(/without downloading a model/)).toBeVisible()
  expect(screen.getByRole('button', { name: 'Download selected models' })).toBeDisabled()
  view.unmount()
  mocks.command.mockRejectedValue(new Error('Saved setup unavailable'))
  render(<EngineFirstRun hardwareProfileControls={manualControls('cancelled')} />)
  expect(await screen.findByRole('alert')).toHaveTextContent('Saved setup unavailable')
  fireEvent.click(screen.getByText('Advanced hardware profile options'))
  expect(await screen.findByRole('button', { name: 'Resume profiling' })).toBeEnabled()
  expect(screen.getByRole('button', { name: 'Retry local setup' })).toBeEnabled()
})

it('renders manual progress and Cancel directly after guided setup is complete', async () => {
  mocks.command.mockResolvedValue(flow('complete'))
  const action = vi.fn().mockResolvedValue(undefined)
  render(<EngineFirstRun hardwareProfileControls={manualControls('running', action)} />)
  expect(await screen.findByRole('region', { name: 'Hardware profile' })).toBeVisible()
  await waitFor(() => expect(screen.queryByRole('region', { name: 'Set up local GInfer' })).not.toBeInTheDocument())
  expect(screen.queryByText('Advanced hardware profile options')).not.toBeInTheDocument()
  expect(screen.getByRole('progressbar')).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: 'Cancel profiling' }))
  expect(action).toHaveBeenCalledExactlyOnceWith('cancel')
  expect(mocks.command).toHaveBeenCalledExactlyOnceWith('first_run', { host_id: 'local' })
})

it('cancels wizard profiling and resumes saved work without losing folder or model choices', async () => {
  let saved = flow('profiling', {
    gpu_uuids: ['GPU-one'], hardware_profile: hardwareStatus('running'),
    catalog_loaded: true, models: [{ release, recommended: false, reason: 'Optional download' }],
  })
  let finishCancel!: (hardware: HardwareProfileStatus) => void
  mocks.command.mockImplementation((operation, args) => {
    if (operation === 'hardware_profile' && args.body.action === 'cancel') return new Promise(resolve => { finishCancel = resolve })
    if (operation === 'hardware_profile' && args.body.action === 'resume') {
      saved = { ...saved, hardware_profile: hardwareStatus('running') }
      return Promise.resolve(saved.hardware_profile)
    }
    return Promise.resolve(saved)
  })
  render(<EngineFirstRun />)
  const folder = await screen.findByLabelText('Model download folder')
  fireEvent.change(folder, { target: { value: '/my-models' } })
  fireEvent.click(screen.getByRole('checkbox', { name: /Muse/ }))
  const cancel = screen.getByRole('button', { name: 'Cancel profiling' })
  fireEvent.click(cancel)
  expect(cancel).toBeDisabled()
  fireEvent.click(cancel)
  expect(mocks.command.mock.calls.filter(([operation]) => operation === 'hardware_profile')).toHaveLength(1)
  expect(mocks.command).toHaveBeenLastCalledWith('hardware_profile', { host_id: 'local', body: { action: 'cancel' } })
  await act(async () => { finishCancel(hardwareStatus('cancelling')) })
  expect(screen.getByText('Stopping hardware profiling…')).toBeVisible()
  expect(screen.getByRole('button', { name: 'Cancelling profiling…' })).toBeDisabled()
  saved = { ...saved, hardware_profile: hardwareStatus('cancelled') }
  const resume = await screen.findByRole('button', { name: 'Resume building profile' }, { timeout: 3000 })
  expect(screen.getByText('Hardware profile cancelled')).toBeVisible()
  expect(folder).toHaveValue('/my-models')
  expect(screen.getByRole('checkbox', { name: /Muse/ })).toBeChecked()
  fireEvent.click(resume)
  expect(await screen.findByText('Building your hardware profile…')).toBeVisible()
  expect(screen.getByRole('button', { name: 'Cancel profiling' })).toBeEnabled()
  expect(mocks.command).toHaveBeenLastCalledWith('hardware_profile', { host_id: 'local', body: { action: 'resume' } })
  expect(folder).toHaveValue('/my-models')
  expect(screen.getByRole('checkbox', { name: /Muse/ })).toBeChecked()
})

it('shows a failed Cancel and keeps its retry available while disabling offline cancellation', async () => {
  mocks.command.mockImplementation(operation => operation === 'hardware_profile'
    ? Promise.reject(new Error('Host could not stop profiling'))
    : Promise.resolve(flow('profiling', { hardware_profile: hardwareStatus('running') })))
  const view = render(<EngineFirstRun />)
  fireEvent.click(await screen.findByRole('button', { name: 'Cancel profiling' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Host could not stop profiling')
  expect(screen.getByRole('button', { name: 'Cancel profiling' })).toBeEnabled()
  mocks.state = { ...mocks.state, errors: { local: 'GInfer offline' } }
  view.rerender(<EngineFirstRun />)
  expect(screen.getByRole('button', { name: 'Cancel profiling' })).toBeDisabled()
})

it('shows only the manual progress controls while advanced options are open', async () => {
  mocks.command.mockResolvedValue(flow('profiling', { hardware_profile: hardwareStatus('running') }))
  render(<EngineFirstRun hardwareProfileControls={manualControls('running')} />)
  expect(await screen.findByRole('progressbar')).toHaveAccessibleName('Hardware profiling')
  expect(screen.getAllByRole('button', { name: 'Cancel profiling' })).toHaveLength(1)
  fireEvent.click(screen.getByText('Advanced hardware profile options'))
  await waitFor(() => expect(screen.getAllByRole('progressbar')).toHaveLength(1))
  expect(screen.getByRole('progressbar')).toHaveAccessibleName('Hardware profiling in progress')
  expect(screen.getAllByRole('button', { name: 'Cancel profiling' })).toHaveLength(1)
  expect(screen.getByLabelText('Model download folder')).toBeVisible()
})

import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { EngineFirstRun } from '../EngineFirstRun'
import { EngineHardwareProfile } from '../EngineHardwareProfile'
import type { EngineHardwareProfile as HardwareProfileStatus } from '@/services/engines'

const mocks = vi.hoisted(() => ({ command: vi.fn(), refresh: vi.fn(), state: {} as Record<string, unknown>, resources: { ready: true as boolean | null, error: '' } }))
vi.mock('@/services/engines', async importOriginal => ({
  ...await importOriginal<typeof import('@/services/engines')>(), engineCommand: mocks.command,
}))
vi.mock('@/stores/engine-hosts-store', () => ({ useEngineHosts: (selector: (state: unknown) => unknown) => selector(mocks.state) }))
vi.mock('@/hooks/useBundledResources', () => ({ useBundledResources: () => mocks.resources }))
const release = { name: 'Muse', identity: { model_id: 'muse', weights_id: 'q4' }, url: `https://huggingface.co/test/muse/resolve/${'c'.repeat(40)}/muse.ginfer`,
  sha256: 'a'.repeat(64), bytes: 1024 ** 3, tp: 1, qualified_sm: ['8.6'], min_vram_mib_per_gpu: 16384, capabilities: [], launch_profiles: [{ id: 'c1' }] }
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
  mocks.resources = { ready: true, error: '' }
  mocks.state = { hosts: [{ host_id: 'local', local: true }], snapshots: { local: { gpus: [{ uuid: 'GPU-one', name: 'RTX 5090', memory_mib: 32768, compute_capability: '12.0' }] } }, errors: {}, refresh: mocks.refresh }
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })

it('keeps the accepted first-run request lifetime when an older status read finishes after Stop', async () => {
  vi.useFakeTimers()
  try {
    let resolveStop!: (value: HardwareProfileStatus) => void
    let resolvePoll!: (value: ReturnType<typeof flow>) => void
    const stop = new Promise<HardwareProfileStatus>(resolve => { resolveStop = resolve })
    const poll = new Promise<ReturnType<typeof flow>>(resolve => { resolvePoll = resolve })
    const running = flow('profiling', { hardware_profile: hardwareStatus('running') })
    mocks.command.mockImplementation(operation => operation === 'hardware_profile' ? stop :
      mocks.command.mock.calls.filter(([name]) => name === 'first_run').length === 1 ? Promise.resolve(running) : poll)
    await act(async () => { render(<EngineFirstRun />) })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Stop setup' })) })
    await act(async () => { await vi.advanceTimersByTimeAsync(2000) })
    expect(mocks.command.mock.calls.filter(([name]) => name === 'first_run')).toHaveLength(2)
    await act(async () => { resolveStop(hardwareStatus('cancelling')) })
    expect(screen.getByText('Stopping graphics-card setup…')).toBeVisible()
    await act(async () => { resolvePoll(running) })
    expect(screen.getByText('Stopping graphics-card setup…')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Stopping setup…' })).toBeDisabled()
  } finally { vi.useRealTimers() }
})

it('continues the first-run request lifetime after an invalidated completed poll', async () => {
  vi.useFakeTimers()
  try {
    let resolvePoll!: (value: ReturnType<typeof flow>) => void
    const poll = new Promise<ReturnType<typeof flow>>(resolve => { resolvePoll = resolve })
    const onComplete = vi.fn()
    let reads = 0
    mocks.command.mockImplementation(operation => {
      if (operation === 'hardware_profile') return Promise.resolve(hardwareStatus('cancelling'))
      if (++reads === 1) return Promise.resolve(flow('profiling', { hardware_profile: hardwareStatus('running') }))
      return reads === 2 ? poll : Promise.resolve(flow('complete'))
    })
    await act(async () => { render(<EngineFirstRun onComplete={onComplete} />) })
    await act(async () => { await vi.advanceTimersByTimeAsync(2000) })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Stop setup' })) })
    await act(async () => { resolvePoll(flow('complete')) })
    expect(onComplete).not.toHaveBeenCalled()
    expect(screen.getByText('Stopping graphics-card setup…')).toBeVisible()
    await act(async () => { await vi.advanceTimersByTimeAsync(2000) })
    expect(reads).toBe(3)
    expect(onComplete).toHaveBeenCalledOnce()
  } finally { vi.useRealTimers() }
})

it('starts a new first-run request lifetime when Welcome discovers a replacement local Host', async () => {
  let resolveAction!: (value: ReturnType<typeof flow>) => void
  const action = new Promise<ReturnType<typeof flow>>(resolve => { resolveAction = resolve })
  mocks.command.mockImplementation((_operation, args) => args.action ? action : Promise.resolve(flow('storage', {
    gpu_uuids: ['GPU-one'],
    storage: { path: '/models', recommended_path: args.host_id === 'replacement' ? '/new-host-models' : '/fast', available_bytes: 1024 ** 4 },
  })))
  const view = render(<EngineFirstRun />)
  await waitFor(() => expect(screen.getByLabelText('Model download folder')).toHaveValue('/fast'))
  fireEvent.change(screen.getByLabelText('Model download folder'), { target: { value: '/former-host-draft' } })
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Use this folder' })) })
  expect(screen.getByRole('button', { name: 'Use this folder' })).toBeDisabled()
  mocks.state = { ...mocks.state, hosts: [{ host_id: 'replacement', local: true }], snapshots: { replacement: { gpus: [] } } }
  await act(async () => { view.rerender(<EngineFirstRun />) })
  await act(async () => { resolveAction(flow('models', { catalog_loaded: false })) })
  expect(screen.getByLabelText('Model download folder')).toHaveValue('/new-host-models')
  expect(screen.getByRole('button', { name: 'Use this folder' })).toBeEnabled()
  expect(screen.queryByText('Loading published model catalog…')).not.toBeInTheDocument()
  expect(mocks.command.mock.calls.filter(([, args]) => args.action)).toEqual([
    ['first_run', { host_id: 'local', action: 'storage', path: '/former-host-draft' }],
  ])
})

it('keeps accepted Retry setup when an older initial refresh request rejects', async () => {
  vi.useFakeTimers()
  try {
    let rejectRefresh!: (reason: Error) => void
    const initialRefresh = new Promise<void>((_resolve, reject) => { rejectRefresh = reject })
    mocks.refresh.mockReturnValueOnce(initialRefresh)
    mocks.command.mockRejectedValueOnce(new Error('Saved setup unavailable'))
      .mockResolvedValue(flow('storage', { gpu_uuids: ['GPU-one'] }))
    await act(async () => { render(<EngineFirstRun />) })
    expect(screen.getByRole('button', { name: 'Retry local setup' })).toBeEnabled()

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Retry local setup' })) })
    expect(mocks.refresh).toHaveBeenCalledTimes(2)
    expect(screen.getByLabelText('Model download folder')).toHaveValue('/fast')
    expect(screen.getByRole('button', { name: 'Use this folder' })).toBeEnabled()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()

    await act(async () => { rejectRefresh(new Error('Older Host discovery failed')) })
    expect(screen.getByLabelText('Model download folder')).toHaveValue('/fast')
    expect(screen.getByRole('button', { name: 'Use this folder' })).toBeEnabled()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Retry local setup' })).not.toBeInTheDocument()
    expect(mocks.command.mock.calls).toEqual([
      ['first_run', { host_id: 'local' }],
      ['first_run', { host_id: 'local' }],
    ])
  } finally { vi.useRealTimers() }
})

it('keeps accepted Retry setup when its earlier refresh request rejects', async () => {
  vi.useFakeTimers()
  try {
    let rejectRefresh!: (reason: Error) => void
    const retryRefresh = new Promise<void>((_resolve, reject) => { rejectRefresh = reject })
    mocks.refresh.mockResolvedValueOnce(undefined).mockReturnValueOnce(retryRefresh)
    mocks.command.mockRejectedValueOnce(new Error('Saved setup unavailable'))
      .mockResolvedValue(flow('storage', { gpu_uuids: ['GPU-one'] }))
    await act(async () => { render(<EngineFirstRun />) })
    expect(screen.getByRole('button', { name: 'Retry local setup' })).toBeEnabled()

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Retry local setup' })) })
    expect(mocks.refresh).toHaveBeenCalledTimes(2)
    expect(screen.getByLabelText('Model download folder')).toHaveValue('/fast')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()

    await act(async () => { rejectRefresh(new Error('Retry Host discovery failed')) })
    expect(screen.getByLabelText('Model download folder')).toHaveValue('/fast')
    expect(screen.getByRole('button', { name: 'Use this folder' })).toBeEnabled()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Retry local setup' })).not.toBeInTheDocument()
    expect(mocks.command.mock.calls).toEqual([
      ['first_run', { host_id: 'local' }],
      ['first_run', { host_id: 'local' }],
    ])
  } finally { vi.useRealTimers() }
})

it('keeps current refresh request failures visible when no local Host exists', async () => {
  vi.useFakeTimers()
  try {
    let rejectInitialRefresh!: (reason: Error) => void
    let rejectRetryRefresh!: (reason: Error) => void
    const initialRefresh = new Promise<void>((_resolve, reject) => { rejectInitialRefresh = reject })
    const retryRefresh = new Promise<void>((_resolve, reject) => { rejectRetryRefresh = reject })
    mocks.refresh.mockReturnValueOnce(initialRefresh).mockReturnValueOnce(retryRefresh)
    mocks.state = { ...mocks.state, hosts: [], snapshots: {} }
    await act(async () => { render(<EngineFirstRun />) })
    expect(screen.getByText('Starting GInfer on this computer…')).toBeVisible()

    await act(async () => { rejectInitialRefresh(new Error('Initial Host discovery failed')) })
    expect(screen.getByRole('alert')).toHaveTextContent('GChat could not read or update setup on this computer.')
    fireEvent.click(screen.getByText('Connection error details'))
    expect(screen.getByText('Error: Initial Host discovery failed')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Retry local setup' })).toBeEnabled()

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Retry local setup' })) })
    await act(async () => { rejectRetryRefresh(new Error('Current retry discovery failed')) })
    expect(screen.getByRole('alert')).toHaveTextContent('GChat could not read or update setup on this computer.')
    expect(screen.getByText('Error: Current retry discovery failed')).toBeVisible()
    expect(screen.queryByText('Error: Initial Host discovery failed')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Retry local setup' })).toBeEnabled()
    expect(mocks.refresh).toHaveBeenCalledTimes(2)
    expect(mocks.command).not.toHaveBeenCalled()
  } finally { vi.useRealTimers() }
})

it('saves explicit GPU selection before choosing storage without starting profiling', async () => {
  mocks.command.mockImplementation((_operation, args) => Promise.resolve(args.action ? flow('storage', { gpu_uuids: ['GPU-one'], hardware_profile: { status: 'idle' } }) : flow('gpu')))
  // Finish restoring the saved GPU group before simulating the user's edit.
  await act(async () => { render(<EngineFirstRun />) })
  const start = await screen.findByRole('button', { name: 'Use selected graphics cards' })
  expect(start).toBeDisabled()
  expect(screen.getByText(/each combination needs its own saved settings/)).toBeVisible()
  const technicalIdentity = screen.getByText(/RTX 5090 · NVIDIA compatibility 12.0/)
  expect(technicalIdentity).not.toBeVisible()
  fireEvent.click(screen.getByText('Graphics card details'))
  expect(technicalIdentity).toBeVisible()
  expect(screen.getByRole('checkbox')).not.toHaveAccessibleName(/GPU-one/)
  expect(mocks.command).toHaveBeenCalledExactlyOnceWith('first_run', { host_id: 'local' })
  fireEvent.click(screen.getByRole('checkbox'))
  await waitFor(() => expect(start).toBeEnabled())
  fireEvent.click(start)
  expect(await screen.findByLabelText('Model download folder')).toBeInTheDocument()
  expect(screen.queryByText('Measuring graphics cards…')).not.toBeInTheDocument()
  expect(mocks.command).toHaveBeenLastCalledWith('first_run', { host_id: 'local', action: 'profile', gpu_uuids: ['GPU-one'] })
  expect(screen.getByText(/GInfer checks the downloaded files, measures the hardware needed by each selected model/)).toBeInTheDocument()
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
  expect(await screen.findByRole('alert')).toHaveTextContent('GInfer could not finish checking this model folder.')
  expect(screen.getByText('Disk measurement unavailable')).not.toBeVisible()
  fireEvent.click(screen.getByText('Folder error details'))
  expect(screen.getByText('Disk measurement unavailable')).toBeVisible()
  expect(screen.getByText(/Select Use this folder when ready\./)).toBeInTheDocument()
  fireEvent.click(screen.getByText('Choose another folder'))
  expect(screen.getByRole('button', { name: '/full · 0 MiB free' })).toBeDisabled()
  await waitFor(() => expect(screen.getByLabelText('Model download folder')).toHaveValue('/fast'))
  fireEvent.change(screen.getByLabelText('Model download folder'), { target: { value: '/chosen' } })
  expect(screen.getByLabelText('Model download folder')).toHaveValue('/chosen')
  fireEvent.click(screen.getByRole('button', { name: 'Use this folder' }))
  expect(await screen.findByText('Loading published model catalog…')).toBeInTheDocument()
  expect(mocks.command).toHaveBeenLastCalledWith('first_run', { host_id: 'local', action: 'storage', path: '/chosen' })
  expect(screen.getByRole('button', { name: 'Refresh model catalog' }).parentElement).toHaveClass('flex', 'gap-2')
  fireEvent.click(screen.getByRole('button', { name: 'Refresh model catalog' }))
  const download = await screen.findByRole('button', { name: 'Download selected models' })
  expect(screen.getByText(/Select a model below, then select Download selected models\. Recommendations/)).toBeInTheDocument()
  await waitFor(() => expect(download).toBeEnabled())
  fireEvent.click(download)
  expect(await screen.findByRole('alert')).toHaveTextContent('Check your internet connection and free space')
  expect(screen.getByText('Connection interrupted')).not.toBeVisible()
  fireEvent.click(screen.getByText('Muse download error details'))
  expect(screen.getByText('Connection interrupted')).toBeVisible()
  expect(mocks.command).toHaveBeenLastCalledWith('first_run', { host_id: 'local', action: 'models', release_ids: [release.sha256] })
  expect(screen.getByRole('button', { name: 'Choose a different model' })).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Resume downloads' })).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
  await screen.findByText(/Muse · Downloading/)
  expect(screen.getByText(/GInfer checks the downloaded files, then measures the hardware/)).toBeInTheDocument()
  expect(mocks.command).toHaveBeenLastCalledWith('first_run', { host_id: 'local', action: 'resume' })
})

it('keeps a paused download informational and resumes its retained progress', async () => {
  const received = 297664406
  let saved = flow('downloads', {
    hardware_profile: { status: 'idle' },
    selected_downloads: [{ id: 'download', release, status: 'paused', received, bytes_per_second: 0,
      error: 'Download paused; partial bytes are retained.' }],
  })
  mocks.command.mockImplementation((_operation, args) => {
    if (args.action === 'resume') saved = flow('downloads', {
      ...saved, selected_downloads: [{ id: 'download', release, status: 'downloading', received,
        bytes_per_second: 1024 ** 2, error: null }],
    })
    return Promise.resolve(saved)
  })
  render(<EngineFirstRun />)
  expect(await screen.findByText(/Muse · Paused; resume to continue/)).toBeInTheDocument()
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  expect(screen.queryByText(/This model download could not finish/)).not.toBeInTheDocument()
  expect(screen.queryByText('Muse download error details')).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Choose a different model' })).not.toBeInTheDocument()
  expect(screen.getByRole('progressbar', { name: 'Muse download' })).toHaveAttribute('value', String(received))
  const resume = screen.getByRole('button', { name: 'Resume downloads' })
  expect(resume).toBeEnabled()
  expect(mocks.command).toHaveBeenCalledExactlyOnceWith('first_run', { host_id: 'local' })
  fireEvent.click(resume)
  expect(await screen.findByText(/Muse · Downloading model/)).toBeInTheDocument()
  expect(screen.getByRole('progressbar', { name: 'Muse download' })).toHaveAttribute('value', String(received))
  expect(mocks.command.mock.calls.filter(([, args]) => args.action)).toEqual([
    ['first_run', { host_id: 'local', action: 'resume' }],
  ])
})

it.each(['pause', 'discard'] as const)('keeps an accepted %s download action when its status read fails', async action => {
  vi.useFakeTimers()
  try {
    const job = { id: 'download', release, status: action === 'pause' ? 'downloading' : 'paused', received: 297664406, bytes_per_second: 0 }
    const before = flow('downloads', { hardware_profile: { status: 'idle' }, selected_downloads: [job] })
    const after = action === 'pause'
      ? flow('downloads', { hardware_profile: { status: 'idle' }, selected_downloads: [{ ...job, status: 'paused' }] })
      : flow('models', { selected_release_ids: [], models: [{ release, recommended: false, reason: 'Choose a model to download' }] })
    let accepted = false
    let readable = false
    mocks.command.mockImplementation((operation, args) => {
      if (operation === 'download_action') {
        accepted = true
        return Promise.resolve({ ok: true })
      }
      if (args.action) throw new Error('Recovery must only read status')
      return accepted ? readable ? Promise.resolve(after) : Promise.reject(new Error('Status read disconnected')) : Promise.resolve(before)
    })
    await act(async () => { render(<EngineFirstRun />) })
    const label = action === 'pause' ? 'Pause download' : 'Discard download'
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: label })) })
    const acceptedMessage = action === 'pause' ? /Pause request accepted/ : /Discard request accepted/
    expect(screen.getByText(acceptedMessage)).toBeVisible()
    expect(screen.getByRole('button', { name: label })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Resume downloads' })).toBeDisabled()
    expect(screen.getByRole('progressbar', { name: 'Muse download' })).toHaveAttribute('value', String(job.received))
    if (action === 'pause') expect(screen.queryByRole('button', { name: 'Discard download' })).not.toBeInTheDocument()

    // A failed retry keeps the accepted receipt and never replays the mutation.
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Retry local setup' })) })
    expect(screen.getByText(acceptedMessage)).toBeVisible()
    expect(screen.getByRole('button', { name: label })).toBeDisabled()
    readable = true
    await act(async () => {
      if (action === 'pause') fireEvent.click(screen.getByRole('button', { name: 'Retry local setup' }))
      else await vi.advanceTimersByTimeAsync(2000)
    })
    expect(screen.queryByText(acceptedMessage)).not.toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    if (action === 'pause') {
      expect(screen.getByRole('button', { name: 'Discard download' })).toBeEnabled()
      expect(screen.getByRole('button', { name: 'Resume downloads' })).toBeEnabled()
      expect(screen.getByText(/Muse · Paused; resume to continue/)).toBeVisible()
    } else {
      expect(screen.queryByRole('progressbar', { name: 'Muse download' })).not.toBeInTheDocument()
      expect(screen.getByRole('checkbox', { name: /Muse/ })).not.toBeChecked()
    }
    expect(mocks.command.mock.calls.filter(([operation]) => operation === 'download_action')).toEqual([
      ['download_action', { host_id: 'local', body: { id: 'download', action } }],
    ])
    expect(mocks.command.mock.calls.filter(([, args]) => args.action)).toEqual([])
  } finally { vi.useRealTimers() }
})

it.each(['pause', 'discard'] as const)('allows retrying a rejected %s download action', async action => {
  const job = { id: 'download', release, status: action === 'pause' ? 'downloading' : 'paused', received: 297664406, bytes_per_second: 0 }
  mocks.command.mockImplementation(operation => operation === 'download_action'
    ? Promise.reject(new Error('Download action was rejected'))
    : Promise.resolve(flow('downloads', { hardware_profile: { status: 'idle' }, selected_downloads: [job] })))
  render(<EngineFirstRun />)
  const label = action === 'pause' ? 'Pause download' : 'Discard download'
  const button = await screen.findByRole('button', { name: label })
  await act(async () => { fireEvent.click(button) })
  expect(screen.getByText('Error: Download action was rejected')).toBeInTheDocument()
  expect(screen.queryByText(/request accepted/)).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: label })).toBeEnabled()
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: label })) })
  expect(mocks.command.mock.calls.filter(([operation]) => operation === 'download_action')).toHaveLength(2)
})

it('pauses then discards a first-run download after the Host reports it paused', async () => {
  vi.useFakeTimers()
  try {
    const job = { id: 'download', release, status: 'downloading', received: 297664406, bytes_per_second: 1024 ** 2 }
    let saved = flow('downloads', {
      hardware_profile: { status: 'idle' }, selected_release_ids: [release.sha256], selected_downloads: [job],
    })
    let resolveDiscard!: () => void
    const discard = new Promise<void>(resolve => { resolveDiscard = resolve })
    mocks.command.mockImplementation((operation, args) => {
      if (operation === 'download_action') {
        if (args.body.action === 'pause') saved = { ...saved, selected_downloads: [{ ...job, status: 'pausing', bytes_per_second: 0 }] }
        if (args.body.action === 'discard') return discard.then(() => {
          saved = flow('models', { selected_release_ids: [], models: [{ release, recommended: false, reason: 'Choose a model to download' }] })
          return { ok: true }
        })
        return Promise.resolve({ ok: true })
      }
      return Promise.resolve(saved)
    })
    await act(async () => { render(<EngineFirstRun />) })
    expect(screen.queryByRole('button', { name: 'Discard download' })).not.toBeInTheDocument()
    expect(screen.getByText('Pausing keeps the partial file so you can resume later.')).toBeVisible()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Pause download' })) })
    expect(screen.getByText(/Muse · Saving progress before pausing/)).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Discard download' })).not.toBeInTheDocument()

    saved = { ...saved, selected_downloads: [{ ...job, status: 'paused', bytes_per_second: 0 }] }
    await act(async () => { await vi.advanceTimersByTimeAsync(2000) })
    expect(screen.getByText(/Muse · Paused; resume to continue/)).toBeVisible()
    expect(screen.getByRole('progressbar', { name: 'Muse download' })).toHaveAttribute('value', String(job.received))
    expect(screen.getByText('Discarding removes the partial file. You will need to start this download again.')).toBeVisible()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Discard download' })) })
    expect(screen.getByRole('button', { name: 'Discard download' })).toBeDisabled()
    expect(screen.getByRole('progressbar', { name: 'Muse download' })).toBeInTheDocument()
    await act(async () => { resolveDiscard() })
    expect(screen.getByRole('checkbox', { name: /Muse/ })).not.toBeChecked()
    expect(screen.getByRole('button', { name: 'Download selected models' })).toBeDisabled()
    expect(screen.queryByRole('progressbar', { name: 'Muse download' })).not.toBeInTheDocument()
    expect(mocks.command.mock.calls.filter(([operation]) => operation === 'download_action')).toEqual([
      ['download_action', { host_id: 'local', body: { id: 'download', action: 'pause' } }],
      ['download_action', { host_id: 'local', body: { id: 'download', action: 'discard' } }],
    ])
  } finally { vi.useRealTimers() }
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
  expect(await screen.findByText(/Muse · Checking the downloaded file/)).toBeInTheDocument()
  expect(screen.queryByText(/Measuring graphics cards/)).not.toBeInTheDocument()
  saved = flow('profiling', {
    gpu_uuids: ['GPU-one'], selected_downloads: [installed],
    hardware_profile: { status: 'failed', scope: 'artifact', scope_complete: false, all_formats_complete: false, error: 'Selected profile interrupted' },
  })
  expect(await screen.findByRole('alert', {}, { timeout: 3000 })).toHaveTextContent('then select Continue setup')
  expect(screen.getByText('Selected profile interrupted')).not.toBeVisible()
  fireEvent.click(screen.getByText('Graphics-card setup error details'))
  expect(screen.getByText('Selected profile interrupted')).toBeVisible()
  expect(screen.getByText('Graphics-card setup could not finish')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Continue setup' }))
  expect(await screen.findByText('Measuring graphics cards…')).toBeInTheDocument()
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
  expect(await screen.findByText('Measuring graphics cards…')).toBeInTheDocument()
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
  expect(screen.getByText(/Your graphics-card settings are ready for the selected models/)).toBeInTheDocument()
  expect(screen.getByText(/Other model types can be measured later/)).toBeInTheDocument()
  expect(screen.getByText('Checking that this model has enough memory to start…')).toBeInTheDocument()
  fireEvent.click(screen.getByText('Advanced settings and memory details'))
  fireEvent.change(screen.getByLabelText('muse simultaneous requests'), { target: { value: '2' } })
  fireEvent.click(screen.getByRole('button', { name: 'Check startup settings' }))
  await waitFor(() => expect(finish).toBeEnabled())
  expect(screen.getByText('Ready to start with these settings.')).toBeVisible()
  expect(mocks.command).toHaveBeenLastCalledWith('first_run', { host_id: 'local', action: 'startup', download_id: 'download', concurrency: 2, max_context: 32768, instance_count: 1, kv_arena_bytes: null })
  fireEvent.click(finish)
  await waitFor(() => expect(onComplete).toHaveBeenCalledOnce())
  expect(mocks.command).toHaveBeenLastCalledWith('first_run', { host_id: 'local', action: 'complete' })
  expect(screen.queryByRole('region', { name: 'Set up local GInfer' })).not.toBeInTheDocument()
})

it('blocks first-run completion and hides readiness when any quoted startup field is edited', async () => {
  mocks.command.mockResolvedValue(flow('startup', {
    startup_profiles: [{ ...profile, quote: { fits: true } }],
  }))
  render(<EngineFirstRun />)
  const finish = await screen.findByRole('button', { name: 'Finish local setup' })
  expect(finish).toBeEnabled()
  fireEvent.click(screen.getByText('Advanced settings and memory details'))

  for (const [label, changed, accepted] of [
    ['simultaneous requests', '2', '4'],
    ['conversation limit in tokens', '16384', '32768'],
    ['model copies', '2', '1'],
    ['graphics-card conversation memory in bytes', '2147483648', ''],
  ]) {
    const field = screen.getByLabelText(`muse ${label}`)
    fireEvent.change(field, { target: { value: changed } })
    expect(finish).toBeDisabled()
    expect(screen.queryByText('Ready to start with these settings.')).not.toBeInTheDocument()
    fireEvent.click(finish)
    fireEvent.change(field, { target: { value: accepted } })
    expect(finish).toBeEnabled()
    expect(screen.getByText('Ready to start with these settings.')).toBeVisible()
  }
  expect(mocks.command).toHaveBeenCalledExactlyOnceWith('first_run', { host_id: 'local' })
})

it('keeps an unchecked startup edit and completion blocked after a rejected check', async () => {
  mocks.command.mockImplementation((_operation, args) => args.action === 'startup'
    ? Promise.reject(new Error('Startup check unavailable'))
    : Promise.resolve(flow('startup', { startup_profiles: [{ ...profile, quote: { fits: true } }] })))
  render(<EngineFirstRun />)
  const finish = await screen.findByRole('button', { name: 'Finish local setup' })
  expect(finish).toBeEnabled()
  fireEvent.click(screen.getByText('Advanced settings and memory details'))
  const requests = screen.getByLabelText('muse simultaneous requests')
  fireEvent.change(requests, { target: { value: '2' } })
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Check startup settings' })) })
  expect(screen.getByRole('alert')).toHaveTextContent('Startup check unavailable')
  expect(requests).toHaveValue(2)
  expect(finish).toBeDisabled()
  expect(screen.queryByText('Ready to start with these settings.')).not.toBeInTheDocument()
  expect(mocks.command.mock.calls.filter(([, args]) => args.action)).toEqual([
    ['first_run', { host_id: 'local', action: 'startup', download_id: 'download', concurrency: 2, max_context: 32768, instance_count: 1, kv_arena_bytes: null }],
  ])
})

it('finishes first-run setup only after a matching check accepts the edited startup settings', async () => {
  const onComplete = vi.fn()
  let saved = flow('startup', { startup_profiles: [{ ...profile, quote: { fits: true } }] })
  mocks.command.mockImplementation((_operation, args) => {
    if (args.action === 'complete') return Promise.resolve(flow('complete'))
    if (args.action === 'startup') saved = flow('startup', { startup_profiles: [{
      ...profile, concurrency: args.concurrency, max_context: args.max_context,
      instance_count: args.instance_count, kv_arena_bytes: args.kv_arena_bytes, quote: { fits: true },
    }] })
    return Promise.resolve(saved)
  })
  render(<EngineFirstRun onComplete={onComplete} />)
  const finish = await screen.findByRole('button', { name: 'Finish local setup' })
  fireEvent.click(screen.getByText('Advanced settings and memory details'))
  fireEvent.change(screen.getByLabelText('muse simultaneous requests'), { target: { value: '2' } })
  fireEvent.change(screen.getByLabelText('muse conversation limit in tokens'), { target: { value: '16384' } })
  fireEvent.change(screen.getByLabelText('muse model copies'), { target: { value: '2' } })
  fireEvent.change(screen.getByLabelText('muse graphics-card conversation memory in bytes'), { target: { value: '2147483648' } })
  expect(finish).toBeDisabled()
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Check startup settings' })) })
  expect(mocks.command).toHaveBeenLastCalledWith('first_run', { host_id: 'local', action: 'startup', download_id: 'download', concurrency: 2, max_context: 16384, instance_count: 2, kv_arena_bytes: 2147483648 })
  expect(finish).toBeEnabled()
  expect(screen.getByText('Ready to start with these settings.')).toBeVisible()
  fireEvent.click(finish)
  await waitFor(() => expect(onComplete).toHaveBeenCalledOnce())
  expect(mocks.command).toHaveBeenLastCalledWith('first_run', { host_id: 'local', action: 'complete' })
  expect(mocks.command.mock.calls.every(([operation]) => operation === 'first_run')).toBe(true)
})

it('does not validate a newer startup edit when an in-flight check accepts an older value', async () => {
  let resolveCheck!: (value: ReturnType<typeof flow>) => void
  const check = new Promise<ReturnType<typeof flow>>(resolve => { resolveCheck = resolve })
  let saved = flow('startup', { startup_profiles: [{ ...profile, quote: { fits: true } }] })
  let checks = 0
  mocks.command.mockImplementation((_operation, args) => {
    if (args.action === 'startup') {
      if (++checks === 1) return check
      saved = flow('startup', { startup_profiles: [{ ...profile, concurrency: args.concurrency, quote: { fits: true } }] })
    }
    return Promise.resolve(saved)
  })
  render(<EngineFirstRun />)
  const finish = await screen.findByRole('button', { name: 'Finish local setup' })
  fireEvent.click(screen.getByText('Advanced settings and memory details'))
  const requests = screen.getByLabelText('muse simultaneous requests')
  fireEvent.change(requests, { target: { value: '2' } })
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Check startup settings' })) })
  expect(requests).toBeEnabled()
  fireEvent.change(requests, { target: { value: '3' } })
  saved = flow('startup', { startup_profiles: [{ ...profile, concurrency: 2, quote: { fits: true } }] })
  await act(async () => { resolveCheck(saved) })
  expect(requests).toHaveValue(3)
  expect(finish).toBeDisabled()
  expect(screen.queryByText('Ready to start with these settings.')).not.toBeInTheDocument()
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Check startup settings' })) })
  expect(requests).toHaveValue(3)
  expect(finish).toBeEnabled()
  expect(screen.getByText('Ready to start with these settings.')).toBeVisible()
  expect(mocks.command.mock.calls.filter(([, args]) => args.action).map(([, args]) => args.concurrency)).toEqual([2, 3])
})

it('keeps startup edits and accepted checks independent for each selected model', async () => {
  let profiles = [
    { ...profile, quote: { fits: true } },
    { ...profile, download_id: 'other-download', model_id: 'qwen', quote: { fits: true } },
  ]
  mocks.command.mockImplementation((_operation, args) => {
    if (args.action === 'startup') profiles = profiles.map(saved => saved.download_id === args.download_id
      ? { ...saved, concurrency: args.concurrency } : saved)
    return Promise.resolve(flow('startup', { startup_profiles: profiles }))
  })
  render(<EngineFirstRun />)
  const finish = await screen.findByRole('button', { name: 'Finish local setup' })
  expect(finish).toBeEnabled()
  screen.getAllByText('Advanced settings and memory details').forEach(summary => fireEvent.click(summary))
  const museRequests = screen.getByLabelText('muse simultaneous requests')
  const qwenRequests = screen.getByLabelText('qwen simultaneous requests')
  fireEvent.change(museRequests, { target: { value: '2' } })
  expect(qwenRequests).toHaveValue(4)
  expect(screen.getAllByText('Ready to start with these settings.')).toHaveLength(1)
  expect(finish).toBeDisabled()
  fireEvent.change(qwenRequests, { target: { value: '3' } })
  expect(screen.queryByText('Ready to start with these settings.')).not.toBeInTheDocument()
  await act(async () => { fireEvent.click(within(museRequests.closest('form')!).getByRole('button', { name: 'Check startup settings' })) })
  expect(museRequests).toHaveValue(2)
  expect(qwenRequests).toHaveValue(3)
  expect(screen.getAllByText('Ready to start with these settings.')).toHaveLength(1)
  expect(finish).toBeDisabled()
  await act(async () => { fireEvent.click(within(qwenRequests.closest('form')!).getByRole('button', { name: 'Check startup settings' })) })
  expect(screen.getAllByText('Ready to start with these settings.')).toHaveLength(2)
  expect(finish).toBeEnabled()
  expect(mocks.command.mock.calls.filter(([, args]) => args.action).map(([, args]) => [args.download_id, args.concurrency])).toEqual([
    ['download', 2], ['other-download', 3],
  ])
})

it('restores the measured placement review without automatically accepting or moving models', async () => {
  const saved = flow('storage_review', {
    gpu_uuids: ['GPU-one'],
    hardware_profile: { status: 'completed', scope: 'artifact', scope_complete: true },
    storage: { path: '/models', recommended_path: '/fast', available_bytes: 1024 ** 4, required_bytes: 3 * 1024 ** 3, review_key: 'current-placement',
      selected_models: [
        { download_id: 'download', name: 'Muse', path: '/models/muse.ginfer', bytes: 1024 ** 3 },
        { download_id: 'other', name: 'Qwen', path: '/models-other/qwen.ginfer', bytes: 2 * 1024 ** 3 },
      ],
      candidates: [
        { path: '/fast', available_bytes: 1024 ** 4, required_bytes: 3 * 1024 ** 3, eligible: true, measured_read_bytes_per_second: 2048 * 1024 ** 2 },
        { path: '/full', available_bytes: 0, eligible: false, reason: 'Not enough free space for the selected models' },
      ],
    },
  })
  mocks.command.mockImplementation((_operation, args) => Promise.resolve(args.action === 'accept_storage'
    ? flow('startup', { startup_profiles: [profile] }) : saved))
  const view = render(<EngineFirstRun />)
  expect(await screen.findByText('Review model locations')).toBeVisible()
  await waitFor(() => expect(screen.getByLabelText('Model download folder')).toHaveValue('/models'))
  expect(screen.getByText('Selected models: 3.0 GiB total.')).toBeVisible()
  expect(screen.getByText('Muse · 1.0 GiB')).toBeVisible()
  expect(screen.getByText('Qwen · 2.0 GiB')).toBeVisible()
  expect(screen.getByText('Current location: /models/muse.ginfer')).toBeVisible()
  expect(screen.getByText('Current location: /models-other/qwen.ginfer')).toBeVisible()
  expect(screen.getByText('Recommended: /fast')).toBeVisible()
  expect(screen.getByText(/Measured read: 2048.0 MiB\/s · Additional space needed: 3.0 GiB/)).toBeVisible()
  expect(screen.getByText('Unavailable · Read speed unavailable')).toBeVisible()
  expect(screen.getByText('Not enough free space for the selected models')).toBeVisible()
  expect(screen.getByRole('button', { name: '/full · 0 MiB free' })).toBeDisabled()
  expect(screen.queryByRole('button', { name: 'Move Muse to selected storage' })).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Move Qwen to selected storage' })).toBeEnabled()
  expect(screen.queryByRole('button', { name: 'Finish local setup' })).not.toBeInTheDocument()
  expect(mocks.command).toHaveBeenCalledExactlyOnceWith('first_run', { host_id: 'local' })

  view.unmount()
  mocks.command.mockClear()
  render(<EngineFirstRun />)
  const keep = await screen.findByRole('button', { name: 'Keep these locations and continue' })
  await waitFor(() => expect(keep).toBeEnabled())
  expect(mocks.command).toHaveBeenCalledExactlyOnceWith('first_run', { host_id: 'local' })
  fireEvent.click(keep)
  expect(await screen.findByText('Review model startup settings')).toBeVisible()
  expect(screen.getByRole('button', { name: 'Finish local setup' })).toBeDisabled()
  expect(mocks.command).toHaveBeenLastCalledWith('first_run', { host_id: 'local', action: 'accept_storage', review_key: 'current-placement' })
})

it('saves a placement destination separately from an explicit managed move', async () => {
  const installed = { id: 'download', release, status: 'installed', received: release.bytes, bytes_per_second: 0 }
  let currentStorage = { path: '/models', requested_path: null as string | null, recommended_path: '/fast', available_bytes: 1024 ** 4, required_bytes: release.bytes, review_key: 'original-placement',
    selected_models: [{ download_id: 'download', name: 'Muse', path: '/models/muse.ginfer', bytes: release.bytes }],
    candidates: [{ path: '/fast', available_bytes: 1024 ** 4, eligible: true, measured_read_bytes_per_second: 2048 * 1024 ** 2 }],
  }
  let saved = flow('storage_review', { gpu_uuids: ['GPU-one'], selected_downloads: [installed], storage: currentStorage })
  mocks.command.mockImplementation((_operation, args) => {
    if (args.action === 'storage') {
      currentStorage = { ...currentStorage, path: args.path, review_key: 'chosen-destination' }
      saved = flow('storage_review', { gpu_uuids: ['GPU-one'], selected_downloads: [installed], storage: currentStorage })
    }
    if (args.action === 'move') saved = flow('profiling', { gpu_uuids: ['GPU-one'], selected_downloads: [installed], hardware_profile: { status: 'running', scope: 'artifact', scope_complete: false }, storage: currentStorage })
    return Promise.resolve(saved)
  })
  const view = render(<EngineFirstRun />)
  await screen.findByText('Review model locations')
  await waitFor(() => expect(screen.getByLabelText('Model download folder')).toHaveValue('/models'))
  fireEvent.click(screen.getByRole('button', { name: '/fast · 1024.0 GiB free' }))
  expect(screen.getByLabelText('Model download folder')).toHaveValue('/fast')
  expect(screen.getByRole('button', { name: 'Keep these locations and continue' })).toBeDisabled()
  expect(mocks.command).toHaveBeenCalledExactlyOnceWith('first_run', { host_id: 'local' })
  fireEvent.click(screen.getByRole('button', { name: 'Use this folder' }))
  await waitFor(() => expect(screen.getByText('Selected download folder: /fast')).toBeVisible())
  expect(screen.getByText('Current location: /models/muse.ginfer')).toBeVisible()
  expect(screen.getByRole('button', { name: 'Keep these locations and continue' })).toBeEnabled()
  expect(mocks.command).toHaveBeenLastCalledWith('first_run', { host_id: 'local', action: 'storage', path: '/fast' })
  expect(mocks.command.mock.calls.filter(([, args]) => args.action).map(([, args]) => args.action)).toEqual(['storage'])

  fireEvent.click(screen.getByRole('button', { name: 'Move Muse to selected storage' }))
  expect(await screen.findByText('Measuring graphics cards…')).toBeVisible()
  expect(screen.queryByRole('button', { name: 'Keep these locations and continue' })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Finish local setup' })).not.toBeInTheDocument()
  expect(mocks.command).toHaveBeenLastCalledWith('first_run', { host_id: 'local', action: 'move', download_id: 'download' })
  expect(mocks.command.mock.calls.filter(([, args]) => args.action).map(([, args]) => args.action)).toEqual(['storage', 'move'])

  view.unmount()
  saved = flow('storage_review', { gpu_uuids: ['GPU-one'], selected_downloads: [installed], storage: { ...currentStorage, review_key: 'moved-placement', selected_models: [{ ...currentStorage.selected_models[0], path: '/fast/muse.ginfer' }] } })
  mocks.command.mockClear()
  render(<EngineFirstRun />)
  expect(await screen.findByText('Current location: /fast/muse.ginfer')).toBeVisible()
  await waitFor(() => expect(screen.getByLabelText('Model download folder')).toHaveValue('/fast'))
  expect(screen.queryByRole('button', { name: 'Move Muse to selected storage' })).not.toBeInTheDocument()
  expect(mocks.command).toHaveBeenCalledExactlyOnceWith('first_run', { host_id: 'local' })
})

it('waits for the current Host placement review key before accepting locations', async () => {
  mocks.command.mockResolvedValue(flow('storage_review', { storage: { path: '/models', available_bytes: 1024 ** 4 } }))
  render(<EngineFirstRun />)
  expect(await screen.findByRole('button', { name: 'Keep these locations and continue' })).toBeDisabled()
  expect(mocks.command).toHaveBeenCalledExactlyOnceWith('first_run', { host_id: 'local' })
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
  // The instructions name the button that is actually shown while profiling.
  expect(screen.getByText(/Select Save folder choice when ready\./)).toBeInTheDocument()
  expect(screen.getByText(/Select a model below, then select Save model choices\. Downloads start after the hardware measurement finishes\./)).toBeInTheDocument()
  fireEvent.change(folder, { target: { value: '/queued-models' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save folder choice' }))
  expect(await screen.findByText('Saved folder choice: /queued-models')).toBeInTheDocument()
  await waitFor(() => expect(screen.getByRole('button', { name: 'Save folder choice' })).toBeEnabled())
  fireEvent.click(screen.getByRole('checkbox', { name: /Muse/ }))
  fireEvent.click(screen.getByRole('button', { name: 'Save model choices' }))
  expect(await screen.findByText('Model choices saved. Downloads will begin after the hardware measurement and folder check finish.')).toBeInTheDocument()
  expect(screen.getByText('Measuring graphics cards…')).toBeInTheDocument()
  expect(screen.queryByText('Downloading models')).not.toBeInTheDocument()
  expect(mocks.command.mock.calls.map(([, args]) => args.action).filter(Boolean)).toEqual(['storage', 'models'])
  expect(mocks.command).toHaveBeenLastCalledWith('first_run', { host_id: 'local', action: 'models', release_ids: [release.sha256] })
  view.unmount()
  render(<EngineFirstRun />)
  await waitFor(() => expect(screen.getByLabelText('Model download folder')).toHaveValue('/queued-models'))
  await waitFor(() => expect(screen.getByRole('checkbox', { name: /Muse/ })).toBeChecked())
  expect(screen.getByText('Measuring graphics cards…')).toBeInTheDocument()
  expect(screen.queryByText('Downloading models')).not.toBeInTheDocument()
})

it.each([null, undefined])('preselects recommendations only before the first choice (%s) and saves an explicit clear', async selected => {
  let saved = flow('profiling', {
    gpu_uuids: ['GPU-one'], catalog_loaded: true, selected_release_ids: selected as string[] | null | undefined,
    models: [{ release, recommended: true, reason: 'Capacity checks wait for profiling' }],
  })
  mocks.command.mockImplementation((_operation, args) => {
    if (args.action === 'models') saved = { ...saved, selected_release_ids: args.release_ids }
    return Promise.resolve(saved)
  })
  const view = render(<EngineFirstRun />)
  const choice = await screen.findByRole('checkbox', { name: /Muse/ })
  await waitFor(() => expect(choice).toBeChecked())
  expect(mocks.command.mock.calls.filter(([, args]) => args.action)).toEqual([])
  fireEvent.click(choice)
  const clear = screen.getByRole('button', { name: 'Clear saved model choices' })
  expect(clear).toBeEnabled()
  fireEvent.click(clear)
  await waitFor(() => expect(mocks.command).toHaveBeenLastCalledWith('first_run', { host_id: 'local', action: 'models', release_ids: [] }))
  await screen.findByRole('button', { name: 'Save model choices' })
  view.unmount()
  render(<EngineFirstRun />)
  await waitFor(() => expect(screen.getByRole('checkbox', { name: /Muse/ })).not.toBeChecked())
  expect(screen.getByText(/Muse.*Recommended/)).toBeVisible()
  expect(screen.getByText('No models are queued for download. Choose models when you are ready.')).toBeVisible()
  expect(screen.getByRole('button', { name: 'Save model choices' })).toBeDisabled()
  expect(mocks.command.mock.calls.filter(([, args]) => args.action)).toEqual([
    ['first_run', { host_id: 'local', action: 'models', release_ids: [] }],
  ])
})

it('clears saved model choices before profiling admits downloads and keeps the cleared choice on polling and reopening', async () => {
  vi.useFakeTimers()
  try {
    let saved = flow('profiling', {
      gpu_uuids: ['GPU-one'], catalog_loaded: true,
      selected_release_ids: [release.sha256],
      models: [{ release, recommended: true, reason: 'Capacity checks wait for profiling' }],
    })
    mocks.command.mockImplementation((_operation, args) => {
      if (args.action === 'models') saved = { ...saved, selected_release_ids: args.release_ids }
      return Promise.resolve(saved)
    })
    let view!: ReturnType<typeof render>
    await act(async () => { view = render(<EngineFirstRun />) })
    const choice = screen.getByRole('checkbox', { name: /Muse/ })
    expect(choice).toBeChecked()
    expect(screen.getByText(/Model choices saved\. Downloads will begin/)).toBeVisible()

    await act(async () => { fireEvent.click(choice) })
    expect(choice).not.toBeChecked()
    expect(screen.queryByText(/Model choices saved\. Downloads will begin/)).not.toBeInTheDocument()
    expect(screen.getByText('Your model choices have changed. Select Clear saved model choices to update the queued downloads.')).toBeVisible()
    const clear = screen.getByRole('button', { name: 'Clear saved model choices' })
    expect(clear).toBeEnabled()
    await act(async () => { fireEvent.click(clear) })
    expect(mocks.command).toHaveBeenLastCalledWith('first_run', { host_id: 'local', action: 'models', release_ids: [] })
    expect(screen.getByText('No models are queued for download. Choose models when you are ready.')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Save model choices' })).toBeDisabled()

    await act(async () => { await vi.advanceTimersByTimeAsync(2000) })
    expect(mocks.command).toHaveBeenLastCalledWith('first_run', { host_id: 'local' })
    expect(choice).not.toBeChecked()
    expect(screen.getByText('Measuring graphics cards…')).toBeVisible()
    expect(screen.queryByText(/Model choices saved\. Downloads will begin/)).not.toBeInTheDocument()
    view.unmount()
    await act(async () => { render(<EngineFirstRun />) })
    expect(screen.getByRole('checkbox', { name: /Muse/ })).not.toBeChecked()
    expect(screen.getByText(/Muse.*Recommended/)).toBeVisible()
    expect(screen.getByText('No models are queued for download. Choose models when you are ready.')).toBeVisible()
    expect(mocks.command.mock.calls.filter(([, args]) => args.action)).toEqual([
      ['first_run', { host_id: 'local', action: 'models', release_ids: [] }],
    ])
  } finally { vi.useRealTimers() }
})

it('keeps edited folder and package choices when a pending profile completes', async () => {
  let reads = 0
  mocks.command.mockImplementation(() => {
    const ready = ++reads > 1
    return Promise.resolve(flow(ready ? 'models' : 'profiling', {
      gpu_uuids: ['GPU-one'],
      storage: { path: '/accepted', recommended_path: ready ? '/new-recommendation' : '/fast', available_bytes: ready ? 1024 ** 4 : null },
      selected_release_ids: ready ? [release.sha256] : null,
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
  await screen.findByRole('button', { name: 'Clear saved model choices' }, { timeout: 3000 })
  expect(screen.getByText('Recommended: /new-recommendation')).toBeInTheDocument()
  expect(folder).toHaveValue('/my-edited-folder')
  expect(choice).not.toBeChecked()
  expect(screen.getByRole('button', { name: 'Clear saved model choices' })).toBeEnabled()
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
  fireEvent.click(screen.getByText('Graphics-card setup technical details'))
  expect(screen.getByText('Completed node 0, FP16 grid')).toBeVisible()
  expect(screen.getByText(/GInfer cannot yet estimate the time left for these graphics cards/)).toBeInTheDocument()
  expect(screen.queryByText(/remaining, based on/)).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Refresh model catalog' }))
  expect(await screen.findByText(/About 7 min remaining, based on earlier measurements for these graphics cards/)).toBeInTheDocument()
  await waitFor(() => expect(screen.getByRole('button', { name: 'Refresh model catalog' })).toBeEnabled())
  fireEvent.click(screen.getByRole('button', { name: 'Refresh model catalog' }))
  expect(await screen.findByText(/This is taking longer than the earlier measurement/)).toBeInTheDocument()
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
  expect(screen.queryByText(/This is taking longer than the earlier measurement/)).not.toBeInTheDocument()
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
  vi.useFakeTimers()
  try {
    render(<EngineFirstRun />)
    await act(async () => { await vi.advanceTimersByTimeAsync(1_000) })
    // The Host is still starting; this is not yet a failure to report.
    expect(screen.getByText(/Starting GInfer on this computer/)).toBeInTheDocument()
    expect(screen.queryByText(/could not connect on this computer/)).not.toBeInTheDocument()
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000) })
    expect(screen.getByText(/GInfer could not connect on this computer/)).toBeInTheDocument()
    expect(screen.queryByText(/Starting GInfer on this computer/)).not.toBeInTheDocument()
  } finally { vi.useRealTimers() }
})

it.each([null, false])('keeps preparing beyond the connection grace while installation readiness is %s', async ready => {
  mocks.state = { ...mocks.state, hosts: [] }
  mocks.resources = { ready, error: '' }
  vi.useFakeTimers()
  try {
    const view = render(<EngineFirstRun />)
    await act(async () => { await vi.advanceTimersByTimeAsync(180_000) })
    expect(screen.getByRole('status')).toHaveTextContent('GChat is installing and checking its bundled files.')
    expect(screen.queryByText(/could not connect on this computer/)).not.toBeInTheDocument()
    expect(mocks.refresh).not.toHaveBeenCalled()

    mocks.resources = { ready: true, error: '' }
    view.rerender(<EngineFirstRun />)
    await act(async () => { await vi.advanceTimersByTimeAsync(1_000) })
    expect(screen.getByRole('status')).toHaveTextContent('Starting GInfer on this computer…')
    expect(mocks.refresh).toHaveBeenCalledOnce()
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000) })
    expect(screen.getByRole('status')).toHaveTextContent('GInfer could not connect on this computer.')
  } finally { vi.useRealTimers() }
})

it('explains a retained installation failure without reporting a failed Host connection', () => {
  mocks.state = { ...mocks.state, hosts: [] }
  mocks.resources = { ready: null, error: 'runtime file hash mismatch: bin/ginfer' }
  render(<EngineFirstRun />)
  expect(screen.getByRole('alert')).toHaveTextContent('Restart GChat to try again. If this keeps happening, reinstall GChat.')
  expect(screen.queryByText(/could not connect on this computer/)).not.toBeInTheDocument()
  expect(screen.queryByText(/Starting GInfer on this computer/)).not.toBeInTheDocument()
  expect(screen.getByText('runtime file hash mismatch: bin/ginfer')).not.toBeVisible()
  fireEvent.click(screen.getByText('GInfer preparation error details'))
  expect(screen.getByText('runtime file hash mismatch: bin/ginfer')).toBeVisible()
  expect(mocks.refresh).not.toHaveBeenCalled()
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
  expect(await screen.findByText(/Downloads are optional: open Models > This computer > Installed and select Add local model to choose an existing \.ginfer file/)).toBeVisible()
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
  expect(screen.getByText('Advanced graphics-card setup options').closest('details')).not.toHaveAttribute('open')
  expect(screen.queryByRole('group', { name: 'Choose graphics cards' })).not.toBeInTheDocument()
  fireEvent.click(screen.getByText('Advanced graphics-card setup options'))
  expect(await screen.findByRole('group', { name: 'Choose graphics cards' })).toBeVisible()
  await waitFor(() => expect(guided).not.toBeInTheDocument())
  expect(screen.getAllByRole('checkbox')).toHaveLength(1)
  expect(screen.getByRole('button', { name: 'Measure graphics cards' })).toBeDisabled()
  fireEvent.click(screen.getByRole('checkbox'))
  expect(screen.getByRole('button', { name: 'Measure graphics cards' })).toBeEnabled()
  fireEvent.click(screen.getByText('Advanced graphics-card setup options'))
  expect(await screen.findByRole('group', { name: 'Select graphics cards' })).toBeVisible()
  expect(screen.getByRole('checkbox')).toBeChecked()
  expect(screen.getByRole('button', { name: 'Use selected graphics cards' })).toBeEnabled()
  expect(mocks.command).toHaveBeenCalledExactlyOnceWith('first_run', { host_id: 'local' })
})

it('keeps manual profile recovery accessible with an empty catalog and setup errors', async () => {
  mocks.command.mockResolvedValue(flow('models', { catalog_loaded: true, hardware_profile: hardwareStatus('cancelled') }))
  const view = render(<EngineFirstRun hardwareProfileControls={manualControls('cancelled')} />)
  expect(await screen.findByText(/Downloads are optional: open Models > This computer > Installed and select Add local model/)).toBeVisible()
  fireEvent.click(screen.getByText('Advanced graphics-card setup options'))
  expect(await screen.findByRole('button', { name: 'Continue setup' })).toBeEnabled()
  expect(screen.getByText(/without downloading a model/)).toBeVisible()
  expect(screen.getByRole('button', { name: 'Download selected models' })).toBeDisabled()
  view.unmount()
  mocks.command.mockRejectedValue(new Error('Saved setup unavailable'))
  render(<EngineFirstRun hardwareProfileControls={manualControls('cancelled')} />)
  expect(await screen.findByRole('alert')).toHaveTextContent('Check that GInfer is running, then select Retry local setup.')
  expect(screen.getByText('Error: Saved setup unavailable')).not.toBeVisible()
  fireEvent.click(screen.getByText('Connection error details'))
  expect(screen.getByText('Error: Saved setup unavailable')).toBeVisible()
  fireEvent.click(screen.getByText('Advanced graphics-card setup options'))
  expect(await screen.findByRole('button', { name: 'Continue setup' })).toBeEnabled()
  expect(screen.getByRole('button', { name: 'Retry local setup' })).toBeEnabled()
})

it('renders manual progress and Cancel directly after guided setup is complete', async () => {
  mocks.command.mockResolvedValue(flow('complete'))
  const action = vi.fn().mockResolvedValue(undefined)
  render(<EngineFirstRun hardwareProfileControls={manualControls('running', action)} />)
  expect(await screen.findByRole('region', { name: 'Graphics-card setup' })).toBeVisible()
  await waitFor(() => expect(screen.queryByRole('region', { name: 'Set up local GInfer' })).not.toBeInTheDocument())
  expect(screen.queryByText('Advanced graphics-card setup options')).not.toBeInTheDocument()
  expect(screen.getByRole('progressbar')).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: 'Stop setup' }))
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
  await waitFor(() => expect(folder).toHaveValue('/fast'))
  fireEvent.change(folder, { target: { value: '/my-models' } })
  fireEvent.click(screen.getByRole('checkbox', { name: /Muse/ }))
  const cancel = screen.getByRole('button', { name: 'Stop setup' })
  fireEvent.click(cancel)
  expect(cancel).toBeDisabled()
  fireEvent.click(cancel)
  expect(mocks.command.mock.calls.filter(([operation]) => operation === 'hardware_profile')).toHaveLength(1)
  expect(mocks.command).toHaveBeenLastCalledWith('hardware_profile', { host_id: 'local', body: { action: 'cancel' } })
  await act(async () => { finishCancel(hardwareStatus('cancelling')) })
  expect(screen.getByText('Stopping graphics-card setup…')).toBeVisible()
  expect(screen.getByRole('button', { name: 'Stopping setup…' })).toBeDisabled()
  saved = { ...saved, hardware_profile: hardwareStatus('cancelled') }
  const resume = await screen.findByRole('button', { name: 'Continue setup' }, { timeout: 3000 })
  expect(screen.getByText('Graphics-card setup stopped')).toBeVisible()
  expect(folder).toHaveValue('/my-models')
  expect(screen.getByRole('checkbox', { name: /Muse/ })).toBeChecked()
  fireEvent.click(resume)
  expect(await screen.findByText('Measuring graphics cards…')).toBeVisible()
  expect(screen.getByRole('button', { name: 'Stop setup' })).toBeEnabled()
  expect(mocks.command).toHaveBeenLastCalledWith('hardware_profile', { host_id: 'local', body: { action: 'resume' } })
  expect(folder).toHaveValue('/my-models')
  expect(screen.getByRole('checkbox', { name: /Muse/ })).toBeChecked()
})

it('shows a failed Cancel and keeps its retry available while disabling offline cancellation', async () => {
  mocks.command.mockImplementation(operation => operation === 'hardware_profile'
    ? Promise.reject(new Error('Host could not stop profiling'))
    : Promise.resolve(flow('profiling', { hardware_profile: hardwareStatus('running') })))
  const view = render(<EngineFirstRun />)
  fireEvent.click(await screen.findByRole('button', { name: 'Stop setup' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('GChat could not finish this setup action. Select Retry local setup to check the current status before trying the action again.')
  expect(screen.getByText('Error: Host could not stop profiling')).not.toBeVisible()
  fireEvent.click(screen.getByText('Setup action error details'))
  expect(screen.getByText('Error: Host could not stop profiling')).toBeVisible()
  expect(screen.getByRole('button', { name: 'Stop setup' })).toBeEnabled()
  mocks.state = { ...mocks.state, errors: { local: 'GInfer offline' } }
  view.rerender(<EngineFirstRun />)
  expect(screen.getByRole('button', { name: 'Stop setup' })).toBeDisabled()
})

it('keeps a rejected stop request visible through status polls until the user retries', async () => {
  vi.useFakeTimers()
  try {
    const saved = flow('profiling', { hardware_profile: hardwareStatus('running') })
    let attempts = 0
    mocks.command.mockImplementation(operation => {
      if (operation !== 'hardware_profile') return Promise.resolve(saved)
      if (++attempts === 1) return Promise.reject(new Error('Host could not stop profiling'))
      return Promise.resolve(hardwareStatus('cancelling'))
    })
    await act(async () => { render(<EngineFirstRun />) })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Stop setup' })) })
    expect(screen.getByRole('alert')).toHaveTextContent('GChat could not finish this setup action.')
    expect(screen.getByText('Error: Host could not stop profiling')).not.toBeVisible()
    fireEvent.click(screen.getByText('Setup action error details'))
    expect(screen.getByText('Error: Host could not stop profiling')).toBeVisible()

    await act(async () => { await vi.advanceTimersByTimeAsync(4000) })
    expect(mocks.command.mock.calls.filter(([operation]) => operation === 'first_run')).toHaveLength(3)
    expect(screen.getByRole('alert')).toHaveTextContent('GChat could not finish this setup action.')
    expect(screen.getByText('Error: Host could not stop profiling')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Stop setup' })).toBeEnabled()
    expect(attempts).toBe(1)

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Stop setup' })) })
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByText('Stopping graphics-card setup…')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Stopping setup…' })).toBeDisabled()
    expect(attempts).toBe(2)
  } finally { vi.useRealTimers() }
})

it('keeps a rejected folder change and the edited path through status polls until retry succeeds', async () => {
  vi.useFakeTimers()
  try {
    let saved = flow('storage')
    let attempts = 0
    mocks.command.mockImplementation((_operation, args) => {
      if (args.action === 'storage') {
        if (++attempts === 1) return Promise.reject(new Error('This folder is not writable. Choose another folder.'))
        saved = flow('models', { storage: { path: args.path, available_bytes: 1024 ** 4 } })
      }
      return Promise.resolve(saved)
    })
    await act(async () => { render(<EngineFirstRun />) })
    fireEvent.change(screen.getByLabelText('Model download folder'), { target: { value: '/chosen-models' } })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Use this folder' })) })
    await act(async () => { await vi.advanceTimersByTimeAsync(4000) })

    expect(screen.getByRole('alert')).toHaveTextContent('GChat could not finish this setup action. Select Retry local setup to check the current status before trying the action again.')
    expect(screen.getByText('Error: This folder is not writable. Choose another folder.')).not.toBeVisible()
    fireEvent.click(screen.getByText('Setup action error details'))
    expect(screen.getByText('Error: This folder is not writable. Choose another folder.')).toBeVisible()
    expect(screen.getByLabelText('Model download folder')).toHaveValue('/chosen-models')
    expect(screen.getByRole('button', { name: 'Use this folder' })).toBeEnabled()
    expect(attempts).toBe(1)

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Retry local setup' })) })
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(mocks.command).toHaveBeenLastCalledWith('first_run', { host_id: 'local' })
    expect(screen.getByLabelText('Model download folder')).toHaveValue('/chosen-models')
    expect(attempts).toBe(1)

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Use this folder' })) })
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Download selected models' })).toBeVisible()
    expect(mocks.command).toHaveBeenLastCalledWith('first_run', { host_id: 'local', action: 'storage', path: '/chosen-models' })
    expect(attempts).toBe(2)
  } finally { vi.useRealTimers() }
})

it('clears a temporary setup connection error when the next status poll succeeds', async () => {
  vi.useFakeTimers()
  try {
    mocks.command.mockRejectedValueOnce(new Error('Saved setup unavailable')).mockResolvedValue(flow('gpu'))
    await act(async () => { render(<EngineFirstRun />) })
    expect(screen.getByRole('alert')).toHaveTextContent('Saved setup unavailable')
    await act(async () => { await vi.advanceTimersByTimeAsync(2000) })
    expect(screen.queryByText(/Saved setup unavailable/)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Retry local setup' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Use selected graphics cards' })).toBeVisible()
  } finally { vi.useRealTimers() }
})

it('shows only the manual progress controls while advanced options are open', async () => {
  mocks.command.mockResolvedValue(flow('profiling', { hardware_profile: hardwareStatus('running') }))
  render(<EngineFirstRun hardwareProfileControls={manualControls('running')} />)
  expect(await screen.findByRole('progressbar')).toHaveAccessibleName('Graphics-card setup in progress')
  expect(screen.getAllByRole('button', { name: 'Stop setup' })).toHaveLength(1)
  // The bar fills its own row; an inline bar ran underneath the Cancel button.
  const bar = screen.getByRole('progressbar')
  expect(bar).toHaveClass('block', 'w-full')
  expect(bar.parentElement).toHaveClass('space-y-3')
  expect(bar.parentElement).toContainElement(screen.getByRole('button', { name: 'Stop setup' }))
  fireEvent.click(screen.getByText('Advanced graphics-card setup options'))
  await waitFor(() => expect(screen.getAllByRole('progressbar')).toHaveLength(1))
  expect(screen.getByRole('progressbar')).toHaveAccessibleName('Graphics-card setup in progress')
  expect(screen.getAllByRole('button', { name: 'Stop setup' })).toHaveLength(1)
  expect(screen.getByLabelText('Model download folder')).toBeVisible()
})

it('does not offer a catalog model that has no tested launch profile', async () => {
  mocks.command.mockResolvedValue(flow('models', { catalog_loaded: true, models: [{ release: { ...release, launch_profiles: [] }, recommended: true, reason: 'Fits your graphics card and free disk space.' }] }))
  render(<EngineFirstRun hostId="local" />)
  await screen.findByText(/No model downloads are available/)
  expect(screen.queryByRole('checkbox', { name: /Muse/ })).toBeNull()
})

it('returns to model choice when the person picks a different model after a failed download', async () => {
  let saved = flow('downloads', { selected_downloads: [{ id: 'download', release, status: 'failed', received: 0, bytes_per_second: 0, error: 'Download not found' }] })
  mocks.command.mockImplementation((_operation, args) => {
    if (args.action === 'reselect') saved = flow('models', { catalog_loaded: true, models: [{ release, recommended: true, reason: 'Published for this GPU group' }] })
    return Promise.resolve(saved)
  })
  render(<EngineFirstRun />)
  fireEvent.click(await screen.findByRole('button', { name: 'Choose a different model' }))
  expect(await screen.findByRole('button', { name: 'Download selected models' })).toBeInTheDocument()
  expect(mocks.command).toHaveBeenLastCalledWith('first_run', { host_id: 'local', action: 'reselect' })
})

it('scrolls the setup card into view after a step is saved', async () => {
  const scroll = vi.fn()
  Element.prototype.scrollIntoView = scroll
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation(cb => { cb(0); return 0 })
  mocks.command.mockImplementation((_operation, args) => Promise.resolve(args.action ? flow('models', { gpu_uuids: ['GPU-one'], hardware_profile: { status: 'idle' } }) : flow('storage', { gpu_uuids: ['GPU-one'], hardware_profile: { status: 'idle' } })))
  await act(async () => { render(<EngineFirstRun />) })
  fireEvent.click(await screen.findByRole('button', { name: 'Use this folder' }))
  await waitFor(() => expect(scroll.mock.calls.length).toBeGreaterThan(0))
})


it('explains a saved setup error while keeping diagnostics closed and model choices available', async () => {
  mocks.command.mockResolvedValue(flow('models', {
    catalog_loaded: true, error: 'Catalog HTTP 503: upstream unavailable',
    models: [{ release, recommended: false, reason: 'Optional download' }],
  }))
  render(<EngineFirstRun />)
  expect(await screen.findByRole('alert')).toHaveTextContent('Setup could not finish this step. Check the details below, then try the step again.')
  const diagnostic = screen.getByText('Catalog HTTP 503: upstream unavailable')
  expect(diagnostic).not.toBeVisible()
  expect(screen.getByRole('checkbox', { name: /Muse/ })).toBeEnabled()
  expect(screen.getByRole('button', { name: 'Refresh model catalog' })).toBeEnabled()
  fireEvent.click(screen.getByText('Setup error details'))
  expect(diagnostic).toBeVisible()
  expect(mocks.command).toHaveBeenCalledExactlyOnceWith('first_run', { host_id: 'local' })
})

it('explains startup errors, hides diagnostics and keeps completion blocked until settings pass', async () => {
  mocks.command.mockImplementation((_operation, args) => Promise.resolve(flow('startup', {
    startup_profiles: [{ ...profile, concurrency: args.action === 'startup' ? args.concurrency : profile.concurrency, quote: { fits: true }, error: args.action === 'startup' ? null : 'CUDA allocation failed: requested 4294967296 bytes' }],
  })))
  render(<EngineFirstRun />)
  expect(await screen.findByRole('alert')).toHaveTextContent('A shorter conversation limit or fewer simultaneous requests may help if memory is short.')
  const diagnostic = screen.getByText('CUDA allocation failed: requested 4294967296 bytes')
  expect(diagnostic).not.toBeVisible()
  const finish = screen.getByRole('button', { name: 'Finish local setup' })
  expect(finish).toBeDisabled()
  fireEvent.click(screen.getByText('muse startup error details'))
  expect(diagnostic).toBeVisible()
  fireEvent.click(screen.getByText('Advanced settings and memory details'))
  fireEvent.change(screen.getByLabelText('muse simultaneous requests'), { target: { value: '2' } })
  fireEvent.click(screen.getByRole('button', { name: 'Check startup settings' }))
  await waitFor(() => expect(finish).toBeEnabled())
  expect(mocks.command).toHaveBeenLastCalledWith('first_run', { host_id: 'local', action: 'startup', download_id: 'download', concurrency: 2, max_context: 32768, instance_count: 1, kv_arena_bytes: null })
  expect(screen.getByText('Ready to start with these settings.')).toBeVisible()
  expect(mocks.command.mock.calls.every(([, args]) => !args.action || args.action === 'startup')).toBe(true)
})

it('shows background disk-full failures and clears the alert after a successful retry', async () => {
  let saved = flow('storage', { storage: { path: '/models', requested_path: '/models', available_bytes: 0 }, maintenance_error: 'The disk is full. Free some space, then try again.' })
  mocks.command.mockImplementation((_operation, args) => {
    if (args.action === 'resume') saved = flow('models', { maintenance_error: null })
    return Promise.resolve(saved)
  })
  render(<EngineFirstRun />)
  expect(await screen.findByRole('alert')).toHaveTextContent('The disk is full. Free some space, then try again.')
  await waitFor(() => expect(screen.getByLabelText('Model download folder')).toHaveValue('/models'))
  fireEvent.click(screen.getByRole('button', { name: 'Retry setup' }))
  await waitFor(() => expect(screen.queryByText(/Setup could not continue/)).not.toBeInTheDocument())
  expect(mocks.command).toHaveBeenLastCalledWith('first_run', { host_id: 'local', action: 'resume' })
})

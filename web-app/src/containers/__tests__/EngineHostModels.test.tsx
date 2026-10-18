import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { toast } from 'sonner'
import { afterEach, expect, it, vi } from 'vitest'
import { HostCard } from '../EngineHostModels'
import { engineCommand, type EngineSnapshot, type EngineStartupQuote, type EngineHardwareProfile } from '@/services/engines'
import { settleConfirm, useConfirmStore } from '@/lib/confirm'

const { refreshHosts, publishSnapshot, publishHardwareProfile } = vi.hoisted(() => ({
  refreshHosts: vi.fn().mockResolvedValue(undefined),
  publishSnapshot: vi.fn(),
  publishHardwareProfile: vi.fn(),
}))

vi.mock('@/services/engines', async (original) => ({
  ...await original<typeof import('@/services/engines')>(),
  engineCommand: vi.fn().mockResolvedValue({}),
}))
vi.mock('@/stores/engine-hosts-store', () => ({
  useEngineHosts: (selector: (state: { refresh: typeof refreshHosts; publishSnapshot: typeof publishSnapshot; publishHardwareProfile: typeof publishHardwareProfile }) => unknown) =>
    selector({ refresh: refreshHosts, publishSnapshot, publishHardwareProfile }),
}))
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn() } }))
vi.mock('../EngineProfilePicker', () => ({ EngineProfilePicker: () => null }))
vi.mock('../EngineFirstRun', () => ({ EngineFirstRun: ({ hostId, hardwareProfileControls }: { hostId: string; hardwareProfileControls?: ReactNode }) => <section aria-label={`First-run setup for ${hostId}`}>{hardwareProfileControls}</section> }))
afterEach(() => {
  cleanup(); settleConfirm(false); vi.clearAllMocks(); publishSnapshot.mockReset(); publishHardwareProfile.mockReset()
  vi.mocked(engineCommand).mockReset().mockResolvedValue({})
  refreshHosts.mockReset().mockResolvedValue(undefined)
})

const localHost = { local: true, host_id: 'host', name: 'Host', base_url: 'https://host', certificate_sha256: '', client_id: 'client' }
const importedModelSnapshot: EngineSnapshot = {
  host_id: 'host', display_name: 'Host', revision: 1,
  gpus: [{ uuid: 'GPU-one', name: 'Fixture GPU', memory_mib: 32607, compute_capability: '12.0' }],
  models: [{ id: 'imported-model', path: '/local/renamed.ginfer', artifact_set: false,
    metadata: { identity: { model_id: 'qwen3.8-27b', weights_id: 'int8' }, tp_size: 1, draft_tp: 0, size_bytes: 1024 } }],
  instances: [], launch_profiles: [],
  model_management: { version: 1, managed_root: '/models', engine_presets_available: false, downloads: [] },
}
const importedQuote: EngineStartupQuote = {
  model_identity: { model_id: 'qwen3.8-27b', weights_id: 'int8' }, instance_count: 2, kv_arena_bytes: 1048576,
}

const hardwareProfile: EngineHardwareProfile = {
  status: 'idle', pending_gpu_groups: [], stale_groups: [], gpu_uuids: ['GPU-one'],
  engine_path: '/bin/ginfer', job_id: null, pid: null, reprofile: false,
  started_unix_ms: null, finished_unix_ms: null, profile_path: '/hardware.json',
  checkpoint_available: false, diagnostic_tail: '', error: null, available: true,
}
const hardwareActions = [
  { action: 'ensure', status: 'idle', button: 'Measure graphics cards', cards: true },
  { action: 'refresh', status: 'completed', button: 'Measure again', cards: true },
  { action: 'resume', status: 'cancelled', button: 'Continue setup', cards: false },
  { action: 'cancel', status: 'running', button: 'Stop setup', cards: false },
] as const

it.each(hardwareActions)('keeps the hardware setup action result for $action after a failed host-list read', async ({ action, status, button, cards }) => {
  const snapshot: EngineSnapshot = { ...importedModelSnapshot, hardware_profile: {
    ...hardwareProfile, status, job_id: status === 'idle' ? null : 'setup-job',
  } }
  const accepted: EngineHardwareProfile = { ...snapshot.hardware_profile!, status: action === 'cancel' ? 'cancelling' : 'running', job_id: 'setup-job' }
  let finish!: (profile: EngineHardwareProfile) => void
  vi.mocked(engineCommand).mockReturnValueOnce(new Promise<EngineHardwareProfile>(resolve => { finish = resolve }))
  refreshHosts.mockRejectedValueOnce(new Error('host-list read failed')).mockResolvedValueOnce(undefined)
  const view = render(<HostCard host={localHost} snapshot={snapshot} />)
  publishHardwareProfile.mockImplementation((hostId, profile) => {
    expect(hostId).toBe('host')
    view.rerender(<HostCard host={localHost} snapshot={{ ...snapshot, hardware_profile: profile }} />)
  })
  if (cards) fireEvent.click(within(screen.getByRole('region', { name: 'First-run setup for host' })).getByRole('checkbox', { name: 'Graphics card 1: Fixture GPU' }))
  const control = screen.getByRole('button', { name: button })
  fireEvent.click(control)
  fireEvent.click(control)
  expect(control).toBeDisabled()
  expect(engineCommand).toHaveBeenCalledExactlyOnceWith('hardware_profile', {
    host_id: 'host', body: { action, ...(cards ? { gpu_uuids: ['GPU-one'] } : {}) },
  })
  expect(screen.queryByText('Graphics-card setup requested.')).not.toBeInTheDocument()
  expect(screen.queryByText('Graphics-card setup stop requested.')).not.toBeInTheDocument()
  expect(publishHardwareProfile).not.toHaveBeenCalled()
  await act(async () => { finish(accepted) })
  expect(await screen.findByText(action === 'cancel' ? 'Graphics-card setup stop requested.' : 'Graphics-card setup requested.')).toBeVisible()
  expect(publishHardwareProfile).toHaveBeenCalledExactlyOnceWith('host', accepted)
  expect(publishSnapshot).not.toHaveBeenCalled()
  expect(screen.getByRole('progressbar', { name: 'Graphics-card setup in progress' })).toBeVisible()
  if (action === 'cancel') expect(screen.getByRole('button', { name: 'Stopping setup…' })).toBeDisabled()
  else expect(screen.getByRole('button', { name: 'Stop setup' })).toBeEnabled()
  expect(screen.getByRole('alert')).toHaveTextContent('Could not refresh the host list.')
  expect(screen.queryByText(/Could not change the graphics-card setup/)).not.toBeInTheDocument()
  expect(screen.getByText('Error: host-list read failed')).not.toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: 'Refresh host list' }))
  await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument())
  expect(refreshHosts).toHaveBeenCalledTimes(2)
  expect(engineCommand).toHaveBeenCalledTimes(1)
})

it.each(hardwareActions)('allows explicit retry after a rejected hardware setup action result for $action', async ({ action, status, button, cards }) => {
  const snapshot: EngineSnapshot = { ...importedModelSnapshot, hardware_profile: {
    ...hardwareProfile, status, job_id: status === 'idle' ? null : 'setup-job',
  } }
  const accepted: EngineHardwareProfile = { ...snapshot.hardware_profile!, status: action === 'cancel' ? 'cancelling' : 'running', job_id: 'setup-job' }
  vi.mocked(engineCommand).mockRejectedValueOnce(new Error('setup command refused')).mockResolvedValueOnce(accepted)
  refreshHosts.mockResolvedValueOnce(undefined)
  render(<HostCard host={localHost} snapshot={snapshot} />)
  if (cards) fireEvent.click(within(screen.getByRole('region', { name: 'First-run setup for host' })).getByRole('checkbox', { name: 'Graphics card 1: Fixture GPU' }))
  fireEvent.click(screen.getByRole('button', { name: button }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Could not change the graphics-card setup.')
  expect(screen.getByText('Error: setup command refused')).not.toBeVisible()
  expect(screen.getByRole('button', { name: button })).toBeEnabled()
  expect(publishHardwareProfile).not.toHaveBeenCalled()
  expect(refreshHosts).not.toHaveBeenCalled()
  expect(screen.queryByText('Graphics-card setup requested.')).not.toBeInTheDocument()
  expect(screen.queryByText('Graphics-card setup stop requested.')).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: button }))
  expect(await screen.findByText(action === 'cancel' ? 'Graphics-card setup stop requested.' : 'Graphics-card setup requested.')).toBeVisible()
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  expect(publishHardwareProfile).toHaveBeenCalledExactlyOnceWith('host', accepted)
  expect(publishSnapshot).not.toHaveBeenCalled()
  expect(engineCommand).toHaveBeenCalledTimes(2)
  for (const call of vi.mocked(engineCommand).mock.calls) expect(call).toEqual(['hardware_profile', {
    host_id: 'host', body: { action, ...(cards ? { gpu_uuids: ['GPU-one'] } : {}) },
  }])
  await waitFor(() => expect(refreshHosts).toHaveBeenCalledOnce())
})

it('keeps local hardware controls in setup and remote hardware controls directly accessible', async () => {
  const snapshot: EngineSnapshot = { ...importedModelSnapshot, hardware_profile: {
    status: 'running', pending_gpu_groups: [], stale_groups: [], gpu_uuids: ['GPU-one'],
    engine_path: '/bin/ginfer', job_id: 'job', pid: 42, reprofile: false,
    started_unix_ms: null, finished_unix_ms: null, profile_path: '/hardware.json',
    checkpoint_available: true, diagnostic_tail: '', error: null, available: true,
  } }
  vi.mocked(engineCommand).mockResolvedValueOnce({ ...snapshot.hardware_profile, status: 'cancelling' })
  const view = render(<HostCard host={localHost} snapshot={snapshot} />)
  const setup = screen.getByRole('region', { name: 'First-run setup for host' })
  expect(within(setup).getByRole('progressbar', { name: 'Graphics-card setup in progress' })).toBeVisible()
  fireEvent.click(within(setup).getByRole('button', { name: 'Stop setup' }))
  await waitFor(() => expect(refreshHosts).toHaveBeenCalledOnce())
  expect(engineCommand).toHaveBeenCalledExactlyOnceWith('hardware_profile', { host_id: 'host', body: { action: 'cancel' } })

  view.rerender(<HostCard host={{ ...localHost, local: false }} snapshot={snapshot} />)
  expect(screen.queryByRole('region', { name: 'First-run setup for host' })).not.toBeInTheDocument()
  expect(screen.getAllByRole('progressbar', { name: 'Graphics-card setup in progress' })).toHaveLength(1)
  expect(screen.getByRole('button', { name: 'Stop setup' })).toBeEnabled()
})

it('shows Host Stop only for a local Host advertising normal-stop capability', () => {
  const { rerender } = render(<HostCard host={localHost} snapshot={importedModelSnapshot} />)
  expect(screen.queryByRole('button', { name: 'Stop model service and quit' })).not.toBeInTheDocument()
  rerender(<HostCard host={{ ...localHost, local: false }} snapshot={{ ...importedModelSnapshot, can_stop_host: true }} />)
  expect(screen.queryByRole('button', { name: 'Stop model service and quit' })).not.toBeInTheDocument()
  rerender(<HostCard host={localHost} snapshot={{ ...importedModelSnapshot, can_stop_host: true }} />)
  expect(screen.getByRole('button', { name: 'Stop model service and quit' })).toBeEnabled()
})

it('accepts normal Host Stop without refreshing or reattaching while quitting', async () => {
  vi.mocked(engineCommand).mockResolvedValue({ stopping: true })
  render(<HostCard host={localHost} snapshot={{ ...importedModelSnapshot, can_stop_host: true }} />)
  fireEvent.click(screen.getByRole('button', { name: 'Stop model service and quit' }))
  expect(await screen.findByRole('status')).toHaveTextContent('The model service is stopping. Quitting GChat')
  expect(screen.getByRole('button', { name: 'Quitting…' })).toBeDisabled()
  expect(engineCommand).toHaveBeenCalledExactlyOnceWith('stop_host', { host_id: 'host' })
  expect(refreshHosts).not.toHaveBeenCalled()
})

it('keeps the Host available and reports the reason when normal Stop is refused', async () => {
  vi.mocked(engineCommand).mockRejectedValueOnce(new Error('Host is busy: model load in progress'))
  render(<HostCard host={localHost} snapshot={{ ...importedModelSnapshot, can_stop_host: true }} />)
  fireEvent.click(screen.getByRole('button', { name: 'Stop model service and quit' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Could not stop the model service.')
  const details = screen.getByText('Error: Host is busy: model load in progress')
  expect(details).not.toBeVisible()
  fireEvent.click(screen.getByText('Technical details'))
  expect(details).toBeVisible()
  expect(screen.getByRole('button', { name: 'Stop model service and quit' })).toBeEnabled()
  expect(screen.queryByText('The model service is stopping. Quitting GChat…')).not.toBeInTheDocument()
  expect(refreshHosts).not.toHaveBeenCalled()
})
async function selectImportedModel() {
  fireEvent.click(screen.getByText('Model and memory settings'))
  fireEvent.click(screen.getByText('Choose model settings'))
  await userEvent.click(screen.getByLabelText('Installed model'))
  await userEvent.click(screen.getByRole('menuitemradio', { name: /Qwen 3.8 27B/ }))
}

it('checks imported artifact settings without a catalog or download and uses the same count when launching', async () => {
  vi.mocked(engineCommand).mockResolvedValue(importedQuote)
  render(<HostCard host={localHost} snapshot={importedModelSnapshot} />)
  await selectImportedModel()
  fireEvent.change(screen.getByLabelText('Model copies'), { target: { value: '2' } })
  fireEvent.change(screen.getByLabelText('Requests at once'), { target: { value: '4' } })
  fireEvent.change(screen.getByLabelText('Conversation length (tokens)'), { target: { value: '65536' } })
  fireEvent.click(screen.getByLabelText('Follow a response format'))
  fireEvent.change(screen.getByLabelText('Computer conversation memory (bytes)'), { target: { value: '0' } })
  fireEvent.click(screen.getByRole('button', { name: 'Check model settings' }))
  const body = expect.objectContaining({ model_id: 'imported-model', gpu_uuids: ['GPU-one'], remaining_instances: 2,
    max_context: 65536, concurrency: 4, structured_outputs: false, kv_arena_bytes: null, host_kv_cache_bytes: 0 })
  await waitFor(() => expect(engineCommand).toHaveBeenCalledWith('quote', { host_id: 'host', body }))
  expect(await screen.findByRole('status')).toHaveTextContent('Model file checked: Qwen 3.8 27B — INT')
  expect(screen.getByRole('status')).toHaveTextContent('2 model copies')
  expect(screen.getByRole('status')).toHaveTextContent('1 MiB of graphics-card conversation memory per model copy')
  expect(engineCommand).toHaveBeenCalledTimes(1)
  await waitFor(() => expect(screen.getByRole('button', { name: 'Start model with these settings' })).toBeEnabled())
  fireEvent.click(screen.getByRole('button', { name: 'Start model with these settings' }))
  await waitFor(() => expect(engineCommand).toHaveBeenCalledTimes(3))
  expect(engineCommand).toHaveBeenNthCalledWith(2, 'launch', { host_id: 'host', body })
  expect(engineCommand).toHaveBeenNthCalledWith(3, 'launch', expect.objectContaining({
    body: expect.objectContaining({ model_id: 'imported-model', remaining_instances: 1, kv_arena_bytes: null }),
  }))
})

it.each([
  { name: 'Engine default with LFU on', input: '', headroom: null, lfu: true },
  { name: 'explicit zero with LFU off', input: '0', headroom: 0, lfu: false },
  { name: 'chosen headroom with LFU on', input: '8', headroom: 8, lfu: true },
])('uses $name for both the custom startup check and launch', async ({ input, headroom, lfu }) => {
  vi.mocked(engineCommand).mockResolvedValue(importedQuote)
  refreshHosts.mockReset().mockResolvedValue(undefined)
  render(<HostCard host={localHost} snapshot={importedModelSnapshot} />)
  await selectImportedModel()
  fireEvent.click(screen.getByText('Advanced model settings'))
  const memory = screen.getByLabelText('Computer memory headroom for Flash (GiB)')
  const cache = screen.getByRole('checkbox', { name: 'Update the Flash expert cache' })
  expect(memory).toHaveDisplayValue('')
  expect(cache).toBeChecked()
  expect(screen.getByText(/Leave blank to use GInfer’s default \(4 GiB\)/)).toBeVisible()
  expect(screen.getByText(/Turning this off stops those updates; it does not clear the cache/)).toBeVisible()
  // Clearing an entered value restores inheritance rather than sending zero.
  fireEvent.change(memory, { target: { value: '12' } })
  fireEvent.change(memory, { target: { value: input } })
  if (!lfu) fireEvent.click(cache)
  const warning = screen.queryByText(/0 removes the extra computer-memory reserve for Flash/)
  if (headroom === 0) expect(warning).toBeVisible()
  else expect(warning).not.toBeInTheDocument()
  const body = expect.objectContaining({
    model_id: 'imported-model', gpu_uuids: ['GPU-one'],
    flash_host_ram_headroom_gib: headroom, expert_lfu: lfu,
  })
  const check = screen.getByRole('button', { name: 'Check model settings' })
  fireEvent.click(check)
  expect(engineCommand).toHaveBeenCalledExactlyOnceWith('quote', { host_id: 'host', body })
  expect(await screen.findByText(/Model file checked:/)).toBeVisible()
  await waitFor(() => expect(check).toBeEnabled())
  const launch = screen.getByRole('button', { name: 'Start model with these settings' })
  fireEvent.click(launch)
  await waitFor(() => expect(launch).toBeEnabled())
  expect(engineCommand).toHaveBeenNthCalledWith(2, 'launch', { host_id: 'host', body })
  expect(engineCommand).toHaveBeenCalledTimes(2)
})

it.each([300, 0, 768, 0.5])('forwards %s MB of GPU reserve unchanged to check and launch', async (mb) => {
  vi.mocked(engineCommand).mockResolvedValue(importedQuote)
  refreshHosts.mockReset().mockResolvedValue(undefined)
  render(<HostCard host={localHost} snapshot={importedModelSnapshot} />)
  await selectImportedModel()
  fireEvent.click(screen.getByText('Advanced model settings'))
  const reserve = screen.getByLabelText('GPU memory to keep free (MB)')
  expect(reserve).toHaveValue(300)
  expect(reserve).toHaveAccessibleDescription(/Raise this if other apps on this GPU, like your desktop or games, cause slowdowns/)
  fireEvent.change(reserve, { target: { value: String(mb) } })
  const body = expect.objectContaining({
    model_id: 'imported-model', gpu_uuids: ['GPU-one'], kv_arena_headroom_bytes: mb * 1024 ** 2,
  })
  const check = screen.getByRole('button', { name: 'Check model settings' })
  fireEvent.click(check)
  expect(engineCommand).toHaveBeenCalledExactlyOnceWith('quote', { host_id: 'host', body })
  await waitFor(() => expect(check).toBeEnabled())
  fireEvent.click(screen.getByRole('button', { name: 'Start model with these settings' }))
  await waitFor(() => expect(engineCommand).toHaveBeenCalledTimes(2))
  expect(engineCommand).toHaveBeenLastCalledWith('launch', { host_id: 'host', body })
})

it.each(['', '-1', '0.0000001', '8589934592'])('blocks invalid GPU reserve %s before checking or launching', async (input) => {
  render(<HostCard host={localHost} snapshot={importedModelSnapshot} />)
  await selectImportedModel()
  fireEvent.click(screen.getByText('Advanced model settings'))
  const reserve = screen.getByLabelText('GPU memory to keep free (MB)')
  fireEvent.change(reserve, { target: { value: input } })
  expect(screen.getByRole('alert')).toHaveTextContent('Enter GPU memory to keep free as a nonnegative number of MB')
  const check = screen.getByRole('button', { name: 'Check model settings' })
  const launch = screen.getByRole('button', { name: 'Start model with these settings' })
  expect(check).toBeDisabled()
  expect(launch).toBeDisabled()
  fireEvent.click(check)
  fireEvent.click(launch)
  expect(engineCommand).not.toHaveBeenCalled()
  fireEvent.change(reserve, { target: { value: '300' } })
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  expect(check).toBeEnabled()
  expect(launch).toBeEnabled()
})

it.each(['-1', '1.5', '9007199254740992'])('rejects invalid Flash headroom %s before checking or launching', async (input) => {
  render(<HostCard host={localHost} snapshot={importedModelSnapshot} />)
  await selectImportedModel()
  fireEvent.click(screen.getByText('Advanced model settings'))
  const memory = screen.getByLabelText('Computer memory headroom for Flash (GiB)')
  fireEvent.change(memory, { target: { value: input } })
  expect(screen.getByRole('alert')).toHaveTextContent('Flash computer-memory headroom must be a whole number of GiB, at least 0, or left blank')
  const check = screen.getByRole('button', { name: 'Check model settings' })
  const launch = screen.getByRole('button', { name: 'Start model with these settings' })
  expect(check).toBeDisabled()
  expect(launch).toBeDisabled()
  fireEvent.click(check)
  fireEvent.click(launch)
  expect(engineCommand).not.toHaveBeenCalled()
  fireEvent.change(memory, { target: { value: '0' } })
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  expect(check).toBeEnabled()
  expect(launch).toBeEnabled()
})

it('does not show a number error before a model is chosen, then reports an emptied context', async () => {
  render(<HostCard host={localHost} snapshot={importedModelSnapshot} />)
  fireEvent.click(screen.getByText('Model and memory settings'))
  fireEvent.click(screen.getByText('Choose model settings'))
  expect(screen.queryByText(/Use whole numbers/)).not.toBeInTheDocument()
  await userEvent.click(screen.getByLabelText('Installed model'))
  await userEvent.click(screen.getByRole('menuitemradio', { name: /Qwen 3.8 27B/ }))
  expect(screen.queryByText(/Use whole numbers/)).not.toBeInTheDocument()
  fireEvent.change(screen.getByLabelText('Conversation length (tokens)'), { target: { value: '' } })
  expect(screen.getByRole('alert')).toHaveTextContent('Use whole numbers')
})

it('labels the advanced launch fields with sentence-case names', () => {
  render(<HostCard host={localHost} snapshot={importedModelSnapshot} />)
  fireEvent.click(screen.getByText('Model and memory settings'))
  fireEvent.click(screen.getByText('Choose model settings'))
  fireEvent.click(screen.getByText('Advanced model settings'))
  for (const name of ['Draft ahead length (tokens)', 'Drafting graphics cards (TP)', 'Input batch size (tokens)']) expect(screen.getByLabelText(name)).toBeInTheDocument()
  expect(screen.queryByLabelText('draft tp')).not.toBeInTheDocument()
})

it.each(['running', 'cancelling'] as const)('allows an imported model quote and Load during %s optional completion', async (status) => {
  const data: EngineSnapshot = { ...importedModelSnapshot, hardware_profile: {
    status, scope: 'complete_remaining_formats', base_complete: true, scope_complete: false, all_formats_complete: false,
    pending_gpu_groups: [], stale_groups: [], gpu_uuids: ['GPU-one'], engine_path: '/bin/ginfer', job_id: 'job', pid: 42,
    reprofile: false, started_unix_ms: null, finished_unix_ms: null, profile_path: '/hardware.json',
    checkpoint_available: true, diagnostic_tail: '', error: null, available: true,
  } }
  vi.mocked(engineCommand).mockResolvedValue(importedQuote)
  const view = render(<HostCard host={localHost} snapshot={data} />)
  await selectImportedModel()
  expect(screen.getByRole('progressbar', { name: 'Graphics-card setup in progress' })).toBeInTheDocument()
  expect(screen.getByText(/Your selected model is ready to load/)).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Start model with these settings' })).toBeEnabled()
  fireEvent.click(screen.getByRole('button', { name: 'Check model settings' }))
  expect(await screen.findByText(/Model file checked: Qwen 3.8 27B — INT/)).toBeInTheDocument()
  await waitFor(() => expect(screen.getByRole('button', { name: 'Start model with these settings' })).toBeEnabled())
  refreshHosts.mockImplementationOnce(async () => {
    view.rerender(<HostCard host={localHost} snapshot={{ ...data, instances: [{
      instance_id: 'loaded', session_id: 'session', display_name: 'Imported model', upstream_model_id: 'model', status: 'starting',
      configuration: { gpu_uuids: ['GPU-one'], max_context: 262144, concurrency: 1 },
    }] }} />)
  })
  fireEvent.click(screen.getByRole('button', { name: 'Start model with these settings' }))
  expect(await screen.findByText(/Imported model.*Starting/)).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Stop model' })).toBeEnabled()
  expect(engineCommand).toHaveBeenLastCalledWith('launch', expect.objectContaining({ body: expect.objectContaining({ model_id: 'imported-model' }) }))
})

it.each([
  ['running', 'artifact'], ['cancelling', 'artifact'], ['running', 'all_formats'], ['cancelling', 'all_formats'],
] as const)('keeps imported model launch blocked during %s %s profiling', async (status, scope) => {
  render(<HostCard host={localHost} snapshot={{ ...importedModelSnapshot, hardware_profile: {
    status, scope, pending_gpu_groups: [], stale_groups: [], gpu_uuids: ['GPU-one'], engine_path: '/bin/ginfer', job_id: 'job', pid: 42,
    reprofile: false, started_unix_ms: null, finished_unix_ms: null, profile_path: '/hardware.json',
    checkpoint_available: true, diagnostic_tail: '', error: null, available: true,
  } }} />)
  await selectImportedModel()
  expect(screen.getByRole('button', { name: 'Check model settings' })).toBeDisabled()
  expect(screen.getByRole('button', { name: 'Start model with these settings' })).toBeDisabled()
  expect(engineCommand).not.toHaveBeenCalled()
})

it('invalidates an imported-model quote when the Host restarts at the same revision', async () => {
  vi.mocked(engineCommand).mockResolvedValue(importedQuote)
  const { rerender } = render(<HostCard host={localHost} snapshot={{ ...importedModelSnapshot, boot_id: 'first-boot' }} />)
  await selectImportedModel()
  fireEvent.click(screen.getByRole('button', { name: 'Check model settings' }))
  expect(await screen.findByRole('status')).toHaveTextContent('Model file checked:')
  rerender(<HostCard host={localHost} snapshot={{ ...importedModelSnapshot, boot_id: 'second-boot' }} />)
  expect(screen.queryByText(/Model file checked:/)).not.toBeInTheDocument()
  expect(engineCommand).toHaveBeenCalledTimes(1)
})

it('keeps a pending startup check through polling and displays its result', async () => {
  let finishQuote!: (quote: EngineStartupQuote) => void
  vi.mocked(engineCommand).mockReturnValueOnce(new Promise<EngineStartupQuote>(resolve => { finishQuote = resolve }))
  const snapshot: EngineSnapshot = { ...importedModelSnapshot, hardware_profile: {
    status: 'running', scope: 'complete_remaining_formats', base_complete: true, scope_complete: false, all_formats_complete: false,
    pending_gpu_groups: [], stale_groups: [], gpu_uuids: ['GPU-one'], engine_path: '/bin/ginfer', job_id: 'job', pid: 42,
    reprofile: false, started_unix_ms: 100, finished_unix_ms: null, profile_path: '/hardware.json',
    checkpoint_available: true, diagnostic_tail: '', error: null, available: true, elapsed_ms: 100,
  } }
  const { rerender } = render(<HostCard host={localHost} snapshot={snapshot} />)
  await selectImportedModel()
  fireEvent.click(screen.getByRole('button', { name: 'Check model settings' }))
  expect(screen.getByRole('button', { name: 'Check model settings' })).toBeDisabled()
  rerender(<HostCard host={localHost} snapshot={{ ...snapshot, revision: 2, hardware_profile: {
    ...snapshot.hardware_profile!, elapsed_ms: 200, diagnostic_tail: 'Profiling another format',
  } }} />)
  rerender(<HostCard host={localHost} snapshot={{ ...snapshot, revision: 3, hardware_profile: {
    ...snapshot.hardware_profile!, status: 'cancelled', finished_unix_ms: 300, diagnostic_tail: 'Yielded to startup check',
  } }} />)
  finishQuote(importedQuote)
  expect(await screen.findByText(/Model file checked: Qwen 3.8 27B — INT/)).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Check model settings' })).toBeEnabled()
  expect(engineCommand).toHaveBeenCalledExactlyOnceWith('quote', expect.objectContaining({ host_id: 'host' }))
})

it.each(['success', 'rejection'] as const)('keeps a completed startup-check %s through unrelated snapshot updates', async (outcome) => {
  if (outcome === 'success') vi.mocked(engineCommand).mockResolvedValueOnce(importedQuote)
  else vi.mocked(engineCommand).mockRejectedValueOnce('Not enough memory for these settings')
  const { rerender } = render(<HostCard host={localHost} snapshot={importedModelSnapshot} />)
  await selectImportedModel()
  fireEvent.click(screen.getByRole('button', { name: 'Check model settings' }))
  const message = outcome === 'success' ? /Model file checked: Qwen 3.8 27B — INT/ : /These model settings could not be checked/
  expect(await screen.findByText(message)).toBeInTheDocument()
  rerender(<HostCard host={localHost} snapshot={{ ...importedModelSnapshot, revision: 2,
    display_name: 'Renamed Host', management_notice: 'Management address updated',
    gpus: [{ ...importedModelSnapshot.gpus[0], display_name: 'Renamed GPU' }],
  }} />)
  rerender(<HostCard host={localHost} snapshot={{ ...importedModelSnapshot, revision: 3 }} />)
  expect(screen.getByText(message)).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Check model settings' })).toBeEnabled()
  expect(engineCommand).toHaveBeenCalledTimes(1)
})

it.each([
  ['Conversation length (tokens)', '32768'], ['Requests at once', '4'], ['Model copies', '2'],
  ['Reply speedup', 'auto'], ['Conversation memory format', 'int8'],
  ['Computer memory headroom for Flash (GiB)', '0'], ['Update the Flash expert cache', 'off'],
  ['GPU memory to keep free (MB)', '600'],
])('discards a pending startup check when %s changes', async (label, value) => {
  let finishQuote!: (quote: EngineStartupQuote) => void
  vi.mocked(engineCommand).mockReturnValueOnce(new Promise<EngineStartupQuote>(resolve => { finishQuote = resolve }))
  render(<HostCard host={localHost} snapshot={importedModelSnapshot} />)
  await selectImportedModel()
  fireEvent.click(screen.getByRole('button', { name: 'Check model settings' }))
  if (['Computer memory headroom for Flash (GiB)', 'Update the Flash expert cache', 'GPU memory to keep free (MB)'].includes(label)) fireEvent.click(screen.getByText('Advanced model settings'))
  if (label === 'Reply speedup' || label === 'Conversation memory format') {
    await userEvent.click(screen.getByLabelText(label))
    await userEvent.click(screen.getByRole('menuitemradio', { name: label === 'Reply speedup' ? 'Automatic' : 'INT8' }))
  } else if (label === 'Update the Flash expert cache') {
    fireEvent.click(screen.getByRole('checkbox', { name: label }))
  } else fireEvent.change(screen.getByLabelText(label), { target: { value } })
  finishQuote(importedQuote)
  await waitFor(() => expect(screen.getByRole('button', { name: 'Check model settings' })).toBeEnabled())
  expect(screen.queryByText(/Model file checked:/)).not.toBeInTheDocument()
  expect(engineCommand).toHaveBeenCalledTimes(1)
})

it.each([
  ['artifact identity', { ...importedModelSnapshot, models: [{ ...importedModelSnapshot.models[0], metadata: {
    ...importedModelSnapshot.models[0].metadata, identity: { model_id: 'qwen3.8-27b', weights_id: 'nvfp4' },
  } }] }],
  ['GPU capacity', { ...importedModelSnapshot, gpus: [{ ...importedModelSnapshot.gpus[0], memory_mib: 24576 }] }],
  ['instance placement', { ...importedModelSnapshot, instances: [{
    instance_id: 'other', session_id: 'session', display_name: 'Other instance', upstream_model_id: 'other', status: 'starting',
    configuration: { gpu_uuids: ['GPU-one'], max_context: 32768, concurrency: 1 },
  }] }],
] satisfies [string, EngineSnapshot][])('invalidates a completed and pending startup check when %s changes', async (_label, changed) => {
  vi.mocked(engineCommand).mockResolvedValueOnce(importedQuote)
  const { rerender } = render(<HostCard host={localHost} snapshot={importedModelSnapshot} />)
  await selectImportedModel()
  fireEvent.click(screen.getByRole('button', { name: 'Check model settings' }))
  expect(await screen.findByText(/Model file checked:/)).toBeInTheDocument()
  // These changes matter even if a Host reuses its snapshot revision.
  rerender(<HostCard host={localHost} snapshot={changed} />)
  expect(screen.queryByText(/Model file checked:/)).not.toBeInTheDocument()
  let finishQuote!: (quote: EngineStartupQuote) => void
  vi.mocked(engineCommand).mockReturnValueOnce(new Promise<EngineStartupQuote>(resolve => { finishQuote = resolve }))
  fireEvent.click(screen.getByRole('button', { name: 'Check model settings' }))
  rerender(<HostCard host={localHost} snapshot={importedModelSnapshot} />)
  finishQuote(importedQuote)
  await waitFor(() => expect(screen.getByRole('button', { name: 'Check model settings' })).toBeEnabled())
  expect(screen.queryByText(/Model file checked:/)).not.toBeInTheDocument()
  expect(engineCommand).toHaveBeenCalledTimes(2)
})

it('does not restore a completed or pending quote after changing settings and changing them back', async () => {
  vi.mocked(engineCommand).mockResolvedValue(importedQuote)
  render(<HostCard host={localHost} snapshot={importedModelSnapshot} />)
  await selectImportedModel()
  fireEvent.click(screen.getByRole('button', { name: 'Check model settings' }))
  expect(await screen.findByRole('status')).toHaveTextContent('Model file checked:')
  const context = screen.getByLabelText('Conversation length (tokens)')
  fireEvent.change(context, { target: { value: '32768' } })
  fireEvent.change(context, { target: { value: '262144' } })
  expect(screen.queryByText(/Model file checked:/)).not.toBeInTheDocument()
  let finishQuote!: (quote: EngineStartupQuote) => void
  vi.mocked(engineCommand).mockReturnValueOnce(new Promise<EngineStartupQuote>(resolve => { finishQuote = resolve }))
  fireEvent.click(screen.getByRole('button', { name: 'Check model settings' }))
  fireEvent.change(context, { target: { value: '32768' } })
  fireEvent.change(context, { target: { value: '262144' } })
  finishQuote(importedQuote)
  await waitFor(() => expect(screen.getByRole('button', { name: 'Check model settings' })).toBeEnabled())
  expect(screen.queryByText(/Model file checked:/)).not.toBeInTheDocument()
  expect(engineCommand).toHaveBeenCalledTimes(2)
})

it('ignores the hidden new-instance count when editing a saved instance', async () => {
  const profile = {
    model_id: 'imported-model', gpu_uuids: ['GPU-one'], max_context: 65536, concurrency: 1,
    vision: true, structured_outputs: true, spec: 'none' as const, draft_tokens: 0, draft_tp: 0,
    kv_dtype: 'auto' as const, kv_arena_bytes: null, host_kv_cache_bytes: null, prefill_chunk: 0, no_cuda_graph: false,
  }
  const snapshot: EngineSnapshot = { ...importedModelSnapshot, instances: [{
    instance_id: 'saved', session_id: null, display_name: 'Saved instance', upstream_model_id: 'model',
    status: 'stopped', configuration: profile, profile,
  }] }
  render(<HostCard host={localHost} snapshot={snapshot} />)
  await selectImportedModel()
  fireEvent.change(screen.getByLabelText('Model copies'), { target: { value: '0' } })
  expect(screen.getByRole('button', { name: 'Start model with these settings' })).toBeDisabled()
  fireEvent.click(screen.getByRole('button', { name: 'Edit settings' }))
  expect(screen.queryByLabelText('Model copies')).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Save and restart model' })).toBeEnabled()
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  expect(engineCommand).not.toHaveBeenCalled()
})

it('discards late quote results after settings change and reports a fresh Host rejection inline', async () => {
  let finishQuote!: (quote: EngineStartupQuote) => void
  vi.mocked(engineCommand).mockReturnValueOnce(new Promise<EngineStartupQuote>(resolve => { finishQuote = resolve }))
  render(<HostCard host={localHost} snapshot={importedModelSnapshot} />)
  await selectImportedModel()
  fireEvent.click(screen.getByRole('button', { name: 'Check model settings' }))
  fireEvent.change(screen.getByLabelText('Conversation length (tokens)'), { target: { value: '32768' } })
  finishQuote(importedQuote)
  await waitFor(() => expect(screen.getByRole('button', { name: 'Check model settings' })).toBeEnabled())
  expect(screen.queryByText(/Model file checked:/)).not.toBeInTheDocument()
  vi.mocked(engineCommand).mockRejectedValueOnce('artifact changed since inventory scan; refresh inventory before loading')
  fireEvent.click(screen.getByRole('button', { name: 'Check model settings' }))
  const alert = await screen.findByRole('alert')
  expect(alert).toHaveTextContent('These model settings could not be checked. Review your choices')
  const details = within(alert).getByText('artifact changed since inventory scan; refresh inventory before loading')
  expect(details).not.toBeVisible()
  fireEvent.click(within(alert).getByText('Technical details'))
  expect(details).toBeVisible()
  expect(engineCommand).toHaveBeenCalledTimes(2)
  expect(vi.mocked(engineCommand).mock.calls.every(([action]) => action === 'quote')).toBe(true)
})

it('keeps an accepted scan result through host-list refresh failure and read-only retries', async () => {
  const inventoryMessage = 'Some model files could not be read. Check that the files are available, then refresh the model list.'
  const initial: EngineSnapshot = { ...importedModelSnapshot, models: [], inventory_errors: [
    { path: '/local/renamed.ginfer', error: 'Temporary file read failure' },
  ] }
  const accepted: EngineSnapshot = { ...importedModelSnapshot, revision: 2, inventory_errors: [] }
  const refreshMessage = 'Could not refresh the host list. Choose Refresh host list to try again.'
  let finishScan!: (snapshot: EngineSnapshot) => void
  let rejectRefresh!: (reason: Error) => void
  let rejectRetry!: (reason: Error) => void
  vi.mocked(engineCommand).mockReset().mockReturnValueOnce(new Promise<EngineSnapshot>((resolve) => { finishScan = resolve }))
  refreshHosts.mockReset().mockResolvedValue(undefined)
    .mockImplementationOnce(() => new Promise<undefined>((_resolve, reject) => { rejectRefresh = reject }))
    .mockImplementationOnce(() => new Promise<undefined>((_resolve, reject) => { rejectRetry = reject }))
  const view = render(<HostCard host={localHost} snapshot={initial} />)
  publishSnapshot.mockImplementation((_hostId: string, snapshot: EngineSnapshot) => {
    view.rerender(<HostCard host={localHost} snapshot={snapshot} />)
  })
  fireEvent.click(screen.getByText('Model and memory settings'))
  fireEvent.click(screen.getByText('Choose model settings'))
  expect(screen.getByText(inventoryMessage)).toBeVisible()
  const scan = screen.getByRole('button', { name: 'Refresh model list' })
  expect(scan).toBeEnabled()
  fireEvent.click(scan)
  expect(scan).toBeDisabled()
  fireEvent.click(scan)
  expect(engineCommand).toHaveBeenCalledExactlyOnceWith('scan', { host_id: 'host' })
  expect(publishSnapshot).not.toHaveBeenCalled()
  expect(refreshHosts).not.toHaveBeenCalled()

  await act(async () => finishScan(accepted))
  await waitFor(() => expect(refreshHosts).toHaveBeenCalledOnce())
  await act(async () => rejectRefresh(new Error('Host list unavailable')))
  expect(publishSnapshot).toHaveBeenCalledExactlyOnceWith('host', accepted)
  expect(publishSnapshot.mock.invocationCallOrder[0]).toBeLessThan(refreshHosts.mock.invocationCallOrder[0])
  expect(screen.getByRole('status')).toHaveTextContent('Model list refreshed.')
  expect(screen.queryByText(inventoryMessage)).not.toBeInTheDocument()
  expect(screen.queryByText('/local/renamed.ginfer: Temporary file read failure')).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Refresh model list' })).not.toBeInTheDocument()
  expect(screen.queryByText(/Could not refresh the model list/)).not.toBeInTheDocument()
  expect(toast.error).not.toHaveBeenCalled()
  const feedback = screen.getByRole('alert')
  expect(feedback).toHaveTextContent(refreshMessage)
  expect(within(feedback).getByText('Error: Host list unavailable')).not.toBeVisible()
  expect(within(feedback).getByText('Host refresh error details').closest('details')).not.toHaveAttribute('open')
  await userEvent.click(screen.getByLabelText('Installed model'))
  expect(screen.getByRole('menuitemradio', { name: /Qwen 3.8 27B/ })).toBeVisible()
  await userEvent.keyboard('{Escape}')

  const refreshButton = within(feedback).getByRole('button', { name: 'Refresh host list' })
  fireEvent.click(refreshButton)
  expect(refreshButton).toBeDisabled()
  fireEvent.click(refreshButton)
  expect(refreshHosts).toHaveBeenCalledTimes(2)
  expect(engineCommand).toHaveBeenCalledExactlyOnceWith('scan', { host_id: 'host' })
  await act(async () => rejectRetry(new Error('Host list still unavailable')))
  expect(feedback).toHaveTextContent(refreshMessage)
  expect(within(feedback).getByText('Error: Host list still unavailable')).not.toBeVisible()
  expect(refreshButton).toBeEnabled()
  expect(screen.getByRole('status')).toHaveTextContent('Model list refreshed.')
  expect(screen.queryByText(inventoryMessage)).not.toBeInTheDocument()
  expect(toast.error).not.toHaveBeenCalled()

  fireEvent.click(refreshButton)
  await waitFor(() => expect(feedback).not.toBeInTheDocument())
  expect(screen.queryByRole('button', { name: 'Refresh host list' })).not.toBeInTheDocument()
  expect(screen.getByRole('status')).toHaveTextContent('Model list refreshed.')
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  expect(refreshHosts).toHaveBeenCalledTimes(3)
  expect(publishSnapshot).toHaveBeenCalledExactlyOnceWith('host', accepted)
  expect(engineCommand).toHaveBeenCalledExactlyOnceWith('scan', { host_id: 'host' })
  expect(toast.error).not.toHaveBeenCalled()
})

it('keeps a rejected scan result retryable without publishing or reading the host list', async () => {
  const initial: EngineSnapshot = { ...importedModelSnapshot, models: [], inventory_errors: [
    { path: '/local/renamed.ginfer', error: 'Temporary file read failure' },
  ] }
  const accepted: EngineSnapshot = { ...importedModelSnapshot, revision: 2, inventory_errors: [] }
  const failureMessage = 'Could not refresh the model list. Check that the model files are available, then try again.'
  let rejectScan!: (reason: Error) => void
  let finishRetry!: (snapshot: EngineSnapshot) => void
  vi.mocked(engineCommand).mockReset()
    .mockReturnValueOnce(new Promise<EngineSnapshot>((_resolve, reject) => { rejectScan = reject }))
    .mockReturnValueOnce(new Promise<EngineSnapshot>((resolve) => { finishRetry = resolve }))
  refreshHosts.mockReset().mockResolvedValue(undefined)
  const view = render(<HostCard host={localHost} snapshot={initial} />)
  publishSnapshot.mockImplementation((_hostId: string, snapshot: EngineSnapshot) => {
    view.rerender(<HostCard host={localHost} snapshot={snapshot} />)
  })
  fireEvent.click(screen.getByText('Model and memory settings'))
  fireEvent.click(screen.getByText('Choose model settings'))
  const scan = screen.getByRole('button', { name: 'Refresh model list' })
  fireEvent.click(scan)
  expect(scan).toBeDisabled()
  fireEvent.click(scan)
  expect(engineCommand).toHaveBeenCalledExactlyOnceWith('scan', { host_id: 'host' })
  await act(async () => rejectScan(new Error('Model directory is unavailable')))
  const feedback = screen.getByText(failureMessage).closest<HTMLElement>('[role="alert"]')!
  expect(feedback).toBeVisible()
  const diagnostic = within(feedback).getByText('Error: Model directory is unavailable')
  expect(diagnostic).not.toBeVisible()
  expect(diagnostic.closest('details')).not.toHaveAttribute('open')
  fireEvent.click(within(feedback).getByText('Technical details'))
  expect(diagnostic).toBeVisible()
  expect(scan).toBeEnabled()
  expect(screen.getByText(/Some model files could not be read/)).toBeVisible()
  expect(publishSnapshot).not.toHaveBeenCalled()
  expect(refreshHosts).not.toHaveBeenCalled()
  expect(toast.error).toHaveBeenCalledExactlyOnceWith(failureMessage)
  expect(screen.queryByRole('button', { name: 'Refresh host list' })).not.toBeInTheDocument()
  expect(screen.queryByText('Model list refreshed.')).not.toBeInTheDocument()

  fireEvent.click(scan)
  expect(scan).toBeDisabled()
  expect(screen.queryByText(failureMessage)).not.toBeInTheDocument()
  fireEvent.click(scan)
  expect(engineCommand).toHaveBeenCalledTimes(2)
  expect(engineCommand).toHaveBeenNthCalledWith(2, 'scan', { host_id: 'host' })
  expect(publishSnapshot).not.toHaveBeenCalled()
  expect(refreshHosts).not.toHaveBeenCalled()
  await act(async () => finishRetry(accepted))
  expect(await screen.findByRole('status')).toHaveTextContent('Model list refreshed.')
  expect(publishSnapshot).toHaveBeenCalledExactlyOnceWith('host', accepted)
  expect(refreshHosts).toHaveBeenCalledOnce()
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Refresh model list' })).not.toBeInTheDocument()
  expect(toast.error).toHaveBeenCalledExactlyOnceWith(failureMessage)
})

it('keeps a saved remote host passive until its Connect button is used', async () => {
  const host = { local: false, host_id: 'remote', name: 'Saved server', base_url: 'https://host', certificate_sha256: '', client_id: 'client' }
  const error = 'Connect this saved host to unlock its credential for this session'
  vi.mocked(engineCommand).mockReset().mockResolvedValueOnce({ ...importedModelSnapshot, host_id: host.host_id, display_name: host.name })
  render(<HostCard host={host} error={error} />)
  expect(screen.getByText(/Choose Connect to use this saved computer/)).toBeInTheDocument()
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Connect' })).toBeEnabled()
  expect(engineCommand).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Connect' }))
  await waitFor(() => expect(engineCommand).toHaveBeenCalledWith('connect', { host_id: 'remote' }))
  await waitFor(() => expect(screen.getByRole('button', { name: 'Connect' })).toBeEnabled())
})

it('keeps an accepted Connect result through host-list refresh failure and read-only retries', async () => {
  const host = { ...localHost, local: false, host_id: 'remote', name: 'Saved server' }
  const accepted: EngineSnapshot = {
    host_id: 'remote', display_name: 'Saved server', revision: 2, instances: [], gpus: [], models: [],
  }
  const refreshMessage = 'Could not refresh the host list. Choose Refresh host list to try again.'
  let finishConnect!: (snapshot: EngineSnapshot) => void
  let rejectRefresh!: (reason: Error) => void
  let rejectRetry!: (reason: Error) => void
  vi.mocked(engineCommand).mockReset().mockReturnValueOnce(new Promise<EngineSnapshot>((resolve) => { finishConnect = resolve }))
  refreshHosts.mockReset().mockResolvedValue(undefined)
    .mockImplementationOnce(() => new Promise<undefined>((_resolve, reject) => { rejectRefresh = reject }))
    .mockImplementationOnce(() => new Promise<undefined>((_resolve, reject) => { rejectRetry = reject }))
  const view = render(<HostCard host={host} error="Connect this saved host to unlock its credential for this session" />)
  publishSnapshot.mockImplementation((_hostId: string, snapshot: EngineSnapshot) => {
    view.rerender(<HostCard host={host} snapshot={snapshot} />)
  })
  const connect = screen.getByRole('button', { name: 'Connect' })
  fireEvent.click(connect)
  expect(connect).toBeDisabled()
  fireEvent.click(connect)
  expect(engineCommand).toHaveBeenCalledExactlyOnceWith('connect', { host_id: 'remote' })
  expect(publishSnapshot).not.toHaveBeenCalled()
  expect(refreshHosts).not.toHaveBeenCalled()

  await act(async () => finishConnect(accepted))
  await waitFor(() => expect(refreshHosts).toHaveBeenCalledOnce())
  expect(screen.getByRole('button', { name: 'Remove connection' })).toBeDisabled()

  await act(async () => rejectRefresh(new Error('Host list unavailable')))
  expect(publishSnapshot).toHaveBeenCalledExactlyOnceWith('remote', accepted)
  expect(publishSnapshot.mock.invocationCallOrder[0]).toBeLessThan(refreshHosts.mock.invocationCallOrder[0])
  expect(screen.getByRole('status')).toHaveTextContent('Connected to Saved server.')
  expect(screen.getByText(`${host.base_url} · Connected`)).toBeVisible()
  expect(screen.queryByRole('button', { name: 'Connect' })).not.toBeInTheDocument()
  expect(screen.queryByText(/Connection did not finish/)).not.toBeInTheDocument()
  const feedback = screen.getByRole('alert')
  expect(feedback).toHaveTextContent(refreshMessage)
  const diagnostic = within(feedback).getByText('Error: Host list unavailable')
  expect(diagnostic).not.toBeVisible()
  expect(within(feedback).getByText('Host refresh error details').closest('details')).not.toHaveAttribute('open')
  expect(screen.getByRole('status')).toHaveTextContent('Connected to Saved server.')
  expect(screen.queryByText(/Connection did not finish/)).not.toBeInTheDocument()
  const refreshButton = within(feedback).getByRole('button', { name: 'Refresh host list' })
  expect(refreshButton).toBeEnabled()
  fireEvent.click(refreshButton)
  expect(refreshButton).toBeDisabled()
  fireEvent.click(refreshButton)
  expect(refreshHosts).toHaveBeenCalledTimes(2)
  expect(engineCommand).toHaveBeenCalledExactlyOnceWith('connect', { host_id: 'remote' })
  await act(async () => rejectRetry(new Error('Host list still unavailable')))
  expect(feedback).toHaveTextContent(refreshMessage)
  expect(within(feedback).getByText('Error: Host list still unavailable')).not.toBeVisible()
  expect(refreshButton).toBeEnabled()
  expect(screen.getByRole('status')).toHaveTextContent('Connected to Saved server.')
  expect(screen.getByText(`${host.base_url} · Connected`)).toBeVisible()
  expect(screen.queryByRole('button', { name: 'Connect' })).not.toBeInTheDocument()

  fireEvent.click(refreshButton)
  await waitFor(() => expect(feedback).not.toBeInTheDocument())
  expect(screen.queryByRole('button', { name: 'Refresh host list' })).not.toBeInTheDocument()
  expect(screen.getByRole('status')).toHaveTextContent('Connected to Saved server.')
  expect(screen.getByText(`${host.base_url} · Connected`)).toBeVisible()
  expect(screen.queryByRole('button', { name: 'Connect' })).not.toBeInTheDocument()
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  expect(refreshHosts).toHaveBeenCalledTimes(3)
  expect(publishSnapshot).toHaveBeenCalledExactlyOnceWith('remote', accepted)
  expect(engineCommand).toHaveBeenCalledExactlyOnceWith('connect', { host_id: 'remote' })
})

it.each(['TLS credential unavailable: keyring locked', 'Connection timed out'])('keeps a rejected Connect result retryable with unlock and network guidance: %s', async (diagnostic) => {
  const host = { ...localHost, local: false, host_id: 'remote', name: 'Saved server' }
  const accepted: EngineSnapshot = {
    host_id: 'remote', display_name: 'Saved server', revision: 2, instances: [], gpus: [], models: [],
  }
  let rejectConnect!: (reason: string) => void
  let finishRetry!: (snapshot: EngineSnapshot) => void
  vi.mocked(engineCommand).mockReset()
    .mockReturnValueOnce(new Promise<EngineSnapshot>((_resolve, reject) => { rejectConnect = reject }))
    .mockReturnValueOnce(new Promise<EngineSnapshot>((resolve) => { finishRetry = resolve }))
  refreshHosts.mockReset().mockResolvedValue(undefined)
  const view = render(<HostCard host={host} />)
  publishSnapshot.mockImplementation((_hostId: string, snapshot: EngineSnapshot) => {
    view.rerender(<HostCard host={host} snapshot={snapshot} />)
  })
  const connect = screen.getByRole('button', { name: 'Connect' })
  fireEvent.click(connect)
  expect(connect).toBeDisabled()
  fireEvent.click(connect)
  expect(engineCommand).toHaveBeenCalledExactlyOnceWith('connect', { host_id: 'remote' })
  await act(async () => rejectConnect(diagnostic))
  const alert = await screen.findByRole('alert')
  expect(alert).toHaveTextContent('Connection did not finish. Choose Connect to try again. If asked, unlock secure storage on this computer so GChat can use the saved sign-in. If you still cannot connect, check that the other computer is on and reachable.')
  const details = within(alert).getByText(diagnostic)
  expect(details).not.toBeVisible()
  expect(details.closest('details')).not.toHaveAttribute('open')
  fireEvent.click(within(alert).getByText('Technical details'))
  expect(details).toBeVisible()
  expect(connect).toBeEnabled()
  expect(screen.getByText(host.name)).toBeVisible()
  expect(screen.queryByText(/Connected to Saved server/)).not.toBeInTheDocument()
  expect(publishSnapshot).not.toHaveBeenCalled()
  expect(refreshHosts).not.toHaveBeenCalled()
  expect(screen.queryByRole('button', { name: 'Refresh host list' })).not.toBeInTheDocument()
  expect(screen.queryByText('Connected to Saved server.')).not.toBeInTheDocument()

  fireEvent.click(connect)
  expect(connect).toBeDisabled()
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  fireEvent.click(connect)
  expect(engineCommand).toHaveBeenCalledTimes(2)
  expect(engineCommand).toHaveBeenNthCalledWith(2, 'connect', { host_id: 'remote' })
  expect(publishSnapshot).not.toHaveBeenCalled()
  expect(refreshHosts).not.toHaveBeenCalled()
  await act(async () => finishRetry(accepted))
  await waitFor(() => expect(screen.getByText(`${host.base_url} · Connected`)).toBeVisible())
  expect(publishSnapshot).toHaveBeenCalledExactlyOnceWith('remote', accepted)
  expect(refreshHosts).toHaveBeenCalledOnce()
  expect(screen.getByRole('status')).toHaveTextContent('Connected to Saved server.')
  expect(screen.queryByRole('button', { name: 'Connect' })).not.toBeInTheDocument()
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
})

it.each([
  { label: 'without a credential cleanup warning', cleanupWarning: null },
  { label: 'with a credential cleanup warning', cleanupWarning: 'The private keyring is locked' },
])('keeps successful removal distinct from a failed refresh $label', async ({ cleanupWarning }) => {
  const refreshMessage = 'Could not refresh the host list. Choose Refresh host list to try again.'
  const cleanupMessage = 'The saved connection was removed, but its saved sign-in could not be cleared from this computer.'
  let rejectRetry!: (reason: Error) => void
  vi.mocked(engineCommand).mockReset().mockResolvedValue({ forgotten: 'host', credential_cleanup_warning: cleanupWarning })
  refreshHosts.mockReset().mockResolvedValue(undefined)
    .mockRejectedValueOnce(new Error('Host list unavailable'))
    .mockImplementationOnce(() => new Promise<undefined>((_resolve, reject) => { rejectRetry = reject }))
  render(<HostCard host={{ ...localHost, local: false }} snapshot={importedModelSnapshot} error="Computer temporarily unavailable" />)
  expect(screen.getByRole('button', { name: 'Connect' })).toBeEnabled()
  expect(screen.getByText('Model and memory settings')).toBeInTheDocument()

  fireEvent.click(screen.getByRole('button', { name: 'Remove connection' }))
  expect(useConfirmStore.getState().pending).toMatchObject({
    title: 'Remove the connection to Host?', confirmLabel: 'Remove connection', destructive: true,
  })
  await act(async () => settleConfirm(true))
  await waitFor(() => expect(refreshHosts).toHaveBeenCalledOnce())
  expect(engineCommand).toHaveBeenCalledExactlyOnceWith('forget', { host_id: 'host' })
  expect(await screen.findByRole('status')).toHaveTextContent('The saved connection was removed.')
  expect(screen.getByRole('heading', { name: 'Host' })).toBeInTheDocument()
  expect(screen.getByText(refreshMessage)).toBeVisible()
  expect(screen.queryByText('Could not remove this saved connection. Try again.')).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Remove connection' })).toBeDisabled()
  expect(screen.queryByRole('button', { name: 'Connect' })).not.toBeInTheDocument()
  expect(screen.queryByText('Model and memory settings')).not.toBeInTheDocument()
  expect(screen.queryByLabelText('Installed model')).not.toBeInTheDocument()
  expect(screen.getAllByRole('alert')).toHaveLength(cleanupWarning ? 2 : 1)
  if (cleanupWarning) {
    expect(screen.getByText(cleanupMessage)).toBeVisible()
    const details = screen.getByText(cleanupWarning)
    expect(details).not.toBeVisible()
    fireEvent.click(screen.getByText('Technical details'))
    expect(details).toBeVisible()
  } else expect(screen.queryByText(cleanupMessage)).not.toBeInTheDocument()

  fireEvent.click(screen.getByRole('button', { name: 'Remove connection' }))
  expect(useConfirmStore.getState().pending).toBeNull()
  expect(engineCommand).toHaveBeenCalledTimes(1)
  const refreshButton = screen.getByRole('button', { name: 'Refresh host list' })
  expect(refreshButton).toBeEnabled()
  fireEvent.click(refreshButton)
  expect(refreshButton).toBeDisabled()
  fireEvent.click(refreshButton)
  expect(refreshHosts).toHaveBeenCalledTimes(2)
  await act(async () => rejectRetry(new Error('Host list still unavailable')))
  expect(screen.getByText(refreshMessage)).toBeVisible()
  expect(screen.getByText('Error: Host list still unavailable')).not.toBeVisible()
  expect(screen.getByRole('button', { name: 'Refresh host list' })).toBeEnabled()
  expect(screen.getByRole('status')).toHaveTextContent('The saved connection was removed.')
  expect(screen.getByRole('button', { name: 'Remove connection' })).toBeDisabled()
  expect(screen.queryByRole('button', { name: 'Connect' })).not.toBeInTheDocument()
  expect(engineCommand).toHaveBeenCalledExactlyOnceWith('forget', { host_id: 'host' })
  if (cleanupWarning) expect(screen.getByText(cleanupMessage)).toBeVisible()

  fireEvent.click(screen.getByRole('button', { name: 'Refresh host list' }))
  await waitFor(() => expect(screen.queryByText(refreshMessage)).not.toBeInTheDocument())
  expect(refreshHosts).toHaveBeenCalledTimes(3)
  expect(screen.queryByRole('button', { name: 'Refresh host list' })).not.toBeInTheDocument()
  expect(screen.queryByText('Error: Host list still unavailable')).not.toBeInTheDocument()
  expect(screen.getByRole('status')).toHaveTextContent('The saved connection was removed.')
  expect(screen.getByRole('button', { name: 'Remove connection' })).toBeDisabled()
  expect(screen.queryByRole('button', { name: 'Connect' })).not.toBeInTheDocument()
  expect(screen.queryAllByRole('alert')).toHaveLength(cleanupWarning ? 1 : 0)
  if (cleanupWarning) {
    expect(screen.getByText(cleanupMessage)).toBeVisible()
    expect(screen.getByText(cleanupWarning)).toBeVisible()
  }
  expect(engineCommand).toHaveBeenCalledExactlyOnceWith('forget', { host_id: 'host' })
})

it('keeps a rejected removal available for an explicitly confirmed retry', async () => {
  vi.mocked(engineCommand).mockReset().mockResolvedValue({ forgotten: 'host' })
    .mockRejectedValueOnce(new Error('Registry write denied'))
  refreshHosts.mockReset().mockResolvedValue(undefined)
  render(<HostCard host={{ ...localHost, local: false }} />)
  fireEvent.click(screen.getByRole('button', { name: 'Remove connection' }))
  await act(async () => settleConfirm(true))
  const alert = await screen.findByRole('alert')
  expect(alert).toHaveTextContent('Could not remove this saved connection. Try again.')
  const details = within(alert).getByText('Error: Registry write denied')
  expect(details).not.toBeVisible()
  fireEvent.click(within(alert).getByText('Technical details'))
  expect(details).toBeVisible()
  expect(screen.getByRole('button', { name: 'Remove connection' })).toBeEnabled()
  expect(screen.getByRole('button', { name: 'Connect' })).toBeEnabled()
  expect(screen.queryByRole('button', { name: 'Refresh host list' })).not.toBeInTheDocument()
  expect(refreshHosts).not.toHaveBeenCalled()
  expect(engineCommand).toHaveBeenCalledExactlyOnceWith('forget', { host_id: 'host' })

  fireEvent.click(screen.getByRole('button', { name: 'Remove connection' }))
  expect(useConfirmStore.getState().pending).toMatchObject({ confirmLabel: 'Remove connection' })
  await act(async () => settleConfirm(false))
  expect(engineCommand).toHaveBeenCalledTimes(1)
  expect(refreshHosts).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Remove connection' }))
  expect(useConfirmStore.getState().pending).toMatchObject({ confirmLabel: 'Remove connection' })
  await act(async () => settleConfirm(true))
  await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument())
  expect(engineCommand).toHaveBeenCalledTimes(2)
  expect(engineCommand).toHaveBeenNthCalledWith(2, 'forget', { host_id: 'host' })
  expect(refreshHosts).toHaveBeenCalledOnce()
})

it('explains the effect of restarting a remote model and honors cancellation before sending', async () => {
  render(<HostCard host={{ ...localHost, local: false }} snapshot={{ ...importedModelSnapshot, instances: [{
    instance_id: 'running', session_id: 'session', display_name: 'My model', upstream_model_id: 'imported-model', status: 'ready',
    configuration: { gpu_uuids: ['GPU-one'], max_context: 65536, concurrency: 1 },
  }] }} />)
  expect(screen.getByText(/My model.*Ready to chat/)).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Restart model' }))
  expect(useConfirmStore.getState().pending).toMatchObject({
    title: 'Restart this model?',
    message: 'The model will finish its current replies, then restart with its saved settings. It will be unavailable for new chats while restarting.',
  })
  await act(async () => settleConfirm(false))
  expect(engineCommand).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Restart model' }))
  await act(async () => settleConfirm(true))
  expect(engineCommand).toHaveBeenCalledExactlyOnceWith('restart', {
    host_id: 'host', instance_id: 'running', body: { force: false, expected_session_id: 'session' },
  })
})

it('shows separate management and LAN ports as notices while preserving sharing errors', () => {
  const host = { local: true, host_id: 'host', name: 'Host', base_url: 'https://host', certificate_sha256: '', client_id: 'client' }
  const managementNotice = 'Another Host owns the preferred management port. This Host uses port 41235.'
  const lanNotice = 'This Host uses saved port 41236 for LAN sharing.'
  const sharingError = 'A later LAN advertisement failed.'
  const snapshot: EngineSnapshot = {
    host_id: 'host', display_name: 'Host', revision: 1, gpus: [], models: [], instances: [],
    management_notice: managementNotice,
    lan_sharing: {
      managed: true, enabled: true, active: true, port: 41236,
      notice: lanNotice,
      error: sharingError,
    },
  }
  render(<HostCard host={host} snapshot={snapshot} />)
  expect(screen.getByText('GChat is using a different connection address to manage models on this computer.')).toHaveAttribute('role', 'status')
  expect(screen.getByText('Network sharing is using a saved connection address.')).toHaveAttribute('role', 'status')
  expect(screen.getByText(/Network sharing needs attention/)).toHaveAttribute('role', 'alert')
  for (const detail of [managementNotice, lanNotice, sharingError]) {
    expect(screen.getByText(detail).closest('details')).not.toHaveAttribute('open')
  }
  expect(screen.getByText(/Other computers on your network can connect after you pair/)).toBeInTheDocument()
})

it.each([
  ['qwen3.8-27b', 262144],
  ['qwen3.8-flash-next', 262144],
  ['muse-glimmer-30b', 131072],
])('launches %s at native context by default and preserves an explicit custom value', async (target, nativeContext) => {
  const host = { local: true, host_id: 'host', name: 'Host', base_url: 'https://host', certificate_sha256: '', client_id: 'client' }
  const snapshot: EngineSnapshot = {
    host_id: 'host', display_name: 'Host', revision: 1,
    gpus: [{ uuid: 'GPU-one', name: 'Fixture GPU', memory_mib: 32607, compute_capability: '12.0' }],
    models: [{ id: 'model', path: '/model.ginfer', artifact_set: false,
      metadata: { identity: { model_id: target, weights_id: 'nvfp4' }, tp_size: 1, draft_tp: 0, size_bytes: 1024 } }],
    instances: [], launch_profiles: [],
  }
  render(<HostCard host={host} snapshot={snapshot} />)
  expect(screen.getByRole('region', { name: 'First-run setup for host' })).toBeInTheDocument()
  fireEvent.click(screen.getByText('Model and memory settings'))
  fireEvent.click(screen.getByText('Choose model settings'))
  expect(screen.getByLabelText('Conversation length (tokens)')).toHaveDisplayValue('')
  expect(screen.getByRole('button', { name: 'Start model with these settings' })).toBeDisabled()
  await userEvent.click(screen.getByLabelText('Installed model'))
  await userEvent.click(screen.getByRole('menuitemradio', { name: target === 'muse-glimmer-30b' ? /Muse 30B/ : target === 'qwen3.8-flash-next' ? /Qwen 3.8 Flash/ : /Qwen 3.8 27B/ }))
  expect(screen.getByLabelText('Conversation length (tokens)')).toHaveValue(nativeContext)
  fireEvent.click(screen.getByRole('button', { name: 'Start model with these settings' }))
  await waitFor(() => expect(engineCommand).toHaveBeenCalledWith('launch', expect.objectContaining({
    body: expect.objectContaining({ model_id: 'model', max_context: nativeContext }),
  })))
  await waitFor(() => expect(screen.getByRole('button', { name: 'Start model with these settings' })).toBeEnabled())
  fireEvent.change(screen.getByLabelText('Conversation length (tokens)'), { target: { value: '65536' } })
  fireEvent.click(screen.getByRole('button', { name: 'Start model with these settings' }))
  await waitFor(() => expect(engineCommand).toHaveBeenLastCalledWith('launch', expect.objectContaining({
    body: expect.objectContaining({ max_context: 65536 }),
  })))
})

it('explains the busy GPU while the Host finishes speed tuning after Stop', () => {
  const job = { key: 'k', model_id: 'm', gpu_uuids: ['GPU-one'], max_context: 4096, concurrency: 1,
    status: 'running' as const, pid: 7, error: null, diagnostic_tail: '' }
  const { rerender } = render(<HostCard host={localHost} snapshot={{ ...importedModelSnapshot, draft_width_calibrations: [job] }} />)
  expect(screen.getByText(/Finishing graphics-card speed tuning \(about 1 minute\)/)).toBeVisible()
  rerender(<HostCard host={localHost} snapshot={{ ...importedModelSnapshot, draft_width_calibrations: [{ ...job, status: 'queued' }] }} />)
  expect(screen.queryByText(/Finishing graphics-card speed tuning/)).not.toBeInTheDocument()
})

const savedModelProfile = {
  model_id: 'imported-model', gpu_uuids: ['GPU-one'], max_context: 65536, concurrency: 1,
  vision: true, structured_outputs: true, spec: 'none' as const, draft_tokens: 0, draft_tp: 0,
  kv_dtype: 'auto' as const, kv_arena_bytes: null, host_kv_cache_bytes: null, prefill_chunk: 0, no_cuda_graph: false,
}

it.each(['quote', 'launch', 'instance'] as const)('shows the actual post-attach reserve failure and recovery for %s', async (source) => {
  const reason = 'final KV arena violates physical headroom on rank 0; free_bytes=209715200; headroom_bytes=314572800'
  const diagnostic = `engine exited unexpectedly: exit status: 1\n${reason}`
  const snapshot: EngineSnapshot = source === 'instance' ? { ...importedModelSnapshot, instances: [{
    instance_id: 'failed', session_id: null, display_name: 'Failed model', upstream_model_id: 'imported-model',
    status: 'failed', configuration: { ...savedModelProfile, kv_arena_bytes: 1073741824 },
    profile: { ...savedModelProfile, kv_arena_bytes: 1073741824 }, last_error: diagnostic,
  }] } : importedModelSnapshot
  vi.mocked(engineCommand).mockRejectedValue(new Error(diagnostic))
  render(<HostCard host={localHost} snapshot={snapshot} />)
  if (source === 'instance') fireEvent.click(screen.getByText('Model and memory settings'))
  else {
    await selectImportedModel()
    fireEvent.click(screen.getByRole('button', { name: source === 'quote' ? 'Check model settings' : 'Start model with these settings' }))
  }
  expect(await screen.findByText(reason, { exact: true })).toBeVisible()
  expect(screen.getByText(/The model could not keep your chosen GPU memory free/)).toBeVisible()
  const alert = screen.getByRole('alert')
  expect(within(alert).getByText('Technical details').closest('details')).not.toHaveAttribute('open')
  expect(within(alert).getByText(source === 'instance' ? diagnostic : `Error: ${diagnostic}`, { exact: true, normalizer: (text) => text })).not.toBeVisible()
  if (source !== 'instance') expect(screen.getByRole('button', { name: source === 'quote' ? 'Check model settings' : 'Start model with these settings' })).toBeEnabled()
})

it.each([undefined, 0, 1024, 4096 / 1024 ** 2])('inherits saved GPU reserve %s MB and applies edits only through confirmed reload', async (mb) => {
  const profile = { ...savedModelProfile, ...(mb === undefined ? {} : { kv_arena_headroom_bytes: mb * 1024 ** 2 }) }
  const snapshot: EngineSnapshot = { ...importedModelSnapshot, instances: [{
    instance_id: 'saved', session_id: 'session', display_name: 'Saved model', upstream_model_id: 'imported-model', status: 'ready',
    configuration: profile, profile,
  }] }
  vi.mocked(engineCommand).mockResolvedValue(snapshot)
  refreshHosts.mockReset().mockResolvedValue(undefined)
  render(<HostCard host={localHost} snapshot={snapshot} />)
  fireEvent.click(screen.getByText('Model and memory settings'))
  fireEvent.click(screen.getByRole('button', { name: 'Edit settings' }))
  fireEvent.click(screen.getByText('Advanced model settings'))
  const reserve = screen.getByLabelText('GPU memory to keep free (MB)')
  expect(reserve).toHaveValue(mb ?? 300)
  const save = screen.getByRole('button', { name: 'Save and restart model' })
  expect(save).toBeEnabled()
  expect(engineCommand).not.toHaveBeenCalled()
  fireEvent.change(reserve, { target: { value: '-1' } })
  expect(save).toBeDisabled()
  fireEvent.change(reserve, { target: { value: '700' } })
  expect(save).toBeEnabled()
  expect(engineCommand).not.toHaveBeenCalled()
  fireEvent.click(save)
  expect(useConfirmStore.getState().pending).toMatchObject({ title: 'Save and restart this model?' })
  await act(async () => settleConfirm(false))
  expect(engineCommand).not.toHaveBeenCalled()
  expect(reserve).toHaveValue(700)
  fireEvent.click(save)
  await act(async () => settleConfirm(true))
  expect(engineCommand).toHaveBeenCalledExactlyOnceWith('reload', { host_id: 'host', instance_id: 'saved', body: {
    configuration: expect.objectContaining({ kv_arena_headroom_bytes: 700 * 1024 ** 2 }), expected_session_id: 'session',
  } })
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Save and restart model' })).not.toBeInTheDocument())
})

it.each([
  { name: 'omitted settings', options: {}, headroom: null, lfu: true },
  { name: 'explicit zero and LFU off', options: { flash_host_ram_headroom_gib: 0, expert_lfu: false }, headroom: 0, lfu: false },
  { name: 'chosen headroom and LFU on', options: { flash_host_ram_headroom_gib: 8, expert_lfu: true }, headroom: 8, lfu: true },
])('preserves $name when editing and reloading a saved model', async ({ options, headroom, lfu }) => {
  const profile = { ...savedModelProfile, ...options }
  const snapshot: EngineSnapshot = { ...importedModelSnapshot, instances: [{
    instance_id: 'saved', session_id: 'session', display_name: 'Saved model', upstream_model_id: 'imported-model', status: 'ready',
    configuration: profile, profile,
  }] }
  vi.mocked(engineCommand).mockResolvedValue(snapshot)
  refreshHosts.mockReset().mockResolvedValue(undefined)
  render(<HostCard host={localHost} snapshot={snapshot} />)
  fireEvent.click(screen.getByText('Model and memory settings'))
  fireEvent.click(screen.getByRole('button', { name: 'Edit settings' }))
  fireEvent.click(screen.getByText('Advanced model settings'))
  const memory = screen.getByLabelText('Computer memory headroom for Flash (GiB)')
  expect(memory).toHaveValue(headroom)
  expect(screen.getByRole('checkbox', { name: 'Update the Flash expert cache' })).toHaveProperty('checked', lfu)
  fireEvent.change(screen.getByLabelText('Conversation length (tokens)'), { target: { value: '32768' } })
  const save = screen.getByRole('button', { name: 'Save and restart model' })
  fireEvent.change(memory, { target: { value: '0.5' } })
  expect(save).toBeDisabled()
  fireEvent.click(save)
  expect(engineCommand).not.toHaveBeenCalled()
  fireEvent.change(memory, { target: { value: headroom === null ? '' : String(headroom) } })
  expect(save).toBeEnabled()
  fireEvent.click(save)
  expect(useConfirmStore.getState().pending).toMatchObject({ title: 'Save and restart this model?' })
  expect(engineCommand).not.toHaveBeenCalled()
  await act(async () => settleConfirm(true))
  expect(engineCommand).toHaveBeenCalledExactlyOnceWith('reload', { host_id: 'host', instance_id: 'saved', body: {
    configuration: expect.objectContaining({ max_context: 32768, flash_host_ram_headroom_gib: headroom, expert_lfu: lfu }),
    expected_session_id: 'session',
  } })
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Save and restart model' })).not.toBeInTheDocument())
})

it.each([
  { action: 'start', label: 'Start model', initialStatus: 'stopped', acceptedStatus: 'starting', result: 'Model start requested.' },
  { action: 'stop', label: 'Stop model', initialStatus: 'ready', acceptedStatus: 'stopped', result: 'Model stop requested.' },
  { action: 'restart', label: 'Restart model', initialStatus: 'ready', acceptedStatus: 'starting', result: 'Model restart requested.' },
  { action: 'reload', label: 'Save and restart model', initialStatus: 'ready', acceptedStatus: 'starting', result: 'Model settings saved; restart requested.' },
] as const)('keeps an accepted $action model control result through failed reads and read-only retries', async ({ action, label, initialStatus, acceptedStatus, result }) => {
  const initial: EngineSnapshot = { ...importedModelSnapshot, instances: [{
    instance_id: 'saved', session_id: initialStatus === 'stopped' ? null : 'session',
    display_name: 'Saved model', upstream_model_id: 'imported-model', status: initialStatus,
    configuration: savedModelProfile, profile: savedModelProfile,
  }] }
  const acceptedProfile = action === 'reload' ? { ...savedModelProfile, max_context: 32768 } : savedModelProfile
  const accepted: EngineSnapshot = { ...initial, revision: 2, instances: [{
    ...initial.instances[0], session_id: action === 'stop' ? null : 'next-session', status: acceptedStatus,
    configuration: acceptedProfile, profile: acceptedProfile,
  }] }
  let finishCommand!: (snapshot: EngineSnapshot) => void
  let rejectRefresh!: (reason: Error) => void
  let rejectRetry!: (reason: Error) => void
  vi.mocked(engineCommand).mockReset().mockReturnValueOnce(new Promise<EngineSnapshot>((resolve) => { finishCommand = resolve }))
  refreshHosts.mockReset().mockResolvedValue(undefined)
    .mockImplementationOnce(() => new Promise<undefined>((_resolve, reject) => { rejectRefresh = reject }))
    .mockImplementationOnce(() => new Promise<undefined>((_resolve, reject) => { rejectRetry = reject }))
  const view = render(<HostCard host={localHost} snapshot={initial} />)
  publishSnapshot.mockImplementation((_hostId: string, snapshot: EngineSnapshot) => {
    view.rerender(<HostCard host={localHost} snapshot={snapshot} />)
  })
  if (action === 'reload') {
    fireEvent.click(screen.getByText('Model and memory settings'))
    fireEvent.click(screen.getByRole('button', { name: 'Edit settings' }))
    fireEvent.change(screen.getByLabelText('Conversation length (tokens)'), { target: { value: '32768' } })
  }
  const control = screen.getByRole('button', { name: label })
  expect(control).toBeEnabled()
  fireEvent.click(control)
  if (action === 'restart' || action === 'reload') {
    expect(useConfirmStore.getState().pending).toMatchObject({
      title: action === 'restart' ? 'Restart this model?' : 'Save and restart this model?',
      confirmLabel: action === 'restart' ? 'Restart model' : 'Save and restart',
    })
    expect(engineCommand).not.toHaveBeenCalled()
    await act(async () => settleConfirm(true))
  }
  expect(control).toBeDisabled()
  fireEvent.click(control)
  expect(engineCommand).toHaveBeenCalledExactlyOnceWith(action, {
    host_id: 'host', instance_id: 'saved', body: action === 'start' ? {}
      : action === 'reload' ? { configuration: expect.objectContaining(acceptedProfile), expected_session_id: 'session' }
        : { force: false, expected_session_id: 'session' },
  })
  expect(publishSnapshot).not.toHaveBeenCalled()
  expect(refreshHosts).not.toHaveBeenCalled()

  await act(async () => finishCommand(accepted))
  await waitFor(() => expect(refreshHosts).toHaveBeenCalledOnce())
  expect(control).toBeDisabled()
  fireEvent.click(control)
  expect(engineCommand).toHaveBeenCalledOnce()
  await act(async () => rejectRefresh(new Error('Host list unavailable')))
  expect(publishSnapshot).toHaveBeenCalledExactlyOnceWith('host', accepted)
  expect(publishSnapshot.mock.invocationCallOrder[0]).toBeLessThan(refreshHosts.mock.invocationCallOrder[0])
  expect(screen.getByRole('status')).toHaveTextContent(result)
  expect(screen.getByText(action === 'stop' ? /Saved model.*Stopped/ : /Saved model.*Starting/)).toBeVisible()
  expect(screen.queryByText(/Saved model.*Ready to chat/)).not.toBeInTheDocument()
  expect(screen.queryByText(/Could not (start|stop|restart) this model/)).not.toBeInTheDocument()
  expect(toast.error).not.toHaveBeenCalled()
  const feedback = screen.getByRole('alert')
  expect(feedback).toHaveTextContent('Could not refresh the host list. Choose Refresh host list to try again.')
  expect(within(feedback).getByText('Error: Host list unavailable')).not.toBeVisible()
  expect(within(feedback).getByText('Host refresh error details').closest('details')).not.toHaveAttribute('open')

  const refreshButton = within(feedback).getByRole('button', { name: 'Refresh host list' })
  fireEvent.click(refreshButton)
  expect(refreshButton).toBeDisabled()
  fireEvent.click(refreshButton)
  expect(refreshHosts).toHaveBeenCalledTimes(2)
  expect(engineCommand).toHaveBeenCalledOnce()
  await act(async () => rejectRetry(new Error('Host list still unavailable')))
  expect(within(feedback).getByText('Error: Host list still unavailable')).not.toBeVisible()
  expect(refreshButton).toBeEnabled()
  expect(screen.getByRole('status')).toHaveTextContent(result)
  fireEvent.click(refreshButton)
  await waitFor(() => expect(feedback).not.toBeInTheDocument())
  expect(screen.queryByRole('button', { name: 'Refresh host list' })).not.toBeInTheDocument()
  expect(screen.getByRole('status')).toHaveTextContent(result)
  expect(refreshHosts).toHaveBeenCalledTimes(3)
  expect(engineCommand).toHaveBeenCalledOnce()
  expect(publishSnapshot).toHaveBeenCalledExactlyOnceWith('host', accepted)
  expect(toast.error).not.toHaveBeenCalled()
})

it('keeps a multi-copy launch model control result despite a failed first read without publishing receipts', async () => {
  type Receipt = { instance_id: string; kv_arena_bytes: number }
  let finishFirst!: (receipt: Receipt) => void
  let finishSecond!: (receipt: Receipt) => void
  let rejectRefresh!: (reason: Error) => void
  vi.mocked(engineCommand).mockReset()
    .mockReturnValueOnce(new Promise<Receipt>((resolve) => { finishFirst = resolve }))
    .mockReturnValueOnce(new Promise<Receipt>((resolve) => { finishSecond = resolve }))
  refreshHosts.mockReset().mockResolvedValue(undefined)
    .mockImplementationOnce(() => new Promise<undefined>((_resolve, reject) => { rejectRefresh = reject }))
    .mockRejectedValueOnce(new Error('Host list still unavailable'))
  render(<HostCard host={localHost} snapshot={importedModelSnapshot} />)
  await selectImportedModel()
  fireEvent.change(screen.getByLabelText('Model copies'), { target: { value: '2' } })
  fireEvent.change(screen.getByLabelText('Conversation length (tokens)'), { target: { value: '65536' } })
  const launch = screen.getByRole('button', { name: 'Start model with these settings' })
  fireEvent.click(launch)
  expect(launch).toBeDisabled()
  fireEvent.click(launch)
  expect(engineCommand).toHaveBeenCalledExactlyOnceWith('launch', { host_id: 'host', body: expect.objectContaining({
    model_id: 'imported-model', gpu_uuids: ['GPU-one'], max_context: 65536, remaining_instances: 2,
  }) })
  expect(refreshHosts).not.toHaveBeenCalled()
  await act(async () => finishFirst({ instance_id: 'copy-one', kv_arena_bytes: 1048576 }))
  await waitFor(() => expect(refreshHosts).toHaveBeenCalledOnce())
  expect(launch).toBeDisabled()
  fireEvent.click(launch)
  expect(engineCommand).toHaveBeenCalledOnce()
  await act(async () => rejectRefresh(new Error('Host list unavailable')))
  await waitFor(() => expect(engineCommand).toHaveBeenCalledTimes(2))
  expect(engineCommand).toHaveBeenNthCalledWith(2, 'launch', { host_id: 'host', body: expect.objectContaining({
    model_id: 'imported-model', gpu_uuids: ['GPU-one'], max_context: 65536, remaining_instances: 1,
  }) })
  expect(launch).toBeDisabled()
  fireEvent.click(launch)
  expect(engineCommand).toHaveBeenCalledTimes(2)
  expect(publishSnapshot).not.toHaveBeenCalled()
  await act(async () => finishSecond({ instance_id: 'copy-two', kv_arena_bytes: 1048576 }))
  await waitFor(() => expect(launch).toBeEnabled())
  expect(refreshHosts).toHaveBeenCalledTimes(2)
  expect(screen.getByRole('status')).toHaveTextContent('Model start requested.')
  expect(screen.queryByText(/Ready to chat/)).not.toBeInTheDocument()
  expect(screen.queryByText(/Could not start this model/)).not.toBeInTheDocument()
  const feedback = screen.getByRole('alert')
  expect(feedback).toHaveTextContent('Could not refresh the host list. Choose Refresh host list to try again.')
  expect(within(feedback).getByText('Error: Host list still unavailable')).not.toBeVisible()
  expect(within(feedback).getByText('Host refresh error details').closest('details')).not.toHaveAttribute('open')
  expect(publishSnapshot).not.toHaveBeenCalled()
  expect(toast.error).not.toHaveBeenCalled()
  expect(toast.warning).not.toHaveBeenCalled()
  fireEvent.click(within(feedback).getByRole('button', { name: 'Refresh host list' }))
  await waitFor(() => expect(feedback).not.toBeInTheDocument())
  expect(refreshHosts).toHaveBeenCalledTimes(3)
  expect(engineCommand).toHaveBeenCalledTimes(2)
  expect(publishSnapshot).not.toHaveBeenCalled()
  expect(screen.getByRole('status')).toHaveTextContent('Model start requested.')
  expect(toast.error).not.toHaveBeenCalled()
  expect(toast.warning).not.toHaveBeenCalled()
})

it('keeps a rejected start model control result actionable until an explicit guarded retry is accepted', async () => {
  const initial: EngineSnapshot = { ...importedModelSnapshot, instances: [{
    instance_id: 'saved', session_id: null, display_name: 'Saved model', upstream_model_id: 'imported-model', status: 'stopped',
    configuration: savedModelProfile, profile: savedModelProfile,
  }] }
  const accepted: EngineSnapshot = { ...initial, revision: 2, instances: [{
    ...initial.instances[0], session_id: 'next-session', status: 'starting',
  }] }
  const failureMessage = 'Could not start this model. Check its settings and available graphics-card memory, then try again.'
  let rejectStart!: (reason: Error) => void
  let finishRetry!: (snapshot: EngineSnapshot) => void
  vi.mocked(engineCommand).mockReset()
    .mockReturnValueOnce(new Promise<EngineSnapshot>((_resolve, reject) => { rejectStart = reject }))
    .mockReturnValueOnce(new Promise<EngineSnapshot>((resolve) => { finishRetry = resolve }))
  refreshHosts.mockReset().mockResolvedValue(undefined)
  const view = render(<HostCard host={localHost} snapshot={initial} />)
  publishSnapshot.mockImplementation((_hostId: string, snapshot: EngineSnapshot) => {
    view.rerender(<HostCard host={localHost} snapshot={snapshot} />)
  })
  const start = screen.getByRole('button', { name: 'Start model' })
  expect(start).toBeEnabled()
  fireEvent.click(start)
  expect(start).toBeDisabled()
  fireEvent.click(start)
  expect(engineCommand).toHaveBeenCalledExactlyOnceWith('start', { host_id: 'host', instance_id: 'saved', body: {} })
  await act(async () => rejectStart(new Error('Insufficient graphics-card memory')))
  const feedback = screen.getByRole('alert')
  expect(feedback).toHaveTextContent(failureMessage)
  const diagnostic = within(feedback).getByText('Error: Insufficient graphics-card memory')
  expect(diagnostic).not.toBeVisible()
  expect(diagnostic.closest('details')).not.toHaveAttribute('open')
  fireEvent.click(within(feedback).getByText('Technical details'))
  expect(diagnostic).toBeVisible()
  expect(screen.getByText(/Saved model.*Stopped/)).toBeVisible()
  expect(start).toBeEnabled()
  expect(publishSnapshot).not.toHaveBeenCalled()
  expect(refreshHosts).not.toHaveBeenCalled()
  expect(screen.queryByRole('status')).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Refresh host list' })).not.toBeInTheDocument()
  expect(toast.error).toHaveBeenCalledExactlyOnceWith(failureMessage)

  fireEvent.click(start)
  expect(start).toBeDisabled()
  expect(feedback).not.toBeInTheDocument()
  fireEvent.click(start)
  expect(engineCommand).toHaveBeenCalledTimes(2)
  expect(engineCommand).toHaveBeenNthCalledWith(2, 'start', { host_id: 'host', instance_id: 'saved', body: {} })
  expect(publishSnapshot).not.toHaveBeenCalled()
  expect(refreshHosts).not.toHaveBeenCalled()
  await act(async () => finishRetry(accepted))
  expect(await screen.findByRole('status')).toHaveTextContent('Model start requested.')
  expect(screen.getByText(/Saved model.*Starting/)).toBeVisible()
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  expect(screen.queryByText('Error: Insufficient graphics-card memory')).not.toBeInTheDocument()
  expect(publishSnapshot).toHaveBeenCalledExactlyOnceWith('host', accepted)
  expect(refreshHosts).toHaveBeenCalledOnce()
  expect(engineCommand).toHaveBeenCalledTimes(2)
  expect(toast.error).toHaveBeenCalledExactlyOnceWith(failureMessage)
})

it('completes an accepted model editor save result after a failed read and reopens with the replacement session', async () => {
  const initial: EngineSnapshot = { ...importedModelSnapshot, instances: [{
    instance_id: 'saved', session_id: 'session-one', display_name: 'Saved model', upstream_model_id: 'imported-model', status: 'ready',
    configuration: savedModelProfile, profile: savedModelProfile,
  }] }
  const firstProfile = { ...savedModelProfile, max_context: 32768, concurrency: 2 }
  const firstAccepted: EngineSnapshot = { ...initial, revision: 2, instances: [{
    ...initial.instances[0], session_id: 'session-two', status: 'starting', configuration: firstProfile, profile: firstProfile,
  }] }
  const secondProfile = { ...firstProfile, max_context: 16384 }
  const secondAccepted: EngineSnapshot = { ...firstAccepted, revision: 3, instances: [{
    ...firstAccepted.instances[0], session_id: 'session-three', configuration: secondProfile, profile: secondProfile,
  }] }
  let finishFirst!: (snapshot: EngineSnapshot) => void
  let finishSecond!: (snapshot: EngineSnapshot) => void
  let rejectRefresh!: (reason: Error) => void
  vi.mocked(engineCommand).mockReset()
    .mockReturnValueOnce(new Promise<EngineSnapshot>((resolve) => { finishFirst = resolve }))
    .mockReturnValueOnce(new Promise<EngineSnapshot>((resolve) => { finishSecond = resolve }))
  refreshHosts.mockReset().mockResolvedValue(undefined)
    .mockImplementationOnce(() => new Promise<undefined>((_resolve, reject) => { rejectRefresh = reject }))
  const view = render(<HostCard host={localHost} snapshot={initial} />)
  publishSnapshot.mockImplementation((_hostId: string, snapshot: EngineSnapshot) => {
    view.rerender(<HostCard host={localHost} snapshot={snapshot} />)
  })
  fireEvent.click(screen.getByText('Model and memory settings'))
  fireEvent.click(screen.getByRole('button', { name: 'Edit settings' }))
  fireEvent.change(screen.getByLabelText('Conversation length (tokens)'), { target: { value: '32768' } })
  fireEvent.change(screen.getByLabelText('Requests at once'), { target: { value: '2' } })
  const save = screen.getByRole('button', { name: 'Save and restart model' })
  fireEvent.click(save)
  expect(useConfirmStore.getState().pending).toMatchObject({ title: 'Save and restart this model?', confirmLabel: 'Save and restart' })
  expect(engineCommand).not.toHaveBeenCalled()
  await act(async () => settleConfirm(true))
  expect(save).toBeDisabled()
  fireEvent.click(save)
  expect(engineCommand).toHaveBeenCalledExactlyOnceWith('reload', { host_id: 'host', instance_id: 'saved', body: {
    configuration: expect.objectContaining(firstProfile), expected_session_id: 'session-one',
  } })
  await act(async () => finishFirst(firstAccepted))
  await waitFor(() => expect(refreshHosts).toHaveBeenCalledOnce())
  await act(async () => rejectRefresh(new Error('Host list unavailable')))
  expect(publishSnapshot).toHaveBeenCalledExactlyOnceWith('host', firstAccepted)
  expect(publishSnapshot.mock.invocationCallOrder[0]).toBeLessThan(refreshHosts.mock.invocationCallOrder[0])
  expect(screen.getByRole('status')).toHaveTextContent('Model settings saved; restart requested.')
  expect(screen.queryByRole('button', { name: 'Save and restart model' })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Cancel editing' })).not.toBeInTheDocument()
  expect(screen.getByText('Choose model settings').closest('details')).not.toHaveAttribute('open')
  expect(screen.queryByText(/^Changing .*Saved model/)).not.toBeInTheDocument()
  const readFeedback = screen.getByRole('alert')
  expect(readFeedback).toHaveTextContent('Could not refresh the host list. Choose Refresh host list to try again.')
  expect(within(readFeedback).getByText('Error: Host list unavailable')).not.toBeVisible()
  expect(toast.error).not.toHaveBeenCalled()

  fireEvent.click(screen.getByRole('button', { name: 'Edit settings' }))
  expect(screen.getByText('Change model settings').closest('details')).toHaveAttribute('open')
  expect(screen.getByLabelText('Conversation length (tokens)')).toHaveValue(32768)
  expect(screen.getByLabelText('Requests at once')).toHaveValue(2)
  fireEvent.change(screen.getByLabelText('Conversation length (tokens)'), { target: { value: '16384' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save and restart model' }))
  expect(useConfirmStore.getState().pending).toMatchObject({ title: 'Save and restart this model?' })
  await act(async () => settleConfirm(true))
  expect(engineCommand).toHaveBeenCalledTimes(2)
  expect(engineCommand).toHaveBeenNthCalledWith(2, 'reload', { host_id: 'host', instance_id: 'saved', body: {
    configuration: expect.objectContaining(secondProfile), expected_session_id: 'session-two',
  } })
  await act(async () => finishSecond(secondAccepted))
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Save and restart model' })).not.toBeInTheDocument())
  expect(screen.getByText('Choose model settings').closest('details')).not.toHaveAttribute('open')
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  expect(screen.getByRole('status')).toHaveTextContent('Model settings saved; restart requested.')
  expect(screen.getByText(/Saved model.*Starting/)).toBeVisible()
  expect(publishSnapshot).toHaveBeenNthCalledWith(2, 'host', secondAccepted)
  expect(refreshHosts).toHaveBeenCalledTimes(2)
  expect(engineCommand).toHaveBeenCalledTimes(2)
  expect(toast.error).not.toHaveBeenCalled()
})

it('retains a canceled or rejected model editor save result draft until an explicit retry is accepted', async () => {
  const initial: EngineSnapshot = { ...importedModelSnapshot, instances: [{
    instance_id: 'saved', session_id: 'session-one', display_name: 'Saved model', upstream_model_id: 'imported-model', status: 'ready',
    configuration: savedModelProfile, profile: savedModelProfile,
  }] }
  const draft = { ...savedModelProfile, max_context: 32768, concurrency: 2 }
  const accepted: EngineSnapshot = { ...initial, revision: 2, instances: [{
    ...initial.instances[0], session_id: 'session-two', status: 'starting', configuration: draft, profile: draft,
  }] }
  let rejectSave!: (reason: Error) => void
  let finishRetry!: (snapshot: EngineSnapshot) => void
  vi.mocked(engineCommand).mockReset()
    .mockReturnValueOnce(new Promise<EngineSnapshot>((_resolve, reject) => { rejectSave = reject }))
    .mockReturnValueOnce(new Promise<EngineSnapshot>((resolve) => { finishRetry = resolve }))
  refreshHosts.mockReset().mockResolvedValue(undefined)
  const view = render(<HostCard host={localHost} snapshot={initial} />)
  publishSnapshot.mockImplementation((_hostId: string, snapshot: EngineSnapshot) => {
    view.rerender(<HostCard host={localHost} snapshot={snapshot} />)
  })
  fireEvent.click(screen.getByText('Model and memory settings'))
  fireEvent.click(screen.getByRole('button', { name: 'Edit settings' }))
  fireEvent.change(screen.getByLabelText('Conversation length (tokens)'), { target: { value: '32768' } })
  fireEvent.change(screen.getByLabelText('Requests at once'), { target: { value: '2' } })
  const save = screen.getByRole('button', { name: 'Save and restart model' })
  fireEvent.click(save)
  expect(useConfirmStore.getState().pending).toMatchObject({ title: 'Save and restart this model?' })
  await act(async () => settleConfirm(false))
  expect(save).toBeEnabled()
  expect(screen.getByText('Change model settings').closest('details')).toHaveAttribute('open')
  expect(screen.getByLabelText('Conversation length (tokens)')).toHaveValue(32768)
  expect(screen.getByLabelText('Requests at once')).toHaveValue(2)
  expect(engineCommand).not.toHaveBeenCalled()
  expect(publishSnapshot).not.toHaveBeenCalled()
  expect(refreshHosts).not.toHaveBeenCalled()

  fireEvent.click(save)
  await act(async () => settleConfirm(true))
  expect(save).toBeDisabled()
  fireEvent.click(save)
  expect(engineCommand).toHaveBeenCalledExactlyOnceWith('reload', { host_id: 'host', instance_id: 'saved', body: {
    configuration: expect.objectContaining(draft), expected_session_id: 'session-one',
  } })
  await act(async () => rejectSave(new Error('Assigned engine session has changed')))
  const failureMessage = 'Could not restart this model. Check the settings and try again.'
  const feedback = screen.getByRole('alert')
  expect(feedback).toHaveTextContent(failureMessage)
  expect(within(feedback).getByText('Error: Assigned engine session has changed')).not.toBeVisible()
  expect(within(feedback).getByText('Technical details').closest('details')).not.toHaveAttribute('open')
  expect(save).toBeEnabled()
  expect(screen.getByRole('button', { name: 'Cancel editing' })).toBeEnabled()
  expect(screen.getByText('Change model settings').closest('details')).toHaveAttribute('open')
  expect(screen.getByLabelText('Conversation length (tokens)')).toHaveValue(32768)
  expect(screen.getByLabelText('Requests at once')).toHaveValue(2)
  expect(screen.getByText(/Saved model.*Ready to chat/)).toBeVisible()
  expect(publishSnapshot).not.toHaveBeenCalled()
  expect(refreshHosts).not.toHaveBeenCalled()

  fireEvent.click(save)
  await act(async () => settleConfirm(true))
  expect(save).toBeDisabled()
  expect(feedback).not.toBeInTheDocument()
  fireEvent.click(save)
  expect(engineCommand).toHaveBeenCalledTimes(2)
  expect(engineCommand).toHaveBeenNthCalledWith(2, 'reload', { host_id: 'host', instance_id: 'saved', body: {
    configuration: expect.objectContaining(draft), expected_session_id: 'session-one',
  } })
  await act(async () => finishRetry(accepted))
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Save and restart model' })).not.toBeInTheDocument())
  expect(screen.queryByRole('button', { name: 'Cancel editing' })).not.toBeInTheDocument()
  expect(screen.getByText('Choose model settings').closest('details')).not.toHaveAttribute('open')
  expect(screen.getByRole('status')).toHaveTextContent('Model settings saved; restart requested.')
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  expect(publishSnapshot).toHaveBeenCalledExactlyOnceWith('host', accepted)
  expect(refreshHosts).toHaveBeenCalledOnce()
  expect(engineCommand).toHaveBeenCalledTimes(2)
  expect(toast.error).toHaveBeenCalledExactlyOnceWith(failureMessage)
})

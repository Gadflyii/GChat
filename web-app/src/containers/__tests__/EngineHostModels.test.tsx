import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import { HostCard } from '../EngineHostModels'
import { engineCommand, type EngineSnapshot, type EngineStartupQuote } from '@/services/engines'
import { settleConfirm, useConfirmStore } from '@/lib/confirm'

const { refreshHosts } = vi.hoisted(() => ({ refreshHosts: vi.fn().mockResolvedValue(undefined) }))

vi.mock('@/services/engines', async (original) => ({
  ...await original<typeof import('@/services/engines')>(),
  engineCommand: vi.fn().mockResolvedValue({}),
}))
vi.mock('@/stores/engine-hosts-store', () => ({ useEngineHosts: () => refreshHosts }))
vi.mock('../EngineProfilePicker', () => ({ EngineProfilePicker: () => null }))
vi.mock('../EngineFirstRun', () => ({ EngineFirstRun: ({ hostId, hardwareProfileControls }: { hostId: string; hardwareProfileControls?: ReactNode }) => <section aria-label={`First-run setup for ${hostId}`}>{hardwareProfileControls}</section> }))
afterEach(() => { cleanup(); settleConfirm(false); vi.clearAllMocks() })

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

it('keeps local hardware controls in setup and remote hardware controls directly accessible', async () => {
  const snapshot: EngineSnapshot = { ...importedModelSnapshot, hardware_profile: {
    status: 'running', pending_gpu_groups: [], stale_groups: [], gpu_uuids: ['GPU-one'],
    engine_path: '/bin/ginfer', job_id: 'job', pid: 42, reprofile: false,
    started_unix_ms: null, finished_unix_ms: null, profile_path: '/hardware.json',
    checkpoint_available: true, diagnostic_tail: '', error: null, available: true,
  } }
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
])('discards a pending startup check when %s changes', async (label, value) => {
  let finishQuote!: (quote: EngineStartupQuote) => void
  vi.mocked(engineCommand).mockReturnValueOnce(new Promise<EngineStartupQuote>(resolve => { finishQuote = resolve }))
  render(<HostCard host={localHost} snapshot={importedModelSnapshot} />)
  await selectImportedModel()
  fireEvent.click(screen.getByRole('button', { name: 'Check model settings' }))
  if (label === 'Reply speedup' || label === 'Conversation memory format') {
    await userEvent.click(screen.getByLabelText(label))
    await userEvent.click(screen.getByRole('menuitemradio', { name: label === 'Reply speedup' ? 'Automatic' : 'INT8' }))
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

it('keeps a saved remote host passive until its Connect button is used', async () => {
  const host = { local: false, host_id: 'remote', name: 'Saved server', base_url: 'https://host', certificate_sha256: '', client_id: 'client' }
  const error = 'Connect this saved host to unlock its credential for this session'
  render(<HostCard host={host} error={error} />)
  expect(screen.getByText(/Choose Connect to use this saved computer/)).toBeInTheDocument()
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Connect' })).toBeEnabled()
  expect(engineCommand).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Connect' }))
  await waitFor(() => expect(engineCommand).toHaveBeenCalledWith('connect', { host_id: 'remote' }))
  await waitFor(() => expect(screen.getByRole('button', { name: 'Connect' })).toBeEnabled())
})

it('explains a remote connection failure, preserves its details and allows retry', async () => {
  vi.mocked(engineCommand).mockRejectedValueOnce('TLS credential unavailable: keyring locked')
  render(<HostCard host={{ ...localHost, local: false }} />)
  fireEvent.click(screen.getByRole('button', { name: 'Connect' }))
  const alert = await screen.findByRole('alert')
  expect(alert).toHaveTextContent('Could not connect to this computer. Check that it is on and reachable, then try Connect again.')
  const details = within(alert).getByText('TLS credential unavailable: keyring locked')
  expect(details).not.toBeVisible()
  fireEvent.click(within(alert).getByText('Technical details'))
  expect(details).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: 'Connect' }))
  await waitFor(() => expect(engineCommand).toHaveBeenCalledTimes(2))
  await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument())
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
  await userEvent.click(screen.getByRole('menuitemradio', { name: target === 'muse-glimmer-30b' ? /Muse Glimmer/ : target === 'qwen3.8-flash-next' ? /Flash Next/ : /Qwen 3.8 27B/ }))
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

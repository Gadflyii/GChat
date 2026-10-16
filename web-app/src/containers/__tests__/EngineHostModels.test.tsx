import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { HostCard } from '../EngineHostModels'
import { engineCommand, type EngineSnapshot, type EngineStartupQuote } from '@/services/engines'

vi.mock('@/services/engines', async (original) => ({
  ...await original<typeof import('@/services/engines')>(),
  engineCommand: vi.fn().mockResolvedValue({}),
}))
vi.mock('@/stores/engine-hosts-store', () => ({ useEngineHosts: () => vi.fn().mockResolvedValue(undefined) }))
vi.mock('../EngineProfilePicker', () => ({ EngineProfilePicker: () => null }))
vi.mock('../EngineFirstRun', () => ({ EngineFirstRun: ({ hostId }: { hostId: string }) => <section aria-label={`First-run setup for ${hostId}`} /> }))
afterEach(() => { cleanup(); vi.clearAllMocks() })

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
function selectImportedModel() {
  fireEvent.click(screen.getByText('Server details'))
  fireEvent.click(screen.getByText('Custom server settings'))
  fireEvent.change(screen.getByLabelText('Custom model'), { target: { value: 'imported-model' } })
}

it('checks imported artifact settings without a catalog or download and uses the same count when launching', async () => {
  vi.mocked(engineCommand).mockResolvedValue(importedQuote)
  render(<HostCard host={localHost} snapshot={importedModelSnapshot} />)
  selectImportedModel()
  fireEvent.change(screen.getByLabelText('Instances'), { target: { value: '2' } })
  fireEvent.change(screen.getByLabelText('Concurrent requests'), { target: { value: '4' } })
  fireEvent.change(screen.getByLabelText('Context tokens'), { target: { value: '65536' } })
  fireEvent.click(screen.getByLabelText('Structured outputs'))
  fireEvent.change(screen.getByLabelText('Host KV cache (bytes, blank = automatic, 0 = disabled)'), { target: { value: '0' } })
  fireEvent.click(screen.getByRole('button', { name: 'Check startup settings' }))
  const body = expect.objectContaining({ model_id: 'imported-model', gpu_uuids: ['GPU-one'], remaining_instances: 2,
    max_context: 65536, concurrency: 4, structured_outputs: false, kv_arena_bytes: null, host_kv_cache_bytes: 0 })
  await waitFor(() => expect(engineCommand).toHaveBeenCalledWith('quote', { host_id: 'host', body }))
  expect(await screen.findByRole('status')).toHaveTextContent('Verified artifact: qwen3.8-27b / int8')
  expect(screen.getByRole('status')).toHaveTextContent('2 instance(s)')
  expect(engineCommand).toHaveBeenCalledTimes(1)
  await waitFor(() => expect(screen.getByRole('button', { name: 'Load model' })).toBeEnabled())
  fireEvent.click(screen.getByRole('button', { name: 'Load model' }))
  await waitFor(() => expect(engineCommand).toHaveBeenCalledTimes(3))
  expect(engineCommand).toHaveBeenNthCalledWith(2, 'launch', { host_id: 'host', body })
  expect(engineCommand).toHaveBeenNthCalledWith(3, 'launch', expect.objectContaining({
    body: expect.objectContaining({ model_id: 'imported-model', remaining_instances: 1, kv_arena_bytes: null }),
  }))
})

it('invalidates an imported-model quote when the Host restarts at the same revision', async () => {
  vi.mocked(engineCommand).mockResolvedValue(importedQuote)
  const { rerender } = render(<HostCard host={localHost} snapshot={{ ...importedModelSnapshot, boot_id: 'first-boot' }} />)
  selectImportedModel()
  fireEvent.click(screen.getByRole('button', { name: 'Check startup settings' }))
  expect(await screen.findByRole('status')).toHaveTextContent('Verified artifact:')
  rerender(<HostCard host={localHost} snapshot={{ ...importedModelSnapshot, boot_id: 'second-boot' }} />)
  expect(screen.queryByText(/Verified artifact:/)).not.toBeInTheDocument()
  expect(engineCommand).toHaveBeenCalledTimes(1)
})

it('does not restore a completed or pending quote after changing settings and changing them back', async () => {
  vi.mocked(engineCommand).mockResolvedValue(importedQuote)
  render(<HostCard host={localHost} snapshot={importedModelSnapshot} />)
  selectImportedModel()
  fireEvent.click(screen.getByRole('button', { name: 'Check startup settings' }))
  expect(await screen.findByRole('status')).toHaveTextContent('Verified artifact:')
  const context = screen.getByLabelText('Context tokens')
  fireEvent.change(context, { target: { value: '32768' } })
  fireEvent.change(context, { target: { value: '262144' } })
  expect(screen.queryByText(/Verified artifact:/)).not.toBeInTheDocument()
  let finishQuote!: (quote: EngineStartupQuote) => void
  vi.mocked(engineCommand).mockReturnValueOnce(new Promise<EngineStartupQuote>(resolve => { finishQuote = resolve }))
  fireEvent.click(screen.getByRole('button', { name: 'Check startup settings' }))
  fireEvent.change(context, { target: { value: '32768' } })
  fireEvent.change(context, { target: { value: '262144' } })
  finishQuote(importedQuote)
  await waitFor(() => expect(screen.getByRole('button', { name: 'Check startup settings' })).toBeEnabled())
  expect(screen.queryByText(/Verified artifact:/)).not.toBeInTheDocument()
  expect(engineCommand).toHaveBeenCalledTimes(2)
})

it('ignores the hidden new-instance count when editing a saved instance', () => {
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
  selectImportedModel()
  fireEvent.change(screen.getByLabelText('Instances'), { target: { value: '0' } })
  expect(screen.getByRole('button', { name: 'Load model' })).toBeDisabled()
  fireEvent.click(screen.getByRole('button', { name: 'Edit settings' }))
  expect(screen.queryByLabelText('Instances')).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Apply settings and reload' })).toBeEnabled()
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  expect(engineCommand).not.toHaveBeenCalled()
})

it('discards late quote results after settings change and reports a fresh Host rejection inline', async () => {
  let finishQuote!: (quote: EngineStartupQuote) => void
  vi.mocked(engineCommand).mockReturnValueOnce(new Promise<EngineStartupQuote>(resolve => { finishQuote = resolve }))
  render(<HostCard host={localHost} snapshot={importedModelSnapshot} />)
  selectImportedModel()
  fireEvent.click(screen.getByRole('button', { name: 'Check startup settings' }))
  fireEvent.change(screen.getByLabelText('Context tokens'), { target: { value: '32768' } })
  finishQuote(importedQuote)
  await waitFor(() => expect(screen.getByRole('button', { name: 'Check startup settings' })).toBeEnabled())
  expect(screen.queryByText(/Verified artifact:/)).not.toBeInTheDocument()
  vi.mocked(engineCommand).mockRejectedValueOnce('artifact changed since inventory scan; refresh inventory before loading')
  fireEvent.click(screen.getByRole('button', { name: 'Check startup settings' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('artifact changed since inventory scan')
  expect(engineCommand).toHaveBeenCalledTimes(2)
  expect(vi.mocked(engineCommand).mock.calls.every(([action]) => action === 'quote')).toBe(true)
})

it('keeps a saved remote host passive until its Connect button is used', async () => {
  const host = { local: false, host_id: 'remote', name: 'Saved server', base_url: 'https://host', certificate_sha256: '', client_id: 'client' }
  const error = 'Connect this saved host to unlock its credential for this session'
  render(<HostCard host={host} error={error} />)
  expect(screen.getByText(/Choose Connect to use this saved host/)).toBeInTheDocument()
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Connect' })).toBeEnabled()
  expect(engineCommand).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Connect' }))
  await waitFor(() => expect(engineCommand).toHaveBeenCalledWith('connect', { host_id: 'remote' }))
  await waitFor(() => expect(screen.getByRole('button', { name: 'Connect' })).toBeEnabled())
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
  expect(screen.getByText(managementNotice)).toHaveAttribute('role', 'status')
  expect(screen.getByText(lanNotice)).toHaveAttribute('role', 'status')
  expect(screen.getByText(sharingError)).toHaveAttribute('role', 'alert')
  expect(screen.getByText(/Other computers on your network can pair/)).toBeInTheDocument()
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
  fireEvent.click(screen.getByText('Server details'))
  fireEvent.click(screen.getByText('Custom server settings'))
  expect(screen.getByLabelText('Context tokens')).toHaveDisplayValue('')
  expect(screen.getByRole('button', { name: 'Load model' })).toBeDisabled()
  fireEvent.change(screen.getByLabelText('Custom model'), { target: { value: 'model' } })
  expect(screen.getByLabelText('Context tokens')).toHaveValue(nativeContext)
  fireEvent.click(screen.getByRole('button', { name: 'Load model' }))
  await waitFor(() => expect(engineCommand).toHaveBeenCalledWith('launch', expect.objectContaining({
    body: expect.objectContaining({ model_id: 'model', max_context: nativeContext }),
  })))
  await waitFor(() => expect(screen.getByRole('button', { name: 'Load model' })).toBeEnabled())
  fireEvent.change(screen.getByLabelText('Context tokens'), { target: { value: '65536' } })
  fireEvent.click(screen.getByRole('button', { name: 'Load model' }))
  await waitFor(() => expect(engineCommand).toHaveBeenLastCalledWith('launch', expect.objectContaining({
    body: expect.objectContaining({ max_context: 65536 }),
  })))
})

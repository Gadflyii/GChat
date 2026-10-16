import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { HostCard } from '../EngineHostModels'
import { engineCommand, type EngineSnapshot } from '@/services/engines'

vi.mock('@/services/engines', async (original) => ({
  ...await original<typeof import('@/services/engines')>(),
  engineCommand: vi.fn().mockResolvedValue({}),
}))
vi.mock('@/stores/engine-hosts-store', () => ({ useEngineHosts: () => vi.fn().mockResolvedValue(undefined) }))
vi.mock('../EngineProfilePicker', () => ({ EngineProfilePicker: () => null }))
vi.mock('../EngineFirstRun', () => ({ EngineFirstRun: ({ hostId }: { hostId: string }) => <section aria-label={`First-run setup for ${hostId}`} /> }))
afterEach(() => { cleanup(); vi.clearAllMocks() })

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

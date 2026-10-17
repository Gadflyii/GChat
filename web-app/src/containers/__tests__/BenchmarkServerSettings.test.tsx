import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { BenchmarkServerSettings } from '../BenchmarkServerSettings'
import type { EngineSnapshot } from '@/services/engines'
import type { BenchmarkSessionInfo } from '@/services/benchmark/tauri'

const mocks = vi.hoisted(() => ({ command: vi.fn(), refreshHosts: vi.fn(), state: {} as Record<string, unknown> }))
vi.mock('@/stores/engine-hosts-store', () => ({ useEngineHosts: () => mocks.state }))
vi.mock('@/services/engines', async importOriginal => ({ ...await importOriginal<typeof import('@/services/engines')>(), engineCommand: mocks.command }))

const snapshot = (): EngineSnapshot => ({
  host_id: 'host', display_name: 'Fixture Host', revision: 1,
  gpus: [{ uuid: 'GPU-one', name: 'Fixture GPU', memory_mib: 24576, compute_capability: '8.6' }],
  models: [{ id: 'release', path: '/fixture.ginfer', artifact_set: false, metadata: {
    identity: { model_id: 'qwen3.8-flash-next', weights_id: 'smol-q2g64' }, tp_size: 1, draft_tp: 0, size_bytes: 1024,
  } }],
  instances: [{ instance_id: 'existing', session_id: 'current-session', display_name: 'Fixture server',
    upstream_model_id: 'qwen3.8-flash-next/smol-q2g64', status: 'ready',
    configuration: { gpu_uuids: ['GPU-one'], max_context: 131072, concurrency: 1 } }],
  max_perf_profiles: [{ model_id: 'release', compatible_gpu_groups: [['GPU-one']], profile: {
    reference: { id: 'gbench-max-perf', version: 1, model_class: 'flash-smol-mtp' },
    id: 'gbench-max-perf-v1-flash-smol-mtp', name: 'GBench Max Perf · Flash SMOL', max_context: 8181, concurrency: 8, tp: 1,
    options: { vision: true, structured_outputs: true, spec: 'mtp', draft_policy: 'fixed', draft_tokens: 3, draft_tp: 0,
      kv_dtype: 'int8', kv_arena_bytes: null, host_kv_cache_bytes: null, prefill_chunk: 0, no_cuda_graph: false },
  } }],
  launch_profiles: [{ model_id: 'release', compatible_gpu_groups: [['GPU-one']], gpu_groups: [['GPU-one']],
    profile: { id: 'capacity-profile', name: 'Recorded capacity', max_context: 131072, concurrency: 1, tp: 1,
      options: { vision: true }, qualification: { tier: 'calculated-pending-validation', engine_revision: 'fixture-engine' } } }],
})

const session = (): BenchmarkSessionInfo => ({
  target_id: 'ginfer/host/existing', session_id: 'current-session', pid: null, port: null,
  model_id: 'qwen3.8-flash-next/smol-q2g64', model_path: '/fixture.ginfer', is_embedding: false,
  vision: true, max_context: 131072, spec: 'mtp', draft_tokens: 3, draft_tp: 0, kv_dtype: 'int8',
  kv_arena_bytes: 'auto', prefill_chunk: 0, max_concurrency: 1, no_cuda_graph: false,
})

beforeEach(() => {
  mocks.command.mockReset().mockResolvedValue(undefined)
  mocks.refreshHosts.mockReset().mockResolvedValue(undefined)
  mocks.state = { hosts: [{ host_id: 'host', name: 'Fixture Host' }], snapshots: { host: snapshot() }, errors: {}, refresh: mocks.refreshHosts }
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })

it('offers Max Perf separately and applies only after selection and confirmation to the same session', async () => {
  const current = session()
  const refresh = vi.fn().mockResolvedValue(undefined)
  const pending = vi.fn()
  render(<BenchmarkServerSettings sessions={[current]} selected={current} select={vi.fn()} disabled={false} refresh={refresh} onPendingChange={pending} />)
  const serverGuidance = screen.getByText('Choose the computer and running model you want to benchmark. Selecting a server does not restart it.')
  const profile = screen.getByLabelText('Max Perf profile')
  expect(screen.getByRole('heading', { name: 'Choose a running server' })).toBeInTheDocument()
  expect(serverGuidance.compareDocumentPosition(profile) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  expect(screen.getByLabelText('Host / Instance').compareDocumentPosition(profile) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  const applyGuidance = screen.getByText('Choose a Max Perf profile, then select Apply Max Perf & Restart Server. Wait for the server to be ready before selecting Run benchmark.')
  expect(applyGuidance.compareDocumentPosition(profile) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Show all' }))
  expect(screen.getByRole('option', {
    name: 'Untested · C1 · 128K context · Vision + text',
  })).toBeInTheDocument()
  expect(screen.getByText(/does not claim hardware qualification/)).toBeInTheDocument()
  expect(mocks.command).not.toHaveBeenCalled()
  const choice = screen.getByRole('option', { name: /GBench Max Perf · Flash SMOL/ }) as HTMLOptionElement
  fireEvent.change(screen.getByLabelText('Max Perf profile'), { target: { value: choice.value } })
  expect(pending).toHaveBeenLastCalledWith(true)
  expect(mocks.command).not.toHaveBeenCalled()
  expect(screen.getByRole('alert')).toHaveTextContent('Applying this profile waits for current requests to finish, then restarts this server. Chats and other clients using it are affected. Wait for the server to be ready before selecting Run benchmark.')
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
  fireEvent.click(screen.getByRole('button', { name: 'Apply Max Perf & Restart Server' }))
  expect(mocks.command).not.toHaveBeenCalled()
  confirm.mockReturnValue(true)
  fireEvent.click(screen.getByRole('button', { name: 'Apply Max Perf & Restart Server' }))
  await waitFor(() => expect(mocks.command).toHaveBeenCalledWith('profile_launch', { host_id: 'host', body: {
    profile_id: 'gbench-max-perf-v1-flash-smol-mtp', model_id: 'release', gpu_uuids: ['GPU-one'],
    instance_id: 'existing', expected_session_id: 'current-session', force: false,
  } }))
  await waitFor(() => expect(refresh).toHaveBeenCalledOnce())
  expect(mocks.refreshHosts).toHaveBeenCalledOnce()
  await waitFor(() => expect(pending).toHaveBeenLastCalledWith(false))
})

it('explains how to load and refresh a server when none are running', () => {
  render(<BenchmarkServerSettings sessions={[]} select={vi.fn()} disabled={false} refresh={vi.fn()} onPendingChange={vi.fn()} />)
  expect(screen.getByRole('heading', { name: 'Choose a running server' })).toBeInTheDocument()
  expect(screen.getByLabelText('Host / Instance')).toHaveValue('')
  expect(screen.getByText('Open Models, load a model, then select Refresh server to update this list.')).toBeInTheDocument()
  expect(mocks.command).not.toHaveBeenCalled()
})

it('clears the pending profile when selecting another server without restarting either server', () => {
  const current = session()
  const other = { ...current, target_id: 'remote/server', session_id: 'other-session', display_name: 'Other running server' }
  const select = vi.fn()
  const pending = vi.fn()
  const props = { sessions: [current, other], selected: current, select, disabled: false, refresh: vi.fn(), onPendingChange: pending }
  const view = render(<BenchmarkServerSettings {...props} />)
  const choice = screen.getByRole('option', { name: /GBench Max Perf · Flash SMOL/ }) as HTMLOptionElement
  fireEvent.change(screen.getByLabelText('Max Perf profile'), { target: { value: choice.value } })
  expect(pending).toHaveBeenLastCalledWith(true)
  fireEvent.change(screen.getByLabelText('Host / Instance'), { target: { value: other.target_id } })
  expect(select).toHaveBeenCalledWith(other.target_id)
  expect(pending).toHaveBeenLastCalledWith(false)
  view.rerender(<BenchmarkServerSettings {...props} selected={other} />)
  view.rerender(<BenchmarkServerSettings {...props} />)
  expect(screen.getByLabelText('Max Perf profile')).toHaveValue('')
  expect(screen.getByRole('button', { name: 'Apply Max Perf & Restart Server' })).toBeDisabled()
  expect(pending).toHaveBeenLastCalledWith(false)
  expect(mocks.command).not.toHaveBeenCalled()
})

it('does not offer missing artifacts, other occupied GPUs or a different GPU group', () => {
  for (const unavailable of ['missing-model', 'occupied', 'different-group']) {
    const data = snapshot()
    if (unavailable === 'missing-model') data.models = []
    if (unavailable === 'occupied') data.instances.push({ ...data.instances[0], instance_id: 'other' })
    if (unavailable === 'different-group') data.instances[0].configuration.gpu_uuids = ['GPU-other']
    mocks.state.snapshots = { host: data }
    const current = session()
    const view = render(<BenchmarkServerSettings sessions={[current]} selected={current} select={vi.fn()} disabled={false} refresh={vi.fn()} onPendingChange={vi.fn()} />)
    expect(screen.getByLabelText('Max Perf profile')).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Apply Max Perf & Restart Server' })).toBeDisabled()
    expect(mocks.command).not.toHaveBeenCalled()
    view.unmount()
  }
})

it('refuses to apply from a stale session selection and clears a choice when its session changes', () => {
  const current = session()
  const props = { sessions: [current], selected: current, select: vi.fn(), disabled: false, refresh: vi.fn(), onPendingChange: vi.fn() }
  const view = render(<BenchmarkServerSettings {...props} />)
  const choice = screen.getByRole('option', { name: /GBench Max Perf · Flash SMOL/ }) as HTMLOptionElement
  fireEvent.change(screen.getByLabelText('Max Perf profile'), { target: { value: choice.value } })
  view.rerender(<BenchmarkServerSettings {...props} selected={{ ...current, session_id: 'old-session' }} />)
  expect(screen.getByLabelText('Max Perf profile')).toHaveValue('')
  expect(screen.getByLabelText('Max Perf profile')).toBeDisabled()
  expect(screen.getByRole('button', { name: 'Apply Max Perf & Restart Server' })).toBeDisabled()
  expect(mocks.command).not.toHaveBeenCalled()
})

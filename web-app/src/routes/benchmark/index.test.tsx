import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { ComponentType } from 'react'
import type { EngineSnapshot } from '@/services/engines'

const mocks = vi.hoisted(() => ({ list: vi.fn(), run: vi.fn(), command: vi.fn(), refresh: vi.fn(), snapshots: {} as Record<string, EngineSnapshot> }))
vi.mock('@tanstack/react-router', () => ({ createFileRoute: () => (options: unknown) => ({ options }), useNavigate: () => vi.fn() }))
vi.mock('@/containers/HeaderPage', () => ({ default: ({ children }: { children: React.ReactNode }) => <header>{children}</header> }))
vi.mock('@/services/benchmark/tauri', () => ({ listBenchmarkSessions: mocks.list, runBenchmark: mocks.run, cancelBenchmark: vi.fn(), onBenchmarkProgress: vi.fn().mockResolvedValue(() => {}) }))
vi.mock('@/services/engines', () => ({ engineAlias: (host: string, instance: string) => `ginfer/${host}/${instance}`, engineCommand: mocks.command }))
vi.mock('@/hooks/useModelProvider', () => ({ useModelProvider: { getState: () => ({ selectedModel: { id: 'model' } }) } }))
vi.mock('@/stores/engine-hosts-store', () => {
  const state = () => ({ hosts: [{ host_id: 'local', name: 'This computer', local: true }, { host_id: 'remote', name: 'Server 2' }], snapshots: mocks.snapshots, errors: {}, refresh: mocks.refresh })
  return { useEngineHosts: Object.assign((selector?: (value: ReturnType<typeof state>) => unknown) => selector ? selector(state()) : state(), { getState: state }) }
})
import { Route, ThroughputChart } from './index'
import { onBenchmarkProgress } from '@/services/benchmark/tauri'
import { useBenchmarkStore } from '@/stores/benchmark-store'
const Page = Route.options.component as ComponentType

it('scales generation independently of prompt throughput with labeled axes', () => {
  const { container } = render(<ThroughputChart points={[
    { concurrency: 1, cold_prompt_tokens_per_second: null, prompt_tokens_per_second: 10000, generation_tokens_per_second: 100 },
    { concurrency: 4, cold_prompt_tokens_per_second: null, prompt_tokens_per_second: 20000, generation_tokens_per_second: 200 },
  ]} />)
  expect(screen.getByText('Prompt t/s (left)')).toBeInTheDocument()
  expect(screen.getByText('Generation t/s (right)')).toBeInTheDocument()
  const circles = container.querySelectorAll('circle')
  expect(circles[0].getAttribute('cy')).toBe(circles[1].getAttribute('cy'))
  expect(circles[2].getAttribute('cy')).toBe(circles[3].getAttribute('cy'))
  expect(Number(circles[1].getAttribute('cy'))).toBeGreaterThan(Number(circles[3].getAttribute('cy')))
  expect(screen.getByText((20000).toLocaleString())).toBeInTheDocument()
  expect(screen.getByText('200')).toBeInTheDocument()
})

it('renders finite chart coordinates for a single zero-throughput point', () => {
  const { container } = render(<ThroughputChart points={[
    { concurrency: 1, cold_prompt_tokens_per_second: null, prompt_tokens_per_second: 0, generation_tokens_per_second: 0 },
  ]} />)
  for (const circle of container.querySelectorAll('circle')) {
    expect(Number.isFinite(Number(circle.getAttribute('cy')))).toBe(true)
    expect(Number.isFinite(Number(circle.getAttribute('cx')))).toBe(true)
  }
})

it('plots Cold PP on the prompt scale and leaves missing measurements unplotted', () => {
  const { container } = render(<ThroughputChart points={[
    { concurrency: 1, cold_prompt_tokens_per_second: 1000, prompt_tokens_per_second: 10000, generation_tokens_per_second: 100 },
    { concurrency: 4, cold_prompt_tokens_per_second: null, prompt_tokens_per_second: 20000, generation_tokens_per_second: null },
  ]} />)
  expect(container.querySelectorAll('circle')).toHaveLength(4)
  expect(screen.getByText('Cold PP · left axis (dotted)')).toBeInTheDocument()
  expect(container.querySelector('svg')?.innerHTML).not.toContain('NaN')
})

beforeEach(() => {
  useBenchmarkStore.setState({ runs: [], selectedRunId: null })
  vi.mocked(onBenchmarkProgress).mockResolvedValue(() => {})
  mocks.refresh.mockResolvedValue(undefined)
  mocks.command.mockReset().mockResolvedValue({})
  mocks.run.mockReset().mockRejectedValue(new Error('Test finished'))
  mocks.snapshots = Object.fromEntries(['local', 'remote'].map(host => [host, {
    host_id: host, display_name: host, revision: 1,
    gpus: [{ uuid: 'GPU', name: '5090', memory_mib: 32768 }],
    models: [{ id: 'model', path: '/model.ginfer', artifact_set: false, metadata: { identity: { model_id: 'muse-glimmer-30b', weights_id: 'nvfp4' }, tp_size: 1, draft_tp: 0, size_bytes: 1024 } }],
    instances: [{ instance_id: 'instance', session_id: 'session', display_name: 'Muse', upstream_model_id: 'model', status: 'ready',
      configuration: { gpu_uuids: ['GPU'], max_context: 8192, concurrency: 1 },
      profile: { model_id: 'model', gpu_uuids: ['GPU'], max_context: 8192, concurrency: 1, vision: true, spec: 'auto', draft_tokens: 0, draft_tp: 0, kv_dtype: 'int8', kv_arena_bytes: null, host_kv_cache_bytes: 0, prefill_chunk: 0, no_cuda_graph: false } }],
    launch_profiles: [{ model_id: 'model', compatible_gpu_groups: [['GPU']], gpu_groups: [['GPU']], profile: { id: 'c4', name: 'C4 profile', tp: 1, max_context: 4096, concurrency: 4, options: { vision: true }, qualification: { tier: 'full-context-tested' } } }],
  }]))
  mocks.list.mockResolvedValue(['local', 'remote', 'offline'].map(host => ({ target_id: `ginfer/${host}/instance`, session_id: 'session', display_name: host, model_id: 'model', max_concurrency: 1, max_context: 8192, pid: null, is_embedding: false })))
})

it('keeps saved results visible without an online server', async () => {
  mocks.list.mockResolvedValue([])
  useBenchmarkStore.setState({ runs: [{ benchmark_id: 'custom', hardware: null, methodology: 'ginfer-resident-max-perf-v1', run_id: 'saved', started_at_ms: 1, completed_at_ms: 1001, points: [],
    session: { display_name: 'Saved Muse run', pid: null, target_id: 'ginfer/local/instance', session_id: 'session',
      model_id: 'model', model_path: '/model.ginfer', max_context: 8192, max_concurrency: 1, vision: true,
      spec: 'auto', draft_tokens: 0, draft_tp: 0, kv_dtype: 'int8', prefill_chunk: 0, cuda_graph: true },
  }], selectedRunId: 'saved' })
  render(<Page />)
  await screen.findByText('Load a model to benchmark it')
  expect(screen.getByRole('img', { name: 'Prompt and generation throughput by concurrency' })).toBeInTheDocument()
  expect(screen.getByText('Saved Muse run')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: /Run benchmark/ })).toBeDisabled()
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })

it('offers the new workloads and every supported concurrency outside Standard Benchmark', async () => {
  mocks.list.mockResolvedValue([{ target_id: 'ginfer/local/instance', model_id: 'model', max_concurrency: 8, max_context: 131072, pid: null, is_embedding: false }])
  render(<Page />)
  await screen.findByRole('option', { name: /Current settings/ })
  fireEvent.click(screen.getByRole('button', { name: /^Standard Benchmark/ }))
  expect(screen.getByRole('button', { name: 'C8', exact: true })).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'C3', exact: true })).not.toBeInTheDocument()
  expect(screen.getByLabelText('Prompt tokens')).toHaveValue(2048)
  expect(screen.getByLabelText('Max output tokens')).toHaveValue(500)
  fireEvent.click(screen.getByRole('button', { name: /^Serving/ }))
  for (let c = 1; c <= 8; c++) expect(screen.getByRole('button', { name: `C${c}`, exact: true })).toBeInTheDocument()
  expect(screen.getByLabelText('Prompt tokens')).toHaveValue(4096)
  expect(screen.getByLabelText('Max output tokens')).toHaveValue(1000)
  fireEvent.click(screen.getByRole('button', { name: /^Long context/ }))
  expect(screen.getByLabelText('Prompt tokens')).toHaveValue(32768)
  expect(screen.getByLabelText('Max output tokens')).toHaveValue(512)
  fireEvent.click(screen.getByRole('button', { name: /^Big Bench/ }))
  expect(screen.getByLabelText('Prompt tokens')).toHaveValue(65536)
  expect(screen.getByLabelText('Max output tokens')).toHaveValue(65536)
})

it('defaults to the running local model, excludes unavailable targets and benchmarks the selected remote instance', async () => {
  render(<Page />)
  await waitFor(() => expect(screen.getByLabelText('Host / Instance')).toHaveValue('ginfer/local/instance'))
  const selector = screen.getByLabelText('Host / Instance')
  expect(screen.queryByRole('option', { name: 'offline' })).not.toBeInTheDocument()
  expect(screen.getByLabelText('Hardware profile')).toHaveValue('')
  expect(screen.getByRole('option', { name: /Current settings · C1/ })).toBeInTheDocument()
  fireEvent.change(selector, { target: { value: 'ginfer/remote/instance' } })
  fireEvent.click(screen.getByRole('button', { name: /Run benchmark/ }))
  await waitFor(() => expect(mocks.run).toHaveBeenCalledWith(expect.anything(), 'ginfer/remote/instance'))
})

it('blocks benchmarking for pending changes and confirms before restarting the selected server', async () => {
  render(<Page />)
  await screen.findByRole('option', { name: /Current settings · C1/ })
  const option = screen.getByRole('option', { name: /C4 profile/ }) as HTMLOptionElement
  fireEvent.change(screen.getByLabelText('Hardware profile'), { target: { value: option.value } })
  expect(screen.getByRole('alert')).toHaveTextContent('unloads the current model')
  expect(screen.getByRole('button', { name: /Run benchmark/ })).toBeDisabled()
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
  fireEvent.click(screen.getByRole('button', { name: 'Apply & Restart Server' }))
  expect(mocks.command).not.toHaveBeenCalled()
  confirm.mockReturnValue(true)
  fireEvent.click(screen.getByRole('button', { name: 'Apply & Restart Server' }))
  await waitFor(() => expect(mocks.command).toHaveBeenCalledWith('profile_launch', { host_id: 'local', body: expect.objectContaining({ profile_id: 'c4', instance_id: 'instance', expected_session_id: 'session' }) }))
  await waitFor(() => expect(screen.getByRole('button', { name: /Run benchmark/ })).toBeEnabled())
})

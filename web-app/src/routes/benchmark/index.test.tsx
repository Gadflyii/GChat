import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { ComponentType } from 'react'
import type { EngineSnapshot } from '@/services/engines'
import type { BenchmarkResult, BenchmarkV2Wave } from '@/services/benchmark/tauri'

const mocks = vi.hoisted(() => ({ list: vi.fn(), run: vi.fn(), command: vi.fn(), refresh: vi.fn(), snapshots: {} as Record<string, EngineSnapshot> }))
vi.mock('@tanstack/react-router', () => ({ createFileRoute: () => (options: unknown) => ({ options }), useNavigate: () => vi.fn() }))
vi.mock('@/containers/HeaderPage', () => ({ default: ({ children }: { children: React.ReactNode }) => <header>{children}</header> }))
vi.mock('@/services/benchmark/tauri', () => ({ listBenchmarkSessions: mocks.list, runBenchmark: mocks.run, cancelBenchmark: vi.fn(), onBenchmarkProgress: vi.fn().mockResolvedValue(() => {}) }))
vi.mock('@/services/engines', () => ({ engineAlias: (host: string, instance: string) => `ginfer/${host}/${instance}`, engineCommand: mocks.command, hardwareProfileBusy: () => false, hardwareProfileBlocksLaunch: () => false }))
vi.mock('@/hooks/useModelProvider', () => ({ useModelProvider: { getState: () => ({ selectedModel: { id: 'model' } }) } }))
vi.mock('@/stores/engine-hosts-store', () => {
  const state = () => ({ hosts: [{ host_id: 'local', name: 'This computer', local: true }, { host_id: 'remote', name: 'Server 2' }], snapshots: mocks.snapshots, errors: {}, refresh: mocks.refresh })
  return { useEngineHosts: Object.assign((selector?: (value: ReturnType<typeof state>) => unknown) => selector ? selector(state()) : state(), { getState: state }) }
})
import { Route, ThroughputChart } from './index'
import { onBenchmarkProgress } from '@/services/benchmark/tauri'
import { useBenchmarkStore } from '@/stores/benchmark-store'
import { localStorageKey } from '@/constants/localStorage'
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

it('labels native cached prefill per request without plotting the historical PP field', () => {
  const { container } = render(<ThroughputChart nativeV2 points={[
    { concurrency: 4, cold_prompt_tokens_per_second: 1000, prompt_tokens_per_second: 99999,
      warm_prefill_tokens_per_second_per_request: 2000, generation_tokens_per_second: 200 },
  ]} />)
  expect(screen.getByText('Warm PP / request · left axis')).toBeInTheDocument()
  expect(screen.getByText('C4 Warm PP / request: 2,000 t/s')).toBeInTheDocument()
  expect(container.querySelector('svg')?.innerHTML).not.toContain('99,999')
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
      profile: { model_id: 'model', gpu_uuids: ['GPU'], max_context: 8192, concurrency: 1, vision: true, structured_outputs: true, spec: 'auto', draft_tokens: 0, draft_tp: 0, kv_dtype: 'int8', kv_arena_bytes: null, host_kv_cache_bytes: 0, prefill_chunk: 0, no_cuda_graph: false } }],
    launch_profiles: [{ model_id: 'model', compatible_gpu_groups: [['GPU']], gpu_groups: [['GPU']], profile: { id: 'c4', name: 'C4 profile', tp: 1, max_context: 4096, concurrency: 4, options: { vision: true }, qualification: { tier: 'full-context-tested', engine_revision: 'fixture' } } }],
  }]))
  mocks.list.mockResolvedValue(['local', 'remote', 'offline'].map(host => ({ target_id: `ginfer/${host}/instance`, session_id: 'session', display_name: host, model_id: 'model', max_concurrency: 1, max_context: 8192, pid: null, is_embedding: false, no_cuda_graph: false })))
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
afterEach(() => { cleanup(); vi.restoreAllMocks(); localStorage.removeItem(localStorageKey.gbenchReceipts) })

it('previews saved native v2 as public v1 offline while keeping publication disabled', async () => {
  mocks.list.mockResolvedValue([])
  const run: BenchmarkResult = { benchmark_id: 'standard', methodology: 'ginfer-resident-max-perf-v2', run_id: 'saved-v2', started_at_ms: 1, completed_at_ms: 1001,
    hardware: { cpu_model: 'Example CPU', physical_cores: 16, logical_threads: 32, ram_bytes: 2 ** 36,
      ram_speed_mt_s: 6000, os: 'Linux', os_version: '6.8', resource_scope: 'physical',
      gpus: [{ model: 'RTX 5090', vram_mib: 32768, sm: '120' }] },
    session: { display_name: 'Saved v2 run', pid: null, target_id: 'ginfer/local/instance', session_id: 'session',
      model_id: 'qwen3.8-27b/groupwise-int-dflash2-q4', model_path: '/model.ginfer', max_context: 8181, max_concurrency: 8, vision: true,
      benchmark_profile: { id: 'gbench-max-perf', version: 1, model_class: 'qwen27-int-dflash-q4' }, tp: 1, draft_policy: 'fixed',
      spec: 'dflash', draft_tokens: 7, draft_tp: 1, kv_dtype: 'int8', prefill_chunk: 0, cuda_graph: true },
    points: [1, 4, 8].map(concurrency => {
      const logical = 2048 * concurrency
      const wave = (prefix: boolean, seconds: number): BenchmarkV2Wave => ({
        full_cold_prompt: !prefix, computed_tokens: prefix ? 0 : logical, cached_tokens: prefix ? logical : 0,
        compute_seconds: prefix ? 0 : seconds, output_tokens: 500 * concurrency, mean_ttft_seconds: seconds,
        decode_tokens: 480 * concurrency, decode_rounds: 120 * concurrency, decode_seconds: 2, wall_seconds: seconds + 4,
        logical_prompt_tokens: logical, observed_compute_tokens: prefix ? 0 : logical, prefix_reuse: prefix,
        warm_cached_prompt: prefix, prefill_seconds_sum: seconds * concurrency, decode_seconds_sum: 2 * concurrency,
        request_seconds_sum: (seconds + 4) * concurrency, warm_prefill_status: prefix ? 'cached' : 'prefix_reuse_disabled',
        warm_prefill_seconds_mean: prefix ? seconds : null, warm_pp_effective_per_request: prefix ? 2048 / seconds : null,
        warm_cached_ttft_seconds: prefix ? seconds : null,
      })
      return { concurrency, requested_prompt_tokens: 2048, requested_output_tokens: 500, completed_requests: concurrency,
        average_prompt_tokens: 2048, average_completion_tokens: 500, cached_prompt_tokens: logical,
        cold_prompt_tokens_per_second: logical / 2, prompt_tokens_per_second: null,
        warm_prefill_tokens_per_second_per_request: 512, warm_cached_ttft_seconds: 4,
        generation_tokens_per_second: 240 * concurrency, per_request_generation_tokens_per_second: 240,
        wave_output_tokens_per_second: 500 * concurrency / 8, average_prefill_seconds: 4, average_decode_seconds: 2,
        average_request_seconds: 8, wave_seconds: 8, finish_reasons: ['output_limit'],
        evidence: { schema: 'ginfer-resident-benchmark-v2', corpus: 'fixture-standard-v2',
          configuration: { engine_build: 'native-build', model: 'qwen3.8-27b', weights: 'groupwise-int-dflash2-q4',
            tp: 1, draft_tp: 1, max_context: 8181, max_concurrency: 8, kv_dtype: 'int8', spec: 'dflash',
            draft_tokens: 7, draft_policy: 'fixed', cuda_graph: true, vision: true, prefix_reuse: true },
          workload: { prompt_tokens: 2048, output_tokens: 500, concurrency, warmup_rounds: 1, measured_rounds: 1 },
          cold_prefill: { prefix_reuse: false, warmup: [wave(false, 1)], measured: [wave(false, 2)] },
          warm_generation: { prefix_reuse: true, warmup: [wave(true, 3)], measured: [wave(true, 4)] } },
      }
    }),
  }
  useBenchmarkStore.setState({ runs: [run], selectedRunId: run.run_id })
  render(<Page />)
  expect(await screen.findByText('Native v2 · measured cold prefill and warm generation')).toBeInTheDocument()
  expect(screen.getByRole('columnheader', { name: 'Warm PP / request t/s' })).toBeInTheDocument()
  expect(screen.getByRole('columnheader', { name: 'Cached TTFT' })).toBeInTheDocument()
  fireEvent.change(screen.getByLabelText('Enter public nickname'), { target: { value: 'Player' } })
  fireEvent.click(screen.getByText('What will be published'))
  const preview = screen.getByText('Full submission preview')
  fireEvent.click(preview)
  const payload = JSON.parse(preview.closest('details')!.querySelector('pre')!.textContent!)
  expect(payload.schema).toBe('gbench-submission-v1')
  expect(payload.methodology).toBe('ginfer-resident-max-perf-v1')
  expect(payload.configuration.engine_build).toBe('native-build')
  expect(payload.points).toEqual([1, 4, 8].map(concurrency => ({ concurrency, corpus: 'fixture-standard-v2',
    warmup: { full_cold_prompt: true, computed_tokens: 2048 * concurrency, cached_tokens: 0, compute_seconds: 1,
      output_tokens: 500 * concurrency, mean_ttft_seconds: 1, decode_tokens: 480 * concurrency,
      decode_rounds: 120 * concurrency, decode_seconds: 2, wall_seconds: 5 },
    measured: { full_cold_prompt: false, computed_tokens: 0, cached_tokens: 2048 * concurrency, compute_seconds: 0,
      output_tokens: 500 * concurrency, mean_ttft_seconds: 4, decode_tokens: 480 * concurrency,
      decode_rounds: 120 * concurrency, decode_seconds: 2, wall_seconds: 8 },
  })))
  fireEvent.click(screen.getByRole('checkbox', { name: /I want to publish/ }))
  expect(screen.getByRole('button', { name: 'Submit to leaderboard' })).toBeDisabled()
  expect(screen.getByText('Leaderboard coming soon. Publishing is not enabled yet.')).toBeInTheDocument()
  expect(localStorage.getItem(localStorageKey.gbenchReceipts)).toBeNull()
  expect(useBenchmarkStore.getState().runs[0]).toEqual(run)
})

it('keeps receipt-owned public removal available after deleting the last local result', async () => {
  const id = 'owned-local-history'
  const receipts = JSON.stringify({ [id]: { run_id: id, delete_token: 'a'.repeat(64) } })
  localStorage.setItem(localStorageKey.gbenchReceipts, receipts)
  useBenchmarkStore.setState({ runs: [{ benchmark_id: 'custom', hardware: null, methodology: 'ginfer-resident-max-perf-v1', run_id: id, started_at_ms: 1, completed_at_ms: 1001, points: [],
    session: { display_name: 'Saved local run', pid: null, target_id: 'ginfer/local/instance', session_id: 'session', model_id: 'model', model_path: '/model.ginfer', max_context: 8192, max_concurrency: 1, vision: true, spec: 'auto', draft_tokens: 0, draft_tp: 0, kv_dtype: 'int8', prefill_chunk: 0, cuda_graph: true },
  }], selectedRunId: id })
  const view = render(<Page />)
  await screen.findByRole('link', { name: `View result ${id}` })
  fireEvent.click(screen.getByRole('button', { name: 'Delete selected local benchmark' }))
  expect(useBenchmarkStore.getState().runs).toEqual([])
  expect(localStorage.getItem(localStorageKey.gbenchReceipts)).toBe(receipts)
  expect(screen.getByRole('button', { name: 'Remove from leaderboard' })).toBeInTheDocument()
  view.unmount()
  render(<Page />)
  expect(await screen.findByRole('link', { name: `View result ${id}` })).toBeInTheDocument()
})

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
  fireEvent.click(screen.getByRole('button', { name: /^Serving/ }))
  fireEvent.click(screen.getByRole('button', { name: /Run benchmark/ }))
  await waitFor(() => expect(mocks.run).toHaveBeenCalledWith(expect.anything(), 'ginfer/remote/instance'))
})

it('blocks benchmarking for pending changes and confirms before restarting the selected server', async () => {
  render(<Page />)
  await screen.findByRole('option', { name: /Current settings · C1/ })
  fireEvent.click(screen.getByRole('button', { name: /^Serving/ }))
  const option = screen.getByRole('option', { name: /Tested · C4 · 4K context/ }) as HTMLOptionElement
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

it('refuses a mismatched Standard session and pins the Max Perf session and all three points', async () => {
  const first = render(<Page />)
  await screen.findByRole('option', { name: /Current settings · C1/ })
  expect(screen.getByRole('button', { name: /Run benchmark/ })).toBeDisabled()
  fireEvent.click(screen.getByRole('button', { name: /Run benchmark/ }))
  expect(mocks.run).not.toHaveBeenCalled()
  expect(screen.getByRole('alert')).toHaveTextContent('recorded GBench Max Perf v1 profile')
  first.unmount()
  mocks.list.mockResolvedValue([{
    target_id: 'ginfer/local/instance', session_id: 'max-perf-session', pid: null,
    model_id: 'qwen3.8-27b/groupwise-int-dflash2-q4', display_name: 'Qwen INT',
    model_path: '/fixture.ginfer', is_embedding: false, max_context: 8181,
    max_concurrency: 8, tp: 1, vision: true, spec: 'dflash', draft_tokens: 7,
    draft_tp: 1, draft_policy: 'fixed', kv_dtype: 'int8', kv_arena_bytes: 'auto',
    prefill_chunk: 0, no_cuda_graph: false,
    benchmark_profile: { id: 'gbench-max-perf', version: 1, model_class: 'qwen27-int-dflash-q4' },
  }])
  render(<Page />)
  await waitFor(() => expect(screen.getByRole('button', { name: /Run benchmark/ })).toBeEnabled())
  fireEvent.click(screen.getByRole('button', { name: /Run benchmark/ }))
  await waitFor(() => expect(mocks.run).toHaveBeenCalledWith(expect.objectContaining({
    benchmark_id: 'standard', expected_session_id: 'max-perf-session',
    prompt_tokens: 2048, max_output_tokens: 500, concurrencies: [1, 4, 8],
    warmup_rounds: 1, measured_rounds: 1,
  }), 'ginfer/local/instance'))
})

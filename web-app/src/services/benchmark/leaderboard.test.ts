import { afterEach, describe, expect, it, vi } from 'vitest'
import { invoke } from '@tauri-apps/api/core'
import { localStorageKey } from '@/constants/localStorage'
import { buildSubmission, submitStandardBenchmark } from './leaderboard'
import type { BenchmarkResult } from './tauri'
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))
afterEach(() => { vi.mocked(invoke).mockReset(); localStorage.removeItem(localStorageKey.gbenchReceipts) })

function fixture(): BenchmarkResult {
  const configuration = { engine_build: 'test', model: 'muse-glimmer-30b', weights: 'nvfp4', tp: 1, draft_tp: 1,
    max_context: 131072, max_concurrency: 1, kv_dtype: 'nvfp4', spec: 'dflash', draft_tokens: 4,
    draft_policy: 'fixed', cuda_graph: true, vision: true }
  const wave = { full_cold_prompt: true, computed_tokens: 2048, compute_seconds: 1, cached_tokens: 0,
    output_tokens: 500, mean_ttft_seconds: 1, decode_tokens: 480, decode_rounds: 120, decode_seconds: 2, wall_seconds: 4 }
  return {
    benchmark_id: 'standard', methodology: 'ginfer-resident-max-perf-v1', run_id: 'test-run-0001', started_at_ms: 1, completed_at_ms: 2,
    hardware: { cpu_model: 'Example', physical_cores: 16, logical_threads: 32, ram_bytes: 2 ** 36,
      ram_speed_mt_s: 6000, os: 'Windows', os_version: '10', resource_scope: 'physical',
      gpus: [{ model: 'RTX 5090', vram_mib: 32768, sm: '120' }] },
    session: { display_name: 'private-host', pid: 123, target_id: 'private-target', session_id: 'private-session',
      model_id: 'muse', model_path: 'private-path', max_context: 131072, max_concurrency: 1,
      vision: true, spec: 'dflash', draft_tokens: 4, draft_tp: 1, kv_dtype: 'nvfp4', prefill_chunk: 2048, cuda_graph: true },
    points: [{ concurrency: 1, requested_prompt_tokens: 2048, requested_output_tokens: 500, completed_requests: 1,
      average_prompt_tokens: 2048, average_completion_tokens: 500, cached_prompt_tokens: 0,
      cold_prompt_tokens_per_second: 2048, prompt_tokens_per_second: 2048, generation_tokens_per_second: 240,
      per_request_generation_tokens_per_second: 240, wave_output_tokens_per_second: 125,
      average_prefill_seconds: 1, average_decode_seconds: 2, average_request_seconds: 4, wave_seconds: 4, finish_reasons: ['length'],
      evidence: { schema: 'ginfer-resident-benchmark-v1', corpus: 'muse_glimmer_30b-max-perf-tail2048-v1', configuration, warmup: [wave], measured: [wave] } }],
  }
}

describe('G.bench public submission', () => {
  it('reserves the official nickname including case and separator variants', () => {
    for (const nickname of ['Sectile.labs', 'SECTILE.LABS', 'sectilelabs', 'Sectile Labs', 'sectile_labs', 'sectile-labs', 'Sectile Research Laboratories', 'Official Sectile', 's.e.c.t.i.l.e']) {
      expect(() => buildSubmission(fixture(), nickname)).toThrow('reserved')
    }
    expect(buildSubmission(fixture(), 'Player One').nickname).toBe('Player One')
  })
  it('sends only public hardware, configuration and raw evidence', () => {
    const run = fixture()
    Object.assign(run.hardware!, { hostname: 'private-host', api_key: 'private-key' })
    Object.assign(run.hardware!.gpus[0], { uuid: 'private-uuid' })
    Object.assign(run.points[0].evidence.configuration, { model_path: 'private-path' })
    const payload = buildSubmission(run, ' Player One ')
    expect(payload.nickname).toBe('Player One')
    expect(JSON.stringify(payload)).not.toContain('private-')
    expect(payload.points[0].measured.decode_tokens).toBe(480)
    expect(payload).not.toHaveProperty('scores')
  })
  it('rejects custom workloads even when their token counts match Standard', () => {
    const run = fixture(); run.benchmark_id = 'custom'
    expect(() => buildSubmission(run, 'Player')).toThrow('Only Standard')
  })
  it('requires every supported concurrency and rejects altered workloads', () => {
    const run = fixture(); run.points[0].evidence.configuration.max_concurrency = 8
    expect(() => buildSubmission(run, 'Player')).toThrow('every supported')
    run.points[0].evidence.configuration.max_concurrency = 1
    run.points[0].requested_output_tokens = 499
    expect(() => buildSubmission(run, 'Player')).toThrow('contract')
  })
  it('submits through native signing and preserves private ownership across retries', async () => {
    const run = fixture()
    vi.mocked(invoke).mockRejectedValueOnce(new Error('Lost response'))
    await expect(submitStandardBenchmark(run, 'Player')).rejects.toThrow('Lost response')
    const first = vi.mocked(invoke).mock.calls[0][1] as { payload: string; ownerToken: string }
    expect(first.ownerToken).toMatch(/^[a-f0-9]{64}$/)
    expect(first.payload).not.toContain(first.ownerToken)
    expect(JSON.parse(localStorage.getItem(localStorageKey.gbenchReceipts)!)[run.run_id].owner_token).toBe(first.ownerToken)
    vi.mocked(invoke).mockResolvedValueOnce({ run_id: run.run_id, delete_token: 'a'.repeat(64) })
    const result = await submitStandardBenchmark(run, 'Player')
    expect(result.run_id).toBe(run.run_id)
    expect(vi.mocked(invoke).mock.calls[1][1]).toEqual(first)
  })
  it('rejects a receipt for a different Run ID', async () => {
    vi.mocked(invoke).mockResolvedValueOnce({ run_id: 'wrong-run', delete_token: 'a'.repeat(64) })
    await expect(submitStandardBenchmark(fixture(), 'Player')).rejects.toThrow('Invalid leaderboard receipt')
  })
})

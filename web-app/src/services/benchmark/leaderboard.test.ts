import { afterEach, describe, expect, it, vi } from 'vitest'
import { invoke } from '@tauri-apps/api/core'
import { localStorageKey } from '@/constants/localStorage'
import { buildSubmission, submitStandardBenchmark, ownedLeaderboardResults, deleteLeaderboardResult, GBENCH_PUBLISHING_ENABLED, maxPerfSessionMismatch } from './leaderboard'
import type { BenchmarkResult } from './tauri'
import type { BenchmarkModelClass } from '@/services/engines'
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))
afterEach(() => { vi.mocked(invoke).mockReset(); localStorage.removeItem(localStorageKey.gbenchReceipts) })

function fixture(modelClass: BenchmarkModelClass = 'qwen27-int-dflash-q4'): BenchmarkResult {
  const policies = {
    'qwen27-int-dflash-q4': { model: 'qwen3.8-27b', weights: 'groupwise-int-dflash2-q4', kv: 'int8', spec: 'dflash', tokens: 7, draftTp: 1 },
    'qwen27-nvfp4-dflash-q4': { model: 'qwen3.8-27b', weights: 'nvfp4-dflash2-q4', kv: 'nvfp4', spec: 'dflash', tokens: 7, draftTp: 1 },
    'flash-smol-mtp': { model: 'qwen3.8-flash-next', weights: 'smol-q2g64', kv: 'int8', spec: 'mtp', tokens: 3, draftTp: 0 },
    'flash-int-mtp': { model: 'qwen3.8-flash-next', weights: 'groupwise-int', kv: 'int8', spec: 'mtp', tokens: 3, draftTp: 0 },
  }
  const policy = policies[modelClass]
  const configuration = { engine_build: 'test', model: policy.model, weights: policy.weights, tp: 1, draft_tp: policy.draftTp,
    max_context: 8181, max_concurrency: 8, kv_dtype: policy.kv, spec: policy.spec, draft_tokens: policy.tokens,
    draft_policy: 'fixed', cuda_graph: true, vision: true }
  const wave = { full_cold_prompt: true, computed_tokens: 2048, compute_seconds: 1, cached_tokens: 0,
    output_tokens: 500, mean_ttft_seconds: 1, decode_tokens: 480, decode_rounds: 120, decode_seconds: 2, wall_seconds: 4 }
  return {
    benchmark_id: 'standard', methodology: 'ginfer-resident-max-perf-v1', run_id: 'test-run-0001', started_at_ms: 1, completed_at_ms: 2,
    hardware: { cpu_model: 'Example', physical_cores: 16, logical_threads: 32, ram_bytes: 2 ** 36,
      ram_speed_mt_s: 6000, os: 'Windows', os_version: '10', resource_scope: 'physical',
      gpus: [{ model: 'RTX 5090', vram_mib: 32768, sm: '120' }] },
    session: { display_name: 'private-host', pid: null, target_id: 'ginfer/private-host/private-instance', session_id: 'private-session',
      model_id: `${policy.model}/${policy.weights}`, model_path: 'private-path', max_context: 8181, max_concurrency: 8,
      benchmark_profile: { id: 'gbench-max-perf', version: 1, model_class: modelClass }, tp: 1, draft_policy: 'fixed',
      vision: true, spec: policy.spec, draft_tokens: policy.tokens, draft_tp: policy.draftTp, kv_dtype: policy.kv, prefill_chunk: 0, cuda_graph: true },
    points: [1, 4, 8].map(concurrency => ({ concurrency, requested_prompt_tokens: 2048, requested_output_tokens: 500, completed_requests: concurrency,
      average_prompt_tokens: 2048, average_completion_tokens: 500, cached_prompt_tokens: 0,
      cold_prompt_tokens_per_second: 2048, prompt_tokens_per_second: 2048, generation_tokens_per_second: 240,
      per_request_generation_tokens_per_second: 240, wave_output_tokens_per_second: 125,
      average_prefill_seconds: 1, average_decode_seconds: 2, average_request_seconds: 4, wave_seconds: 4, finish_reasons: ['length'],
      evidence: { schema: 'ginfer-resident-benchmark-v1', corpus: 'fixture-max-perf-tail2048-v1', configuration: { ...configuration },
        warmup: [{ ...wave, computed_tokens: 2048 * concurrency, output_tokens: 500 * concurrency, decode_tokens: 480 * concurrency, decode_rounds: 120 * concurrency }],
        measured: [{ ...wave, computed_tokens: 2048 * concurrency, output_tokens: 500 * concurrency, decode_tokens: 480 * concurrency, decode_rounds: 120 * concurrency }] } })),
  }
}

describe('G.bench public submission', () => {
  it.each<BenchmarkModelClass>(['qwen27-int-dflash-q4', 'qwen27-nvfp4-dflash-q4', 'flash-smol-mtp', 'flash-int-mtp'])('accepts the exact %s Max Perf release policy without adding public v1 fields', modelClass => {
    const run = fixture(modelClass)
    expect(maxPerfSessionMismatch(run.session)).toBeNull()
    const payload = buildSubmission(run, 'Player One')
    expect(payload.schema).toBe('gbench-submission-v1')
    expect(Object.keys(payload)).toEqual(['schema', 'benchmark_id', 'methodology', 'run_id', 'nickname', 'hardware', 'configuration', 'points'])
    expect(Object.keys(payload.configuration)).toEqual(['engine_build', 'model', 'weights', 'tp', 'draft_tp', 'max_context', 'max_concurrency', 'kv_dtype', 'spec', 'draft_tokens', 'draft_policy', 'cuda_graph', 'vision'])
    expect(Object.keys(payload.points[0])).toEqual(['concurrency', 'corpus', 'warmup', 'measured'])
    expect(Object.keys(payload.points[0].measured)).toEqual(['full_cold_prompt', 'computed_tokens', 'compute_seconds', 'cached_tokens', 'output_tokens', 'mean_ttft_seconds', 'decode_tokens', 'decode_rounds', 'decode_seconds', 'wall_seconds'])
    expect(JSON.stringify(payload)).not.toContain('benchmark_profile')
    expect(JSON.stringify(payload)).not.toContain('private-')
  })
  it('rejects missing or unknown profile metadata, historical drafter classes and unspecified Muse', () => {
    for (const change of [
      { benchmark_profile: undefined },
      { benchmark_profile: { id: 'custom', version: 1, model_class: 'flash-int-mtp' } },
      { benchmark_profile: { id: 'gbench-max-perf', version: 2, model_class: 'flash-int-mtp' } },
      { benchmark_profile: { id: 'gbench-max-perf', version: 1, model_class: 'muse' } },
      { model_id: 'qwen3.8-27b/nvfp4-dflash2-nvfp4' },
      { model_id: 'muse-glimmer-30b/groupwise-int-dflash-q4' },
    ]) {
      const run = fixture()
      Object.assign(run.session, change)
      expect(maxPerfSessionMismatch(run.session)).not.toBeNull()
      expect(() => buildSubmission(run, 'Player')).toThrow('Max Perf')
    }
  })
  it('rejects changed or missing selected-session facts before constructing a submission', () => {
    for (const change of [{ session_id: null }, { target_id: '' }, { tp: undefined }, { tp: 2 },
      { draft_policy: undefined }, { draft_policy: 'auto' }, { max_context: 8192 }, { max_concurrency: 4 },
      { kv_dtype: 'auto' }, { spec: 'auto' }, { draft_tokens: 3 }, { draft_tp: 0 }, { cuda_graph: false }, { vision: false }]) {
      const run = fixture()
      Object.assign(run.session, change)
      expect(maxPerfSessionMismatch(run.session)).not.toBeNull()
      expect(() => buildSubmission(run, 'Player')).toThrow('session')
    }
  })
  it('normalizes the live-session graph flag without inventing missing policy facts', () => {
    const run = fixture('flash-smol-mtp')
    const { cuda_graph, ...session } = run.session
    const live = { ...session, port: null, is_embedding: false, kv_arena_bytes: 'auto', no_cuda_graph: !cuda_graph }
    expect(maxPerfSessionMismatch(live)).toBeNull()
    expect(maxPerfSessionMismatch({ ...live, no_cuda_graph: true })).toContain('session')
    expect(maxPerfSessionMismatch({ ...live, draft_policy: undefined })).toContain('session')
    const missingGraph = { ...live }; Reflect.deleteProperty(missingGraph, 'no_cuda_graph')
    expect(maxPerfSessionMismatch(missingGraph)).toContain('no reported CUDA graph status')
  })
  it('rejects session/configuration differences and changed configurations between points', () => {
    for (const change of [{ model: 'muse-glimmer-30b' }, { weights: 'groupwise-int-dflash2-q4-g32' },
      { max_context: 131072 }, { max_concurrency: 4 }, { tp: 2 }, { draft_tp: 0 },
      { kv_dtype: 'bf16' }, { spec: 'none' }, { draft_tokens: 0 }, { draft_policy: 'adaptive' },
      { cuda_graph: false }, { vision: false }]) {
      const run = fixture()
      Object.assign(run.points[0].evidence.configuration, change)
      expect(() => buildSubmission(run, 'Player')).toThrow('actual selected')
    }
    for (const change of [{ engine_build: 'other-engine' }, { vision: false }, { draft_tokens: 1 }]) {
      const run = fixture()
      Object.assign(run.points[1].evidence.configuration, change)
      expect(() => buildSubmission(run, 'Player')).toThrow('contract')
    }
    const v2 = fixture(); v2.points[0].evidence.schema = 'ginfer-resident-benchmark-v2'
    expect(() => buildSubmission(v2, 'Player')).toThrow('contract')
    for (const build of ['', '   ']) {
      const noBuild = fixture(); noBuild.points.forEach(point => { point.evidence.configuration.engine_build = build })
      expect(() => buildSubmission(noBuild, 'Player')).toThrow('Engine build')
    }
    for (const corpus of ['', '   ']) {
      const noCorpus = fixture(); noCorpus.points.forEach(point => { point.evidence.corpus = corpus })
      expect(() => buildSubmission(noCorpus, 'Player')).toThrow('corpus')
    }
    const changedCorpus = fixture(); changedCorpus.points[1].evidence.corpus = 'other-corpus'
    expect(() => buildSubmission(changedCorpus, 'Player')).toThrow('contract')
    const noPrefix = fixture(); noPrefix.points[1].evidence.configuration.prefix_reuse = false
    expect(() => buildSubmission(noPrefix, 'Player')).toThrow('contract')
    const prefixOn = fixture(); prefixOn.points.forEach(point => { point.evidence.configuration.prefix_reuse = true })
    expect(buildSubmission(prefixOn, 'Player').configuration).not.toHaveProperty('prefix_reuse')
  })
  it('rejects incorrect or unrepresented warmup and measured token totals at C4 and C8', () => {
    for (const pointIndex of [1, 2]) {
      for (const phase of ['warmup', 'measured'] as const) {
        for (const change of [{ computed_tokens: 2048 }, { cached_tokens: 1 }, { output_tokens: 500 },
          { computed_tokens: -1 }, { cached_tokens: 0.5 }, { output_tokens: Number.NaN }, { computed_tokens: Number.POSITIVE_INFINITY }]) {
          const run = fixture()
          Object.assign(run.points[pointIndex].evidence[phase][0], change)
          expect(() => buildSubmission(run, 'Player')).toThrow('wave')
        }
      }
    }
    const cached = fixture()
    cached.points.forEach(point => { point.evidence.measured[0].computed_tokens = 0; point.evidence.measured[0].cached_tokens = 2048 * point.concurrency })
    expect(buildSubmission(cached, 'Player').points[2].measured.cached_tokens).toBe(16384)
  })
  it('reserves brand nicknames including case and separator variants', () => {
    for (const nickname of ['Sectile.labs', 'SECTILE.LABS', 'sectilelabs', 'Sectile Labs', 'sectile_labs', 'sectile-labs', 'Sectile Research Laboratories', 'Official Sectile', 's.e.c.t.i.l.e']) {
      expect(() => buildSubmission(fixture(), nickname)).toThrow('reserved')
    }
    for (const brand of ['ginfer', 'gchat', 'gbench']) {
      for (const nickname of [brand, brand.toUpperCase(), `Official ${brand} Team`,
        ...[' ', '.', '_', '-', ' ._-'].map(separator => [...brand].join(separator))]) {
        expect(() => buildSubmission(fixture(), nickname), nickname).toThrow('reserved')
      }
    }
    for (const nickname of ['Player One', 'GPU Tester', 'Chat Fan', 'Bench Runner']) {
      expect(buildSubmission(fixture(), nickname).nickname).toBe(nickname)
    }
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
  it('requires C1/C4/C8 in order and rejects altered workloads', () => {
    const run = fixture(); run.points.pop()
    expect(() => buildSubmission(run, 'Player')).toThrow('C1, C4 and C8')
    run.points = fixture().points.reverse()
    expect(() => buildSubmission(run, 'Player')).toThrow('C1, C4 and C8')
    run.points = fixture().points
    run.points[0].requested_output_tokens = 499
    expect(() => buildSubmission(run, 'Player')).toThrow('contract')
  })
  it('keeps publishing disabled without native submission or ownership writes', async () => {
    expect(GBENCH_PUBLISHING_ENABLED).toBe(false)
    await expect(submitStandardBenchmark(fixture(), 'Player')).rejects.toThrow('not enabled')
    expect(invoke).not.toHaveBeenCalled()
    expect(localStorage.getItem(localStorageKey.gbenchReceipts)).toBeNull()
  })
})

describe('G.bench receipt-owned deletion', () => {
  const id = 'published-run-001'
  const receipt = { run_id: id, delete_token: 'b'.repeat(64), owner_token: 'c'.repeat(64) }
  const other = { run_id: 'other-published-run', delete_token: 'd'.repeat(64) }
  const pending = { owner_token: 'e'.repeat(64) }
  const save = () => localStorage.setItem(localStorageKey.gbenchReceipts, JSON.stringify({ [id]: receipt, [other.run_id]: other, 'pending-run-001': pending }))

  it('restores ownership independently of local benchmark history and clears only a confirmed deletion', async () => {
    save()
    expect(ownedLeaderboardResults()).toEqual([receipt, other])
    vi.mocked(invoke).mockResolvedValueOnce(undefined)
    await deleteLeaderboardResult(id)
    expect(invoke).toHaveBeenCalledWith('delete_benchmark', { runId: id, deleteToken: receipt.delete_token })
    expect(ownedLeaderboardResults()).toEqual([other])
    expect(JSON.parse(localStorage.getItem(localStorageKey.gbenchReceipts)!)['pending-run-001']).toEqual(pending)
  })

  it('keeps the exact receipt and unrelated results after a failed or lost response', async () => {
    save()
    const before = localStorage.getItem(localStorageKey.gbenchReceipts)
    vi.mocked(invoke).mockRejectedValueOnce(new Error('Invalid deletion receipt.'))
    await expect(deleteLeaderboardResult(id)).rejects.toThrow('Invalid deletion receipt.')
    expect(localStorage.getItem(localStorageKey.gbenchReceipts)).toBe(before)
    vi.mocked(invoke).mockResolvedValueOnce(undefined)
    await deleteLeaderboardResult(id)
    expect(vi.mocked(invoke).mock.calls[1][1]).toEqual(vi.mocked(invoke).mock.calls[0][1])
  })

  it('refuses absent or mismatched receipt ownership without sending DELETE', async () => {
    localStorage.setItem(localStorageKey.gbenchReceipts, JSON.stringify({ [id]: { ...receipt, run_id: other.run_id } }))
    await expect(deleteLeaderboardResult(id)).rejects.toThrow('No saved deletion receipt')
    expect(invoke).not.toHaveBeenCalled()
  })

  it('reports public success separately when local receipt persistence fails', async () => {
    save()
    vi.mocked(invoke).mockResolvedValueOnce(undefined)
    const storage = vi.spyOn(Storage.prototype, 'setItem').mockImplementationOnce(() => { throw new Error('Storage unavailable') })
    try {
      await expect(deleteLeaderboardResult(id)).rejects.toThrow('public result was removed, but its local receipt could not be cleared')
      expect(ownedLeaderboardResults()).toEqual([receipt, other])
    } finally { storage.mockRestore() }
  })
})

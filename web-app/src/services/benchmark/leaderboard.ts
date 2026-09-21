import type { BenchmarkConfiguration, BenchmarkResult, BenchmarkWave } from './tauri'
import { invoke } from '@tauri-apps/api/core'
import { localStorageKey } from '@/constants/localStorage'

export const GBENCH_URL = 'https://sectilelabs.ai/gbench'
export const GBENCH_PUBLISHING_ENABLED = true

function configuration(c: BenchmarkConfiguration): BenchmarkConfiguration {
  return { engine_build: c.engine_build, model: c.model, weights: c.weights,
    tp: c.tp, draft_tp: c.draft_tp, max_context: c.max_context, max_concurrency: c.max_concurrency,
    kv_dtype: c.kv_dtype, spec: c.spec, draft_tokens: c.draft_tokens, draft_policy: c.draft_policy,
    cuda_graph: c.cuda_graph, vision: c.vision }
}

function wave(w: BenchmarkWave): BenchmarkWave {
  return { full_cold_prompt: w.full_cold_prompt, computed_tokens: w.computed_tokens,
    compute_seconds: w.compute_seconds, cached_tokens: w.cached_tokens,
    output_tokens: w.output_tokens, mean_ttft_seconds: w.mean_ttft_seconds,
    decode_tokens: w.decode_tokens, decode_rounds: w.decode_rounds,
    decode_seconds: w.decode_seconds, wall_seconds: w.wall_seconds }
}

export function buildSubmission(run: BenchmarkResult, nickname: string) {
  if (run.benchmark_id !== 'standard' || run.methodology !== 'ginfer-resident-max-perf-v1') throw new Error('Only Standard Benchmark results can be submitted.')
  const name = nickname.trim()
  const normalizedName = name.toLowerCase().replace(/[ ._-]/g, '')
  if (['sectile', 'ginfer', 'gchat', 'gbench'].some(brand => normalizedName.includes(brand))) throw new Error('Sectile, GInfer, GChat, and GBench names are reserved for official Sectile Labs results. Please choose another nickname.')
  if (!/^[\p{L}\p{N}_. -]{2,32}$/u.test(name)) throw new Error('Use 2–32 letters, numbers, spaces, dots, underscores or hyphens for your public nickname.')
  const h = run.hardware
  if (!h || !h.gpus.length || !run.points.length) throw new Error('This run has no complete inference-host hardware record. Run Standard Benchmark on an updated host.')
  const config = configuration(run.points[0].evidence.configuration)
  const expected = [1, 4, 8].filter(c => c <= config.max_concurrency)
  if (JSON.stringify(run.points.map(p => p.concurrency)) !== JSON.stringify(expected)) throw new Error('Standard Benchmark must complete every supported C1/C4/C8 point.')
  return {
    schema: 'gbench-submission-v1', benchmark_id: 'standard', methodology: run.methodology,
    run_id: run.run_id, nickname: name,
    hardware: { cpu_model: h.cpu_model, physical_cores: h.physical_cores,
      logical_threads: h.logical_threads, ram_bytes: h.ram_bytes, ram_speed_mt_s: h.ram_speed_mt_s,
      os: h.os, os_version: h.os_version, resource_scope: h.resource_scope,
      gpus: h.gpus.map(g => ({ model: g.model, vram_mib: g.vram_mib, sm: g.sm })) },
    configuration: config,
    points: run.points.map(p => {
      if (p.requested_prompt_tokens !== 2048 || p.requested_output_tokens !== 500 ||
          p.evidence.warmup.length !== 1 || p.evidence.measured.length !== 1 ||
          JSON.stringify(configuration(p.evidence.configuration)) !== JSON.stringify(config)) throw new Error('The result does not match the Standard Benchmark contract.')
      return { concurrency: p.concurrency, corpus: p.evidence.corpus,
        warmup: wave(p.evidence.warmup[0]), measured: wave(p.evidence.measured[0]) }
    }),
  }
}

export async function submitStandardBenchmark(run: BenchmarkResult, nickname: string) {
  if (!GBENCH_PUBLISHING_ENABLED) throw new Error('Leaderboard publishing is not enabled yet.')
  const payload = JSON.stringify(buildSubmission(run, nickname))
  const receipts = JSON.parse(localStorage.getItem(localStorageKey.gbenchReceipts) || '{}')
  const ownerToken: string = receipts[run.run_id]?.owner_token || Array.from(crypto.getRandomValues(new Uint8Array(32)), byte => byte.toString(16).padStart(2, '0')).join('')
  receipts[run.run_id] = { ...receipts[run.run_id], owner_token: ownerToken }
  // Persist ownership before sending, so a lost response can be retried safely.
  localStorage.setItem(localStorageKey.gbenchReceipts, JSON.stringify(receipts))
  const result = await invoke<{ run_id: string; delete_token: string }>('submit_benchmark', {
    payload, ownerToken,
  })
  if (result.run_id !== run.run_id || !/^[a-f0-9]{64}$/.test(result.delete_token)) throw new Error('Invalid leaderboard receipt.')
  const saved = JSON.parse(localStorage.getItem(localStorageKey.gbenchReceipts) || '{}')
  saved[run.run_id] = { ...result, owner_token: ownerToken }
  localStorage.setItem(localStorageKey.gbenchReceipts, JSON.stringify(saved))
  return result
}

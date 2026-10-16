import type { BenchmarkConfiguration, BenchmarkResult, BenchmarkSessionInfo, BenchmarkV2Report, BenchmarkWave } from './tauri'
import type { BenchmarkModelClass, BenchmarkProfileReference } from '@/services/engines'
import { invoke } from '@tauri-apps/api/core'
import { localStorageKey } from '@/constants/localStorage'

export const GBENCH_URL = 'https://sectilelabs.ai/gbench'
export const GBENCH_PUBLISHING_ENABLED = false

type OwnerReceipt = { run_id: string; delete_token: string; owner_token?: string }

export function ownedLeaderboardResults(): OwnerReceipt[] {
  const receipts = JSON.parse(localStorage.getItem(localStorageKey.gbenchReceipts) || '{}')
  if (!receipts || typeof receipts !== 'object' || Array.isArray(receipts)) throw new Error('Invalid saved leaderboard ownership receipts.')
  return Object.entries(receipts).flatMap(([id, value]) => {
    const receipt = value as Partial<OwnerReceipt> | null
    return /^[A-Za-z0-9_-]{8,80}$/.test(id) && receipt?.run_id === id &&
      typeof receipt.delete_token === 'string' && /^[a-f0-9]{64}$/.test(receipt.delete_token)
      ? [receipt as OwnerReceipt] : []
  })
}

export async function deleteLeaderboardResult(runId: string): Promise<void> {
  const receipt = ownedLeaderboardResults().find(receipt => receipt.run_id === runId)
  if (!receipt) throw new Error('No saved deletion receipt for this leaderboard result.')
  await invoke<void>('delete_benchmark', { runId, deleteToken: receipt.delete_token })
  // A failed/lost DELETE retains ownership; only confirmed deletion clears this entry.
  try {
    const receipts = JSON.parse(localStorage.getItem(localStorageKey.gbenchReceipts) || '{}')
    delete receipts[runId]
    localStorage.setItem(localStorageKey.gbenchReceipts, JSON.stringify(receipts))
  } catch {
    throw new Error('The public result was removed, but its local receipt could not be cleared. Retry removal to finish cleanup.')
  }
}

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

// Native v2 contains two complete phase pairs. Public v1 keeps its approved raw-wave
// projection; local v2 scores and the original report remain untouched.
function projectedV2Waves(report: BenchmarkV2Report, concurrency: number): [BenchmarkWave, BenchmarkWave] {
  const invalid = () => new Error('The native v2 evidence does not match the Standard Benchmark contract.')
  const workload = report.workload
  if (!workload || workload.prompt_tokens !== 2048 || workload.output_tokens !== 500 ||
      workload.concurrency !== concurrency || workload.warmup_rounds !== 1 || workload.measured_rounds !== 1 ||
      report.configuration.prefix_reuse !== true || report.cold_prefill?.prefix_reuse !== false ||
      report.warm_generation?.prefix_reuse !== true) throw invalid()
  const logical = 2048 * concurrency
  const positive = (value: number | null) => value === null || (Number.isFinite(value) && Number(value) > 0)
  const close = (value: number | null, expected: number | null) => expected === null
    ? value === null : typeof value === 'number' && Math.abs(value - expected) <= 1e-9 * Math.max(Math.abs(value), Math.abs(expected), 1)
  for (const phase of [report.cold_prefill, report.warm_generation]) {
    if (!Array.isArray(phase.warmup) || !Array.isArray(phase.measured) ||
        phase.warmup.length !== 1 || phase.measured.length !== 1) throw invalid()
    for (const actual of [...phase.warmup, ...phase.measured]) {
      if (!actual || ![actual.logical_prompt_tokens, actual.observed_compute_tokens, actual.computed_tokens,
        actual.cached_tokens, actual.output_tokens, actual.decode_tokens, actual.decode_rounds]
        .every(value => Number.isInteger(value) && value >= 0) ||
          actual.logical_prompt_tokens !== logical || actual.computed_tokens + actual.cached_tokens !== logical ||
          actual.observed_compute_tokens > actual.computed_tokens || actual.output_tokens !== 500 * concurrency ||
          actual.decode_tokens > actual.output_tokens - concurrency || actual.prefix_reuse !== phase.prefix_reuse ||
          ![actual.compute_seconds, actual.mean_ttft_seconds, actual.decode_seconds, actual.wall_seconds,
            actual.prefill_seconds_sum, actual.decode_seconds_sum, actual.request_seconds_sum]
            .every(value => Number.isFinite(value) && value >= 0) || actual.wall_seconds <= 0 ||
          ![actual.warm_prefill_seconds_mean, actual.warm_pp_effective_per_request, actual.warm_cached_ttft_seconds]
            .every(positive)) throw invalid()
      const fullCold = actual.cached_tokens === 0 && actual.computed_tokens === logical && actual.observed_compute_tokens === logical
      const fullWarm = phase.prefix_reuse && actual.cached_tokens === logical && actual.computed_tokens === 0 && actual.observed_compute_tokens === 0
      if (actual.full_cold_prompt !== fullCold || (!phase.prefix_reuse && !fullCold) || actual.warm_cached_prompt !== fullWarm) throw invalid()
      const status = actual.warm_prefill_status
      if (!((status === 'prefix_reuse_disabled' && !phase.prefix_reuse) ||
          (status === 'prefix_incomplete' && phase.prefix_reuse && !fullWarm) ||
          (status === 'prefill_timer_unavailable' && fullWarm) ||
          (status === 'cached' && fullWarm && actual.prefill_seconds_sum > 0))) throw invalid()
      const cachedTiming = fullWarm && status === 'cached'
      if (!close(actual.warm_prefill_seconds_mean, cachedTiming ? actual.prefill_seconds_sum / concurrency : null) ||
          !close(actual.warm_pp_effective_per_request, cachedTiming ? logical / actual.prefill_seconds_sum : null) ||
          (actual.warm_cached_ttft_seconds !== null && (!fullWarm || !close(actual.warm_cached_ttft_seconds, actual.mean_ttft_seconds)))) throw invalid()
    }
  }
  return [report.cold_prefill.warmup[0], report.warm_generation.measured[0]]
}

const maxPerfPolicies: Record<BenchmarkModelClass, { model: string; weights: string; kv: string; spec: string; tokens: number; draftTp: number }> = {
  'qwen27-int-dflash-q4': { model: 'qwen3.8-27b', weights: 'groupwise-int-dflash2-q4', kv: 'int8', spec: 'dflash', tokens: 7, draftTp: 1 },
  'qwen27-nvfp4-dflash-q4': { model: 'qwen3.8-27b', weights: 'nvfp4-dflash2-q4', kv: 'nvfp4', spec: 'dflash', tokens: 7, draftTp: 1 },
  'flash-smol-mtp': { model: 'qwen3.8-flash-next', weights: 'smol-q2g64', kv: 'int8', spec: 'mtp', tokens: 3, draftTp: 0 },
  'flash-int-mtp': { model: 'qwen3.8-flash-next', weights: 'groupwise-int', kv: 'int8', spec: 'mtp', tokens: 3, draftTp: 0 },
}

function maxPerfPolicy(reference?: BenchmarkProfileReference | null) {
  if (reference?.id !== 'gbench-max-perf' || reference.version !== 1 ||
      !Object.prototype.hasOwnProperty.call(maxPerfPolicies, reference.model_class)) {
    throw new Error('Standard Benchmark requires a recorded GBench Max Perf v1 profile for a supported model class.')
  }
  return maxPerfPolicies[reference.model_class]
}

function validateMaxPerfSession(session: BenchmarkResult['session']) {
  const policy = maxPerfPolicy(session.benchmark_profile)
  const identityKnown = session.target_id.startsWith('ginfer/')
    ? typeof session.session_id === 'string' && session.session_id.length > 0
    : Number.isInteger(session.pid) && Number(session.pid) > 0 && session.target_id === `local:${session.pid}`
  if (!identityKnown || session.model_id !== `${policy.model}/${policy.weights}` ||
      session.max_context !== 8181 || session.max_concurrency !== 8 || session.tp !== 1 ||
      session.kv_dtype !== policy.kv || session.spec !== policy.spec || session.draft_tokens !== policy.tokens ||
      session.draft_tp !== policy.draftTp || session.draft_policy !== 'fixed' ||
      session.cuda_graph !== true || session.vision !== true) {
    throw new Error('The selected session does not match its GBench Max Perf profile. Apply the profile and refresh the ready server.')
  }
  return policy
}

export function maxPerfSessionMismatch(session: BenchmarkSessionInfo | BenchmarkResult['session']): string | null {
  try {
    const cudaGraph = 'cuda_graph' in session ? session.cuda_graph
      : typeof session.no_cuda_graph === 'boolean' ? !session.no_cuda_graph : undefined
    if (typeof cudaGraph !== 'boolean') return 'The selected session has no reported CUDA graph status. Refresh an updated Host.'
    validateMaxPerfSession({ ...session, display_name: session.display_name ?? session.model_id,
      session_id: session.session_id ?? null, cuda_graph: cudaGraph })
    return null
  } catch (error) { return error instanceof Error ? error.message : String(error) }
}

export function buildSubmission(run: BenchmarkResult, nickname: string) {
  if (run.benchmark_id !== 'standard' || !['ginfer-resident-max-perf-v1', 'ginfer-resident-max-perf-v2'].includes(run.methodology)) throw new Error('Only Standard Benchmark results can be submitted.')
  const schema = run.methodology === 'ginfer-resident-max-perf-v2' ? 'ginfer-resident-benchmark-v2' : 'ginfer-resident-benchmark-v1'
  if (run.points.some(point => point.evidence.schema !== schema)) throw new Error('The report schema does not match the Standard Benchmark methodology contract.')
  const name = nickname.trim()
  const normalizedName = name.toLowerCase().replace(/[ ._-]/g, '')
  if (['sectile', 'ginfer', 'gchat', 'gbench'].some(brand => normalizedName.includes(brand))) throw new Error('Sectile, GInfer, GChat, and GBench names are reserved for official Sectile Labs results. Please choose another nickname.')
  if (!/^[\p{L}\p{N}_. -]{2,32}$/u.test(name)) throw new Error('Use 2–32 letters, numbers, spaces, dots, underscores or hyphens for your public nickname.')
  const h = run.hardware
  if (!h || !h.gpus.length || !run.points.length) throw new Error('This run has no complete inference-host hardware record. Run Standard Benchmark on an updated host.')
  const config = configuration(run.points[0].evidence.configuration)
  const corpus = run.points[0].evidence.corpus
  if (typeof config.engine_build !== 'string' || !config.engine_build.trim().length || typeof corpus !== 'string' || !corpus.trim().length) {
    throw new Error('The Standard Benchmark result requires an Engine build and corpus identity.')
  }
  const policy = validateMaxPerfSession(run.session)
  if (JSON.stringify(run.points.map(p => p.concurrency)) !== JSON.stringify([1, 4, 8])) throw new Error('Standard Benchmark must complete C1, C4 and C8 in order.')
  if (config.model !== policy.model || config.weights !== policy.weights ||
      config.tp !== run.session.tp || config.draft_tp !== run.session.draft_tp ||
      config.max_context !== run.session.max_context || config.max_concurrency !== run.session.max_concurrency ||
      config.kv_dtype !== run.session.kv_dtype || config.spec !== run.session.spec ||
      config.draft_tokens !== run.session.draft_tokens || config.draft_policy !== run.session.draft_policy ||
      config.cuda_graph !== run.session.cuda_graph || config.vision !== run.session.vision) {
    throw new Error('The benchmark configuration does not match the actual selected Max Perf session.')
  }
  return {
    schema: 'gbench-submission-v1', benchmark_id: 'standard', methodology: 'ginfer-resident-max-perf-v1',
    run_id: run.run_id, nickname: name,
    hardware: { cpu_model: h.cpu_model, physical_cores: h.physical_cores,
      logical_threads: h.logical_threads, ram_bytes: h.ram_bytes, ram_speed_mt_s: h.ram_speed_mt_s,
      os: h.os, os_version: h.os_version, resource_scope: h.resource_scope,
      gpus: h.gpus.map(g => ({ model: g.model, vram_mib: g.vram_mib, sm: g.sm })) },
    configuration: config,
    points: run.points.map(p => {
      const [warmup, measured] = p.evidence.schema === 'ginfer-resident-benchmark-v2'
        ? projectedV2Waves(p.evidence, p.concurrency)
        : [p.evidence.warmup[0], p.evidence.measured[0]]
      if (p.evidence.corpus !== corpus ||
          (Object.prototype.hasOwnProperty.call(p.evidence.configuration, 'prefix_reuse') && p.evidence.configuration.prefix_reuse !== true) ||
          p.requested_prompt_tokens !== 2048 || p.requested_output_tokens !== 500 ||
          (p.evidence.schema === 'ginfer-resident-benchmark-v1' && (p.evidence.warmup.length !== 1 || p.evidence.measured.length !== 1)) ||
          JSON.stringify(configuration(p.evidence.configuration)) !== JSON.stringify(config)) throw new Error('The result does not match the Standard Benchmark contract.')
      for (const actual of [warmup, measured]) {
        if (![actual.computed_tokens, actual.cached_tokens, actual.output_tokens].every(value => Number.isInteger(value) && value >= 0) ||
            actual.computed_tokens + actual.cached_tokens !== 2048 * p.concurrency || actual.output_tokens !== 500 * p.concurrency) {
          throw new Error('The benchmark wave does not match the Standard token workload.')
        }
      }
      return { concurrency: p.concurrency, corpus: p.evidence.corpus,
        warmup: wave(warmup), measured: wave(measured) }
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

import { createFileRoute, useNavigate } from '@tanstack/react-router'
import {
  IconAlertTriangle,
  IconChartLine,
  IconPlayerPlay,
  IconRefresh,
  IconSquare,
  IconTrash,
} from '@tabler/icons-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Progress } from '@/components/ui/progress'
import HeaderPage from '@/containers/HeaderPage'
import { route } from '@/constants/routes'
import { cn } from '@/lib/utils'
import {
  cancelBenchmark,
  listBenchmarkSessions,
  onBenchmarkProgress,
  runBenchmark,
  type BenchmarkPoint,
  type BenchmarkProgress,
  type BenchmarkResult,
  type BenchmarkSessionInfo,
} from '@/services/benchmark/tauri'
import { useBenchmarkStore } from '@/stores/benchmark-store'
import { useEngineHosts } from '@/stores/engine-hosts-store'
import { useModelProvider } from '@/hooks/useModelProvider'
import { engineAlias } from '@/services/engines'
import { BenchmarkServerSettings } from '@/containers/BenchmarkServerSettings'
import { BenchmarkLeaderboard } from '@/containers/BenchmarkLeaderboard'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const Route = createFileRoute(route.benchmark.index as any)({
  component: BenchmarkPage,
})

type PresetId = 'quick' | 'standard' | 'long-context' | 'generation' | 'custom'

type Preset = {
  id: PresetId
  name: string
  description: string
  promptTokens: number
  outputTokens: number
  concurrencies: number[]
  warmupRounds: number
  measuredRounds: number
}

const PRESETS: Preset[] = [
  {
    id: 'quick',
    name: 'Standard Benchmark',
    description: 'Max Perf: 2K prompt, 500 output tokens, C1/C4/C8.',
    promptTokens: 2048,
    outputTokens: 500,
    concurrencies: [1, 4, 8],
    warmupRounds: 1,
    measuredRounds: 1,
  },
  {
    id: 'standard',
    name: 'Serving',
    description: 'Balanced prompt and generation work across C1–C8.',
    promptTokens: 4096,
    outputTokens: 1000,
    concurrencies: [1, 2, 3, 4, 5, 6, 7, 8],
    warmupRounds: 1,
    measuredRounds: 1,
  },
  {
    id: 'long-context',
    name: 'Long context',
    description: 'Heavier KV and prefill pressure with a 32K prompt.',
    promptTokens: 32768,
    outputTokens: 512,
    concurrencies: [1, 2, 3, 4, 5, 6, 7, 8],
    warmupRounds: 1,
    measuredRounds: 1,
  },
  {
    id: 'generation',
    name: 'Big Bench',
    description: '64K prompt and 64K generated tokens.',
    promptTokens: 65536,
    outputTokens: 65536,
    concurrencies: [1, 2, 3, 4, 5, 6, 7, 8],
    warmupRounds: 1,
    measuredRounds: 1,
  },
  {
    id: 'custom',
    name: 'Custom',
    description: 'Choose the prompt, output, concurrency, and repeat counts.',
    promptTokens: 2048,
    outputTokens: 512,
    concurrencies: [1],
    warmupRounds: 1,
    measuredRounds: 1,
  },
]

function effectiveConcurrency(session?: BenchmarkSessionInfo): number {
  return session?.max_concurrency || 1
}

function formatRate(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—'
  return value >= 1000
    ? value.toLocaleString(undefined, { maximumFractionDigits: 0 })
    : value.toLocaleString(undefined, { maximumFractionDigits: 1 })
}

function formatSeconds(value: number): string {
  if (!Number.isFinite(value)) return '—'
  return value < 1 ? `${Math.round(value * 1000)} ms` : `${value.toFixed(2)} s`
}

function formatTokens(value: number): string {
  return Math.round(value).toLocaleString()
}

function runLabel(run: BenchmarkResult): string {
  const date = new Date(run.completed_at_ms)
  return `${run.session.display_name ?? run.session.model_id} · ${date.toLocaleDateString()} ${date.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  })}`
}

type ThroughputPoint = Pick<BenchmarkPoint, 'concurrency' | 'cold_prompt_tokens_per_second' | 'prompt_tokens_per_second' | 'generation_tokens_per_second'>

export function ThroughputChart({ points }: { points: ThroughputPoint[] }) {
  const width = 760
  const height = 280
  const margin = { left: 82, right: 82, top: 24, bottom: 44 }
  const plotWidth = width - margin.left - margin.right
  const plotHeight = height - margin.top - margin.bottom
  const promptMaximum = Math.max(1, ...points.flatMap((point) => [point.prompt_tokens_per_second ?? 0, point.cold_prompt_tokens_per_second ?? 0]))
  const generationMaximum = Math.max(1, ...points.map((point) => point.generation_tokens_per_second ?? 0))
  const x = (index: number) =>
    margin.left +
    (points.length === 1 ? plotWidth / 2 : (index / (points.length - 1)) * plotWidth)
  const y = (value: number, maximum: number) => margin.top + plotHeight - (value / maximum) * plotHeight
  const path = (selector: (point: ThroughputPoint) => number | null | undefined, maximum: number) => {
    let connected = false
    return points.map((point, index) => {
      const value = selector(point)
      if (value == null) { connected = false; return '' }
      const segment = `${connected ? 'L' : 'M'} ${x(index)} ${y(value, maximum)}`
      connected = true
      return segment
    }).join(' ')
  }

  return (
    <div className="min-w-0 w-full">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="h-[clamp(160px,30dvh,280px)] w-full"
        role="img"
        aria-label="Prompt and generation throughput by concurrency"
      >
        {[0, 0.25, 0.5, 0.75, 1].map((fraction) => {
          const gridY = margin.top + plotHeight - fraction * plotHeight
          return (
            <g key={fraction}>
              <line
                x1={margin.left}
                x2={width - margin.right}
                y1={gridY}
                y2={gridY}
                className="stroke-border"
                strokeDasharray="4 6"
              />
              <text
                x={margin.left - 10}
                y={gridY + 4}
                textAnchor="end"
                className="fill-muted-foreground text-[11px]"
              >
                {formatRate(promptMaximum * fraction)}
              </text>
              <text
                x={width - margin.right + 10}
                y={gridY + 4}
                textAnchor="start"
                className="fill-muted-foreground text-[11px]"
              >
                {formatRate(generationMaximum * fraction)}
              </text>
            </g>
          )
        })}
        <path d={path((point) => point.cold_prompt_tokens_per_second, promptMaximum)} fill="none" stroke="currentColor" className="text-primary" strokeWidth="2" strokeDasharray="3 4" />
        <path d={path((point) => point.prompt_tokens_per_second, promptMaximum)} fill="none" stroke="#20b8a6" strokeWidth="3" />
        <path d={path((point) => point.generation_tokens_per_second, generationMaximum)} fill="none" stroke="#7dd3fc" strokeWidth="3" strokeDasharray="7 4" />
        {points.map((point, index) => (
          <g key={point.concurrency}>
            {point.prompt_tokens_per_second != null && <circle cx={x(index)} cy={y(point.prompt_tokens_per_second, promptMaximum)} r="5" fill="#20b8a6">
              <title>{`C${point.concurrency} prompt: ${formatRate(point.prompt_tokens_per_second)} t/s`}</title>
            </circle>}
            {point.generation_tokens_per_second != null && <circle cx={x(index)} cy={y(point.generation_tokens_per_second, generationMaximum)} r="4" fill="#7dd3fc">
              <title>{`C${point.concurrency} generation: ${formatRate(point.generation_tokens_per_second)} t/s`}</title>
            </circle>}
            {point.cold_prompt_tokens_per_second != null && <circle cx={x(index)} cy={y(point.cold_prompt_tokens_per_second, promptMaximum)} r="4" fill="currentColor" className="text-primary"><title>{`C${point.concurrency} Cold PP: ${formatRate(point.cold_prompt_tokens_per_second)} t/s`}</title></circle>}
            <text
              x={x(index)}
              y={height - 16}
              textAnchor="middle"
              className="fill-muted-foreground text-xs"
            >
              C{point.concurrency}
            </text>
          </g>
        ))}
        <text
          x="16"
          y={height / 2}
          transform={`rotate(-90 16 ${height / 2})`}
          textAnchor="middle"
          className="fill-muted-foreground text-[11px]"
        >
          Prompt t/s (left)
        </text>
        <text
          x={width - 16}
          y={height / 2}
          transform={`rotate(90 ${width - 16} ${height / 2})`}
          textAnchor="middle"
          className="fill-muted-foreground text-[11px]"
        >
          Generation t/s (right)
        </text>
      </svg>
      <div className="flex justify-center gap-5 text-xs text-muted-foreground">
        <span className="flex items-center gap-2 text-primary">Cold PP · left axis (dotted)</span>
        <span className="flex items-center gap-2"><span className="size-2.5 rounded-full bg-[#20b8a6]" />PP · left axis</span>
        <span className="flex items-center gap-2"><span className="size-2.5 rounded-full bg-[#7dd3fc]" />Generation · right axis (dashed)</span>
      </div>
    </div>
  )
}

function ResultsTable({ points }: { points: BenchmarkPoint[] }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border/70">
      <table className="w-full min-w-[1040px] text-sm">
        <thead className="bg-muted/45 text-left text-xs text-muted-foreground">
          <tr>
            <th className="px-3 py-2.5 font-medium">Concurrency</th>
            <th className="px-3 py-2.5 font-medium">Prompt / request</th>
            <th className="px-3 py-2.5 font-medium">Output / request</th>
            <th className="px-3 py-2.5 font-medium">Cold PP t/s</th>
            <th className="px-3 py-2.5 font-medium">PP t/s</th>
            <th className="px-3 py-2.5 font-medium">Generation t/s</th>
            <th className="px-3 py-2.5 font-medium">Per-request t/s</th>
            <th className="px-3 py-2.5 font-medium">Prefill</th>
            <th className="px-3 py-2.5 font-medium">Decode</th>
            <th className="px-3 py-2.5 font-medium">Wave</th>
            <th className="px-3 py-2.5 font-medium">Finish</th>
          </tr>
        </thead>
        <tbody>
          {points.map((point) => (
            <tr key={point.concurrency} className="border-t border-border/60">
              <td className="px-3 py-3 font-medium text-foreground">C{point.concurrency}</td>
              <td className="px-3 py-3">{formatTokens(point.average_prompt_tokens)}</td>
              <td className="px-3 py-3">{formatTokens(point.average_completion_tokens)}</td>
              <td className="px-3 py-3 font-mono text-foreground" title="Actual prefill compute rate from the first warmup. Unavailable when a full cold prompt was not computed.">{formatRate(point.cold_prompt_tokens_per_second)}</td>
              <td className="px-3 py-3 font-mono text-foreground">{formatRate(point.prompt_tokens_per_second)}</td>
              <td className="px-3 py-3 font-mono text-foreground">{formatRate(point.generation_tokens_per_second)}</td>
              <td className="px-3 py-3 font-mono">{formatRate(point.per_request_generation_tokens_per_second)}</td>
              <td className="px-3 py-3">{formatSeconds(point.average_prefill_seconds)}</td>
              <td className="px-3 py-3">{formatSeconds(point.average_decode_seconds)}</td>
              <td className="px-3 py-3">{formatSeconds(point.wave_seconds)}</td>
              <td className="px-3 py-3">
                <span>{point.finish_reasons.join(', ')}</span>
                {point.cached_prompt_tokens > 0 && (
                  <span className="ml-2 text-amber-500" title="Prompt tokens served from the prefix cache">
                    {point.cached_prompt_tokens.toLocaleString()} cached
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function BenchmarkPage() {
  const navigate = useNavigate()
  const [sessions, setSessions] = useState<BenchmarkSessionInfo[]>([])
  const [selectedTarget, setSelectedTarget] = useState<string | null>(null)
  const [loadingSessions, setLoadingSessions] = useState(true)
  const [pendingSettings, setPendingSettings] = useState(false)
  const [presetId, setPresetId] = useState<PresetId>('quick')
  const [promptTokens, setPromptTokens] = useState(2048)
  const [outputTokens, setOutputTokens] = useState(500)
  const [concurrencies, setConcurrencies] = useState<number[]>([1, 4, 8])
  const [warmupRounds, setWarmupRounds] = useState(1)
  const [measuredRounds, setMeasuredRounds] = useState(1)
  const [activeRunId, setActiveRunId] = useState<string | null>(null)
  const [progress, setProgress] = useState<BenchmarkProgress | null>(null)
  const runs = useBenchmarkStore((state) => state.runs)
  const selectedRunId = useBenchmarkStore((state) => state.selectedRunId)
  const addRun = useBenchmarkStore((state) => state.addRun)
  const selectRun = useBenchmarkStore((state) => state.selectRun)
  const deleteRun = useBenchmarkStore((state) => state.deleteRun)

  const selectedSession = sessions.find((session) => session.target_id === selectedTarget)
  const selectedIsLocal = useEngineHosts(state => state.hosts.some(host => host.local && selectedTarget?.startsWith(`ginfer/${host.host_id}/`)))
  const maxConcurrency = effectiveConcurrency(selectedSession)
  const selectedRun = runs.find((run) => run.run_id === selectedRunId) ?? runs[0]

  const refreshSessions = useCallback(async () => {
    setLoadingSessions(true)
    try {
      await useEngineHosts.getState().refresh()
      const { hosts, snapshots, errors } = useEngineHosts.getState()
      const readyTargets = new Set(hosts.filter(host => !errors[host.host_id]).flatMap(host =>
        (snapshots[host.host_id]?.instances ?? []).filter(instance => instance.status === 'ready')
          .map(instance => engineAlias(host.host_id, instance.instance_id))))
      const loaded = (await listBenchmarkSessions()).filter(
        (session) => !session.is_embedding && readyTargets.has(session.target_id)
      )
      setSessions(loaded)
      const currentModel = useModelProvider.getState().selectedModel?.id
      setSelectedTarget((current) =>
        current ?? loaded.find(session => session.target_id === currentModel)?.target_id
          ?? loaded.find(session => session.model_id === currentModel && hosts.some(host => host.local && session.target_id.startsWith(`ginfer/${host.host_id}/`)))?.target_id
          ?? loaded.find(session => hosts.some(host => host.local && session.target_id.startsWith(`ginfer/${host.host_id}/`)))?.target_id
          ?? loaded[0]?.target_id ?? null
      )
    } catch (error) {
      setSessions([])
      toast.error('Could not read loaded GInfer models', {
        description: String(error),
      })
    } finally {
      setLoadingSessions(false)
    }
  }, [])

  useEffect(() => {
    void refreshSessions()
    if (activeRunId) return
    const timer = window.setInterval(() => void refreshSessions(), 10000)
    return () => window.clearInterval(timer)
  }, [refreshSessions, activeRunId])

  useEffect(() => {
    let unlisten: (() => void) | undefined
    void onBenchmarkProgress((next) => {
      setProgress((current) =>
        !current || current.run_id === next.run_id ? next : current
      )
    }).then((dispose) => {
      unlisten = dispose
    })
    return () => unlisten?.()
  }, [])

  useEffect(() => {
    setConcurrencies((values) => {
      if (presetId === 'quick') return [1, 4, 8].filter(value => value <= maxConcurrency)
      const valid = values.filter((value) => value <= maxConcurrency)
      return valid.length > 0 ? valid : [1]
    })
  }, [maxConcurrency, presetId])

  const selectPreset = (preset: Preset) => {
    setPresetId(preset.id)
    setPromptTokens(preset.promptTokens)
    setOutputTokens(preset.outputTokens)
    setConcurrencies(
      preset.concurrencies.filter((value) => value <= maxConcurrency)
    )
    setWarmupRounds(preset.warmupRounds)
    setMeasuredRounds(preset.measuredRounds)
  }

  const availableConcurrency = useMemo(
    () => (presetId === 'quick' ? [1, 4, 8] : [1, 2, 3, 4, 5, 6, 7, 8]).filter((value) => value <= maxConcurrency),
    [maxConcurrency, presetId]
  )

  const toggleConcurrency = (value: number) => {
    setConcurrencies((current) => {
      if (current.includes(value)) {
        const next = current.filter((item) => item !== value)
        return next.length > 0 ? next : current
      }
      return [...current, value].sort((left, right) => left - right)
    })
  }

  const startBenchmark = async () => {
    if (!selectedSession || activeRunId || pendingSettings || loadingSessions) return
    const runId = crypto.randomUUID()
    setActiveRunId(runId)
    setProgress({
      run_id: runId,
      completed_points: 0,
      total_points: concurrencies.length,
      concurrency: 0,
      phase: 'preparing',
    })
    try {
      const result = await runBenchmark({
        benchmark_id: presetId === 'quick' ? 'standard' : presetId === 'standard' ? 'serving' : presetId === 'generation' ? 'big-bench' : presetId,
        run_id: runId,
        session_pid: selectedSession.pid,
        prompt_tokens: promptTokens,
        max_output_tokens: outputTokens,
        concurrencies,
        warmup_rounds: warmupRounds,
        measured_rounds: measuredRounds,
      }, selectedSession.target_id)
      addRun(result)
      toast.success('Benchmark complete', {
        description: `${result.session.display_name} · ${result.points.length} measured points`,
      })
    } catch (error) {
      if (!String(error).toLowerCase().includes('cancelled')) {
        toast.error('Benchmark failed', { description: String(error) })
      }
    } finally {
      setActiveRunId(null)
      setProgress(null)
    }
  }

  const stopBenchmark = async () => {
    if (!activeRunId) return
    try {
      await cancelBenchmark(activeRunId)
    } catch (error) {
      toast.error('Could not stop benchmark', { description: String(error) })
    }
  }

  const progressValue = progress
    ? ((progress.completed_points + (progress.phase === 'complete' ? 0 : 0.25)) /
        Math.max(progress.total_points, 1)) *
      100
    : 0

  return (
    <div className="grid h-svh min-w-0 grid-rows-[auto_minmax(0,1fr)] overflow-hidden bg-background text-foreground">
      <HeaderPage>
        <div className="flex items-center justify-between pr-4">
          <div className="flex items-center gap-2">
            <IconChartLine className="size-5 text-primary" />
            <span className="font-studio text-base font-medium">Benchmark</span>
          </div>
          <Button variant="ghost" size="sm" onClick={() => void refreshSessions()} disabled={loadingSessions || !!activeRunId}>
            <IconRefresh className={cn(loadingSessions && 'animate-spin')} />
            Refresh server
          </Button>
        </div>
      </HeaderPage>

      <main className="min-h-0 min-w-0 flex-1 overflow-auto px-5 pb-8">
        <div className="mx-auto flex min-w-0 w-full max-w-7xl flex-col gap-5">
          {sessions.length === 0 && !loadingSessions && (
            <div className="flex min-h-[420px] flex-col items-center justify-center rounded-xl border border-dashed border-border bg-card/40 text-center">
              <div className="mb-4 flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary">
                <IconChartLine className="size-6" />
              </div>
              <h1 className="text-lg font-medium">Load a model to benchmark it</h1>
              <p className="mt-2 max-w-md text-sm text-muted-foreground">
                Benchmarks run against the GInfer server already loaded by GChat. No second engine or model copy is started.
              </p>
              <Button className="mt-5" onClick={() => navigate({ to: route.hub.index })}>
                Open Models
              </Button>
            </div>
          )}
            <>
              <section className="rounded-xl border border-border/70 bg-card p-5 shadow-sm">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
                  <div className="min-w-0 flex-1">
                    <BenchmarkServerSettings sessions={sessions} selected={selectedSession} select={setSelectedTarget}
                      disabled={!!activeRunId} refresh={refreshSessions} onPendingChange={setPendingSettings} />
                    {selectedSession && (
                      <div className="mt-3 flex flex-wrap gap-2 text-xs text-muted-foreground">
                        <span className="rounded-full bg-muted px-2.5 py-1">{selectedIsLocal ? 'This computer' : 'Paired LAN instance · benchmark shares its capacity'}</span>
                        <span className="rounded-full bg-muted px-2.5 py-1">C1–C{maxConcurrency}</span>
                        <span className="rounded-full bg-muted px-2.5 py-1">Context {selectedSession.max_context ? selectedSession.max_context.toLocaleString() : 'engine default'}</span>
                        <span className="rounded-full bg-muted px-2.5 py-1">KV {selectedSession.kv_dtype || 'auto'}</span>
                        <span className="rounded-full bg-muted px-2.5 py-1">Spec {selectedSession.spec || 'auto'}{selectedSession.draft_tp ? ` · DTP${selectedSession.draft_tp}` : ''}</span>
                        <span className="rounded-full bg-muted px-2.5 py-1">CUDA Graph {selectedSession.no_cuda_graph ? 'off' : 'on'}</span>
                      </div>
                    )}
                  </div>
                  {activeRunId ? (
                    <Button variant="destructive" onClick={() => void stopBenchmark()}>
                      <IconSquare /> Stop
                    </Button>
                  ) : (
                    <Button onClick={() => void startBenchmark()} disabled={!selectedSession || pendingSettings || loadingSessions || concurrencies.length === 0}>
                      <IconPlayerPlay /> Run benchmark
                    </Button>
                  )}
                </div>
                {maxConcurrency === 1 && selectedSession && (
                  <div className="mt-4 flex gap-2 rounded-lg border border-amber-500/25 bg-amber-500/8 px-3 py-2.5 text-sm text-amber-700 dark:text-amber-300">
                    <IconAlertTriangle className="mt-0.5 size-4 shrink-0" />
                    This server was loaded for C1. Reload the model with Max Concurrency 2, 4, or 8 to measure concurrent serving.
                  </div>
                )}
              </section>

              <section className="rounded-xl border border-border/70 bg-card p-5 shadow-sm">
                <div className="mb-4">
                  <h2 className="font-medium">Benchmarks</h2>
                  <p className="mt-1 text-sm leading-relaxed text-muted-foreground">Each preset calls the GInfer engine’s benchmark endpoint with a repeating prompt to exercise its new K/V engine, K/V prefix cache, DFlash2 performance when enabled, and kernels tuned for each GPU architecture (SM) and model. Benchmarks use the selected server’s loaded model and profile.</p>
                  <h3 className="mt-4 text-sm font-medium">Scores captured</h3>
                  <dl className="mt-2 grid gap-x-6 gap-y-3 text-sm md:grid-cols-2">
                    <div>
                      <dt className="font-medium">Cold PP · prompt processing</dt>
                      <dd className="mt-1 leading-relaxed text-muted-foreground">The rate at which the engine actually computes prompt tokens during the first warmup, in tokens per second (t/s). If the prompt was already cached and no complete cold measurement is available, the score shows —.</dd>
                    </div>
                    <div>
                      <dt className="font-medium">PP · effective prompt processing</dt>
                      <dd className="mt-1 leading-relaxed text-muted-foreground">Total prompt tokens across concurrent requests divided by their average time to first token in the measured run. Prefix-cache reuse avoids repeated computation, so this effective rate can be much higher than Cold PP.</dd>
                    </div>
                    <div>
                      <dt className="font-medium">C1–C8 · concurrent requests</dt>
                      <dd className="mt-1 leading-relaxed text-muted-foreground">C1 runs one request at a time; C4 runs four together; C8 runs eight together. Available concurrency depends on the loaded profile. Per-request TG is the aggregate generation rate divided by the number of concurrent requests—not a guarantee that every request runs at exactly that rate.</dd>
                    </div>
                    <div>
                      <dt className="font-medium">TG · aggregate token generation</dt>
                      <dd className="mt-1 leading-relaxed text-muted-foreground">The combined generation speed across all requests at the selected concurrency, measured from the engine’s decode work. For example, 800 t/s at C4 means 200 t/s per request on average. The first token produced during prompt processing is excluded.</dd>
                    </div>
                  </dl>
                  <p className="mt-3 text-xs leading-relaxed text-muted-foreground">Repeating prompts highlight cache reuse and speculative decoding. These are synthetic best-case benchmarks, not predictions of everyday chat or agent performance.</p>
                </div>
                <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
                  {PRESETS.map((preset) => (
                    <button
                      key={preset.id}
                      type="button"
                      disabled={!!activeRunId}
                      onClick={() => selectPreset(preset)}
                      className={cn(
                        'rounded-lg border p-3 text-left transition-colors disabled:opacity-50',
                        presetId === preset.id
                          ? 'border-primary bg-primary/8'
                          : 'border-border/70 hover:border-primary/45 hover:bg-muted/40'
                      )}
                    >
                      <span className="block text-sm font-medium text-foreground">{preset.name}</span>
                      <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">{preset.description}</span>
                    </button>
                  ))}
                </div>

                <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-5">
                  <label className="space-y-1.5 text-sm">
                    <span className="font-medium">Prompt tokens</span>
                    <Input type="number" min={32} max={262144} value={promptTokens} disabled={!!activeRunId} onChange={(event) => { setPresetId('custom'); setPromptTokens(Number(event.target.value)) }} />
                  </label>
                  <label className="space-y-1.5 text-sm">
                    <span className="font-medium">Max output tokens</span>
                    <Input type="number" min={1} max={65536} value={outputTokens} disabled={!!activeRunId} onChange={(event) => { setPresetId('custom'); setOutputTokens(Number(event.target.value)) }} />
                  </label>
                  <label className="space-y-1.5 text-sm">
                    <span className="font-medium">Warmup rounds</span>
                    <Input type="number" min={1} max={5} value={warmupRounds} disabled={!!activeRunId} onChange={(event) => { setPresetId('custom'); setWarmupRounds(Number(event.target.value)) }} />
                  </label>
                  <label className="space-y-1.5 text-sm">
                    <span className="font-medium">Measured rounds</span>
                    <Input type="number" min={1} max={5} value={measuredRounds} disabled={!!activeRunId} onChange={(event) => { setPresetId('custom'); setMeasuredRounds(Number(event.target.value)) }} />
                  </label>
                  <div className="space-y-1.5 text-sm">
                    <span className="font-medium">Concurrency points</span>
                    <div className="flex min-h-9 flex-wrap items-center gap-1.5">
                      {availableConcurrency.map((value) => (
                        <button
                          key={value}
                          type="button"
                          disabled={!!activeRunId || presetId === 'quick'}
                          onClick={() => toggleConcurrency(value)}
                          className={cn(
                            'h-8 min-w-10 rounded-full border px-2 text-xs font-medium transition-colors disabled:opacity-50',
                            concurrencies.includes(value)
                              ? 'border-primary bg-primary text-primary-foreground'
                              : 'border-border bg-background hover:border-primary/50'
                          )}
                        >C{value}</button>
                      ))}
                    </div>
                  </div>
                </div>
              </section>

              {activeRunId && progress && (
                <section className="rounded-xl border border-primary/25 bg-primary/5 p-5">
                  <div className="mb-3 flex items-center justify-between text-sm">
                    <span className="font-medium capitalize">{progress.phase}{progress.concurrency ? ` · C${progress.concurrency}` : ''}</span>
                    <span className="text-muted-foreground">{progress.completed_points} / {progress.total_points} points</span>
                  </div>
                  <Progress value={progressValue} />
                </section>
              )}

              <section className="rounded-xl border border-border/70 bg-card p-5 shadow-sm">
                <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <h2 className="font-medium">Results</h2>
                    <p className="mt-1 text-sm text-muted-foreground">Cold prefill, effective cached-input throughput, and exact-concurrency generation from native Engine counters.</p>
                  </div>
                  {runs.length > 0 && (
                    <div className="flex items-center gap-2">
                      <select
                        value={selectedRun?.run_id ?? ''}
                        onChange={(event) => selectRun(event.target.value)}
                        className="h-9 max-w-[360px] rounded-md border border-input bg-background px-3 text-sm"
                      >
                        {runs.map((run) => <option key={run.run_id} value={run.run_id}>{runLabel(run)}</option>)}
                      </select>
                      <Button variant="ghost" size="icon-sm" aria-label="Delete selected benchmark" onClick={() => selectedRun && deleteRun(selectedRun.run_id)}>
                        <IconTrash />
                      </Button>
                    </div>
                  )}
                </div>

                {selectedRun ? (
                  <div className="space-y-5">
                    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                      <div className="rounded-lg bg-muted/45 p-3"><div className="text-xs text-muted-foreground">Model instance</div><div className="mt-1 truncate text-sm font-medium" title={selectedRun.session.display_name ?? selectedRun.session.model_id}>{selectedRun.session.display_name ?? selectedRun.session.model_id}</div></div>
                      <div className="rounded-lg bg-muted/45 p-3"><div className="text-xs text-muted-foreground">Server capacity</div><div className="mt-1 text-sm font-medium">C{selectedRun.session.max_concurrency} · {selectedRun.session.max_context.toLocaleString()} context</div></div>
                      <div className="rounded-lg bg-muted/45 p-3"><div className="text-xs text-muted-foreground">KV / speculative</div><div className="mt-1 text-sm font-medium">{selectedRun.session.kv_dtype} · {selectedRun.session.spec}{selectedRun.session.draft_tp ? ` DTP${selectedRun.session.draft_tp}` : ''}</div></div>
                      <div className="rounded-lg bg-muted/45 p-3"><div className="text-xs text-muted-foreground">Runtime</div><div className="mt-1 text-sm font-medium">CUDA Graph {selectedRun.session.cuda_graph ? 'on' : 'off'} · {formatSeconds((selectedRun.completed_at_ms - selectedRun.started_at_ms) / 1000)}</div></div>
                    </div>
                    <BenchmarkLeaderboard key={selectedRun.run_id} run={selectedRun} />
                    <ThroughputChart points={selectedRun.points} />
                    <ResultsTable points={selectedRun.points} />
                    <p className="text-xs leading-relaxed text-muted-foreground">
                      Cold PP measures actual prefill computation in the first warmup; — means a complete cold prompt was not observed. PP divides logical input tokens by mean time to first token and includes work avoided by caching. TG uses committed decode tokens and time at the requested concurrency. This repeated-text workload measures synthetic best-case performance, not typical agent workloads.
                    </p>
                  </div>
                ) : (
                  <div className="flex min-h-64 flex-col items-center justify-center rounded-lg border border-dashed border-border text-center">
                    <IconChartLine className="mb-3 size-8 text-muted-foreground/60" />
                    <p className="text-sm font-medium">No benchmark results yet</p>
                    <p className="mt-1 max-w-md text-xs text-muted-foreground">Choose a loaded model and workload, then run the benchmark. The latest 20 completed runs are kept locally for comparison.</p>
                  </div>
                )}
              </section>
            </>
        </div>
      </main>
    </div>
  )
}

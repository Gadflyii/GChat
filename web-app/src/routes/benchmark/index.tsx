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
    name: 'Quick check',
    description: 'A short C1/C4 health and regression check.',
    promptTokens: 512,
    outputTokens: 128,
    concurrencies: [1, 4],
    warmupRounds: 1,
    measuredRounds: 1,
  },
  {
    id: 'standard',
    name: 'Standard serving',
    description: 'Balanced prompt and generation work across C1–C8.',
    promptTokens: 2048,
    outputTokens: 512,
    concurrencies: [1, 2, 4, 8],
    warmupRounds: 1,
    measuredRounds: 1,
  },
  {
    id: 'long-context',
    name: 'Long context',
    description: 'Heavier KV and prefill pressure with an 8K prompt.',
    promptTokens: 8192,
    outputTokens: 512,
    concurrencies: [1, 2, 4, 8],
    warmupRounds: 1,
    measuredRounds: 1,
  },
  {
    id: 'generation',
    name: 'Generation',
    description: 'A longer decode window for sustained generation rates.',
    promptTokens: 512,
    outputTokens: 2048,
    concurrencies: [1, 2, 4, 8],
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

function formatRate(value: number): string {
  if (!Number.isFinite(value)) return '—'
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

function ThroughputChart({ points }: { points: BenchmarkPoint[] }) {
  const width = 760
  const height = 280
  const margin = { left: 66, right: 24, top: 24, bottom: 44 }
  const plotWidth = width - margin.left - margin.right
  const plotHeight = height - margin.top - margin.bottom
  const maximum = Math.max(
    1,
    ...points.flatMap((point) => [
      point.prompt_tokens_per_second,
      point.generation_tokens_per_second,
    ])
  )
  const x = (index: number) =>
    margin.left +
    (points.length === 1 ? plotWidth / 2 : (index / (points.length - 1)) * plotWidth)
  const y = (value: number) => margin.top + plotHeight - (value / maximum) * plotHeight
  const path = (selector: (point: BenchmarkPoint) => number) =>
    points
      .map((point, index) => `${index === 0 ? 'M' : 'L'} ${x(index)} ${y(selector(point))}`)
      .join(' ')

  return (
    <div className="w-full overflow-x-auto">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="min-w-[620px] w-full"
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
                {formatRate(maximum * fraction)}
              </text>
            </g>
          )
        })}
        <path d={path((point) => point.prompt_tokens_per_second)} fill="none" stroke="#20b8a6" strokeWidth="3" />
        <path d={path((point) => point.generation_tokens_per_second)} fill="none" stroke="#7dd3fc" strokeWidth="3" />
        {points.map((point, index) => (
          <g key={point.concurrency}>
            <circle cx={x(index)} cy={y(point.prompt_tokens_per_second)} r="5" fill="#20b8a6">
              <title>{`C${point.concurrency} prompt: ${formatRate(point.prompt_tokens_per_second)} t/s`}</title>
            </circle>
            <circle cx={x(index)} cy={y(point.generation_tokens_per_second)} r="5" fill="#7dd3fc">
              <title>{`C${point.concurrency} generation: ${formatRate(point.generation_tokens_per_second)} t/s`}</title>
            </circle>
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
          tokens / second
        </text>
      </svg>
      <div className="flex justify-center gap-5 text-xs text-muted-foreground">
        <span className="flex items-center gap-2"><span className="size-2.5 rounded-full bg-[#20b8a6]" />Prompt</span>
        <span className="flex items-center gap-2"><span className="size-2.5 rounded-full bg-[#7dd3fc]" />Generation</span>
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
            <th className="px-3 py-2.5 font-medium">Prompt t/s</th>
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
  const [presetId, setPresetId] = useState<PresetId>('quick')
  const [promptTokens, setPromptTokens] = useState(512)
  const [outputTokens, setOutputTokens] = useState(128)
  const [concurrencies, setConcurrencies] = useState<number[]>([1, 4])
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
  const maxConcurrency = effectiveConcurrency(selectedSession)
  const selectedRun = runs.find((run) => run.run_id === selectedRunId) ?? runs[0]

  const refreshSessions = useCallback(async () => {
    setLoadingSessions(true)
    try {
      const loaded = (await listBenchmarkSessions()).filter(
        (session) => !session.is_embedding
      )
      setSessions(loaded)
      setSelectedTarget((current) =>
        loaded.some((session) => session.target_id === current)
          ? current
          : (loaded[0]?.target_id ?? null)
      )
    } catch (error) {
      toast.error('Could not read loaded GInfer models', {
        description: String(error),
      })
    } finally {
      setLoadingSessions(false)
    }
  }, [])

  useEffect(() => {
    void refreshSessions()
  }, [refreshSessions])

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
      const valid = values.filter((value) => value <= maxConcurrency)
      return valid.length > 0 ? valid : [1]
    })
  }, [maxConcurrency])

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
    () => [1, 2, 4, 8].filter((value) => value <= maxConcurrency),
    [maxConcurrency]
  )

  const toggleConcurrency = (value: number) => {
    setPresetId('custom')
    setConcurrencies((current) => {
      if (current.includes(value)) {
        const next = current.filter((item) => item !== value)
        return next.length > 0 ? next : current
      }
      return [...current, value].sort((left, right) => left - right)
    })
  }

  const startBenchmark = async () => {
    if (!selectedSession || activeRunId) return
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
    <div className="flex h-full min-h-0 flex-col bg-background text-foreground">
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

      <main className="min-h-0 flex-1 overflow-y-auto px-5 pb-8">
        <div className="mx-auto flex w-full max-w-7xl flex-col gap-5">
          {sessions.length === 0 && !loadingSessions ? (
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
          ) : (
            <>
              <section className="rounded-xl border border-border/70 bg-card p-5 shadow-sm">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
                  <div className="min-w-0 flex-1">
                    <label htmlFor="benchmark-model" className="mb-2 block text-sm font-medium">Loaded model</label>
                    <select
                      id="benchmark-model"
                      value={selectedTarget ?? ''}
                      onChange={(event) => setSelectedTarget(event.target.value)}
                      disabled={!!activeRunId}
                      className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/40 lg:max-w-xl"
                    >
                      {sessions.map((session) => (
                        <option key={session.target_id} value={session.target_id}>{session.display_name ?? session.model_id}</option>
                      ))}
                    </select>
                    {selectedSession && (
                      <div className="mt-3 flex flex-wrap gap-2 text-xs text-muted-foreground">
                        <span className="rounded-full bg-muted px-2.5 py-1">{selectedSession.pid == null ? 'Paired LAN instance · benchmark shares its capacity' : 'This computer'}</span>
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
                    <Button onClick={() => void startBenchmark()} disabled={!selectedSession || concurrencies.length === 0}>
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
                  <h2 className="font-medium">Workload</h2>
                  <p className="mt-1 text-sm text-muted-foreground">Each preset calibrates its prompt with the resident server tokenizer, warms the selected points, then sends simultaneous non-streaming requests.</p>
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
                    <Input type="number" min={1} max={16384} value={outputTokens} disabled={!!activeRunId} onChange={(event) => { setPresetId('custom'); setOutputTokens(Number(event.target.value)) }} />
                  </label>
                  <label className="space-y-1.5 text-sm">
                    <span className="font-medium">Warmup rounds</span>
                    <Input type="number" min={0} max={5} value={warmupRounds} disabled={!!activeRunId} onChange={(event) => { setPresetId('custom'); setWarmupRounds(Number(event.target.value)) }} />
                  </label>
                  <label className="space-y-1.5 text-sm">
                    <span className="font-medium">Measured rounds</span>
                    <Input type="number" min={1} max={5} value={measuredRounds} disabled={!!activeRunId} onChange={(event) => { setPresetId('custom'); setMeasuredRounds(Number(event.target.value)) }} />
                  </label>
                  <div className="space-y-1.5 text-sm">
                    <span className="font-medium">Concurrency points</span>
                    <div className="flex h-9 items-center gap-1.5">
                      {availableConcurrency.map((value) => (
                        <button
                          key={value}
                          type="button"
                          disabled={!!activeRunId}
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
                    <p className="mt-1 text-sm text-muted-foreground">Aggregate phase throughput from the loaded server’s native <code>x_ginfer</code> timings.</p>
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
                    <ThroughputChart points={selectedRun.points} />
                    <ResultsTable points={selectedRun.points} />
                    <p className="text-xs leading-relaxed text-muted-foreground">
                      Prompt and generation t/s are aggregate phase rates: total tokens divided by the longest request phase in each simultaneous wave. Per-request t/s divides output tokens by summed request decode time. Cached prompt tokens and early stop reasons remain visible so a contaminated or truncated run cannot masquerade as a clean result.
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
          )}
        </div>
      </main>
    </div>
  )
}

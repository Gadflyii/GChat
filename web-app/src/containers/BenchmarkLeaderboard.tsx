import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { BenchmarkResult } from '@/services/benchmark/tauri'
import { buildSubmission, GBENCH_PUBLISHING_ENABLED, GBENCH_URL, submitStandardBenchmark } from '@/services/benchmark/leaderboard'

export function BenchmarkLeaderboard({ run }: { run: BenchmarkResult }) {
  const [nickname, setNickname] = useState('')
  const [consent, setConsent] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState<string | null>(null)
  if (run.benchmark_id !== 'standard') return null
  const hardware = run.hardware
  let preview: ReturnType<typeof buildSubmission> | null = null
  let validationError: string | null = null
  try { preview = buildSubmission(run, nickname || 'Your nickname') } catch (error) { validationError = error instanceof Error ? error.message : String(error) }
  const submit = async () => {
    setSubmitting(true)
    try {
      const receipt = await submitStandardBenchmark(run, nickname)
      setSubmitted(receipt.run_id)
      toast.success('Your benchmark is on the leaderboard!')
    } catch (error) { toast.error('Could not submit benchmark', { description: String(error) }) }
    finally { setSubmitting(false) }
  }
  return <section aria-label="G.bench leaderboard" className="border border-primary/30 bg-primary/5 p-4">
    <h3 className="font-medium">G.bench leaderboard</h3>
    <p className="mt-1 text-sm text-muted-foreground">See how your system stacks up! Share your Standard Benchmark scores and compare with other users running the same GPU and model. Friendly competition, powered by GInfer.</p>
    <details className="mt-3 text-sm">
      <summary className="cursor-pointer text-primary">What will be published</summary>
      <dl className="mt-2 grid gap-2 sm:grid-cols-2">
        <div><dt>CPU</dt><dd className="font-mono text-xs">{hardware?.cpu_model || 'Not reported'} · {hardware?.physical_cores ?? '—'} cores · {hardware?.logical_threads ?? '—'} threads</dd></div>
        <div><dt>System RAM</dt><dd className="font-mono text-xs">{hardware?.ram_bytes ? `${(hardware.ram_bytes / 2 ** 30).toFixed(1)} GiB` : 'Not reported'} · {hardware?.ram_speed_mt_s ? `${hardware.ram_speed_mt_s} MT/s` : 'Speed not reported'}</dd></div>
        <div><dt>GPU</dt><dd className="font-mono text-xs">{hardware?.gpus.map(g => `${g.model} · ${(g.vram_mib / 1024).toFixed(1)} GiB · SM ${g.sm ?? '—'}`).join('; ') || 'Not reported'}</dd></div>
        <div><dt>Operating system</dt><dd className="font-mono text-xs">{hardware?.os ?? 'Not reported'} {hardware?.os_version} {hardware?.os === 'WSL' ? '(WSL-visible CPU and RAM)' : ''}</dd></div>
      </dl>
      <p className="mt-2 text-muted-foreground">Your public nickname, model and engine configuration, scores, and timing counters will be published. No hostname, account name, IP address, model path, credentials, prompts, or generated text are included in the submission. The website receives your connection IP for abuse prevention.</p>
      {preview && <details className="mt-2"><summary className="cursor-pointer">Full submission preview</summary><pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-all font-mono text-xs">{JSON.stringify(preview, null, 2)}</pre></details>}
    </details>
    <div className="mt-4 flex flex-wrap items-end gap-3">
      <label className="min-w-52 flex-1 text-sm">Enter public nickname<Input className="mt-1" value={nickname} maxLength={32} onChange={e => setNickname(e.target.value)} autoComplete="off" disabled={submitting || !!submitted} /></label>
      <Button disabled={!GBENCH_PUBLISHING_ENABLED || !consent || !preview || submitting || !!submitted || !nickname.trim()} onClick={() => void submit()}>{submitting ? 'Submitting…' : 'Submit to leaderboard'}</Button>
    </div>
    <label className="mt-3 flex items-start gap-2 text-xs text-muted-foreground"><input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} />I want to publish this nickname, hardware information, configuration, and scores.</label>
    {!GBENCH_PUBLISHING_ENABLED && <p className="mt-2 text-sm text-muted-foreground">Leaderboard coming soon. Publishing is not enabled yet.</p>}
    {validationError && <p className="mt-2 text-sm text-muted-foreground">{validationError}</p>}
    {submitted && <a className="mt-2 inline-block text-sm text-primary underline" href={`${GBENCH_URL}/?run=${encodeURIComponent(submitted)}`} target="_blank" rel="noreferrer">View your result</a>}
  </section>
}

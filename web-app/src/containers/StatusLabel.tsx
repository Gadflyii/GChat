const tones: Record<string, string> = {
  running: 'text-status-running',
  ready: 'text-status-running',
  finished: 'text-status-done',
  finish: 'text-status-done',
  completed: 'text-status-done',
  failed: 'text-status-failed',
  incompatible: 'text-status-failed',
  blocked: 'text-status-blocked',
  incomplete: 'text-status-blocked',
  queued: 'text-status-queued',
  busy: 'text-status-queued',
  paused: 'text-status-paused',
  cancelled: 'text-status-paused',
}
export function StatusLabel({ status }: { status: string }) {
  return (
    <span
      className={`${tones[status] ?? 'text-muted-foreground'} font-mono text-xs font-medium tracking-wide`}
    >
      {status.replaceAll('_', ' ')}
    </span>
  )
}

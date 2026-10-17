import { useCallback, useEffect, useState } from 'react'
import { listen } from '@tauri-apps/api/event'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { gbot, type SavedAssignment } from '@/services/gbot'

type Schedule = {
  id: string
  workspace_id: string
  prompt: string
  enabled: boolean
  assignment: SavedAssignment
  timing:
    | { kind: 'once'; at: number }
    | { kind: 'interval'; first_at: number; every_seconds: number }
  missed_run_policy: 'run_latest' | 'skip_missed'
  next_at: number | null
  occurrences: {
    task_id: string
    due_at: number
    state: string
    note: string | null
    retry_at: number | null
  }[]
}

export default function GbotSchedules({
  workspaceId,
  assignment,
}: {
  workspaceId: string
  assignment?: SavedAssignment
}) {
  return (
    <WorkspaceSchedules
      key={workspaceId}
      workspaceId={workspaceId}
      assignment={assignment}
    />
  )
}

function WorkspaceSchedules({
  workspaceId,
  assignment,
}: {
  workspaceId: string
  assignment?: SavedAssignment
}) {
  const [schedules, setSchedules] = useState<Schedule[]>([])
  const [prompt, setPrompt] = useState('')
  const [at, setAt] = useState('')
  const [kind, setKind] = useState<'once' | 'interval'>('once')
  const [seconds, setSeconds] = useState('3600')
  const [policy, setPolicy] = useState<'run_latest' | 'skip_missed'>(
    'run_latest'
  )
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [stopped, setStopped] = useState<string | null>(null)
  const refresh = useCallback(async () => {
    try {
      const values = await gbot<{
        schedules: Schedule[]
        stopped: string | null
      }>('schedules')
      setSchedules(
        values.schedules.filter((value) => value.workspace_id === workspaceId)
      )
      setStopped(values.stopped)
      setError('')
    } catch (cause) {
      setError(String(cause))
    }
  }, [workspaceId])
  useEffect(() => {
    void refresh()
    const subscription = listen('gbot-task-update', () => void refresh())
    return () => {
      void subscription.then((stop) => stop())
    }
  }, [refresh])

  async function perform(action: () => Promise<unknown>) {
    setBusy(true)
    setError('')
    try {
      await action()
      await refresh()
    } catch (cause) {
      setError(String(cause))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="rounded-lg border p-3">
      <p className="my-3 text-sm text-muted-foreground">
        Scheduled tasks keep running after GChat closes while Gbot service and
        the assigned inference endpoint are running.
      </p>
      {stopped && (
        <p role="alert" className="mb-3 text-sm text-destructive">
          Scheduling has stopped: {stopped}. Quit and start Gbot service to
          recover before schedules run again.
        </p>
      )}
      {error && (
        <p role="alert" className="mb-3 text-sm text-destructive">
          {error}
        </p>
      )}
      <details>
        <summary className="mb-3 cursor-pointer text-sm">
          Scheduled tasks
        </summary>
        <p className="mb-3 text-xs text-muted-foreground">
          Schedules use this bot’s saved inference assignment and linked
          accounts. Actions keep their existing approval requirements. Disable
          prevents future dispatch; stop a running task in its history.
        </p>
        {schedules.map((schedule) => (
          <article
            key={schedule.id}
            className="mb-3 space-y-2 rounded-md border p-3"
          >
            <p className="whitespace-pre-wrap text-sm">{schedule.prompt}</p>
            <p className="text-xs text-muted-foreground">
              {schedule.enabled ? 'Enabled' : 'Disabled'} ·{' '}
              {schedule.assignment.model} ·{' '}
              {schedule.timing.kind === 'interval'
                ? `Every ${schedule.timing.every_seconds} seconds`
                : 'Once'}
              {schedule.next_at
                ? ` · Next: ${new Date(schedule.next_at * 1000).toLocaleString()}`
                : ' · No future run'}
            </p>
            {schedule.occurrences.some(
              (occurrence) => occurrence.state === 'needs_review'
            ) && (
              <p className="text-sm text-muted-foreground">
                Needs review. Future occurrences are held.
              </p>
            )}
            <Button
              variant="outline"
              disabled={busy}
              onClick={() =>
                void perform(() =>
                  gbot('schedules/enabled', {
                    id: schedule.id,
                    enabled: !schedule.enabled,
                  })
                )
              }
            >
              {schedule.enabled ? 'Disable schedule' : 'Enable schedule'}
            </Button>
            {!!schedule.occurrences.length && (
              <details>
                <summary className="cursor-pointer text-xs">
                  Occurrences
                </summary>
                {schedule.occurrences.map((occurrence) => (
                  <p key={occurrence.task_id} className="mt-1 text-xs">
                    {new Date(occurrence.due_at * 1000).toLocaleString()} ·{' '}
                    {occurrence.state.replaceAll('_', ' ')}
                    {occurrence.note && ` · ${occurrence.note}`}
                    {occurrence.retry_at &&
                      ` · Retry after ${new Date(occurrence.retry_at * 1000).toLocaleString()}`}
                  </p>
                ))}
              </details>
            )}
          </article>
        ))}
        {!assignment && (
          <p className="text-sm text-muted-foreground">
            Save this bot’s inference assignment before creating a schedule.
          </p>
        )}
        <form
          aria-label="Schedule a bot task"
          className="mt-3 space-y-3"
          onSubmit={(event) => {
            event.preventDefault()
            const timestamp = Math.floor(new Date(at).getTime() / 1000)
            if (
              !Number.isFinite(timestamp) ||
              timestamp <= 0 ||
              !prompt.trim() ||
              (kind === 'interval' &&
                (!Number.isSafeInteger(Number(seconds)) ||
                  Number(seconds) <= 0))
            ) {
              setError(
                'Enter a prompt, start time and positive whole interval in seconds.'
              )
              return
            }
            void perform(async () => {
              await gbot('schedules/create', {
                workspace_id: workspaceId,
                prompt,
                timing:
                  kind === 'once'
                    ? { kind, at: timestamp }
                    : {
                        kind,
                        first_at: timestamp,
                        every_seconds: Number(seconds),
                      },
                missed_run_policy: policy,
              })
              setPrompt('')
            })
          }}
        >
          <label className="block text-sm">
            Scheduled task prompt
            <textarea
              aria-label="Scheduled task prompt"
              className="mt-1 min-h-20 w-full rounded-md border bg-background p-2 text-sm"
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              disabled={busy || !assignment}
            />
          </label>
          <label className="block text-sm">
            First run (your local time)
            <Input
              aria-label="Schedule start time"
              type="datetime-local"
              value={at}
              onChange={(event) => setAt(event.target.value)}
              disabled={busy || !assignment}
            />
          </label>
          <label className="block text-sm">
            Repeat
            <select
              aria-label="Schedule repetition"
              className="ml-2 rounded-md border bg-background p-1"
              value={kind}
              onChange={(event) =>
                setKind(event.target.value as 'once' | 'interval')
              }
              disabled={busy || !assignment}
            >
              <option value="once">Once</option>
              <option value="interval">At an interval</option>
            </select>
          </label>
          {kind === 'interval' && (
            <label className="block text-sm">
              Interval in seconds
              <Input
                aria-label="Schedule interval in seconds"
                type="number"
                min="1"
                step="1"
                value={seconds}
                onChange={(event) => setSeconds(event.target.value)}
                disabled={busy || !assignment}
              />
            </label>
          )}
          <label className="block text-sm">
            Missed runs
            <select
              aria-label="Missed run policy"
              className="ml-2 rounded-md border bg-background p-1"
              value={policy}
              onChange={(event) =>
                setPolicy(event.target.value as 'run_latest' | 'skip_missed')
              }
              disabled={busy || !assignment}
            >
              <option value="run_latest">
                Run the latest missed occurrence once
              </option>
              <option value="skip_missed">Skip missed occurrences</option>
            </select>
          </label>
          <p className="text-xs text-muted-foreground">
            After restart, enabling or a backlog of multiple intervals, run only
            the latest occurrence or skip the backlog. Unknown dispatch outcomes
            need review and are never retried automatically.
          </p>
          <Button
            disabled={busy || !!stopped || !assignment || !prompt.trim() || !at}
          >
            Create schedule
          </Button>
        </form>
      </details>
    </div>
  )
}

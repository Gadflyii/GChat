import { useCallback, useEffect, useRef, useState } from 'react'
import { listen } from '@tauri-apps/api/event'
import { Button } from '@/components/ui/button'
import { ChoiceSelect } from '@/components/ui/choice-select'
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
  const [pending, setPending] = useState<{
    label: string
    scheduleId?: string
    refreshing?: boolean
  }>()
  const pendingRef = useRef(false)
  const busy = !!pending
  const [error, setError] = useState('')
  const [refreshError, setRefreshError] = useState('')
  const [stopped, setStopped] = useState<string | null>(null)
  const refreshVersion = useRef(0)
  const refresh = useCallback(async () => {
    const version = ++refreshVersion.current
    try {
      const values = await gbot<{
        schedules: Schedule[]
        stopped: string | null
      }>('schedules')
      if (version !== refreshVersion.current) return
      setSchedules(
        values.schedules.filter((value) => value.workspace_id === workspaceId)
      )
      setStopped(values.stopped)
      setRefreshError('')
    } catch (cause) {
      if (version !== refreshVersion.current) return
      setRefreshError(String(cause))
    }
  }, [workspaceId])
  useEffect(() => {
    void refresh()
    const subscription = listen('gbot-task-update', () => void refresh())
    return () => {
      ++refreshVersion.current
      void subscription.then((stop) => stop())
    }
  }, [refresh])

  async function retryRefresh() {
    if (pendingRef.current) return
    pendingRef.current = true
    setPending({ label: 'Loading schedules…', refreshing: true })
    try {
      await refresh()
    } finally {
      pendingRef.current = false
      setPending(undefined)
    }
  }

  async function perform(
    label: string,
    action: () => Promise<unknown>,
    scheduleId?: string
  ) {
    if (pendingRef.current) return
    pendingRef.current = true
    setPending({ label, scheduleId })
    setError('')
    try {
      await action()
      await refresh()
    } catch (cause) {
      setError(String(cause))
    } finally {
      pendingRef.current = false
      setPending(undefined)
    }
  }

  return (
    <div className="rounded-lg border p-3">
      {stopped && (
        <p role="alert" className="mb-3 text-sm text-destructive">
          Scheduling has stopped: {stopped}. Restart the Gbot service on the
          computer where it runs before scheduled tasks can run again.
        </p>
      )}
      {error && (
        <p role="alert" className="mb-3 text-sm text-destructive">
          {error}
        </p>
      )}
      {refreshError && (
        <div className="mb-3 space-y-2">
          <p role="alert" className="text-sm text-destructive">
            Could not load scheduled tasks. {refreshError}
          </p>
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => void retryRefresh()}
          >
            Retry loading schedules
          </Button>
        </div>
      )}
      {pending && (
        <p role="status" className="mb-3 text-sm text-muted-foreground">
          {pending.label}
        </p>
      )}
      <details>
        <summary className="mb-3 cursor-pointer text-sm">
          Scheduled tasks
        </summary>
        <p className="mb-3 text-sm text-muted-foreground">
          Set a time for this bot to carry out a task. Scheduled tasks can keep
          running after GChat closes, but the Gbot service, the bot’s computer
          and its model server must stay on and connected.
        </p>
        <p className="mb-3 text-xs text-muted-foreground">
          Schedules use the model saved in this bot’s brain settings and the
          accounts you linked to it. Actions still require the same approvals.
          Disable stops future runs; to stop a task already running, open its
          task history.
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
                void perform(
                  schedule.enabled
                    ? 'Disabling schedule…'
                    : 'Enabling schedule…',
                  () =>
                    gbot('schedules/enabled', {
                      id: schedule.id,
                      enabled: !schedule.enabled,
                    }),
                  schedule.id
                )
              }
            >
              {pending?.scheduleId === schedule.id
                ? pending.label
                : schedule.enabled
                  ? 'Disable schedule'
                  : 'Enable schedule'}
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
            Choose a brain, then click Save brain settings before creating a
            schedule.
          </p>
        )}
        <form
          aria-label="Schedule a bot task"
          className="mt-3 space-y-3"
          onSubmit={(event) => {
            event.preventDefault()
            if (pendingRef.current || !assignment || stopped) return
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
            void perform('Creating schedule…', async () => {
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
            <ChoiceSelect
              aria-label="Schedule repetition"
              className="ml-2 rounded-md border bg-background p-1"
              value={kind}
              onValueChange={(value) =>
                setKind(value as 'once' | 'interval')
              }
              disabled={busy || !assignment}
              options={[
                { value: 'once', label: 'Once' },
                { value: 'interval', label: 'At an interval' },
              ]}
            />
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
            <ChoiceSelect
              aria-label="Missed run policy"
              className="ml-2 rounded-md border bg-background p-1"
              value={policy}
              onValueChange={(value) =>
                setPolicy(value as 'run_latest' | 'skip_missed')
              }
              disabled={busy || !assignment}
              options={[
                { value: 'run_latest', label: 'Run the latest missed occurrence once' },
                { value: 'skip_missed', label: 'Skip missed occurrences' },
              ]}
            />
          </label>
          <p className="text-xs text-muted-foreground">
            Choose what happens if the computer was off or a scheduled run was
            missed: run the latest missed task once, or skip it and wait for the
            next time. If Gbot cannot confirm whether a task started, review it
            yourself; it will not try that task again automatically.
          </p>
          <Button
            disabled={busy || !!stopped || !assignment || !prompt.trim() || !at}
          >
            {pending && !pending.scheduleId && !pending.refreshing
              ? pending.label
              : 'Create schedule'}
          </Button>
        </form>
      </details>
    </div>
  )
}

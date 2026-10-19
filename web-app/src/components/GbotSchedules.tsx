import { useCallback, useEffect, useRef, useState } from 'react'
import { listen } from '@tauri-apps/api/event'
import { Button } from '@/components/ui/button'
import { ChoiceSelect } from '@/components/ui/choice-select'
import { Input } from '@/components/ui/input'
import { gbot, type SavedAssignment } from '@/services/gbot'

type CalendarRule =
  | { kind: 'days'; days: number[]; hour: number; minute: number }
  | {
      kind: 'monthly_weekday'
      nth: number
      weekday: number
      hour: number
      minute: number
    }
type EventSource =
  | { kind: 'folder_arrival'; path: string }
  | { kind: 'mail_folder'; path: string }
type Timing =
  | { kind: 'once'; at: number }
  | { kind: 'interval'; first_at: number; every_seconds: number }
  | { kind: 'calendar'; rule: CalendarRule }
  | { kind: 'event'; source: EventSource }

type Kind = 'once' | 'interval' | 'days' | 'monthly' | 'folder' | 'mail'

const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
const NTH_NAMES = ['First', 'Second', 'Third', 'Fourth', 'Last']

function clock(hour: number, minute: number): string {
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
}

/** Plain words for when a schedule runs. */
export function describeTiming(timing: Timing): string {
  switch (timing.kind) {
    case 'interval':
      return `Every ${timing.every_seconds} seconds`
    case 'calendar': {
      const rule = timing.rule
      if (rule.kind === 'days') {
        const days = [...rule.days].sort((a, b) => a - b)
        const weekdays = days.length === 5 && days.every((day, index) => day === index)
        const every = days.length === 7
        const label = weekdays
          ? 'Weekdays'
          : every
            ? 'Every day'
            : `Every ${days.map((day) => DAY_NAMES[day]).join(', ')}`
        return `${label} at ${clock(rule.hour, rule.minute)}`
      }
      return `${NTH_NAMES[rule.nth - 1]} ${DAY_NAMES[rule.weekday]} of each month at ${clock(rule.hour, rule.minute)}`
    }
    case 'event':
      return timing.source.kind === 'folder_arrival'
        ? `When a file arrives in ${timing.source.path} on the bot’s computer`
        : `When new mail arrives in the mail folder ${timing.source.path}`
    default:
      return 'Once'
  }
}

type Schedule = {
  id: string
  workspace_id: string
  prompt: string
  enabled: boolean
  assignment: SavedAssignment
  timing: Timing
  watch?: { primed: boolean; last_error: string | null }
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
  const [kind, setKind] = useState<Kind>('once')
  const [days, setDays] = useState<number[]>([0, 1, 2, 3, 4])
  const [time, setTime] = useState('09:00')
  const [nth, setNth] = useState('1')
  const [weekday, setWeekday] = useState('0')
  const [folder, setFolder] = useState('')
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
  const [error, setError] = useState<{
    message: string
    details?: string
  } | null>(null)
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
        setRefreshError(cause instanceof Error ? cause.message : String(cause))
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
    action: () => Promise<Schedule>,
    failureMessage: string,
    scheduleId?: string
  ) {
    if (pendingRef.current) return
    pendingRef.current = true
    setPending({ label, scheduleId })
    setError(null)
    try {
      const saved = await action()
      setSchedules((current) =>
        current.some((schedule) => schedule.id === saved.id)
          ? current.map((schedule) =>
              schedule.id === saved.id ? saved : schedule
            )
          : [...current, saved]
      )
      await refresh()
    } catch (cause) {
      setError({
        message: failureMessage,
        details: cause instanceof Error ? cause.message : String(cause),
      })
    } finally {
      pendingRef.current = false
      setPending(undefined)
    }
  }

  return (
    <div className="rounded-lg border p-3">
      {stopped && (
        <div role="alert" className="mb-3 space-y-2 text-sm text-destructive">
          <p>
            Scheduling has stopped. Restart the Gbot service on the computer
            where it runs before scheduled tasks can run again.
          </p>
          <details className="text-muted-foreground">
            <summary>Details</summary>
            <p className="whitespace-pre-wrap break-words">{stopped}</p>
          </details>
        </div>
      )}
      {error && (
        <div role="alert" className="mb-3 space-y-2 text-sm text-destructive">
          <p>{error.message}</p>
          {error.details !== undefined && (
            <details className="text-muted-foreground">
              <summary>Details</summary>
              <p className="whitespace-pre-wrap break-words">{error.details}</p>
            </details>
          )}
        </div>
      )}
      {refreshError && (
        <div role="alert" className="mb-3 space-y-2 text-sm text-destructive">
          <p>
            Could not load scheduled tasks. Check the Gbot service connection,
            then choose Retry loading schedules.
          </p>
          <details className="text-muted-foreground">
            <summary>Details</summary>
            <p className="whitespace-pre-wrap break-words">{refreshError}</p>
          </details>
        </div>
      )}
      {(error?.details !== undefined || refreshError) && (
        <Button
          className="mb-3"
          variant="outline"
          disabled={busy}
          onClick={() => void retryRefresh()}
        >
          Retry loading schedules
        </Button>
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
          and its model server must stay on and connected. While a task is
          running, GChat asks this computer not to go to sleep, but it cannot
          wake a computer that is asleep or switched off.
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
              {describeTiming(schedule.timing)}
              {schedule.timing.kind === 'event'
                ? ' · Watching for new arrivals'
                : schedule.next_at
                  ? ` · Next: ${new Date(schedule.next_at * 1000).toLocaleString()}`
                  : ' · No later scheduled occurrences'}
            </p>
            {schedule.watch?.last_error && (
              <p role="alert" className="text-sm text-destructive">
                {schedule.watch.last_error}
              </p>
            )}
            {schedule.enabled &&
              !stopped &&
              !schedule.occurrences.some(
                (occurrence) => occurrence.state === 'needs_review'
              ) &&
              schedule.occurrences.map(
                (occurrence) =>
                  occurrence.state === 'queued' &&
                  occurrence.retry_at !== null && (
                    <p
                      key={occurrence.task_id}
                      className="text-sm text-muted-foreground"
                    >
                      Waiting to start. Gbot will try again automatically after{' '}
                      {new Date(occurrence.retry_at * 1000).toLocaleString()}.
                      Keep the Gbot service, bot computer and model server on
                      and connected.
                    </p>
                  )
              )}
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
                    gbot<Schedule>('schedules/enabled', {
                      id: schedule.id,
                      enabled: !schedule.enabled,
                    }),
                  `Could not confirm whether this schedule was ${schedule.enabled ? 'disabled' : 'enabled'}. Choose Retry loading schedules to check its current state before changing it again.`,
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
            <Button
              variant="outline"
              disabled={busy}
              onClick={() =>
                void perform(
                  'Starting run…',
                  () =>
                    gbot<Schedule>('schedules/run_now', { id: schedule.id }),
                  'Could not start a run now. It may already be running or waiting for your review.',
                  schedule.id
                )
              }
            >
              Run now
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
            const [hour, minute] = time.split(':').map(Number)
            const timed = kind === 'once' || kind === 'interval'
            const needsPath = kind === 'folder' || kind === 'mail'
            if (
              !prompt.trim() ||
              (timed && (!Number.isFinite(timestamp) || timestamp <= 0)) ||
              (kind === 'interval' &&
                (!Number.isSafeInteger(Number(seconds)) ||
                  Number(seconds) <= 0)) ||
              ((kind === 'days' || kind === 'monthly') &&
                !Number.isFinite(hour) || !Number.isFinite(minute)) ||
              (kind === 'days' && days.length === 0) ||
              (needsPath && !folder.trim())
            ) {
              setError({
                message: timed
                  ? 'Enter a prompt, start time and positive whole interval in seconds.'
                  : needsPath
                    ? 'Enter what the bot should do and the full folder path to watch.'
                    : 'Enter what the bot should do, the time of day and at least one day.',
              })
              return
            }
            const timing: Timing =
              kind === 'once'
                ? { kind, at: timestamp }
                : kind === 'interval'
                  ? {
                      kind,
                      first_at: timestamp,
                      every_seconds: Number(seconds),
                    }
                  : kind === 'days'
                    ? {
                        kind: 'calendar',
                        rule: { kind: 'days', days: [...days].sort(), hour, minute },
                      }
                    : kind === 'monthly'
                      ? {
                          kind: 'calendar',
                          rule: {
                            kind: 'monthly_weekday',
                            nth: Number(nth),
                            weekday: Number(weekday),
                            hour,
                            minute,
                          },
                        }
                      : {
                          kind: 'event',
                          source: {
                            kind: kind === 'folder' ? 'folder_arrival' : 'mail_folder',
                            path: folder.trim(),
                          },
                        }
            void perform(
              'Creating schedule…',
              async () => {
                const saved = await gbot<Schedule>('schedules/create', {
                  workspace_id: workspaceId,
                  prompt,
                  timing,
                  missed_run_policy: policy,
                })
                setPrompt('')
                return saved
              },
              'Could not confirm that the schedule was created. Your draft is still here. Choose Retry loading schedules to check for it before trying Create schedule again.'
            )
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
            When should it run?
            <ChoiceSelect
              aria-label="Schedule repetition"
              className="ml-2 rounded-md border bg-background p-1"
              value={kind}
              onValueChange={(value) => setKind(value as Kind)}
              disabled={busy || !assignment}
              options={[
                { value: 'once', label: 'Once' },
                { value: 'interval', label: 'At an interval' },
                { value: 'days', label: 'On chosen days at a set time' },
                { value: 'monthly', label: 'Once a month on a chosen weekday' },
                { value: 'folder', label: 'When a file arrives on the bot’s computer' },
                { value: 'mail', label: 'When new mail arrives in a mail folder' },
              ]}
            />
          </label>
          {(kind === 'once' || kind === 'interval') && (
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
          )}
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
          {kind === 'days' && (
            <fieldset className="space-y-1 text-sm">
              <legend>Days</legend>
              <div className="flex flex-wrap gap-3">
                {DAY_NAMES.map((name, index) => (
                  <label key={name} className="flex items-center gap-1">
                    <input
                      type="checkbox"
                      checked={days.includes(index)}
                      disabled={busy || !assignment}
                      onChange={(event) =>
                        setDays((current) =>
                          event.target.checked
                            ? [...current, index]
                            : current.filter((day) => day !== index)
                        )
                      }
                    />
                    {name}
                  </label>
                ))}
              </div>
            </fieldset>
          )}
          {kind === 'monthly' && (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <ChoiceSelect
                aria-label="Which weekday of the month"
                className="rounded-md border bg-background p-1"
                value={nth}
                onValueChange={setNth}
                disabled={busy || !assignment}
                options={NTH_NAMES.map((name, index) => ({
                  value: String(index + 1),
                  label: name,
                }))}
              />
              <ChoiceSelect
                aria-label="Weekday"
                className="rounded-md border bg-background p-1"
                value={weekday}
                onValueChange={setWeekday}
                disabled={busy || !assignment}
                options={DAY_NAMES.map((name, index) => ({
                  value: String(index),
                  label: name,
                }))}
              />
              <span>of each month</span>
            </div>
          )}
          {(kind === 'days' || kind === 'monthly') && (
            <label className="block text-sm">
              Time of day (your computer’s time zone)
              <Input
                aria-label="Time of day"
                type="time"
                value={time}
                onChange={(event) => setTime(event.target.value)}
                disabled={busy || !assignment}
              />
            </label>
          )}
          {(kind === 'folder' || kind === 'mail') && (
            <label className="block text-sm">
              {kind === 'folder'
                ? 'Folder on the bot’s computer (full path)'
                : 'Mail folder on this computer (full path)'}
              <Input
                aria-label={
                  kind === 'folder' ? 'Folder to watch' : 'Mail folder to watch'
                }
                value={folder}
                placeholder={kind === 'folder' ? '/home/gbot/Inbox' : '/home/me/Mail/inbox'}
                onChange={(event) => setFolder(event.target.value)}
                disabled={busy || !assignment}
              />
            </label>
          )}
          {(kind === 'folder' || kind === 'mail') && (
            <p className="text-xs text-muted-foreground">
              {kind === 'folder'
                ? 'The bot starts the task above once for each new file that appears in this folder, after the file has finished arriving. Files already there are ignored. Up to five tasks wait at a time.'
                : 'The bot starts the task above once for each new message that appears in this folder (a Maildir or a folder of .eml files), and is told who it is from, the subject and the start of the message. Messages already there are ignored. Mail from connected Google or Microsoft accounts is not watched yet.'}
            </p>
          )}
          {kind !== 'folder' && kind !== 'mail' && (<><label className="block text-sm">
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
          </p></>)}
          <Button
            disabled={
              busy ||
              !!stopped ||
              !assignment ||
              !prompt.trim() ||
              ((kind === 'once' || kind === 'interval') && !at)
            }
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

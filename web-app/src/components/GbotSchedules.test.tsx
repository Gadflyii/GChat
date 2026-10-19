import userEvent from '@testing-library/user-event'
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import GbotSchedules, { describeTiming } from './GbotSchedules'

const { request, listen } = vi.hoisted(() => ({
  request: vi.fn(),
  listen: vi.fn(),
}))
vi.mock('@/services/gbot', () => ({ gbot: request }))
vi.mock('@tauri-apps/api/event', () => ({ listen }))

const assignment = {
  workspace_id: 'bot-one',
  connection: { kind: 'endpoint', api_base: 'http://localhost:1337/v1' },
  model: 'fixture',
  context_tokens: 131072,
  credential_ref: null,
}
const schedule = {
  id: 'schedule-one',
  workspace_id: 'bot-one',
  prompt: 'Check the calendar',
  enabled: true,
  assignment,
  timing: { kind: 'once', at: 2000000000 },
  missed_run_policy: 'run_latest',
  next_at: 2000000000,
  occurrences: [],
}

beforeEach(() => {
  request.mockReset()
  listen.mockReset()
  listen.mockImplementation(async () => vi.fn())
  request.mockImplementation(
    async (route: string, input?: Record<string, unknown>) => {
      if (route === 'schedules') {
        return {
          schedules: [
            schedule,
            {
              ...schedule,
              id: 'other',
              workspace_id: 'bot-two',
              prompt: 'Other bot task',
            },
          ],
          stopped: null,
        }
      }
      if (route === 'schedules/enabled') return { ...schedule, ...input }
      if (route === 'schedules/create') {
        return { ...schedule, id: 'created', ...input }
      }
    }
  )
})
afterEach(cleanup)

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (cause: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function taskUpdate() {
  const registration = listen.mock.calls.find(
    ([event]) => event === 'gbot-task-update'
  )
  if (!registration) throw new Error('Task update listener is not registered')
  act(() => registration[1]())
}

it.each([true, false])(
  'keeps the confirmed schedule change from enabled=%s when reloading fails',
  async (enabled) => {
    const current = { ...schedule, enabled }
    const saved = { ...current, enabled: !enabled }
    const older = deferred<{ schedules: (typeof schedule)[]; stopped: null }>()
    const change = deferred<typeof saved>()
    const reload = deferred<never>()
    const retry = deferred<{
      schedules: (typeof schedule)[]
      stopped: null
    }>()
    request
      .mockResolvedValueOnce({ schedules: [current], stopped: null })
      .mockReturnValueOnce(older.promise)
      .mockReturnValueOnce(change.promise)
      .mockReturnValueOnce(reload.promise)
      .mockReturnValueOnce(retry.promise)
    render(<GbotSchedules workspaceId="bot-one" assignment={assignment} />)
    fireEvent.click(screen.getByText('Scheduled tasks'))
    await screen.findByText('Check the calendar')
    fireEvent.change(screen.getByLabelText('Scheduled task prompt'), {
      target: { value: 'Keep this draft' },
    })
    fireEvent.change(screen.getByLabelText('Schedule start time'), {
      target: { value: '2030-01-02T09:00' },
    })
    taskUpdate()
    const originalLabel = enabled ? 'Disable schedule' : 'Enable schedule'
    const savedLabel = enabled ? 'Enable schedule' : 'Disable schedule'
    fireEvent.click(screen.getByRole('button', { name: originalLabel }))
    await act(async () => change.resolve(saved))

    expect(
      screen.getByText(enabled ? /^Disabled ·/ : /^Enabled ·/)
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /schedule…/ })).toBeDisabled()
    await act(async () =>
      older.resolve({ schedules: [current], stopped: null })
    )
    expect(
      screen.getByText(enabled ? /^Disabled ·/ : /^Enabled ·/)
    ).toBeInTheDocument()
    await act(async () => reload.reject(new Error('Schedule list unavailable')))

    expect(screen.getByRole('button', { name: savedLabel })).toBeEnabled()
    expect(
      screen.queryByRole('button', { name: originalLabel })
    ).not.toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Schedule list unavailable'
    )
    expect(screen.getByLabelText('Scheduled task prompt')).toHaveValue(
      'Keep this draft'
    )
    expect(screen.getByLabelText('Schedule start time')).toHaveValue(
      '2030-01-02T09:00'
    )
    expect(
      request.mock.calls.filter(([route]) => route === 'schedules/enabled')
    ).toEqual([['schedules/enabled', { id: current.id, enabled: !enabled }]])

    const retryButton = screen.getByRole('button', {
      name: 'Retry loading schedules',
    })
    act(() => {
      fireEvent.click(retryButton)
      fireEvent.click(retryButton)
    })
    expect(screen.getByRole('button', { name: savedLabel })).toBeDisabled()
    await act(async () =>
      retry.resolve({ schedules: [current], stopped: null })
    )
    expect(screen.getByRole('button', { name: originalLabel })).toBeEnabled()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Scheduled task prompt')).toHaveValue(
      'Keep this draft'
    )
    expect(request.mock.calls.map(([route]) => route)).toEqual([
      'schedules',
      'schedules',
      'schedules/enabled',
      'schedules',
      'schedules',
    ])
  }
)

it('keeps the confirmed new schedule when reloading fails without creating it again', async () => {
  const saved = { ...schedule, id: 'created', prompt: 'Prepare my notes' }
  const older = deferred<{ schedules: (typeof schedule)[]; stopped: null }>()
  const create = deferred<typeof saved>()
  const reload = deferred<never>()
  const failedRetry = deferred<never>()
  request
    .mockResolvedValueOnce({ schedules: [], stopped: null })
    .mockReturnValueOnce(older.promise)
    .mockReturnValueOnce(create.promise)
    .mockReturnValueOnce(reload.promise)
    .mockReturnValueOnce(failedRetry.promise)
    .mockResolvedValueOnce({ schedules: [saved], stopped: null })
  render(<GbotSchedules workspaceId="bot-one" assignment={assignment} />)
  fireEvent.click(screen.getByText('Scheduled tasks'))
  await waitFor(() => expect(request).toHaveBeenCalledWith('schedules'))
  fireEvent.change(screen.getByLabelText('Scheduled task prompt'), {
    target: { value: saved.prompt },
  })
  fireEvent.change(screen.getByLabelText('Schedule start time'), {
    target: { value: '2030-01-02T09:00' },
  })
  taskUpdate()
  fireEvent.click(screen.getByRole('button', { name: 'Create schedule' }))
  await act(async () => create.resolve(saved))

  expect(screen.getByText(saved.prompt)).toBeInTheDocument()
  expect(screen.getByLabelText('Scheduled task prompt')).toHaveValue('')
  expect(screen.getByRole('button', { name: 'Creating schedule…' })).toBeDisabled()
  await act(async () => older.resolve({ schedules: [], stopped: null }))
  expect(screen.getByText(saved.prompt)).toBeInTheDocument()
  await act(async () => reload.reject(new Error('Schedule list unavailable')))
  expect(screen.getByText(saved.prompt)).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Disable schedule' })).toBeEnabled()
  fireEvent.change(screen.getByLabelText('Scheduled task prompt'), {
    target: { value: 'Next task draft' },
  })

  fireEvent.click(screen.getByRole('button', { name: 'Retry loading schedules' }))
  await act(async () => failedRetry.reject(new Error('Still disconnected')))
  expect(screen.getByText(saved.prompt)).toBeInTheDocument()
  expect(screen.getByRole('alert')).toHaveTextContent('Still disconnected')
  expect(screen.getByLabelText('Scheduled task prompt')).toHaveValue(
    'Next task draft'
  )
  fireEvent.click(screen.getByRole('button', { name: 'Retry loading schedules' }))
  await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument())
  expect(screen.getByText(saved.prompt)).toBeInTheDocument()
  expect(screen.getByLabelText('Scheduled task prompt')).toHaveValue(
    'Next task draft'
  )
  expect(
    request.mock.calls.filter(([route]) => route === 'schedules/create')
  ).toHaveLength(1)
  expect(request.mock.calls.map(([route]) => route)).toEqual([
    'schedules',
    'schedules',
    'schedules/create',
    'schedules',
    'schedules',
    'schedules',
  ])
})

it('does not restore Enabled from an older task-update refresh after Disable succeeds', async () => {
  const older = deferred<{ schedules: (typeof schedule)[]; stopped: null }>()
  const disable = deferred<unknown>()
  const latest = deferred<{ schedules: (typeof schedule)[]; stopped: null }>()
  request
    .mockResolvedValueOnce({ schedules: [schedule], stopped: null })
    .mockReturnValueOnce(older.promise)
    .mockReturnValueOnce(disable.promise)
    .mockReturnValueOnce(latest.promise)
  render(<GbotSchedules workspaceId="bot-one" assignment={assignment} />)
  fireEvent.click(screen.getByText('Scheduled tasks'))
  await screen.findByText('Check the calendar')

  taskUpdate()
  fireEvent.click(screen.getByRole('button', { name: 'Disable schedule' }))
  await act(async () => disable.resolve({ ...schedule, enabled: false }))
  await act(async () =>
    latest.resolve({
      schedules: [{ ...schedule, enabled: false }],
      stopped: null,
    })
  )
  expect(screen.getByRole('button', { name: 'Enable schedule' })).toBeEnabled()
  await act(async () =>
    older.resolve({ schedules: [schedule], stopped: null })
  )

  expect(screen.getByRole('button', { name: 'Enable schedule' })).toBeEnabled()
  expect(screen.queryByRole('button', { name: 'Disable schedule' })).toBeNull()
  expect(screen.getByText(/^Disabled ·/)).toBeInTheDocument()
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
})

it('ignores an older task-update failure after a newer refresh succeeds', async () => {
  const older = deferred<{ schedules: (typeof schedule)[]; stopped: null }>()
  const latest = deferred<{ schedules: (typeof schedule)[]; stopped: null }>()
  request
    .mockResolvedValueOnce({ schedules: [schedule], stopped: null })
    .mockReturnValueOnce(older.promise)
    .mockReturnValueOnce(latest.promise)
  render(<GbotSchedules workspaceId="bot-one" assignment={assignment} />)
  fireEvent.click(screen.getByText('Scheduled tasks'))
  await screen.findByText('Check the calendar')

  taskUpdate()
  taskUpdate()
  await act(async () =>
    latest.resolve({
      schedules: [{ ...schedule, enabled: false }],
      stopped: null,
    })
  )
  await act(async () => older.reject(new Error('Obsolete service failure')))

  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Enable schedule' })).toBeEnabled()
  expect(screen.getByText(/^Disabled ·/)).toBeInTheDocument()
})

it('keeps the newer stopped scheduler when an older task-update refresh succeeds', async () => {
  const older = deferred<{ schedules: (typeof schedule)[]; stopped: null }>()
  const latest = deferred<{
    schedules: (typeof schedule)[]
    stopped: string
  }>()
  request
    .mockResolvedValueOnce({ schedules: [schedule], stopped: null })
    .mockReturnValueOnce(older.promise)
    .mockReturnValueOnce(latest.promise)
  render(<GbotSchedules workspaceId="bot-one" assignment={assignment} />)
  fireEvent.click(screen.getByText('Scheduled tasks'))
  await screen.findByText('Check the calendar')

  taskUpdate()
  taskUpdate()
  await act(async () =>
    latest.resolve({
      schedules: [{ ...schedule, enabled: false }],
      stopped: 'Journal failure',
    })
  )
  await act(async () =>
    older.resolve({ schedules: [schedule], stopped: null })
  )

  const alert = screen.getByRole('alert')
  expect(alert).toHaveTextContent('Scheduling has stopped.')
  expect(within(alert).getByText('Journal failure')).not.toBeVisible()
  expect(screen.getByRole('button', { name: 'Enable schedule' })).toBeEnabled()
  expect(screen.getByRole('button', { name: 'Create schedule' })).toBeDisabled()
  expect(screen.getByText(/^Disabled ·/)).toBeInTheDocument()
})

it('shows a stopped scheduler outside the collapsed panel with plain recovery and optional technical details', async () => {
  const reason = 'Schedule journal publication could not be confirmed'
  request.mockResolvedValue({
    schedules: [schedule],
    stopped: reason,
  })
  render(<GbotSchedules workspaceId="bot-one" assignment={assignment} />)
  const alert = await screen.findByRole('alert')
  expect(alert).toHaveTextContent('Scheduling has stopped.')
  expect(alert).toHaveTextContent(
    'Restart the Gbot service on the computer where it runs before scheduled tasks can run again.'
  )
  expect(alert.closest('details')).toBeNull()
  expect(within(alert).getByText(reason)).not.toBeVisible()
  expect(
    within(alert).getByText('Details').closest('details')
  ).not.toHaveAttribute('open')
  fireEvent.click(within(alert).getByText('Details'))
  expect(within(alert).getByText(reason)).toBeVisible()
  fireEvent.click(within(alert).getByText('Details'))
  expect(within(alert).getByText(reason)).not.toBeVisible()
  expect(request).toHaveBeenCalledTimes(1)
  fireEvent.click(screen.getByText('Scheduled tasks'))
  fireEvent.change(screen.getByLabelText('Scheduled task prompt'), {
    target: { value: 'Check task' },
  })
  fireEvent.change(screen.getByLabelText('Schedule start time'), {
    target: { value: '2030-01-02T09:00' },
  })
  expect(screen.getByRole('button', { name: 'Create schedule' })).toBeDisabled()
  fireEvent.submit(screen.getByRole('form', { name: 'Schedule a bot task' }))
  expect(request).not.toHaveBeenCalledWith(
    'schedules/create',
    expect.anything()
  )
})

it('lists this bot schedules, states the background lifetime requirement and disables future dispatch', async () => {
  render(<GbotSchedules workspaceId="bot-one" assignment={assignment} />)
  fireEvent.click(screen.getByText('Scheduled tasks'))
  expect(
    screen.getByText(/Scheduled tasks can keep running after GChat closes/)
  ).toHaveTextContent(
    'the Gbot service, the bot’s computer and its model server must stay on and connected.'
  )
  await screen.findByText('Check the calendar')
  expect(screen.queryByText('Other bot task')).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Disable schedule' }))
  await waitFor(() =>
    expect(request).toHaveBeenCalledWith('schedules/enabled', {
      id: 'schedule-one',
      enabled: false,
    })
  )
})

it('shows a queued Once retry outside collapsed occurrences and clears it after an explicit read without replay', async () => {
  const dueAt = Math.floor(Date.now() / 1000) - 10
  const retryAt = dueAt + 30
  const queued = {
    ...schedule,
    timing: { kind: 'once', at: dueAt },
    next_at: null,
    occurrences: [
      {
        task_id: '74569aba-3734-4bda-b8ab-12044f7a114c',
        due_at: dueAt,
        state: 'queued',
        note: 'SSH transport failed',
        retry_at: retryAt,
      },
    ],
  }
  const started = {
    ...queued,
    occurrences: [
      { ...queued.occurrences[0], state: 'dispatched', note: null, retry_at: null },
    ],
  }
  const recovery = deferred<{ schedules: (typeof started)[]; stopped: null }>()
  request
    .mockResolvedValueOnce({ schedules: [queued], stopped: null })
    .mockRejectedValueOnce(new Error('Schedule list unavailable'))
    .mockReturnValueOnce(recovery.promise)
  render(<GbotSchedules workspaceId="bot-one" assignment={assignment} />)
  fireEvent.click(screen.getByText('Scheduled tasks'))

  const retryGuidance = await screen.findByText(
    /Waiting to start\. Gbot will try again automatically after/
  )
  expect(retryGuidance).toBeVisible()
  expect(retryGuidance).toHaveTextContent(
    new Date(retryAt * 1000).toLocaleString()
  )
  expect(retryGuidance).toHaveTextContent(
    'Keep the Gbot service, bot computer and model server on and connected.'
  )
  expect(screen.getByText(/No later scheduled occurrences/)).toBeVisible()
  expect(screen.queryByText(/No future run/)).not.toBeInTheDocument()
  const occurrences = screen.getByText('Occurrences').closest('details')
  expect(occurrences).not.toHaveAttribute('open')
  expect(screen.getByText(/SSH transport failed/)).not.toBeVisible()
  expect(request.mock.calls).toEqual([['schedules']])

  await act(async () => taskUpdate())
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Could not load scheduled tasks.'
  )
  expect(retryGuidance).toBeVisible()
  fireEvent.click(
    screen.getByRole('button', { name: 'Retry loading schedules' })
  )
  expect(screen.getByRole('status')).toHaveTextContent('Loading schedules…')
  expect(retryGuidance).toBeVisible()
  await act(async () =>
    recovery.resolve({ schedules: [started], stopped: null })
  )

  expect(
    screen.queryByText(/Gbot will try again automatically after/)
  ).not.toBeInTheDocument()
  expect(screen.getByText('Occurrences').closest('details')).not.toHaveAttribute(
    'open'
  )
  expect(screen.getByText(/dispatched/)).not.toBeVisible()
  expect(screen.queryByText(/SSH transport failed/)).not.toBeInTheDocument()
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  expect(screen.queryByRole('status')).not.toBeInTheDocument()
  expect(request.mock.calls).toEqual([
    ['schedules'],
    ['schedules'],
    ['schedules'],
  ])
})

it.each(['needs_review', 'completed', 'skipped', 'dispatched'])(
  'does not promise an automatic retry for a %s occurrence',
  async (state) => {
    request.mockResolvedValue({
      schedules: [
        {
          ...schedule,
          next_at: null,
          occurrences: [
            {
              task_id: '74569aba-3734-4bda-b8ab-12044f7a114c',
              due_at: 2000000000,
              state,
              note: null,
              retry_at: null,
            },
          ],
        },
      ],
      stopped: null,
    })
    render(<GbotSchedules workspaceId="bot-one" assignment={assignment} />)
    fireEvent.click(screen.getByText('Scheduled tasks'))
    await screen.findByText('Check the calendar')

    expect(
      screen.queryByText(/Gbot will try again automatically after/)
    ).not.toBeInTheDocument()
    if (state === 'needs_review') {
      expect(
        screen.getByText('Needs review. Future occurrences are held.')
      ).toBeVisible()
    }
    expect(request.mock.calls).toEqual([['schedules']])
  }
)

it.each([
  { name: 'disabled schedule', enabled: false, stopped: null },
  { name: 'stopped scheduler', enabled: true, stopped: 'Schedule journal failed' },
])('does not promise a queued retry for a $name', async ({ enabled, stopped }) => {
  request.mockResolvedValue({
    schedules: [
      {
        ...schedule,
        enabled,
        next_at: null,
        occurrences: [
          {
            task_id: '74569aba-3734-4bda-b8ab-12044f7a114c',
            due_at: 2000000000,
            state: 'queued',
            note: 'SSH transport failed',
            retry_at: 2000000030,
          },
        ],
      },
    ],
    stopped,
  })
  render(<GbotSchedules workspaceId="bot-one" assignment={assignment} />)
  fireEvent.click(screen.getByText('Scheduled tasks'))
  await screen.findByText('Check the calendar')

  expect(
    screen.queryByText(/Gbot will try again automatically after/)
  ).not.toBeInTheDocument()
  expect(request.mock.calls).toEqual([['schedules']])
})

it('creates an explicit interval prompt and missed-run policy for the selected bot', async () => {
  const create = deferred<unknown>()
  const refreshed = deferred<{
    schedules: (typeof schedule)[]
    stopped: null
  }>()
  request
    .mockResolvedValueOnce({ schedules: [schedule], stopped: null })
    .mockReturnValueOnce(create.promise)
    .mockReturnValueOnce(refreshed.promise)
  render(<GbotSchedules workspaceId="bot-one" assignment={assignment} />)
  fireEvent.click(screen.getByText('Scheduled tasks'))
  await screen.findByText('Check the calendar')
  fireEvent.change(screen.getByLabelText('Scheduled task prompt'), {
    target: { value: 'Prepare my daily notes' },
  })
  fireEvent.change(screen.getByLabelText('Schedule start time'), {
    target: { value: '2030-01-02T09:00' },
  })
  const user = userEvent.setup()
  await user.click(screen.getByRole('button', { name: 'Schedule repetition' }))
  await user.click(screen.getByRole('menuitemradio', { name: 'At an interval' }))
  fireEvent.change(screen.getByLabelText('Schedule interval in seconds'), {
    target: { value: '86400' },
  })
  await user.click(screen.getByRole('button', { name: 'Missed run policy' }))
  await user.click(screen.getByRole('menuitemradio', { name: 'Skip missed occurrences' }))
  const form = screen.getByRole('form', { name: 'Schedule a bot task' })
  act(() => {
    fireEvent.submit(form)
    fireEvent.submit(form)
  })
  expect(
    request.mock.calls.filter(([route]) => route === 'schedules/create')
  ).toEqual([
    [
      'schedules/create',
      {
        workspace_id: 'bot-one',
        prompt: 'Prepare my daily notes',
        timing: {
          kind: 'interval',
          first_at: Math.floor(new Date('2030-01-02T09:00').getTime() / 1000),
          every_seconds: 86400,
        },
        missed_run_policy: 'skip_missed',
      },
    ],
  ])
  expect(
    screen.getByRole('button', { name: 'Creating schedule…' })
  ).toBeDisabled()
  expect(screen.getByLabelText('Scheduled task prompt')).toBeDisabled()
  expect(screen.getByRole('status')).toHaveTextContent('Creating schedule…')
  expect(screen.getByRole('status').closest('details')).toBeNull()
  await act(async () =>
    create.resolve({
      ...schedule,
      id: 'created',
      prompt: 'Prepare my daily notes',
      timing: {
        kind: 'interval',
        first_at: Math.floor(new Date('2030-01-02T09:00').getTime() / 1000),
        every_seconds: 86400,
      },
      missed_run_policy: 'skip_missed',
    })
  )
  expect(screen.getByLabelText('Scheduled task prompt')).toHaveValue('')
  expect(
    screen.getByRole('button', { name: 'Creating schedule…' })
  ).toBeDisabled()
  fireEvent.submit(form)
  expect(
    request.mock.calls.filter(([route]) => route === 'schedules/create')
  ).toHaveLength(1)
  await act(async () =>
    refreshed.resolve({ schedules: [schedule], stopped: null })
  )
  expect(screen.queryByRole('status')).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Create schedule' })).toBeDisabled()
})

it.each([
  [true, 'Disable schedule', 'Disabling schedule…'],
  [false, 'Enable schedule', 'Enabling schedule…'],
])(
  'shows progress and allows retry when changing enabled=%s fails',
  async (enabled, label, progress) => {
    const change = deferred<unknown>()
    const retry = deferred<unknown>()
    const current = { ...schedule, enabled }
    request
      .mockResolvedValueOnce({
        schedules: [
          current,
          {
            ...schedule,
            id: 'second',
            prompt: 'Another task',
            enabled: !enabled,
          },
        ],
        stopped: null,
      })
      .mockReturnValueOnce(change.promise)
      .mockResolvedValueOnce({ schedules: [current], stopped: null })
      .mockReturnValueOnce(retry.promise)
      .mockResolvedValueOnce({
        schedules: [{ ...current, enabled: !enabled }],
        stopped: null,
      })
    render(<GbotSchedules workspaceId="bot-one" assignment={assignment} />)
    fireEvent.click(screen.getByText('Scheduled tasks'))
    await screen.findByText('Check the calendar')
    const button = screen.getByRole('button', { name: label })
    act(() => {
      fireEvent.click(button)
      fireEvent.click(button)
    })
    expect(
      request.mock.calls.filter(([route]) => route === 'schedules/enabled')
    ).toEqual([['schedules/enabled', { id: schedule.id, enabled: !enabled }]])
    expect(screen.getByRole('button', { name: progress })).toBeDisabled()
    expect(
      screen.getByRole('button', {
        name: enabled ? 'Enable schedule' : 'Disable schedule',
      })
    ).toBeDisabled()
    expect(
      screen.getByRole('button', { name: 'Create schedule' })
    ).toBeDisabled()
    expect(screen.getByRole('status')).toHaveTextContent(progress)

    await act(async () => change.reject(new Error('Service unavailable')))
    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent(
      `Could not confirm whether this schedule was ${enabled ? 'disabled' : 'enabled'}. Choose Retry loading schedules to check its current state before changing it again.`
    )
    expect(within(alert).getByText('Service unavailable')).not.toBeVisible()
    const details = within(alert).getByText('Details').closest('details')
    expect(details).not.toHaveAttribute('open')
    fireEvent.click(within(alert).getByText('Details'))
    expect(within(alert).getByText('Service unavailable')).toBeVisible()
    expect(
      screen.getByRole('button', { name: 'Retry loading schedules' })
    ).toBeEnabled()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: label })).toBeEnabled()
    await act(async () => taskUpdate())
    expect(screen.getByRole('alert')).toHaveTextContent('Service unavailable')
    expect(screen.getByRole('button', { name: label })).toBeEnabled()
    expect(
      request.mock.calls.filter(([route]) => route === 'schedules/enabled')
    ).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: label }))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent(progress)
    await act(async () => retry.resolve({ ...current, enabled: !enabled }))
    expect(
      request.mock.calls.filter(([route]) => route === 'schedules/enabled')
    ).toEqual([
      ['schedules/enabled', { id: schedule.id, enabled: !enabled }],
      ['schedules/enabled', { id: schedule.id, enabled: !enabled }],
    ])
    expect(
      screen.getByRole('button', {
        name: enabled ? 'Enable schedule' : 'Disable schedule',
      })
    ).toBeEnabled()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  }
)

it('retains a failed schedule draft and lets the user retry creating it', async () => {
  const create = deferred<unknown>()
  request
    .mockResolvedValueOnce({ schedules: [], stopped: null })
    .mockReturnValueOnce(create.promise)
    .mockResolvedValueOnce({ schedules: [], stopped: null })
    .mockResolvedValueOnce({
      ...schedule,
      id: 'created',
      prompt: 'Check task',
      timing: {
        kind: 'once',
        at: Math.floor(new Date('2030-01-02T09:00').getTime() / 1000),
      },
    })
    .mockResolvedValueOnce({ schedules: [], stopped: null })
  render(<GbotSchedules workspaceId="bot-one" assignment={assignment} />)
  fireEvent.click(screen.getByText('Scheduled tasks'))
  await waitFor(() => expect(request).toHaveBeenCalledWith('schedules'))
  fireEvent.change(screen.getByLabelText('Scheduled task prompt'), {
    target: { value: 'Check task' },
  })
  fireEvent.change(screen.getByLabelText('Schedule start time'), {
    target: { value: '2030-01-02T09:00' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Create schedule' }))
  await act(async () => create.reject(new Error('Could not save schedule')))
  const alert = screen.getByRole('alert')
  expect(alert).toHaveTextContent(
    'Could not confirm that the schedule was created. Your draft is still here. Choose Retry loading schedules to check for it before trying Create schedule again.'
  )
  expect(within(alert).getByText('Could not save schedule')).not.toBeVisible()
  expect(
    within(alert).getByText('Details').closest('details')
  ).not.toHaveAttribute('open')
  fireEvent.click(within(alert).getByText('Details'))
  expect(within(alert).getByText('Could not save schedule')).toBeVisible()
  expect(
    screen.getByRole('button', { name: 'Retry loading schedules' })
  ).toBeEnabled()
  expect(screen.getByLabelText('Scheduled task prompt')).toHaveValue(
    'Check task'
  )
  expect(screen.getByLabelText('Schedule start time')).toHaveValue(
    '2030-01-02T09:00'
  )
  expect(screen.getByRole('button', { name: 'Create schedule' })).toBeEnabled()
  await act(async () => taskUpdate())
  expect(screen.getByRole('alert')).toHaveTextContent('Could not save schedule')
  expect(screen.getByLabelText('Scheduled task prompt')).toHaveValue(
    'Check task'
  )
  expect(screen.getByLabelText('Schedule start time')).toHaveValue(
    '2030-01-02T09:00'
  )
  expect(screen.getByRole('button', { name: 'Create schedule' })).toBeEnabled()
  expect(
    request.mock.calls.filter(([route]) => route === 'schedules/create')
  ).toHaveLength(1)
  fireEvent.click(screen.getByRole('button', { name: 'Create schedule' }))
  await waitFor(() =>
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  )
  const calls = request.mock.calls.filter(
    ([route]) => route === 'schedules/create'
  )
  expect(calls).toHaveLength(2)
  expect(calls[1]).toEqual(calls[0])
  expect(screen.getByLabelText('Scheduled task prompt')).toHaveValue('')
})

it('retries loading saved schedules without losing a draft or submitting it', async () => {
  const retry = deferred<{ schedules: (typeof schedule)[]; stopped: null }>()
  const recovery = deferred<{ schedules: (typeof schedule)[]; stopped: null }>()
  request
    .mockRejectedValueOnce(new Error('Schedule list unavailable'))
    .mockReturnValueOnce(retry.promise)
    .mockReturnValueOnce(recovery.promise)
  render(<GbotSchedules workspaceId="bot-one" assignment={assignment} />)
  const alert = await screen.findByRole('alert')
  expect(alert).toHaveTextContent(
    'Could not load scheduled tasks. Check the Gbot service connection, then choose Retry loading schedules.'
  )
  expect(within(alert).getByText('Schedule list unavailable')).not.toBeVisible()
  expect(
    within(alert).getByText('Details').closest('details')
  ).not.toHaveAttribute('open')
  fireEvent.click(within(alert).getByText('Details'))
  expect(within(alert).getByText('Schedule list unavailable')).toBeVisible()
  fireEvent.click(within(alert).getByText('Details'))
  fireEvent.click(screen.getByText('Scheduled tasks'))
  fireEvent.click(screen.getByText('Scheduled tasks'))
  fireEvent.click(screen.getByText('Scheduled tasks'))
  expect(request.mock.calls).toEqual([['schedules']])
  expect(screen.queryByText('Check the calendar')).not.toBeInTheDocument()
  fireEvent.change(screen.getByLabelText('Scheduled task prompt'), {
    target: { value: 'Prepare my notes' },
  })
  fireEvent.change(screen.getByLabelText('Schedule start time'), {
    target: { value: '2030-01-02T09:00' },
  })
  const form = screen.getByRole('form', { name: 'Schedule a bot task' })
  const retryButton = screen.getByRole('button', {
    name: 'Retry loading schedules',
  })
  act(() => {
    fireEvent.click(retryButton)
    fireEvent.click(retryButton)
    fireEvent.submit(form)
  })
  expect(request.mock.calls).toEqual([['schedules'], ['schedules']])
  expect(retryButton).toBeDisabled()
  expect(screen.getByRole('status')).toHaveTextContent('Loading schedules…')
  expect(screen.getByRole('button', { name: 'Create schedule' })).toBeDisabled()
  expect(screen.getByLabelText('Scheduled task prompt')).toBeDisabled()
  expect(screen.getByLabelText('Schedule start time')).toBeDisabled()

  await act(async () => retry.reject('Connection still unavailable'))
  expect(screen.getByRole('alert')).toHaveTextContent(
    'Connection still unavailable'
  )
  expect(retryButton).toBeEnabled()
  expect(screen.queryByRole('status')).not.toBeInTheDocument()
  expect(screen.getByLabelText('Scheduled task prompt')).toHaveValue(
    'Prepare my notes'
  )
  expect(screen.getByLabelText('Schedule start time')).toHaveValue(
    '2030-01-02T09:00'
  )
  expect(request.mock.calls).toEqual([['schedules'], ['schedules']])

  fireEvent.click(retryButton)
  expect(retryButton).toBeDisabled()
  await act(async () =>
    recovery.resolve({
      schedules: [
        schedule,
        {
          ...schedule,
          id: 'other',
          workspace_id: 'bot-two',
          prompt: 'Other bot task',
        },
      ],
      stopped: null,
    })
  )
  expect(screen.getByText('Check the calendar')).toBeInTheDocument()
  expect(screen.queryByText('Other bot task')).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Disable schedule' })).toBeEnabled()
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  expect(screen.queryByRole('status')).not.toBeInTheDocument()
  expect(
    screen.queryByRole('button', { name: 'Retry loading schedules' })
  ).not.toBeInTheDocument()
  expect(screen.getByLabelText('Scheduled task prompt')).toHaveValue(
    'Prepare my notes'
  )
  expect(screen.getByLabelText('Schedule start time')).toHaveValue(
    '2030-01-02T09:00'
  )
  expect(screen.getByRole('button', { name: 'Create schedule' })).toBeEnabled()
  expect(request.mock.calls).toEqual([
    ['schedules'],
    ['schedules'],
    ['schedules'],
  ])
})

it('preserves a failed schedule draft during an explicit list retry', async () => {
  const create = deferred<unknown>()
  const listFailure = deferred<never>()
  const reload = deferred<{ schedules: (typeof schedule)[]; stopped: null }>()
  const createRetry = deferred<unknown>()
  request
    .mockResolvedValueOnce({ schedules: [schedule], stopped: null })
    .mockReturnValueOnce(create.promise)
    .mockReturnValueOnce(listFailure.promise)
    .mockReturnValueOnce(reload.promise)
    .mockReturnValueOnce(createRetry.promise)
    .mockResolvedValueOnce({
      schedules: [
        schedule,
        { ...schedule, id: 'new-schedule', prompt: 'Prepare my notes' },
      ],
      stopped: null,
    })
  render(<GbotSchedules workspaceId="bot-one" assignment={assignment} />)
  fireEvent.click(screen.getByText('Scheduled tasks'))
  await screen.findByText('Check the calendar')
  fireEvent.change(screen.getByLabelText('Scheduled task prompt'), {
    target: { value: 'Prepare my notes' },
  })
  fireEvent.change(screen.getByLabelText('Schedule start time'), {
    target: { value: '2030-01-02T09:00' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Create schedule' }))
  await act(async () => create.reject(new Error('Could not save schedule')))
  expect(screen.getByRole('alert')).toHaveTextContent('Could not save schedule')
  const retryButton = screen.getByRole('button', {
    name: 'Retry loading schedules',
  })
  act(() => {
    fireEvent.click(retryButton)
    fireEvent.click(retryButton)
    fireEvent.submit(screen.getByRole('form', { name: 'Schedule a bot task' }))
  })
  expect(request.mock.calls.map(([route]) => route)).toEqual([
    'schedules',
    'schedules/create',
    'schedules',
  ])
  expect(retryButton).toBeDisabled()
  expect(screen.getByLabelText('Scheduled task prompt')).toBeDisabled()
  await act(async () =>
    listFailure.reject(new Error('Schedule list unavailable'))
  )
  const alerts = screen.getAllByRole('alert')
  expect(alerts).toHaveLength(2)
  expect(alerts.map((alert) => alert.textContent)).toEqual(
    expect.arrayContaining([
      expect.stringContaining('Could not save schedule'),
      expect.stringContaining('Schedule list unavailable'),
    ])
  )
  expect(
    screen.getAllByRole('button', { name: 'Retry loading schedules' })
  ).toHaveLength(1)

  fireEvent.click(screen.getByRole('button', { name: 'Retry loading schedules' }))
  expect(screen.getByRole('status')).toHaveTextContent('Loading schedules…')
  expect(
    screen.getByRole('button', { name: 'Retry loading schedules' })
  ).toBeDisabled()
  expect(screen.getByRole('button', { name: 'Create schedule' })).toBeDisabled()
  expect(screen.getByRole('button', { name: 'Disable schedule' })).toBeDisabled()
  expect(screen.getAllByRole('alert')).toHaveLength(2)
  expect(
    request.mock.calls.filter(([route]) => route === 'schedules/create')
  ).toHaveLength(1)
  await act(async () => reload.resolve({ schedules: [schedule], stopped: null }))

  expect(screen.getByRole('alert')).toHaveTextContent('Could not save schedule')
  expect(screen.queryByText(/Schedule list unavailable/)).not.toBeInTheDocument()
  expect(
    screen.getByRole('button', { name: 'Retry loading schedules' })
  ).toBeEnabled()
  expect(screen.getByRole('button', { name: 'Disable schedule' })).toBeEnabled()
  expect(screen.getByLabelText('Scheduled task prompt')).toHaveValue(
    'Prepare my notes'
  )
  expect(screen.getByLabelText('Schedule start time')).toHaveValue(
    '2030-01-02T09:00'
  )
  expect(screen.getByRole('button', { name: 'Create schedule' })).toBeEnabled()
  expect(
    request.mock.calls.filter(([route]) => route === 'schedules/create')
  ).toHaveLength(1)

  fireEvent.click(screen.getByRole('button', { name: 'Create schedule' }))
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  const payload = {
    workspace_id: 'bot-one',
    prompt: 'Prepare my notes',
    timing: {
      kind: 'once',
      at: Math.floor(new Date('2030-01-02T09:00').getTime() / 1000),
    },
    missed_run_policy: 'run_latest',
  }
  expect(
    request.mock.calls.filter(([route]) => route === 'schedules/create')
  ).toEqual([
    ['schedules/create', payload],
    ['schedules/create', payload],
  ])
  await act(async () =>
    createRetry.resolve({
      ...schedule,
      ...payload,
      id: 'new-schedule',
    })
  )
  expect(screen.getByText('Prepare my notes')).toBeInTheDocument()
  expect(screen.getByLabelText('Scheduled task prompt')).toHaveValue('')
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  expect(screen.queryByRole('status')).not.toBeInTheDocument()
  expect(request.mock.calls.map(([route]) => route)).toEqual([
    'schedules',
    'schedules/create',
    'schedules',
    'schedules',
    'schedules/create',
    'schedules',
  ])
})

it('keeps invalid schedule entries as plain validation without a service retry', async () => {
  render(<GbotSchedules workspaceId="bot-one" assignment={assignment} />)
  fireEvent.click(screen.getByText('Scheduled tasks'))
  await screen.findByText('Check the calendar')
  fireEvent.change(screen.getByLabelText('Scheduled task prompt'), {
    target: { value: 'Prepare my notes' },
  })
  fireEvent.change(screen.getByLabelText('Schedule start time'), {
    target: { value: '2030-01-02T09:00' },
  })
  const user = userEvent.setup()
  await user.click(screen.getByRole('button', { name: 'Schedule repetition' }))
  await user.click(screen.getByRole('menuitemradio', { name: 'At an interval' }))
  fireEvent.change(screen.getByLabelText('Schedule interval in seconds'), {
    target: { value: '0' },
  })
  const form = screen.getByRole('form', { name: 'Schedule a bot task' })
  fireEvent.submit(form)
  expect(screen.getByRole('alert')).toHaveTextContent(
    'Enter a prompt, start time and positive whole interval in seconds.'
  )
  expect(screen.queryByText('Details')).not.toBeInTheDocument()
  expect(
    screen.queryByRole('button', { name: 'Retry loading schedules' })
  ).not.toBeInTheDocument()
  expect(request.mock.calls).toEqual([['schedules']])
  expect(screen.getByLabelText('Scheduled task prompt')).toHaveValue(
    'Prepare my notes'
  )
  fireEvent.change(screen.getByLabelText('Schedule interval in seconds'), {
    target: { value: '60' },
  })
  fireEvent.submit(form)
  await waitFor(() =>
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  )
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  expect(
    request.mock.calls.filter(([route]) => route === 'schedules/create')
  ).toHaveLength(1)
  expect(screen.getByLabelText('Scheduled task prompt')).toHaveValue('')
})

it('clears a schedule-list connection error when a task update refresh succeeds', async () => {
  request
    .mockRejectedValueOnce(new Error('Schedule list unavailable'))
    .mockResolvedValue({ schedules: [schedule], stopped: null })
  render(<GbotSchedules workspaceId="bot-one" assignment={assignment} />)
  fireEvent.click(screen.getByText('Scheduled tasks'))
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Schedule list unavailable'
  )

  await act(async () => taskUpdate())
  expect(await screen.findByText('Check the calendar')).toBeInTheDocument()
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Disable schedule' })).toBeEnabled()
})

it('names the brain setup controls and requires saved settings before schedule creation', async () => {
  render(<GbotSchedules workspaceId="bot-one" />)
  fireEvent.click(screen.getByText('Scheduled tasks'))
  expect(
    screen.getByText(
      'Choose a brain, then click Save brain settings before creating a schedule.'
    )
  ).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Create schedule' })).toBeDisabled()
  expect(screen.getByLabelText('Scheduled task prompt')).toBeDisabled()
  await screen.findByText('Check the calendar')
  fireEvent.change(screen.getByLabelText('Scheduled task prompt'), {
    target: { value: 'Check task' },
  })
  fireEvent.change(screen.getByLabelText('Schedule start time'), {
    target: { value: '2030-01-02T09:00' },
  })
  fireEvent.submit(screen.getByRole('form', { name: 'Schedule a bot task' }))
  expect(request).not.toHaveBeenCalledWith(
    'schedules/create',
    expect.anything()
  )
})

it('removes the previous bot schedules and draft immediately while the new bot loads', async () => {
  const next = deferred<{ schedules: (typeof schedule)[]; stopped: null }>()
  request
    .mockResolvedValueOnce({ schedules: [schedule], stopped: null })
    .mockReturnValueOnce(next.promise)
  const view = render(
    <GbotSchedules workspaceId="bot-one" assignment={assignment} />
  )
  fireEvent.click(screen.getByText('Scheduled tasks'))
  await screen.findByText('Check the calendar')
  fireEvent.change(screen.getByLabelText('Scheduled task prompt'), {
    target: { value: 'Only for bot one' },
  })
  fireEvent.change(screen.getByLabelText('Schedule start time'), {
    target: { value: '2030-01-02T09:00' },
  })

  view.rerender(
    <GbotSchedules
      workspaceId="bot-two"
      assignment={{ ...assignment, workspace_id: 'bot-two' }}
    />
  )
  fireEvent.click(screen.getByText('Scheduled tasks'))

  expect(screen.queryByText('Check the calendar')).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Disable schedule' })).toBeNull()
  expect(screen.getByLabelText('Scheduled task prompt')).toHaveValue('')
  expect(screen.getByLabelText('Schedule start time')).toHaveValue('')
  expect(screen.getByRole('button', { name: 'Create schedule' })).toBeDisabled()
  await act(async () =>
    next.resolve({
      schedules: [
        {
          ...schedule,
          id: 'two',
          workspace_id: 'bot-two',
          prompt: 'Bot two task',
        },
      ],
      stopped: null,
    })
  )
  expect(screen.getByText('Bot two task')).toBeInTheDocument()
  expect(screen.queryByText('Check the calendar')).not.toBeInTheDocument()
})

it('ignores a previous bot schedule response after the current list is ready', async () => {
  const previous = deferred<{ schedules: (typeof schedule)[]; stopped: null }>()
  request.mockReturnValueOnce(previous.promise).mockResolvedValueOnce({
    schedules: [
      {
        ...schedule,
        id: 'two',
        workspace_id: 'bot-two',
        prompt: 'Bot two task',
      },
    ],
    stopped: null,
  })
  const view = render(<GbotSchedules workspaceId="bot-one" />)
  view.rerender(<GbotSchedules workspaceId="bot-two" />)
  fireEvent.click(screen.getByText('Scheduled tasks'))
  await screen.findByText('Bot two task')

  await act(async () =>
    previous.resolve({ schedules: [schedule], stopped: null })
  )

  expect(screen.getByText('Bot two task')).toBeInTheDocument()
  expect(screen.queryByText('Check the calendar')).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Disable schedule' }))
  await waitFor(() =>
    expect(request).toHaveBeenCalledWith('schedules/enabled', {
      id: 'two',
      enabled: false,
    })
  )
})

it('keeps the new bot usable when the previous bot pending action fails', async () => {
  const previousAction = deferred<unknown>()
  request
    .mockResolvedValueOnce({ schedules: [schedule], stopped: null })
    .mockReturnValueOnce(previousAction.promise)
    .mockResolvedValueOnce({ schedules: [], stopped: null })
  const view = render(
    <GbotSchedules workspaceId="bot-one" assignment={assignment} />
  )
  fireEvent.click(screen.getByText('Scheduled tasks'))
  await screen.findByText('Check the calendar')
  fireEvent.click(screen.getByRole('button', { name: 'Disable schedule' }))
  expect(
    screen.getByRole('button', { name: 'Disabling schedule…' })
  ).toBeDisabled()

  view.rerender(
    <GbotSchedules
      workspaceId="bot-two"
      assignment={{ ...assignment, workspace_id: 'bot-two' }}
    />
  )
  fireEvent.click(screen.getByText('Scheduled tasks'))
  fireEvent.change(screen.getByLabelText('Scheduled task prompt'), {
    target: { value: 'Only for bot two' },
  })
  await act(async () => previousAction.reject(new Error('Old bot unavailable')))

  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  expect(screen.getByLabelText('Scheduled task prompt')).toHaveValue(
    'Only for bot two'
  )
  expect(screen.getByLabelText('Scheduled task prompt')).toBeEnabled()
  expect(screen.queryByText('Check the calendar')).not.toBeInTheDocument()
})

it('keeps the schedule explanation inside the Scheduled tasks section like Linked accounts', async () => {
  request.mockResolvedValue({ schedules: [], stopped: null })
  render(<GbotSchedules workspaceId="bot-one" assignment={assignment} />)
  const summary = await screen.findByText('Scheduled tasks')
  const section = summary.closest('details')!
  expect(section).toContainElement(
    screen.getByText(/Scheduled tasks can keep running after GChat closes/)
  )
  expect(section.parentElement?.firstElementChild).toBe(section)
})

it('describes every kind of schedule in plain words', () => {
  expect(describeTiming({ kind: 'once', at: 1 })).toBe('Once')
  expect(describeTiming({ kind: 'interval', first_at: 1, every_seconds: 60 })).toBe('Every 60 seconds')
  expect(
    describeTiming({ kind: 'calendar', rule: { kind: 'days', days: [0, 1, 2, 3, 4], hour: 9, minute: 0 } })
  ).toBe('Weekdays at 09:00')
  expect(
    describeTiming({ kind: 'calendar', rule: { kind: 'days', days: [0, 2], hour: 7, minute: 5 } })
  ).toBe('Every Monday, Wednesday at 07:05')
  expect(
    describeTiming({ kind: 'calendar', rule: { kind: 'monthly_weekday', nth: 1, weekday: 0, hour: 9, minute: 30 } })
  ).toBe('First Monday of each month at 09:30')
  expect(
    describeTiming({ kind: 'calendar', rule: { kind: 'monthly_weekday', nth: 5, weekday: 4, hour: 17, minute: 0 } })
  ).toBe('Last Friday of each month at 17:00')
  expect(describeTiming({ kind: 'event', source: { kind: 'folder_arrival', path: '/home/gbot/Inbox' } })).toBe(
    'When a file arrives in /home/gbot/Inbox on the bot’s computer'
  )
  expect(describeTiming({ kind: 'event', source: { kind: 'mail_folder', path: '/home/me/Mail' } })).toBe(
    'When new mail arrives in the mail folder /home/me/Mail'
  )
})

it('creates a weekdays-at-nine schedule and a first-Monday schedule', async () => {
  const user = userEvent.setup()
  render(<GbotSchedules workspaceId="bot-one" assignment={assignment} />)
  fireEvent.click(screen.getByText('Scheduled tasks'))
  await screen.findByText('Check the calendar')
  fireEvent.change(screen.getByLabelText('Scheduled task prompt'), {
    target: { value: 'Send the morning summary' },
  })
  await user.click(screen.getByRole('button', { name: 'Schedule repetition' }))
  await user.click(screen.getByRole('menuitemradio', { name: 'On chosen days at a set time' }))
  expect(screen.queryByLabelText('Schedule start time')).toBeNull()
  fireEvent.change(screen.getByLabelText('Time of day'), { target: { value: '09:00' } })
  fireEvent.submit(screen.getByRole('form', { name: 'Schedule a bot task' }))
  await waitFor(() =>
    expect(request).toHaveBeenCalledWith('schedules/create', {
      workspace_id: 'bot-one',
      prompt: 'Send the morning summary',
      timing: { kind: 'calendar', rule: { kind: 'days', days: [0, 1, 2, 3, 4], hour: 9, minute: 0 } },
      missed_run_policy: 'run_latest',
    })
  )
  await waitFor(() => expect(screen.getByLabelText('Scheduled task prompt')).not.toBeDisabled())
  fireEvent.change(screen.getByLabelText('Scheduled task prompt'), { target: { value: 'Month start review' } })
  await user.click(screen.getByRole('button', { name: 'Schedule repetition' }))
  await user.click(screen.getByRole('menuitemradio', { name: 'Once a month on a chosen weekday' }))
  fireEvent.change(screen.getByLabelText('Time of day'), { target: { value: '08:30' } })
  fireEvent.submit(screen.getByRole('form', { name: 'Schedule a bot task' }))
  await waitFor(() =>
    expect(request).toHaveBeenCalledWith('schedules/create', {
      workspace_id: 'bot-one',
      prompt: 'Month start review',
      timing: { kind: 'calendar', rule: { kind: 'monthly_weekday', nth: 1, weekday: 0, hour: 8, minute: 30 } },
      missed_run_policy: 'run_latest',
    })
  )
})

it('creates file-arrival and mail-folder schedules and explains them', async () => {
  const user = userEvent.setup()
  render(<GbotSchedules workspaceId="bot-one" assignment={assignment} />)
  fireEvent.click(screen.getByText('Scheduled tasks'))
  await screen.findByText('Check the calendar')
  fireEvent.change(screen.getByLabelText('Scheduled task prompt'), {
    target: { value: 'File this invoice' },
  })
  await user.click(screen.getByRole('button', { name: 'Schedule repetition' }))
  await user.click(screen.getByRole('menuitemradio', { name: 'When a file arrives on the bot’s computer' }))
  expect(screen.getByText(/once for each new file/)).toBeVisible()
  expect(screen.queryByLabelText('Missed run policy')).toBeNull()
  fireEvent.submit(screen.getByRole('form', { name: 'Schedule a bot task' }))
  expect(screen.getByRole('alert')).toHaveTextContent('full folder path')
  fireEvent.change(screen.getByLabelText('Folder to watch'), { target: { value: '/home/gbot/Inbox' } })
  fireEvent.submit(screen.getByRole('form', { name: 'Schedule a bot task' }))
  await waitFor(() =>
    expect(request).toHaveBeenCalledWith('schedules/create', {
      workspace_id: 'bot-one',
      prompt: 'File this invoice',
      timing: { kind: 'event', source: { kind: 'folder_arrival', path: '/home/gbot/Inbox' } },
      missed_run_policy: 'run_latest',
    })
  )
  await waitFor(() => expect(screen.getByLabelText('Scheduled task prompt')).not.toBeDisabled())
  fireEvent.change(screen.getByLabelText('Scheduled task prompt'), { target: { value: 'Reply to this email' } })
  await user.click(screen.getByRole('button', { name: 'Schedule repetition' }))
  await user.click(screen.getByRole('menuitemradio', { name: 'When new mail arrives in a mail folder' }))
  expect(screen.getByText(/Mail from connected Google or Microsoft accounts is not watched yet/)).toBeVisible()
  fireEvent.change(screen.getByLabelText('Mail folder to watch'), { target: { value: '/home/me/Mail/inbox' } })
  fireEvent.submit(screen.getByRole('form', { name: 'Schedule a bot task' }))
  await waitFor(() =>
    expect(request).toHaveBeenCalledWith('schedules/create', {
      workspace_id: 'bot-one',
      prompt: 'Reply to this email',
      timing: { kind: 'event', source: { kind: 'mail_folder', path: '/home/me/Mail/inbox' } },
      missed_run_policy: 'run_latest',
    })
  )
})

it('shows what an event schedule is watching and why a look failed', async () => {
  request.mockResolvedValueOnce({
    schedules: [
      {
        ...schedule,
        timing: { kind: 'event', source: { kind: 'folder_arrival', path: '/home/gbot/Inbox' } },
        next_at: null,
        watch: { primed: true, last_error: 'The folder /home/gbot/Inbox could not be read on the bot’s computer. Check that it exists.' },
      },
    ],
    stopped: null,
  })
  render(<GbotSchedules workspaceId="bot-one" assignment={assignment} />)
  fireEvent.click(screen.getByText('Scheduled tasks'))
  expect(await screen.findByText(/When a file arrives in \/home\/gbot\/Inbox/)).toBeVisible()
  expect(screen.getByText(/Watching for new arrivals/)).toBeVisible()
  expect(screen.getByRole('alert')).toHaveTextContent('Check that it exists')
})

it('starts a run now for the chosen schedule and says plainly when it cannot', async () => {
  render(<GbotSchedules workspaceId="bot-one" assignment={assignment} />)
  fireEvent.click(screen.getByText('Scheduled tasks'))
  await screen.findByText('Check the calendar')
  request.mockImplementation(async (route: string, input?: Record<string, unknown>) => {
    if (route === 'schedules/run_now') return { ...schedule }
    if (route === 'schedules') return { schedules: [schedule], stopped: null }
    return { ...schedule, ...input }
  })
  fireEvent.click(screen.getByRole('button', { name: 'Run now' }))
  await waitFor(() => expect(request).toHaveBeenCalledWith('schedules/run_now', { id: 'schedule-one' }))
  request.mockImplementation(async (route: string) => {
    if (route === 'schedules/run_now') throw new Error('A run of this schedule is already going or needs your review.')
    return { schedules: [schedule], stopped: null }
  })
  fireEvent.click(screen.getByRole('button', { name: 'Run now' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Could not start a run now')
  fireEvent.click(within(screen.getByRole('alert')).getByText('Details'))
  expect(screen.getByText('A run of this schedule is already going or needs your review.')).toBeVisible()
})

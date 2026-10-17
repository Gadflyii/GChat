import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import GbotSchedules from './GbotSchedules'

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
  request.mockImplementation(async (route: string) =>
    route === 'schedules'
      ? {
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
      : undefined
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
  await act(async () => disable.resolve(undefined))
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

  expect(screen.getByRole('alert')).toHaveTextContent(
    'Scheduling has stopped: Journal failure'
  )
  expect(screen.getByRole('button', { name: 'Enable schedule' })).toBeEnabled()
  expect(screen.getByRole('button', { name: 'Create schedule' })).toBeDisabled()
  expect(screen.getByText(/^Disabled ·/)).toBeInTheDocument()
})

it('shows a stopped scheduler outside the collapsed panel and prevents creating a schedule', async () => {
  request.mockResolvedValue({
    schedules: [schedule],
    stopped: 'Journal failure',
  })
  render(<GbotSchedules workspaceId="bot-one" assignment={assignment} />)
  const alert = await screen.findByRole('alert')
  expect(alert).toHaveTextContent('Scheduling has stopped: Journal failure')
  expect(alert.closest('details')).toBeNull()
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
  fireEvent.change(screen.getByLabelText('Schedule repetition'), {
    target: { value: 'interval' },
  })
  fireEvent.change(screen.getByLabelText('Schedule interval in seconds'), {
    target: { value: '86400' },
  })
  fireEvent.change(screen.getByLabelText('Missed run policy'), {
    target: { value: 'skip_missed' },
  })
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
  await act(async () => create.resolve(undefined))
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
    expect(screen.getByRole('alert')).toHaveTextContent('Service unavailable')
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: label })).toBeEnabled()
    fireEvent.click(screen.getByRole('button', { name: label }))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent(progress)
    await act(async () => retry.resolve(undefined))
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
    .mockResolvedValueOnce(undefined)
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
  expect(screen.getByRole('alert')).toHaveTextContent('Could not save schedule')
  expect(screen.getByLabelText('Scheduled task prompt')).toHaveValue(
    'Check task'
  )
  expect(screen.getByLabelText('Schedule start time')).toHaveValue(
    '2030-01-02T09:00'
  )
  expect(screen.getByRole('button', { name: 'Create schedule' })).toBeEnabled()
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

it('requires a saved bot inference assignment before schedule creation', async () => {
  render(<GbotSchedules workspaceId="bot-one" />)
  fireEvent.click(screen.getByText('Scheduled tasks'))
  expect(
    screen.getByText(
      'Save this bot’s inference assignment before creating a schedule.'
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

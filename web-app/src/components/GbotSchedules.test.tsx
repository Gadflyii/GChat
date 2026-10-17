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

const { request } = vi.hoisted(() => ({ request: vi.fn() }))
vi.mock('@/services/gbot', () => ({ gbot: request }))
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(async () => vi.fn()) }))

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
  render(<GbotSchedules workspaceId="bot-one" assignment={assignment} />)
  fireEvent.click(screen.getByText('Scheduled tasks'))
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
  fireEvent.click(screen.getByRole('button', { name: 'Create schedule' }))
  await waitFor(() =>
    expect(request).toHaveBeenCalledWith('schedules/create', {
      workspace_id: 'bot-one',
      prompt: 'Prepare my daily notes',
      timing: {
        kind: 'interval',
        first_at: Math.floor(new Date('2030-01-02T09:00').getTime() / 1000),
        every_seconds: 86400,
      },
      missed_run_policy: 'skip_missed',
    })
  )
  await waitFor(() =>
    expect(screen.getByLabelText('Scheduled task prompt')).toHaveValue('')
  )
  expect(screen.getByRole('button', { name: 'Create schedule' })).toBeDisabled()
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
})

it('removes the previous bot schedules and draft immediately while the new bot loads', async () => {
  const next = deferred<{ schedules: typeof schedule[]; stopped: null }>()
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
        { ...schedule, id: 'two', workspace_id: 'bot-two', prompt: 'Bot two task' },
      ],
      stopped: null,
    })
  )
  expect(screen.getByText('Bot two task')).toBeInTheDocument()
  expect(screen.queryByText('Check the calendar')).not.toBeInTheDocument()
})

it('ignores a previous bot schedule response after the current list is ready', async () => {
  const previous = deferred<{ schedules: typeof schedule[]; stopped: null }>()
  request
    .mockReturnValueOnce(previous.promise)
    .mockResolvedValueOnce({
      schedules: [
        { ...schedule, id: 'two', workspace_id: 'bot-two', prompt: 'Bot two task' },
      ],
      stopped: null,
    })
  const view = render(<GbotSchedules workspaceId="bot-one" />)
  view.rerender(<GbotSchedules workspaceId="bot-two" />)
  fireEvent.click(screen.getByText('Scheduled tasks'))
  await screen.findByText('Bot two task')

  await act(async () => previous.resolve({ schedules: [schedule], stopped: null }))

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
  expect(screen.getByRole('button', { name: 'Disable schedule' })).toBeDisabled()

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

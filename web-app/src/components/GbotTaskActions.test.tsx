import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { toast } from 'sonner'
import GbotTaskActions from './GbotTaskActions'

vi.mock('sonner', () => ({ toast: { error: vi.fn() } }))

const available = { busy: false, ready: true, botHasControl: true }

it.each([
  {
    state: 'running',
    button: 'Stop task',
    action: 'cancel',
    pending: 'Stopping',
  },
  {
    state: 'paused',
    button: 'Resume task',
    action: 'resume',
    pending: 'Resuming',
  },
])(
  'shows $pending until completion and ignores repeat clicks',
  async ({ state, button, action, pending }) => {
    let finish!: () => void
    const onAction = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve
        })
    )
    const view = render(
      <GbotTaskActions {...available} taskState={state} onAction={onAction} />
    )
    const control = screen.getByRole('button', { name: button })
    act(() => {
      fireEvent.click(control)
      fireEvent.click(control)
    })
    expect(onAction).toHaveBeenCalledExactlyOnceWith(action)
    expect(screen.getByRole('status')).toHaveTextContent(
      `${pending} this task…`
    )
    expect(screen.getByRole('button', { name: `${pending}…` })).toBeDisabled()
    expect(control).toHaveAttribute('aria-busy', 'true')
    view.rerender(
      <GbotTaskActions
        {...available}
        taskState="completed"
        onAction={onAction}
      />
    )
    expect(screen.getByRole('button', { name: `${pending}…` })).toBeDisabled()
    await act(async () => finish())
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(onAction).toHaveBeenCalledTimes(1)
  }
)

it.each([
  { blocked: { ready: false }, reason: 'the brain is not ready' },
  { blocked: { botHasControl: false }, reason: 'a person has control' },
  { blocked: { busy: true }, reason: 'another action is pending' },
])('keeps Resume disabled when $reason', ({ blocked }) => {
  const onAction = vi.fn()
  render(
    <GbotTaskActions
      {...available}
      {...blocked}
      taskState="paused"
      onAction={onAction}
    />
  )
  const control = screen.getByRole('button', { name: 'Resume task' })
  fireEvent.click(control)
  expect(control).toBeDisabled()
  expect(onAction).not.toHaveBeenCalled()
  expect(screen.queryByRole('status')).not.toBeInTheDocument()
})

it('keeps Stop available without a ready brain or bot control', async () => {
  const onAction = vi.fn().mockResolvedValue(undefined)
  render(
    <GbotTaskActions
      busy={false}
      ready={false}
      botHasControl={false}
      taskState="waiting_for_human"
      onAction={onAction}
    />
  )
  const control = screen.getByRole('button', { name: 'Stop task' })
  expect(control).toBeEnabled()
  fireEvent.click(control)
  await waitFor(() =>
    expect(onAction).toHaveBeenCalledExactlyOnceWith('cancel')
  )
})

it('keeps a failed task action available for an explicit retry', async () => {
  const onAction = vi
    .fn()
    .mockRejectedValueOnce(new Error('The bot is disconnected'))
    .mockResolvedValueOnce(undefined)
  render(
    <GbotTaskActions {...available} taskState="paused" onAction={onAction} />
  )
  const control = screen.getByRole('button', { name: 'Resume task' })
  fireEvent.click(control)
  await waitFor(() => expect(control).toBeEnabled())
  expect(toast.error).toHaveBeenCalledWith('Error: The bot is disconnected')
  expect(screen.queryByRole('status')).not.toBeInTheDocument()
  fireEvent.click(control)
  await waitFor(() => expect(onAction).toHaveBeenCalledTimes(2))
  expect(onAction.mock.calls).toEqual([['resume'], ['resume']])
})

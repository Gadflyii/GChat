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
  {
    state: 'paused',
    button: 'Stop task',
    action: 'cancel',
    pending: 'Stopping',
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
    const controls = screen.getAllByRole('button')
    act(() => {
      fireEvent.click(control)
      fireEvent.click(control)
      controls.filter((other) => other !== control).forEach((other) => fireEvent.click(other))
    })
    expect(onAction).toHaveBeenCalledExactlyOnceWith(action)
    expect(screen.getByRole('status')).toHaveTextContent(
      `${pending} this task…`
    )
    expect(screen.getByRole('button', { name: `${pending}…` })).toBeDisabled()
    controls.forEach((other) => expect(other).toBeDisabled())
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

it.each(['waiting_for_human', 'ready', 'paused', 'interrupted'])(
  'keeps Stop available for %s without a ready brain or bot control',
  async (taskState) => {
    const onAction = vi.fn().mockResolvedValue(undefined)
    render(
      <GbotTaskActions
        busy={false}
        ready={false}
        botHasControl={false}
        taskState={taskState}
        onAction={onAction}
      />
    )
    const control = screen.getByRole('button', { name: 'Stop task' })
    expect(control).toBeEnabled()
    if (taskState !== 'waiting_for_human') {
      expect(screen.getByRole('button', { name: 'Resume task' })).toBeDisabled()
    }
    fireEvent.click(control)
    await waitFor(() =>
      expect(onAction).toHaveBeenCalledExactlyOnceWith('cancel')
    )
  }
)

it.each([
  { button: 'Stop task', action: 'cancel' },
  { button: 'Resume task', action: 'resume' },
])('keeps a failed $button available for an explicit retry', async ({ button, action }) => {
  const onAction = vi
    .fn()
    .mockRejectedValueOnce(new Error('The bot is disconnected'))
    .mockResolvedValueOnce(undefined)
  render(
    <GbotTaskActions {...available} taskState="paused" onAction={onAction} />
  )
  const control = screen.getByRole('button', { name: button })
  fireEvent.click(control)
  await waitFor(() => expect(control).toBeEnabled())
  expect(toast.error).toHaveBeenCalledWith('Error: The bot is disconnected')
  expect(screen.queryByRole('status')).not.toBeInTheDocument()
  fireEvent.click(control)
  await waitFor(() => expect(onAction).toHaveBeenCalledTimes(2))
  expect(onAction.mock.calls).toEqual([[action], [action]])
})

it.each(['completed', 'needs_review'])(
  'does not offer task controls for %s',
  (taskState) => {
    render(<GbotTaskActions {...available} taskState={taskState} onAction={vi.fn()} />)
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  }
)

it('offers only Resume for a cancelled task', () => {
  render(<GbotTaskActions {...available} taskState="cancelled" onAction={vi.fn()} />)
  expect(screen.getByRole('button', { name: 'Resume task' })).toBeEnabled()
  expect(screen.queryByRole('button', { name: 'Stop task' })).not.toBeInTheDocument()
})

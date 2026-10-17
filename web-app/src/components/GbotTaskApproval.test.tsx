import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { toast } from 'sonner'
import GbotTaskApproval from './GbotTaskApproval'

vi.mock('sonner', () => ({ toast: { error: vi.fn() } }))

const approval = {
  id: 'permission-one',
  task_id: 'task-one',
  request: { operation: { kind: 'desktop_input' } },
}

it.each([
  { button: 'Allow', allow: true, pending: 'Allowing' },
  { button: 'Deny', allow: false, pending: 'Denying' },
])(
  'sends $button once and blocks an opposing pending reply',
  async ({ button, allow, pending }) => {
    let finish!: () => void
    const reply = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve
        })
    )
    render(<GbotTaskApproval approval={approval} busy={false} reply={reply} />)
    const allowButton = screen.getByRole('button', {
      name: 'Allow',
      exact: true,
    })
    const denyButton = screen.getByRole('button', { name: 'Deny', exact: true })
    const chosen = button === 'Allow' ? allowButton : denyButton
    const opposite = button === 'Allow' ? denyButton : allowButton
    act(() => {
      fireEvent.click(chosen)
      fireEvent.click(opposite)
      fireEvent.click(chosen)
    })
    expect(reply).toHaveBeenCalledExactlyOnceWith(allow)
    expect(screen.getByRole('article')).toHaveAttribute('aria-busy', 'true')
    expect(screen.getByRole('status')).toHaveTextContent(
      `${pending} this action…`
    )
    expect(screen.getByRole('button', { name: `${pending}…` })).toBeDisabled()
    expect(opposite).toBeDisabled()
    expect(screen.getByText(/desktop_input/)).toBeVisible()
    await act(async () => finish())
    await waitFor(() => expect(chosen).toBeEnabled())
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(screen.getByRole('article')).toHaveAttribute('aria-busy', 'false')
  }
)

it('retains a failed request for an explicit retry', async () => {
  const reply = vi
    .fn()
    .mockRejectedValueOnce(new Error('Permission reply failed'))
    .mockResolvedValueOnce(undefined)
  render(<GbotTaskApproval approval={approval} busy={false} reply={reply} />)
  const allow = screen.getByRole('button', { name: 'Allow', exact: true })
  fireEvent.click(allow)
  await waitFor(() => expect(allow).toBeEnabled())
  expect(toast.error).toHaveBeenCalledWith('Error: Permission reply failed')
  expect(screen.getByText(/desktop_input/)).toBeVisible()
  fireEvent.click(allow)
  await waitFor(() => expect(reply).toHaveBeenCalledTimes(2))
  expect(reply.mock.calls).toEqual([[true], [true]])
})

it('respects another pending action without submitting a permission reply', () => {
  const reply = vi.fn()
  render(<GbotTaskApproval approval={approval} busy reply={reply} />)
  const allow = screen.getByRole('button', { name: 'Allow', exact: true })
  const deny = screen.getByRole('button', { name: 'Deny', exact: true })
  fireEvent.click(allow)
  fireEvent.click(deny)
  expect(allow).toBeDisabled()
  expect(deny).toBeDisabled()
  expect(reply).not.toHaveBeenCalled()
  expect(screen.queryByRole('status')).not.toBeInTheDocument()
})

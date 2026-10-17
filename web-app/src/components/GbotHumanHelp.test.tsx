import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { HelpRequest } from '@/services/gbot'
import GbotHumanHelp from './GbotHumanHelp'

afterEach(cleanup)

const request: HelpRequest = {
  id: 'folder',
  question: 'Which folder should I use?',
  status: 'pending',
  response: null,
}

function deferred() {
  let resolve!: () => void
  let reject!: (cause: unknown) => void
  const promise = new Promise<void>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}

it.each([
  ['Send reply', 'Sending reply…', 'Documents'],
  ['Decline', 'Declining request…', null],
] as const)(
  'shows progress and prevents duplicate %s actions until confirmation',
  async (action, status, response) => {
    const pending = deferred()
    const reply = vi.fn().mockReturnValue(pending.promise)
    const { container } = render(
      <GbotHumanHelp request={request} busy={false} reply={reply} />
    )
    fireEvent.change(screen.getByLabelText('Your reply'), {
      target: { value: 'Documents' },
    })
    const button = screen.getByRole('button', { name: action })
    act(() => {
      fireEvent.click(button)
      fireEvent.click(button)
      fireEvent.submit(container.querySelector('form')!)
    })
    expect(reply).toHaveBeenCalledExactlyOnceWith(response)
    expect(screen.getByRole('status')).toHaveTextContent(status)
    expect(screen.getByLabelText('Your reply')).toBeDisabled()
    expect(
      screen
        .getAllByRole('button')
        .every((item) => item.hasAttribute('disabled'))
    ).toBe(true)
    await act(async () => pending.resolve())
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Your reply')).toBeEnabled()
    expect(screen.getByLabelText('Your reply')).toHaveValue('Documents')
  }
)

it.each(['Send reply', 'Decline'])(
  'keeps the reply draft after a failed %s and allows retry',
  async (action) => {
    const first = deferred()
    const retry = deferred()
    const reply = vi
      .fn()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(retry.promise)
    render(<GbotHumanHelp request={request} busy={false} reply={reply} />)
    fireEvent.change(screen.getByLabelText('Your reply'), {
      target: { value: 'Keep this draft' },
    })
    fireEvent.click(screen.getByRole('button', { name: action }))
    await act(async () => first.reject(new Error('Service unavailable')))
    expect(screen.getByRole('alert')).toHaveTextContent('Service unavailable')
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Your reply')).toHaveValue('Keep this draft')
    expect(screen.getByLabelText('Your reply')).toBeEnabled()
    fireEvent.click(screen.getByRole('button', { name: action }))
    expect(reply).toHaveBeenCalledTimes(2)
    expect(reply.mock.calls[1]).toEqual(reply.mock.calls[0])
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    await act(async () => retry.resolve())
  }
)

it('does not submit an empty reply or claim to send during unrelated work', () => {
  const reply = vi.fn().mockResolvedValue(undefined)
  const { container, rerender } = render(
    <GbotHumanHelp request={request} busy={false} reply={reply} />
  )
  fireEvent.submit(container.querySelector('form')!)
  expect(reply).not.toHaveBeenCalled()
  fireEvent.change(screen.getByLabelText('Your reply'), {
    target: { value: 'Documents' },
  })
  rerender(<GbotHumanHelp request={request} busy reply={reply} />)
  fireEvent.submit(container.querySelector('form')!)
  expect(reply).not.toHaveBeenCalled()
  expect(screen.getByRole('button', { name: 'Send reply' })).toBeDisabled()
  expect(screen.getByRole('button', { name: 'Decline' })).toBeDisabled()
  expect(screen.queryByRole('status')).not.toBeInTheDocument()
})

it('shows the confirmed outcome without offering another response', () => {
  const reply = vi.fn().mockResolvedValue(undefined)
  const { rerender } = render(
    <GbotHumanHelp
      request={{ ...request, status: 'completed', response: 'Documents' }}
      busy={false}
      reply={reply}
    />
  )
  expect(screen.getByText('Your reply: Documents')).toBeVisible()
  expect(screen.queryByRole('button')).not.toBeInTheDocument()
  rerender(
    <GbotHumanHelp
      request={{ ...request, status: 'declined' }}
      busy={false}
      reply={reply}
    />
  )
  expect(screen.getByText('Request declined')).toBeVisible()
  expect(reply).not.toHaveBeenCalled()
})

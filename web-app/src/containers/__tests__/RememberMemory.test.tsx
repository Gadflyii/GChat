import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, expect, it, vi } from 'vitest'
import { RememberMemory } from '../RememberMemory'
import { memoryCommand } from '@/lib/memory'

vi.mock('@/lib/memory', () => ({ memoryCommand: vi.fn() }))
beforeEach(() => vi.clearAllMocks())

it('requires review and preserves the source message when saving a memory', async () => {
  const user = userEvent.setup()
  vi.mocked(memoryCommand).mockResolvedValue({ id: 'saved' })
  render(
    <RememberMemory
      text="Use pnpm test for this project."
      messageId="message-one"
    />
  )
  const trigger = screen.getByRole('button', { name: 'Save to Memory' })
  await user.click(trigger)
  expect(memoryCommand).not.toHaveBeenCalled()
  fireEvent.change(screen.getByLabelText('Title'), {
    target: { value: 'Project test command' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Save memory' }))
  await waitFor(() =>
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  )
  await waitFor(() => expect(trigger).toHaveFocus())
  expect(memoryCommand).toHaveBeenCalledWith(
    'save',
    expect.objectContaining({
      title: 'Project test command',
      content: 'Use pnpm test for this project.',
      origin: 'message:message-one',
      workspace: null,
    })
  )
})

it.each(['Escape', 'Close'] as const)(
  'returns focus to the same message after %s and discards the cancelled draft',
  async (dismissal) => {
    const user = userEvent.setup()
    render(
      <>
        <RememberMemory text="First message" messageId="message-one" />
        <RememberMemory text="Second message" messageId="message-two" />
      </>
    )
    const trigger = screen.getAllByRole('button', { name: 'Save to Memory' })[1]
    trigger.focus()
    await user.keyboard('{Enter}')
    expect(screen.getByLabelText('Title')).toHaveValue('Second message')
    await user.clear(screen.getByLabelText('Title'))
    await user.type(screen.getByLabelText('Title'), 'Discard this draft')

    if (dismissal === 'Escape') await user.keyboard('{Escape}')
    else await user.click(screen.getByRole('button', { name: 'Close' }))

    await waitFor(() => expect(trigger).toHaveFocus())
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(memoryCommand).not.toHaveBeenCalled()
    await user.keyboard(' ')
    expect(await screen.findByRole('dialog')).toBeInTheDocument()
    expect(screen.getByLabelText('Title')).toHaveValue('Second message')
    expect(screen.getByLabelText('Memory')).toHaveValue('Second message')
    await user.keyboard('{Escape}')
    await waitFor(() => expect(trigger).toHaveFocus())
  }
)

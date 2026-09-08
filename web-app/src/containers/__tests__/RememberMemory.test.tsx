import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { RememberMemory } from '../RememberMemory'
import { memoryCommand } from '@/lib/memory'

vi.mock('@/lib/memory', () => ({ memoryCommand: vi.fn() }))
it('requires review and preserves the source message when saving a memory', async () => {
  vi.mocked(memoryCommand).mockResolvedValue({ id: 'saved' })
  render(
    <RememberMemory
      text="Use pnpm test for this project."
      messageId="message-one"
    />
  )
  fireEvent.click(screen.getByRole('button', { name: 'Remember this' }))
  expect(memoryCommand).not.toHaveBeenCalled()
  fireEvent.change(screen.getByLabelText('Title'), {
    target: { value: 'Project test command' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Save memory' }))
  await waitFor(() =>
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  )
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

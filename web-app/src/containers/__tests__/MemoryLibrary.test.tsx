import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import { MemoryLibrary } from '../MemoryLibrary'
import { memoryCommand, type SavedMemory } from '@/lib/memory'

vi.mock('@/lib/memory', () => ({ memoryCommand: vi.fn() }))
let saved: SavedMemory[]
beforeEach(() => {
  saved = []
  vi.mocked(memoryCommand).mockImplementation(async (action, args) => {
    const value = args as SavedMemory
    if (action === 'list') return [...saved]
    if (action === 'save') {
      saved = [
        {
          ...value,
          id: 'memory',
          revision: (value.revision ?? 0) + 1,
          source: 'user',
          createdAt: 1,
          updatedAt: 2,
        },
      ]
      return saved[0]
    }
    if (action === 'delete') {
      saved = []
      return { deleted: true }
    }
    if (action === 'instructions') return { text: 'Run pnpm test.' }
    throw new Error('Unexpected action')
  })
})

it('creates, edits, disables, and deletes a visible memory with confirmation', async () => {
  render(<MemoryLibrary />)
  await screen.findByText(/No saved memories yet/)
  fireEvent.click(screen.getByRole('button', { name: 'New memory' }))
  fireEvent.change(screen.getByLabelText('Title'), {
    target: { value: 'Build command' },
  })
  fireEvent.change(screen.getByLabelText('Memory', { selector: 'textarea' }), {
    target: { value: 'Use pnpm test.' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Save memory' }))
  await screen.findByRole('heading', { name: 'Build command' })
  fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
  fireEvent.click(screen.getByLabelText('Enabled'))
  fireEvent.click(screen.getByRole('button', { name: 'Save memory' }))
  await screen.findByText('Personal · Disabled')
  expect(saved[0].revision).toBe(2)
  fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
  expect(
    screen.getByRole('heading', { name: 'Build command' })
  ).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Confirm delete' }))
  await screen.findByText(/No saved memories yet/)
})

it('keeps edits visible when a concurrent revision prevents saving', async () => {
  render(<MemoryLibrary />)
  fireEvent.click(screen.getByRole('button', { name: 'New memory' }))
  fireEvent.change(screen.getByLabelText('Title'), {
    target: { value: 'Preference' },
  })
  fireEvent.change(screen.getByLabelText('Memory', { selector: 'textarea' }), {
    target: { value: 'Keep responses concise.' },
  })
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Save memory' })).toBeEnabled()
  )
  vi.mocked(memoryCommand).mockRejectedValueOnce(
    new Error('Memory changed; refresh before editing')
  )
  fireEvent.click(screen.getByRole('button', { name: 'Save memory' }))
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'refresh before editing'
  )
  expect(screen.getByLabelText('Title')).toHaveValue('Preference')
})

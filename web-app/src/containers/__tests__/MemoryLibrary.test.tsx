import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
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

it('filters personal and workspace memories through the scope menu', async () => {
  const user = userEvent.setup()
  saved = [
    {
      id: 'personal', title: 'Personal preference', content: 'Keep answers concise.',
      workspace: null, pinned: false, enabled: true, revision: 1,
      createdAt: 1, updatedAt: 1, source: 'user',
    },
    {
      id: 'workspace', title: 'Workspace command', content: 'Run pnpm test.',
      workspace: '/workspace', pinned: false, enabled: true, revision: 1,
      createdAt: 1, updatedAt: 1, source: 'user',
    },
  ]
  render(<MemoryLibrary />)
  await screen.findByRole('heading', { name: 'Personal preference' })
  expect(screen.getByRole('heading', { name: 'Workspace command' })).toBeInTheDocument()

  await user.click(screen.getByRole('button', { name: 'Memory scope' }))
  await user.click(screen.getByRole('menuitemradio', { name: 'Personal' }))
  expect(screen.getByRole('heading', { name: 'Personal preference' })).toBeInTheDocument()
  expect(screen.queryByRole('heading', { name: 'Workspace command' })).not.toBeInTheDocument()

  await user.click(screen.getByRole('button', { name: 'Memory scope' }))
  await user.click(screen.getByRole('menuitemradio', { name: 'Workspaces' }))
  expect(screen.getByRole('heading', { name: 'Workspace command' })).toBeInTheDocument()
  expect(screen.queryByRole('heading', { name: 'Personal preference' })).not.toBeInTheDocument()

  await user.click(screen.getByRole('button', { name: 'Memory scope' }))
  await user.click(screen.getByRole('menuitemradio', { name: 'All scopes' }))
  expect(screen.getByRole('heading', { name: 'Personal preference' })).toBeInTheDocument()
  expect(screen.getByRole('heading', { name: 'Workspace command' })).toBeInTheDocument()
})

it('puts Refresh and New memory in the page header slot and does not repeat the page title', async () => {
  const slot = document.createElement('div')
  slot.id = 'page-header-actions'
  document.body.appendChild(slot)
  try {
    render(<MemoryLibrary />)
    await screen.findByText(/No saved memories yet/)
    expect(slot).toContainElement(screen.getByRole('button', { name: 'Refresh' }))
    expect(slot).toContainElement(screen.getByRole('button', { name: 'New memory' }))
    expect(screen.queryByRole('heading', { name: 'Memory' })).not.toBeInTheDocument()
  } finally {
    slot.remove()
  }
})

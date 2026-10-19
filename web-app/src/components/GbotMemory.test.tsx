import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import GbotMemory from './GbotMemory'

const { request } = vi.hoisted(() => ({ request: vi.fn() }))
vi.mock('@/services/gbot', () => ({ gbot: request }))

const fact = (id: string, text: string, by: 'person' | 'bot' = 'person') => ({ id, text, by, at: 1 })

beforeEach(() => request.mockReset())
afterEach(cleanup)

it('lists what the bot remembers and who added it, then adds, edits and deletes', async () => {
  request.mockResolvedValueOnce({ facts: [fact('a', 'Call me Sam'), fact('b', 'Prefers metric', 'bot')] })
  render(<GbotMemory workspaceId="bot-one" />)
  fireEvent.click(screen.getByText('Memory'))
  expect(await screen.findByText('Call me Sam')).toBeVisible()
  expect(screen.getByText('Added by the bot, approved by you')).toBeVisible()
  expect(request).toHaveBeenCalledWith('memory/get', { workspace_id: 'bot-one' })

  request.mockResolvedValueOnce({ facts: [fact('a', 'Call me Sam'), fact('b', 'Prefers metric', 'bot'), fact('c', 'Works in Austin')] })
  fireEvent.change(screen.getByLabelText('Add a memory'), { target: { value: 'Works in Austin' } })
  fireEvent.click(screen.getByRole('button', { name: 'Remember this' }))
  await waitFor(() => expect(request).toHaveBeenCalledWith('memory/add', { workspace_id: 'bot-one', text: 'Works in Austin' }))
  expect(await screen.findByText('Works in Austin')).toBeVisible()
  expect(screen.getByLabelText('Add a memory')).toHaveValue('')

  fireEvent.click(screen.getByRole('button', { name: 'Edit memory: Call me Sam' }))
  fireEvent.change(screen.getByLabelText('Edit memory'), { target: { value: 'Call me Samantha' } })
  request.mockResolvedValueOnce({ facts: [fact('a', 'Call me Samantha'), fact('b', 'Prefers metric', 'bot'), fact('c', 'Works in Austin')] })
  fireEvent.click(screen.getByRole('button', { name: 'Save change' }))
  await waitFor(() => expect(request).toHaveBeenCalledWith('memory/edit', { workspace_id: 'bot-one', id: 'a', text: 'Call me Samantha' }))
  expect(await screen.findByText('Call me Samantha')).toBeVisible()

  request.mockResolvedValueOnce({ facts: [fact('b', 'Prefers metric', 'bot'), fact('c', 'Works in Austin')] })
  fireEvent.click(screen.getByRole('button', { name: 'Delete memory: Call me Samantha' }))
  await waitFor(() => expect(request).toHaveBeenCalledWith('memory/delete', { workspace_id: 'bot-one', id: 'a' }))
  await waitFor(() => expect(screen.queryByText('Call me Samantha')).toBeNull())
})

it('shows an empty state and a plain error', async () => {
  request.mockResolvedValueOnce({ facts: [] })
  render(<GbotMemory workspaceId="bot-one" />)
  fireEvent.click(screen.getByText('Memory'))
  expect(await screen.findByText('This bot does not remember anything yet.')).toBeVisible()
  request.mockRejectedValueOnce(new Error('Keep each memory under 400 characters.'))
  fireEvent.change(screen.getByLabelText('Add a memory'), { target: { value: 'x' } })
  fireEvent.click(screen.getByRole('button', { name: 'Remember this' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Keep each memory under 400 characters.')
})

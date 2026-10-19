import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import GbotSites from './GbotSites'

const { request } = vi.hoisted(() => ({ request: vi.fn() }))
vi.mock('@/services/gbot', () => ({ gbot: request }))

beforeEach(() => request.mockReset())
afterEach(cleanup)

it('shows the saved rules and saves cleaned lines for this bot', async () => {
  request.mockResolvedValueOnce({ workspace_id: 'bot-one', allowed: ['docs.example.com'], blocked: [] })
  render(<GbotSites workspaceId="bot-one" />)
  fireEvent.click(screen.getByText('Websites'))
  expect(await screen.findByLabelText('Allowed websites')).toHaveValue('docs.example.com')
  expect(screen.getByText(/Leave both lists empty to let it use any website/)).toBeVisible()
  expect(request).toHaveBeenCalledWith('sites/get', { workspace_id: 'bot-one' })
  fireEvent.change(screen.getByLabelText('Blocked websites'), { target: { value: ' Bank.com \n\nhttps://x.org/p\n' } })
  request.mockResolvedValueOnce({ workspace_id: 'bot-one', allowed: ['docs.example.com'], blocked: ['bank.com', 'x.org'] })
  fireEvent.click(screen.getByRole('button', { name: 'Save website rules' }))
  await waitFor(() =>
    expect(request).toHaveBeenCalledWith('sites/save', {
      workspace_id: 'bot-one',
      allowed: ['docs.example.com'],
      blocked: ['Bank.com', 'https://x.org/p'],
    })
  )
  expect(await screen.findByText(/Website rules saved/)).toBeVisible()
  expect(screen.getByLabelText('Blocked websites')).toHaveValue('bank.com\nx.org')
})

it('says plainly when a rule is not a website and when rules are cleared', async () => {
  request.mockResolvedValueOnce({ workspace_id: 'bot-one', allowed: [], blocked: [] })
  render(<GbotSites workspaceId="bot-one" />)
  fireEvent.click(screen.getByText('Websites'))
  await screen.findByLabelText('Allowed websites')
  fireEvent.change(screen.getByLabelText('Allowed websites'), { target: { value: 'not a site' } })
  request.mockRejectedValueOnce(new Error('"not a site" is not a website address.'))
  fireEvent.click(screen.getByRole('button', { name: 'Save website rules' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('"not a site" is not a website address.')
  fireEvent.change(screen.getByLabelText('Allowed websites'), { target: { value: '' } })
  request.mockResolvedValueOnce({ workspace_id: 'bot-one', allowed: [], blocked: [] })
  fireEvent.click(screen.getByRole('button', { name: 'Save website rules' }))
  expect(await screen.findByText('No website rules. The bot may open any website.')).toBeVisible()
})

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import LanTools from './LanTools'
import { gbot } from '@/services/gbot'

vi.mock('@/services/gbot', () => ({ gbot: vi.fn() }))
afterEach(() => {
  cleanup()
  vi.resetAllMocks()
})

it('requires consent, stages a command and checks installation before proceeding', async () => {
  const ready = vi.fn()
  const busy = vi.fn()
  const api = vi
    .mocked(gbot)
    .mockResolvedValueOnce({
      installed: false,
      command: 'sudo -- sh "install.sh"',
      issue: null,
    })
    .mockResolvedValueOnce({ installed: true, command: null, issue: null })
  render(<LanTools workspaceId="bot" ready={ready} busy={busy} />)
  expect(screen.getByRole('button', { name: 'Prepare tools' })).toBeDisabled()
  expect(api).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('checkbox'))
  fireEvent.click(screen.getByRole('button', { name: 'Prepare tools' }))
  await screen.findByDisplayValue('sudo -- sh "install.sh"')
  expect(api).toHaveBeenCalledWith('workspaces/ssh/prepare', {
    workspace_id: 'bot',
    consent: true,
  })
  expect(ready).toHaveBeenLastCalledWith(false)
  expect(screen.queryByRole('status')).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Check tools' }))
  await screen.findByRole('status')
  expect(ready).toHaveBeenLastCalledWith(true)
  expect(busy).toHaveBeenLastCalledWith(false)
})

it('shows the failed step and allows another preparation or installation check', async () => {
  const ready = vi.fn()
  const api = vi
    .mocked(gbot)
    .mockResolvedValueOnce({
      installed: false,
      command: null,
      issue: 'Guest archive upload failed: checksum mismatch',
    })
    .mockRejectedValueOnce(new Error('SSH unavailable'))
    .mockResolvedValueOnce({ installed: true, command: null, issue: null })
  render(<LanTools workspaceId="bot" ready={ready} busy={vi.fn()} />)
  fireEvent.click(screen.getByRole('checkbox'))
  fireEvent.click(screen.getByRole('button', { name: 'Prepare tools' }))
  await screen.findByText('Guest archive upload failed: checksum mismatch')
  fireEvent.click(screen.getByRole('button', { name: 'Prepare tools' }))
  await screen.findByText('SSH unavailable')
  expect(ready).toHaveBeenLastCalledWith(false)
  fireEvent.click(screen.getByRole('button', { name: 'Check tools' }))
  await waitFor(() => expect(ready).toHaveBeenLastCalledWith(true))
  expect(api).toHaveBeenCalledTimes(3)
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
})

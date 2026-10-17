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
  await screen.findByText(
    'Tools installed. Continue to connect and check the bot desktop.'
  )
  expect(
    screen.queryByRole('textbox', { name: 'Bot tools administrator command' })
  ).not.toBeInTheDocument()
  expect(ready).toHaveBeenLastCalledWith(true)
  expect(busy).toHaveBeenLastCalledWith(false)
})

it('hides the old administrator command while checking and replaces it with current instructions', async () => {
  let completeCheck!: (value: {
    installed: boolean
    command: string | null
    issue: null
  }) => void
  vi.mocked(gbot)
    .mockResolvedValueOnce({
      installed: false,
      command: 'sudo -- sh "old-install.sh"',
      issue: null,
    })
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          completeCheck = resolve
        })
    )
  render(<LanTools workspaceId="bot" ready={vi.fn()} busy={vi.fn()} />)
  fireEvent.click(screen.getByRole('checkbox'))
  fireEvent.click(screen.getByRole('button', { name: 'Prepare tools' }))
  await screen.findByDisplayValue('sudo -- sh "old-install.sh"')

  fireEvent.click(screen.getByRole('button', { name: 'Check tools' }))
  expect(
    screen.queryByRole('textbox', { name: 'Bot tools administrator command' })
  ).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Checking tools…' })).toBeDisabled()
  expect(screen.getByRole('button', { name: 'Prepare tools' })).toBeDisabled()
  expect(screen.getByRole('status')).toHaveTextContent(
    'Checking tools on the bot computer…'
  )

  completeCheck({
    installed: false,
    command: 'sudo -- sh "current-install.sh"',
    issue: null,
  })
  await screen.findByDisplayValue('sudo -- sh "current-install.sh"')
  expect(
    screen.queryByDisplayValue('sudo -- sh "old-install.sh"')
  ).not.toBeInTheDocument()
  expect(screen.queryByRole('status')).not.toBeInTheDocument()
})

it('announces preparation, blocks repeat requests and restores controls after failure', async () => {
  let failPreparation!: (cause: Error) => void
  const ready = vi.fn()
  const busy = vi.fn()
  const api = vi.mocked(gbot).mockImplementationOnce(
    () =>
      new Promise((_resolve, reject) => {
        failPreparation = reject
      })
  )
  render(<LanTools workspaceId="bot" ready={ready} busy={busy} />)
  fireEvent.click(screen.getByRole('checkbox'))
  const prepare = screen.getByRole('button', { name: 'Prepare tools' })
  fireEvent.click(prepare)
  fireEvent.click(prepare)
  expect(api).toHaveBeenCalledTimes(1)
  expect(api).toHaveBeenCalledWith('workspaces/ssh/prepare', {
    workspace_id: 'bot',
    consent: true,
  })
  expect(
    screen.getByRole('button', { name: 'Preparing tools…' })
  ).toBeDisabled()
  expect(screen.getByRole('button', { name: 'Check tools' })).toBeDisabled()
  expect(screen.getByRole('checkbox')).toBeDisabled()
  expect(screen.getByRole('status')).toHaveTextContent(
    'Preparing tools on the bot computer…'
  )
  expect(busy).toHaveBeenLastCalledWith(true)
  expect(ready).toHaveBeenLastCalledWith(false)

  failPreparation(new Error('SSH unavailable'))
  await screen.findByText('SSH unavailable')
  expect(screen.queryByRole('status')).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Prepare tools' })).toBeEnabled()
  expect(screen.getByRole('button', { name: 'Check tools' })).toBeEnabled()
  expect(screen.getByRole('checkbox')).toBeEnabled()
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

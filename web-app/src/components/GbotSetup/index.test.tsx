import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import GbotSetup from './index'

afterEach(cleanup)

function chooseLan() {
  fireEvent.change(screen.getByLabelText('Bot name'), {
    target: { value: ' Writer ' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
  fireEvent.click(screen.getByLabelText(/Another computer on the LAN/))
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
}

function fillConnection() {
  for (const [label, value] of [
    ['SSH host', ' bot.local '],
    ['SSH user', ' bot '],
    ['SSH host public key', ' ssh-ed25519 pinned-key '],
    ['SSH private key', 'private-key'],
    ['Key passphrase', 'secret-passphrase'],
  ])
    fireEvent.change(screen.getByLabelText(label), { target: { value } })
}

it('requires a supported computer choice and cancels without importing credentials', () => {
  const save = vi.fn()
  const cancel = vi.fn()
  render(<GbotSetup save={save} localReady={vi.fn()} cancel={cancel} />)
  expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled()
  fireEvent.change(screen.getByLabelText('Bot name'), {
    target: { value: 'Writer' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
  for (const choice of [/Cloud hosted/, /M365 Cloud PC/]) {
    fireEvent.click(screen.getByLabelText(choice))
    expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled()
  }
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
  expect(cancel).toHaveBeenCalledOnce()
  expect(save).not.toHaveBeenCalled()
})

it('reviews a valid LAN connection without showing secrets and saves only on confirmation', async () => {
  const save = vi.fn().mockResolvedValue(undefined)
  render(<GbotSetup save={save} localReady={vi.fn()} cancel={vi.fn()} />)
  chooseLan()
  fillConnection()
  fireEvent.change(screen.getByLabelText('SSH port'), {
    target: { value: '65536' },
  })
  expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled()
  fireEvent.change(screen.getByLabelText('SSH port'), {
    target: { value: '2222' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
  expect(screen.getByText('bot@bot.local:2222')).toBeInTheDocument()
  expect(screen.queryByDisplayValue('private-key')).not.toBeInTheDocument()
  expect(
    screen.queryByDisplayValue('secret-passphrase')
  ).not.toBeInTheDocument()
  expect(save).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Save bot' }))
  await waitFor(() => expect(save).toHaveBeenCalledOnce())
  expect(save).toHaveBeenCalledWith({
    name: 'Writer',
    hostname: 'bot.local',
    port: '2222',
    user: 'bot',
    hostKey: 'ssh-ed25519 pinned-key',
    key: 'private-key',
    passphrase: 'secret-passphrase',
  })
})

it('keeps a failed save reviewable and allows retry', async () => {
  const save = vi
    .fn()
    .mockRejectedValueOnce(new Error('Vault unavailable'))
    .mockResolvedValueOnce(undefined)
  render(<GbotSetup save={save} localReady={vi.fn()} cancel={vi.fn()} />)
  chooseLan()
  fillConnection()
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
  fireEvent.click(screen.getByRole('button', { name: 'Save bot' }))
  await screen.findByRole('alert')
  expect(screen.getByRole('alert')).toHaveTextContent('Vault unavailable')
  expect(screen.getByText('bot@bot.local:22')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Save bot' }))
  await waitFor(() => expect(save).toHaveBeenCalledTimes(2))
})

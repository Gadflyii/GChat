import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import GbotSetup from './index'
import { gbot } from '@/services/gbot'

vi.mock('@/services/gbot', () => ({ gbot: vi.fn() }))

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

function chooseLan() {
  fireEvent.change(screen.getByLabelText('Bot name'), {
    target: { value: ' Writer ' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
  fireEvent.click(screen.getByLabelText(/Another computer on the LAN/))
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
}

function fillConnection() {
  fireEvent.click(screen.getByLabelText('Use an existing SSH key'))
  for (const [label, value] of [
    ['SSH host', ' bot.local '],
    ['SSH user', ' bot '],
    ['SSH host public key', ' ssh-ed25519 pinned-key '],
    ['SSH private key', 'private-key'],
    ['Key passphrase', 'secret-passphrase'],
  ])
    fireEvent.change(screen.getByLabelText(label), { target: { value } })
}

it('asks separately where the service runs and where the bot computer lives', () => {
  const save = vi.fn()
  const cancel = vi.fn()
  render(<GbotSetup save={save} localReady={vi.fn()} cancel={cancel} />)
  expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled()
  fireEvent.change(screen.getByLabelText('Bot name'), {
    target: { value: 'Writer' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
  expect(screen.getByText('Step 2 of 5 · Service')).toBeInTheDocument()
  expect(screen.getByLabelText('This PC (recommended)')).toBeChecked()
  expect(screen.queryByLabelText(/A separate local VM/)).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Continue' })).toBeEnabled()
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
  expect(screen.getByText('Step 3 of 5 · Computer')).toBeInTheDocument()
  expect(
    screen.queryByLabelText('This PC (recommended)')
  ).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled()
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

it('verifies the fingerprint, saves a vault key and requires SSH authentication before review', async () => {
  const publicKey = { algorithm: 'ssh-ed25519', public_key: 'public-only' }
  const api = vi
    .mocked(gbot)
    .mockResolvedValueOnce({
      public_key: publicKey,
      fingerprint: 'SHA256:verified-computer',
    })
    .mockResolvedValueOnce({ id: 'saved-bot' })
    .mockResolvedValueOnce(publicKey)
    .mockResolvedValueOnce({ authenticated: true })
  const save = vi.fn().mockResolvedValue(undefined)
  render(<GbotSetup save={save} localReady={vi.fn()} cancel={vi.fn()} />)
  chooseLan()
  fireEvent.change(screen.getByLabelText('SSH host'), {
    target: { value: 'bot.local' },
  })
  fireEvent.change(screen.getByLabelText('SSH user'), {
    target: { value: 'bot' },
  })
  expect(screen.getByRole('button', { name: 'Create bot key' })).toBeDisabled()
  fireEvent.click(
    screen.getByRole('button', { name: 'Check computer identity' })
  )
  await screen.findByText('SHA256:verified-computer')
  expect(screen.getByRole('button', { name: 'Create bot key' })).toBeDisabled()
  fireEvent.click(
    screen.getByLabelText('I verified this fingerprint on the bot computer')
  )
  fireEvent.click(screen.getByRole('button', { name: 'Create bot key' }))
  await screen.findByDisplayValue('ssh-ed25519 public-only')
  expect(api).toHaveBeenCalledWith(
    'workspaces/ssh',
    expect.objectContaining({
      name: 'Writer',
      private_key: null,
      passphrase: null,
      pinned_host_key: publicKey,
    })
  )
  expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled()
  fireEvent.click(screen.getByRole('button', { name: 'Check SSH access' }))
  await screen.findByRole('status')
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
  fireEvent.click(screen.getByRole('button', { name: 'Save bot' }))
  await waitFor(() =>
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: 'saved-bot',
        key: '',
        passphrase: '',
      })
    )
  )
})

it('resumes the saved key and keeps a changed host identity from passing the connection step', async () => {
  vi.mocked(gbot)
    .mockResolvedValueOnce({
      algorithm: 'ssh-ed25519',
      public_key: 'saved-public-key',
    })
    .mockRejectedValueOnce(new Error('The SSH host identity changed'))
  render(
    <GbotSetup
      save={vi.fn()}
      localReady={vi.fn()}
      cancel={vi.fn()}
      resume={{
        id: 'saved-bot',
        name: 'Writer',
        connection: {
          kind: 'ssh',
          endpoint: { hostname: 'bot.local', port: 22, user: 'bot' },
          pinned_host_key: { algorithm: 'ssh-ed25519', public_key: 'pinned' },
        },
      }}
    />
  )
  await screen.findByDisplayValue('ssh-ed25519 saved-public-key')
  expect(screen.getByLabelText('SSH host')).toBeDisabled()
  fireEvent.click(screen.getByRole('button', { name: 'Check SSH access' }))
  await screen.findByRole('alert')
  expect(screen.getByRole('alert')).toHaveTextContent('identity changed')
  expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled()
  expect(
    vi.mocked(gbot).mock.calls.every(([route]) => route !== 'workspaces/ssh')
  ).toBe(true)
})

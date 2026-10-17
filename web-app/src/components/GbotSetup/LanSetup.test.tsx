import { useState } from 'react'
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import LanSetup from './LanSetup'
import type { BotConnection } from './index'
import { gbot } from '@/services/gbot'

vi.mock('@/services/gbot', () => ({ gbot: vi.fn() }))

afterEach(() => {
  cleanup()
  vi.resetAllMocks()
})

const connection: BotConnection = {
  name: 'Writer',
  hostname: 'bot.example',
  port: '22',
  user: 'writer',
  hostKey: '',
  key: '',
  passphrase: '',
}
const publicKey = { algorithm: 'ssh-ed25519', public_key: 'bot-key' }
const identity = { public_key: publicKey, fingerprint: 'SHA256:computer-key' }

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: Error) => void
  const promise = new Promise<T>((done, fail) => {
    resolve = done
    reject = fail
  })
  return { promise, resolve, reject }
}

function setup(initial = connection) {
  const busy = vi.fn()
  const ready = vi.fn()
  function Form() {
    const [value, change] = useState(initial)
    return (
      <LanSetup connection={value} change={change} ready={ready} busy={busy} />
    )
  }
  render(<Form />)
  return { busy, ready }
}

it('explains the identity check, blocks duplicate activation and allows retry after failure', async () => {
  const request = deferred<typeof identity>()
  const api = vi
    .mocked(gbot)
    .mockReturnValueOnce(request.promise)
    .mockResolvedValueOnce(identity)
  const { busy } = setup()
  const button = screen.getByRole('button', { name: 'Check computer identity' })
  act(() => {
    button.click()
    button.click()
  })
  expect(screen.getByRole('status')).toHaveTextContent(
    'Checking computer identity…'
  )
  expect(
    screen.getByRole('button', { name: 'Checking computer identity…' })
  ).toBeDisabled()
  expect(screen.getByRole('button', { name: 'Create bot key' })).toBeDisabled()
  expect(api).toHaveBeenCalledTimes(1)
  await act(async () => request.reject(new Error('Computer is unreachable')))
  expect(screen.queryByRole('status')).not.toBeInTheDocument()
  expect(screen.getByRole('alert')).toHaveTextContent('Computer is unreachable')
  expect(busy).toHaveBeenLastCalledWith(false)
  fireEvent.click(
    screen.getByRole('button', { name: 'Check computer identity' })
  )
  await screen.findByText(identity.fingerprint)
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
})

it('names an existing-key import while it runs and keeps the entered key in the request', async () => {
  const request = deferred<{ id: string }>()
  const api = vi
    .mocked(gbot)
    .mockReturnValueOnce(request.promise)
    .mockResolvedValue(publicKey)
  const { busy } = setup()
  fireEvent.click(
    screen.getByRole('checkbox', { name: 'Use an existing SSH key (advanced)' })
  )
  fireEvent.change(screen.getByLabelText('SSH host public key'), {
    target: { value: 'ssh-ed25519 verified-host-key' },
  })
  fireEvent.change(screen.getByLabelText('SSH private key'), {
    target: { value: 'synthetic-private-key' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Import bot key' }))
  expect(screen.getByRole('status')).toHaveTextContent('Importing bot key…')
  expect(
    screen.getByRole('button', { name: 'Importing bot key…' })
  ).toBeDisabled()
  expect(api).toHaveBeenCalledWith(
    'workspaces/ssh',
    expect.objectContaining({
      private_key: 'synthetic-private-key',
      pinned_host_key: {
        algorithm: 'ssh-ed25519',
        public_key: 'verified-host-key',
      },
    })
  )
  await act(async () => request.resolve({ id: 'saved-bot' }))
  await screen.findByDisplayValue('ssh-ed25519 bot-key')
  expect(screen.queryByRole('status')).not.toBeInTheDocument()
  expect(busy).toHaveBeenLastCalledWith(false)
})

it('names new-key creation only after the user has verified the computer identity', async () => {
  const request = deferred<{ id: string }>()
  const api = vi
    .mocked(gbot)
    .mockResolvedValueOnce(identity)
    .mockReturnValueOnce(request.promise)
    .mockResolvedValue(publicKey)
  setup()
  expect(screen.getByRole('button', { name: 'Create bot key' })).toBeDisabled()
  fireEvent.click(
    screen.getByRole('button', { name: 'Check computer identity' })
  )
  fireEvent.click(
    await screen.findByRole('checkbox', {
      name: 'I verified this fingerprint on the bot computer',
    })
  )
  fireEvent.click(screen.getByRole('button', { name: 'Create bot key' }))
  expect(screen.getByRole('status')).toHaveTextContent('Creating bot key…')
  expect(
    screen.getByRole('button', { name: 'Creating bot key…' })
  ).toBeDisabled()
  expect(api).toHaveBeenCalledWith(
    'workspaces/ssh',
    expect.objectContaining({
      private_key: null,
      pinned_host_key: publicKey,
    })
  )
  await act(async () => request.resolve({ id: 'saved-bot' }))
  await screen.findByDisplayValue('ssh-ed25519 bot-key')
  expect(screen.queryByRole('status')).not.toBeInTheDocument()
})

it('shows public-key loading and clears the pending state when the key arrives', async () => {
  const request = deferred<typeof publicKey>()
  vi.mocked(gbot)
    .mockRejectedValueOnce(new Error('Key not yet available'))
    .mockReturnValueOnce(request.promise)
  setup({ ...connection, workspaceId: 'saved-bot' })
  await screen.findByRole('alert')
  fireEvent.click(screen.getByRole('button', { name: 'Show bot public key' }))
  expect(screen.getByRole('status')).toHaveTextContent(
    'Loading bot public key…'
  )
  expect(
    screen.getByRole('button', { name: 'Loading bot public key…' })
  ).toBeDisabled()
  await act(async () => request.resolve(publicKey))
  expect(
    screen.getByRole('textbox', { name: 'Bot SSH public key' })
  ).toHaveValue('ssh-ed25519 bot-key')
  expect(screen.queryByRole('status')).not.toBeInTheDocument()
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
})

it('explains SSH access checking and waits for success before offering tool checks', async () => {
  const request = deferred<{ authenticated: boolean }>()
  const api = vi
    .mocked(gbot)
    .mockResolvedValueOnce(publicKey)
    .mockReturnValueOnce(request.promise)
  const { busy, ready } = setup({ ...connection, workspaceId: 'saved-bot' })
  await screen.findByDisplayValue('ssh-ed25519 bot-key')
  fireEvent.click(screen.getByRole('button', { name: 'Check SSH access' }))
  expect(screen.getByRole('status')).toHaveTextContent('Checking SSH access…')
  expect(
    screen.getByRole('button', { name: 'Checking SSH access…' })
  ).toBeDisabled()
  expect(
    screen.queryByRole('button', { name: 'Check tools' })
  ).not.toBeInTheDocument()
  expect(api).toHaveBeenLastCalledWith('workspaces/ssh/check', {
    workspace_id: 'saved-bot',
  })
  await act(async () => request.resolve({ authenticated: true }))
  await screen.findByRole('button', { name: 'Check tools' })
  await waitFor(() => expect(busy).toHaveBeenLastCalledWith(false))
  expect(ready).toHaveBeenLastCalledWith(false)
  expect(screen.queryByRole('status')).not.toBeInTheDocument()
})

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

it('says why Create bot key is off until the identity is checked and the fingerprint confirmed', async () => {
  vi.mocked(gbot).mockResolvedValueOnce(identity)
  setup()
  const create = screen.getByRole('button', { name: 'Create bot key' })
  expect(create).toBeDisabled()
  expect(create).toHaveAccessibleDescription(
    'To create the bot key, first choose Check computer identity.'
  )
  fireEvent.click(
    screen.getByRole('button', { name: 'Check computer identity' })
  )
  const confirm = await screen.findByRole('checkbox', {
    name: 'I verified this fingerprint on the bot computer',
  })
  expect(create).toHaveAccessibleDescription(
    'Confirm the fingerprint above to turn on Create bot key.'
  )
  fireEvent.click(confirm)
  expect(create).toBeEnabled()
  expect(create).not.toHaveAccessibleDescription()
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

it.each([
  ['Check tools', 'workspaces/ssh/tools'],
  ['Prepare tools', 'workspaces/ssh/prepare'],
])(
  'blocks SSH rechecks while %s is pending, including before rerender',
  async (label, route) => {
    const request = deferred<{ installed: boolean }>()
    const api = vi.mocked(gbot).mockImplementation(async (path) => {
      if (path === 'workspaces/ssh/key') return publicKey
      if (path === 'workspaces/ssh/check') return { authenticated: true }
      if (path === route) return request.promise
      throw new Error(`Unexpected ${path}`)
    })
    const { busy, ready } = setup({ ...connection, workspaceId: 'saved-bot' })
    await screen.findByDisplayValue('ssh-ed25519 bot-key')
    fireEvent.click(screen.getByRole('button', { name: 'Check SSH access' }))
    await screen.findByRole('button', { name: 'Check tools' })
    if (label === 'Prepare tools') {
      fireEvent.click(
        screen.getByRole('checkbox', {
          name: /This computer is dedicated to Gbot/,
        })
      )
    }
    const ssh = screen.getByRole('button', { name: 'Check SSH access' })
    act(() => {
      screen.getByRole('button', { name: label }).click()
      ssh.click()
    })
    expect(
      api.mock.calls.filter(([path]) => path === 'workspaces/ssh/check')
    ).toHaveLength(1)
    expect(ssh).toBeDisabled()
    expect(busy).toHaveBeenLastCalledWith(true)
    expect(ready).toHaveBeenLastCalledWith(false)
    fireEvent.click(ssh)
    expect(
      api.mock.calls.filter(([path]) => path === 'workspaces/ssh/check')
    ).toHaveLength(1)
    await act(async () => request.resolve({ installed: true }))
    expect(ssh).toBeEnabled()
    expect(busy).toHaveBeenLastCalledWith(false)
    expect(ready).toHaveBeenLastCalledWith(true)
    fireEvent.click(ssh)
    await screen.findByRole('button', { name: 'Check tools' })
    expect(
      api.mock.calls.filter(([path]) => path === 'workspaces/ssh/check')
    ).toHaveLength(2)
    expect(ready).toHaveBeenLastCalledWith(false)
  }
)

it.each([
  ['Check tools', 'workspaces/ssh/tools', 'Checking tools…'],
  ['Prepare tools', 'workspaces/ssh/prepare', 'Preparing tools…'],
])(
  'blocks %s during an SSH recheck before rerender and permits explicit recovery',
  async (label, route, pendingLabel) => {
    const recheck = deferred<{ authenticated: boolean }>()
    const tools = deferred<{ installed: boolean }>()
    let checks = 0
    const api = vi.mocked(gbot).mockImplementation(async (path) => {
      if (path === 'workspaces/ssh/key') return publicKey
      if (path === 'workspaces/ssh/check')
        return ++checks === 2 ? recheck.promise : { authenticated: true }
      if (path === route) return tools.promise
      throw new Error(`Unexpected ${path}`)
    })
    const { busy, ready } = setup({ ...connection, workspaceId: 'saved-bot' })
    await screen.findByDisplayValue('ssh-ed25519 bot-key')
    fireEvent.click(screen.getByRole('button', { name: 'Check SSH access' }))
    const tool = await screen.findByRole('button', { name: label })
    if (label === 'Prepare tools') {
      fireEvent.click(
        screen.getByRole('checkbox', {
          name: /This computer is dedicated to Gbot/,
        })
      )
    }
    const ssh = screen.getByRole('button', { name: 'Check SSH access' })
    act(() => {
      ssh.click()
      tool.click()
      tool.click()
    })
    expect(
      api.mock.calls.filter(([path]) => path === 'workspaces/ssh/check')
    ).toEqual([
      ['workspaces/ssh/check', { workspace_id: 'saved-bot' }],
      ['workspaces/ssh/check', { workspace_id: 'saved-bot' }],
    ])
    expect(api.mock.calls.filter(([path]) => path === route)).toHaveLength(0)
    expect(ssh).toBeDisabled()
    expect(screen.queryByRole('button', { name: label })).not.toBeInTheDocument()
    expect(busy).toHaveBeenLastCalledWith(true)
    expect(ready).toHaveBeenLastCalledWith(false)

    await act(async () =>
      recheck.reject(new Error('The SSH host identity changed'))
    )
    expect(screen.getByRole('alert')).toHaveTextContent(
      'The SSH host identity changed'
    )
    expect(ssh).toBeEnabled()
    expect(busy).toHaveBeenLastCalledWith(false)
    expect(ready).toHaveBeenLastCalledWith(false)
    expect(checks).toBe(2)
    expect(api.mock.calls.filter(([path]) => path === route)).toHaveLength(0)

    fireEvent.click(ssh)
    const retry = await screen.findByRole('button', { name: label })
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    if (label === 'Prepare tools') {
      fireEvent.click(
        screen.getByRole('checkbox', {
          name: /This computer is dedicated to Gbot/,
        })
      )
    }
    act(() => {
      retry.click()
      ssh.click()
      retry.click()
    })
    expect(api.mock.calls.filter(([path]) => path === route)).toEqual([
      [
        route,
        {
          workspace_id: 'saved-bot',
          ...(label === 'Prepare tools' ? { consent: true } : {}),
        },
      ],
    ])
    expect(checks).toBe(3)
    expect(screen.getByRole('button', { name: pendingLabel })).toBeDisabled()
    expect(ssh).toBeDisabled()
    expect(busy).toHaveBeenLastCalledWith(true)
    expect(ready).toHaveBeenLastCalledWith(false)
    await act(async () => tools.resolve({ installed: true }))
    expect(ssh).toBeEnabled()
    expect(screen.getByRole('button', { name: label })).toBeEnabled()
    expect(busy).toHaveBeenLastCalledWith(false)
    expect(ready).toHaveBeenLastCalledWith(true)
  }
)

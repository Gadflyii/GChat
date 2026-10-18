import { useState } from 'react'
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
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
  const changed = vi.fn()
  function Form() {
    const [value, setValue] = useState(initial)
    return (
      <LanSetup
        connection={value}
        change={(next) => {
          changed(next)
          setValue(next)
        }}
        ready={ready}
        busy={busy}
      />
    )
  }
  render(<Form />)
  return { busy, ready, changed }
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
  const alert = screen.getByRole('alert')
  expect(alert).toHaveTextContent('Could not check this computer’s identity.')
  expect(alert).toHaveTextContent(
    'Choose Check computer identity to try again.'
  )
  expect(within(alert).getByText('Computer is unreachable')).not.toBeVisible()
  expect(
    within(alert).getByText('Details').closest('details')
  ).not.toHaveAttribute('open')
  fireEvent.click(within(alert).getByText('Details'))
  expect(within(alert).getByText('Computer is unreachable')).toBeVisible()
  expect(api).toHaveBeenCalledTimes(1)
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

it('keeps connection and key drafts stable during import, then permits a corrected explicit retry', async () => {
  const first = deferred<{ id: string }>()
  const retry = deferred<{ id: string }>()
  let imports = 0
  const api = vi.mocked(gbot).mockImplementation(async (path) => {
    if (path === 'workspaces/ssh')
      return ++imports === 1 ? first.promise : retry.promise
    if (path === 'workspaces/ssh/key') return publicKey
    throw new Error(`Unexpected ${path}`)
  })
  const { busy, changed } = setup()
  const mode = screen.getByRole('checkbox', {
    name: 'Use an existing SSH key (advanced)',
  })
  fireEvent.click(mode)
  const drafts = [
    ['SSH host public key', 'ssh-ed25519 original-host-key'],
    ['SSH private key', 'original-private-key'],
    ['Key passphrase', 'original-passphrase'],
  ] as const
  for (const [label, value] of drafts)
    fireEvent.change(screen.getByLabelText(label), { target: { value } })
  const edits = changed.mock.calls.length
  const importButton = screen.getByRole('button', { name: 'Import bot key' })
  act(() => {
    importButton.click()
    for (const [label] of drafts)
      fireEvent.change(screen.getByLabelText(label), {
        target: { value: 'an edit after import started' },
      })
    fireEvent.change(screen.getByLabelText('SSH host'), {
      target: { value: 'other.example' },
    })
    mode.click()
  })
  expect(changed).toHaveBeenCalledTimes(edits)
  expect(mode).toBeChecked()
  expect(mode).toBeDisabled()
  for (const label of ['SSH host', 'SSH port', 'SSH user'])
    expect(screen.getByLabelText(label)).toBeDisabled()
  for (const [label, value] of drafts) {
    expect(screen.getByLabelText(label)).toBeDisabled()
    expect(screen.getByLabelText(label)).toHaveValue(value)
  }
  expect(screen.getByRole('status')).toHaveTextContent('Importing bot key…')
  expect(busy).toHaveBeenLastCalledWith(true)
  expect(api.mock.calls.filter(([path]) => path === 'workspaces/ssh')).toEqual([
    [
      'workspaces/ssh',
      expect.objectContaining({
        endpoint: { hostname: 'bot.example', port: 22, user: 'writer' },
        pinned_host_key: {
          algorithm: 'ssh-ed25519',
          public_key: 'original-host-key',
        },
        private_key: 'original-private-key',
        passphrase: 'original-passphrase',
      }),
    ],
  ])

  await act(async () =>
    first.reject(new Error('The private key could not be unlocked'))
  )
  const alert = screen.getByRole('alert')
  expect(alert).toHaveTextContent(
    'Could not confirm that the bot key was imported.'
  )
  expect(alert).toHaveTextContent(
    'Review the private key and passphrase, then choose Import bot key to try again.'
  )
  expect(
    within(alert).getByText('The private key could not be unlocked')
  ).not.toBeVisible()
  expect(
    within(alert).getByText('Details').closest('details')
  ).not.toHaveAttribute('open')
  fireEvent.click(within(alert).getByText('Details'))
  expect(
    within(alert).getByText('The private key could not be unlocked')
  ).toBeVisible()
  expect(imports).toBe(1)
  expect(busy).toHaveBeenLastCalledWith(false)
  expect(mode).toBeEnabled()
  for (const label of ['SSH host', 'SSH port', 'SSH user'])
    expect(screen.getByLabelText(label)).toBeEnabled()
  for (const [label, value] of drafts) {
    expect(screen.getByLabelText(label)).toBeEnabled()
    expect(screen.getByLabelText(label)).toHaveValue(value)
  }
  expect(imports).toBe(1)
  for (const [label, value] of [
    ['SSH host', 'corrected.example'],
    ['SSH host public key', 'ssh-ed25519 corrected-host-key'],
    ['SSH private key', 'corrected-private-key'],
    ['Key passphrase', 'corrected-passphrase'],
  ])
    fireEvent.change(screen.getByLabelText(label), { target: { value } })
  fireEvent.click(screen.getByRole('button', { name: 'Import bot key' }))
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  expect(api).toHaveBeenLastCalledWith(
    'workspaces/ssh',
    expect.objectContaining({
      endpoint: { hostname: 'corrected.example', port: 22, user: 'writer' },
      pinned_host_key: {
        algorithm: 'ssh-ed25519',
        public_key: 'corrected-host-key',
      },
      private_key: 'corrected-private-key',
      passphrase: 'corrected-passphrase',
    })
  )
  expect(imports).toBe(2)
  await act(async () => retry.resolve({ id: 'saved-bot' }))
  await screen.findByDisplayValue('ssh-ed25519 bot-key')
  expect(changed).toHaveBeenLastCalledWith(
    expect.objectContaining({
      hostname: 'corrected.example',
      hostKey: 'ssh-ed25519 corrected-host-key',
      workspaceId: 'saved-bot',
      key: '',
      passphrase: '',
    })
  )
  expect(screen.getByLabelText('SSH host')).toHaveValue('corrected.example')
  for (const label of ['SSH host', 'SSH port', 'SSH user'])
    expect(screen.getByLabelText(label)).toBeDisabled()
  expect(screen.queryByLabelText('SSH private key')).not.toBeInTheDocument()
  expect(screen.queryByLabelText('Key passphrase')).not.toBeInTheDocument()
  expect(
    screen.queryByRole('checkbox', {
      name: 'Use an existing SSH key (advanced)',
    })
  ).not.toBeInTheDocument()
  expect(busy).toHaveBeenLastCalledWith(false)
})

it('keeps fingerprint confirmation stable during Create and restores editing after rejection', async () => {
  const first = deferred<{ id: string }>()
  const retry = deferred<{ id: string }>()
  let creates = 0
  const api = vi.mocked(gbot).mockImplementation(async (path) => {
    if (path === 'ssh/identity') return identity
    if (path === 'workspaces/ssh')
      return ++creates === 1 ? first.promise : retry.promise
    if (path === 'workspaces/ssh/key') return publicKey
    throw new Error(`Unexpected ${path}`)
  })
  const { busy, changed } = setup()
  fireEvent.click(
    screen.getByRole('button', { name: 'Check computer identity' })
  )
  const confirm = await screen.findByRole('checkbox', {
    name: 'I verified this fingerprint on the bot computer',
  })
  fireEvent.click(confirm)
  const edits = changed.mock.calls.length
  act(() => {
    screen.getByRole('button', { name: 'Create bot key' }).click()
    confirm.click()
  })
  expect(confirm).toBeDisabled()
  expect(confirm).toBeChecked()
  expect(changed).toHaveBeenCalledTimes(edits)
  for (const label of ['SSH host', 'SSH port', 'SSH user'])
    expect(screen.getByLabelText(label)).toBeDisabled()
  expect(
    screen.getByRole('checkbox', {
      name: 'Use an existing SSH key (advanced)',
    })
  ).toBeDisabled()
  expect(
    screen.getByRole('button', { name: 'Check computer identity' })
  ).toBeDisabled()
  expect(screen.getByRole('status')).toHaveTextContent('Creating bot key…')
  await act(async () =>
    first.reject(new Error('Secure storage is unavailable'))
  )
  const alert = screen.getByRole('alert')
  expect(alert).toHaveTextContent(
    'Could not confirm that the bot key was created.'
  )
  expect(alert).toHaveTextContent(
    'Your fingerprint confirmation is still here. Choose Create bot key to try again.'
  )
  expect(
    within(alert).getByText('Secure storage is unavailable')
  ).not.toBeVisible()
  expect(
    within(alert).getByText('Details').closest('details')
  ).not.toHaveAttribute('open')
  fireEvent.click(within(alert).getByText('Details'))
  expect(within(alert).getByText('Secure storage is unavailable')).toBeVisible()
  expect(creates).toBe(1)
  expect(confirm).toBeEnabled()
  expect(confirm).toBeChecked()
  expect(busy).toHaveBeenLastCalledWith(false)
  expect(creates).toBe(1)
  fireEvent.click(confirm)
  expect(screen.getByRole('button', { name: 'Create bot key' })).toBeDisabled()
  fireEvent.click(confirm)
  fireEvent.click(screen.getByRole('button', { name: 'Create bot key' }))
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  expect(confirm).toBeChecked()
  expect(confirm).toBeDisabled()
  expect(creates).toBe(2)
  const expectedCreate = [
    'workspaces/ssh',
    expect.objectContaining({
      endpoint: { hostname: 'bot.example', port: 22, user: 'writer' },
      pinned_host_key: publicKey,
      private_key: null,
      passphrase: null,
    }),
  ]
  expect(api.mock.calls.filter(([path]) => path === 'workspaces/ssh')).toEqual([
    expectedCreate,
    expectedCreate,
  ])
  await act(async () => retry.resolve({ id: 'saved-bot' }))
  await screen.findByDisplayValue('ssh-ed25519 bot-key')
  expect(screen.getByLabelText('SSH host')).toHaveValue('bot.example')
  expect(screen.getByLabelText('SSH host')).toBeDisabled()
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

it.each([false, true])(
  'clears failed key guidance when switching existing-key mode from %s',
  async (importing) => {
    const api = vi.mocked(gbot).mockImplementation(async (path) => {
      if (path === 'ssh/identity') return identity
      throw new Error('Synthetic key storage failure')
    })
    setup()
    const mode = screen.getByRole('checkbox', {
      name: 'Use an existing SSH key (advanced)',
    })
    if (importing) {
      fireEvent.click(mode)
      fireEvent.change(screen.getByLabelText('SSH host public key'), {
        target: { value: 'ssh-ed25519 verified-host-key' },
      })
      fireEvent.change(screen.getByLabelText('SSH private key'), {
        target: { value: 'synthetic-private-key' },
      })
      fireEvent.click(screen.getByRole('button', { name: 'Import bot key' }))
    } else {
      fireEvent.click(
        screen.getByRole('button', { name: 'Check computer identity' })
      )
      fireEvent.click(
        await screen.findByRole('checkbox', {
          name: 'I verified this fingerprint on the bot computer',
        })
      )
      fireEvent.click(screen.getByRole('button', { name: 'Create bot key' }))
    }
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(
      importing
        ? 'Could not confirm that the bot key was imported.'
        : 'Could not confirm that the bot key was created.'
    )
    const calls = api.mock.calls.length
    fireEvent.click(mode)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(
      screen.getByRole('button', {
        name: importing ? 'Check computer identity' : 'Import bot key',
      })
    ).toBeInTheDocument()
    expect(api).toHaveBeenCalledTimes(calls)
    expect(screen.getByLabelText('SSH host')).toHaveValue('bot.example')
  }
)

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
  const retry = deferred<typeof publicKey>()
  const api = vi
    .mocked(gbot)
    .mockRejectedValueOnce(new Error('Key not yet available'))
    .mockReturnValueOnce(request.promise)
    .mockReturnValueOnce(retry.promise)
  setup({ ...connection, workspaceId: 'saved-bot' })
  const initialAlert = await screen.findByRole('alert')
  expect(initialAlert).toHaveTextContent(
    'Could not load the bot public key. Choose Show bot public key to try again.'
  )
  expect(
    within(initialAlert).getByText('Key not yet available')
  ).not.toBeVisible()
  expect(
    within(initialAlert).getByText('Details').closest('details')
  ).not.toHaveAttribute('open')
  fireEvent.click(within(initialAlert).getByText('Details'))
  expect(within(initialAlert).getByText('Key not yet available')).toBeVisible()
  expect(api).toHaveBeenCalledTimes(1)
  const show = screen.getByRole('button', { name: 'Show bot public key' })
  act(() => {
    show.click()
    show.click()
  })
  expect(screen.getByRole('status')).toHaveTextContent(
    'Loading bot public key…'
  )
  expect(
    screen.getByRole('button', { name: 'Loading bot public key…' })
  ).toBeDisabled()
  expect(api).toHaveBeenCalledTimes(2)
  await act(async () => request.reject(new Error('Key storage is locked')))
  const retryAlert = screen.getByRole('alert')
  expect(retryAlert).toHaveTextContent(
    'Could not load the bot public key. Choose Show bot public key to try again.'
  )
  expect(
    within(retryAlert).getByText('Key storage is locked')
  ).not.toBeVisible()
  expect(
    within(retryAlert).getByText('Details').closest('details')
  ).not.toHaveAttribute('open')
  fireEvent.click(within(retryAlert).getByText('Details'))
  expect(within(retryAlert).getByText('Key storage is locked')).toBeVisible()
  expect(api).toHaveBeenCalledTimes(2)
  expect(
    screen.getByRole('button', { name: 'Show bot public key' })
  ).toBeEnabled()
  expect(
    screen.getByRole('button', { name: 'Check SSH access' })
  ).toBeDisabled()
  fireEvent.click(screen.getByRole('button', { name: 'Show bot public key' }))
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  expect(api).toHaveBeenCalledTimes(3)
  await act(async () => retry.resolve(publicKey))
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
    expect(
      screen.queryByRole('button', { name: label })
    ).not.toBeInTheDocument()
    expect(busy).toHaveBeenLastCalledWith(true)
    expect(ready).toHaveBeenLastCalledWith(false)

    await act(async () =>
      recheck.reject(new Error('The SSH host identity changed'))
    )
    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent('Could not confirm SSH access.')
    expect(alert).toHaveTextContent(
      'Review Details and check the bot computer’s SSH settings and public key. Choose Check SSH access to try again.'
    )
    expect(
      within(alert).getByText('The SSH host identity changed')
    ).not.toBeVisible()
    expect(
      within(alert).getByText('Details').closest('details')
    ).not.toHaveAttribute('open')
    fireEvent.click(within(alert).getByText('Details'))
    expect(
      within(alert).getByText('The SSH host identity changed')
    ).toBeVisible()
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

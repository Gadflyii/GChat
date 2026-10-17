import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import GbotSetup from './index'
import {
  gbot,
  gbotControlGrant,
  getGbotServiceTarget,
  selectGbotService,
} from '@/services/gbot'

const resources = vi.hoisted(() => ({
  ready: true as boolean | null,
  error: '',
}))
vi.mock('@/hooks/useBundledResources', () => ({
  useBundledResources: () => resources,
}))

const hostStore = vi.hoisted(() => ({
  hosts: [] as import('@/services/engines').EngineHost[],
  errors: {},
  refresh: async () => {},
}))
vi.mock('@/stores/engine-hosts-store', () => ({
  useEngineHosts: (select: (state: unknown) => unknown) => select(hostStore),
}))

vi.mock('@/services/gbot', () => ({
  gbot: vi.fn(),
  getGbotServiceTarget: vi.fn(),
  selectGbotService: vi.fn(),
  gbotControlGrant: vi.fn(),
}))
beforeEach(() => {
  resources.ready = true
  resources.error = ''
  hostStore.hosts = []
  vi.mocked(getGbotServiceTarget).mockResolvedValue({ kind: 'local' })
  vi.mocked(selectGbotService).mockResolvedValue(undefined)
  vi.mocked(gbotControlGrant).mockResolvedValue({
    status: 'approved',
    service_configured: true,
  })
})

afterEach(() => {
  cleanup()
  vi.resetAllMocks()
})

function preparedApi() {
  vi.mocked(gbot).mockImplementation(async (route) => {
    if (route === 'workspaces/ssh') return { id: 'saved-bot' }
    if (route === 'workspaces/ssh/key')
      return { algorithm: 'ssh-ed25519', public_key: 'public-only' }
    if (route === 'workspaces/ssh/check') return { authenticated: true }
    if (route === 'workspaces/ssh/tools')
      return { installed: true, command: null, issue: null }
    throw new Error(`Unexpected ${route}`)
  })
}

async function checkTools() {
  await screen.findByDisplayValue('ssh-ed25519 public-only')
  fireEvent.click(screen.getByRole('button', { name: 'Check SSH access' }))
  await screen.findByRole('button', { name: 'Check tools' })
  expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled()
  fireEvent.click(screen.getByRole('button', { name: 'Check tools' }))
  await screen.findByRole('status')
}

async function chooseLan(serviceHostId?: string) {
  fireEvent.change(screen.getByLabelText('Bot name'), {
    target: { value: ' Writer ' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Continue' })).toBeEnabled()
  )
  if (serviceHostId) {
    fireEvent.click(screen.getByLabelText('Another PC on the LAN'))
    fireEvent.change(screen.getByLabelText('Paired service computer'), {
      target: { value: serviceHostId },
    })
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Continue' })).toBeEnabled()
    )
  }
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
  await screen.findByLabelText(/A separate local VM/)
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

it.each([
  ['azure', 'Azure (guided)'],
  ['aws', 'AWS (guided)'],
  ['gcp', 'Google Cloud (guided)'],
])(
  'attaches a dedicated %s VM using the vault-backed SSH flow',
  async (provider, label) => {
    preparedApi()
    const save = vi.fn().mockResolvedValue(undefined)
    render(<GbotSetup save={save} localReady={vi.fn()} cancel={vi.fn()} />)
    fireEvent.change(screen.getByLabelText('Bot name'), {
      target: { value: 'Writer' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Continue' })).toBeEnabled()
    )
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    await screen.findByLabelText(/Cloud hosted/)
    fireEvent.click(screen.getByLabelText(/Cloud hosted/))
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    fireEvent.click(screen.getByLabelText(label))
    expect(
      screen.queryByLabelText('Provider API token')
    ).not.toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Connect this VM' })
    ).toBeDisabled()
    fireEvent.change(screen.getByLabelText('Cloud VM resource ID'), {
      target: { value: ' vm-123 ' },
    })
    fireEvent.click(
      screen.getByLabelText(/I reviewed the provider’s live cost/)
    )
    fireEvent.click(screen.getByRole('button', { name: 'Connect this VM' }))
    fillConnection()
    fireEvent.click(screen.getByRole('button', { name: 'Import bot key' }))
    await checkTools()
    expect(gbot).toHaveBeenCalledWith(
      'workspaces/ssh',
      expect.objectContaining({
        bot_pc: { kind: 'cloud', provider, resource_id: 'vm-123' },
      })
    )
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    expect(screen.getByText(`${provider} · vm-123`)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Save bot' }))
    await waitFor(() =>
      expect(save).toHaveBeenCalledWith(
        expect.objectContaining({
          cloud: { kind: 'cloud', provider, resource_id: 'vm-123' },
          workspaceId: 'saved-bot',
          key: '',
          passphrase: '',
        })
      )
    )
    expect(
      vi
        .mocked(gbot)
        .mock.calls.every(([route]) => !route.startsWith('setup/cloud/'))
    ).toBe(true)
  }
)

it('resumes guided cloud setup with the same resource and vault key', async () => {
  preparedApi()
  render(
    <GbotSetup
      save={vi.fn()}
      localReady={vi.fn()}
      cancel={vi.fn()}
      resume={{
        id: 'saved-bot',
        name: 'Writer',
        bot_pc: { kind: 'cloud', provider: 'azure', resource_id: 'vm-123' },
        connection: {
          endpoint: { hostname: 'bot.local', port: 22, user: 'bot' },
          pinned_host_key: {
            algorithm: 'ssh-ed25519',
            public_key: 'pinned-key',
          },
        },
      }}
    />
  )
  expect(screen.getByLabelText('Azure (guided)')).toBeChecked()
  expect(screen.getByLabelText('Cloud VM resource ID')).toHaveValue('vm-123')
  await screen.findByDisplayValue('ssh-ed25519 public-only')
  fireEvent.click(screen.getByRole('button', { name: 'Check SSH access' }))
  fireEvent.click(await screen.findByRole('button', { name: 'Check tools' }))
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Continue' })).toBeEnabled()
  )
  expect(gbot).not.toHaveBeenCalledWith('workspaces/ssh', expect.anything())
})

it('asks separately where the service runs and where the bot computer lives', async () => {
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
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Continue' })).toBeEnabled()
  )
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
  await screen.findByLabelText(/Cloud hosted/)
  expect(selectGbotService).toHaveBeenCalledWith({ kind: 'local' })
  expect(screen.getByText('Step 3 of 5 · Computer')).toBeInTheDocument()
  expect(
    screen.queryByLabelText('This PC (recommended)')
  ).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled()
  fireEvent.click(screen.getByLabelText(/Cloud hosted/))
  expect(screen.getByRole('button', { name: 'Continue' })).toBeEnabled()
  fireEvent.click(screen.getByLabelText(/M365 Cloud PC/))
  expect(screen.getByRole('button', { name: 'Continue' })).toBeEnabled()
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
  expect(cancel).toHaveBeenCalledOnce()
  expect(save).not.toHaveBeenCalled()
})

it.each([null, false])(
  'explains resource preparation without advancing the pending service selection (%s)',
  async (ready) => {
    resources.ready = ready
    let finish!: () => void
    vi.mocked(selectGbotService).mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve
        })
    )
    const props = { save: vi.fn(), localReady: vi.fn(), cancel: vi.fn() }
    const view = render(<GbotSetup {...props} />)
    fireEvent.change(screen.getByLabelText('Bot name'), {
      target: { value: 'Writer' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Continue' })).toBeEnabled()
    )
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    expect(screen.getByRole('status')).toHaveTextContent(
      'Preparing and validating bundled resources'
    )
    expect(screen.getByRole('status')).toHaveTextContent('a few minutes')
    expect(
      screen.getByRole('button', { name: 'Preparing resources…' })
    ).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Back' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Preparing resources…' }))
    expect(selectGbotService).toHaveBeenCalledOnce()
    expect(props.save).not.toHaveBeenCalled()

    resources.ready = true
    view.rerender(<GbotSetup {...props} />)
    expect(screen.getByRole('status')).toHaveTextContent('Selecting Gbot service')
    expect(
      screen.getByRole('button', { name: 'Selecting service…' })
    ).toBeDisabled()
    expect(screen.getByText('Step 2 of 5 · Service')).toBeInTheDocument()
    await act(async () => finish())
    expect(screen.getByText('Step 3 of 5 · Computer')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Back' }))
    fireEvent.click(screen.getByRole('button', { name: 'Back' }))
    expect(screen.getByLabelText('Bot name')).toHaveValue('Writer')
  }
)

it('retains the resource failure and directs restart without offering another selection', async () => {
  resources.ready = false
  let fail!: (error: string) => void
  vi.mocked(selectGbotService).mockImplementationOnce(
    () =>
      new Promise<void>((_, reject) => {
        fail = reject
      })
  )
  const props = { save: vi.fn(), localReady: vi.fn(), cancel: vi.fn() }
  const view = render(<GbotSetup {...props} />)
  fireEvent.change(screen.getByLabelText('Bot name'), {
    target: { value: 'Writer' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Continue' })).toBeEnabled()
  )
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
  resources.error = 'Bundled runtime digest mismatch'
  view.rerender(<GbotSetup {...props} />)
  await act(async () => fail(resources.error))
  expect(screen.getByRole('alert')).toHaveTextContent(resources.error)
  expect(screen.getByRole('alert')).toHaveTextContent('Restart GChat')
  expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled()
  expect(screen.getByRole('button', { name: 'Back' })).toBeEnabled()
  expect(screen.getByRole('button', { name: 'Cancel' })).toBeEnabled()
  expect(selectGbotService).toHaveBeenCalledOnce()
  expect(props.save).not.toHaveBeenCalled()
})

it('reviews a valid LAN connection without showing secrets and saves only on confirmation', async () => {
  preparedApi()
  const save = vi.fn().mockResolvedValue(undefined)
  render(<GbotSetup save={save} localReady={vi.fn()} cancel={vi.fn()} />)
  await chooseLan()
  fillConnection()
  fireEvent.change(screen.getByLabelText('SSH port'), {
    target: { value: '65536' },
  })
  expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled()
  fireEvent.change(screen.getByLabelText('SSH port'), {
    target: { value: '2222' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Import bot key' }))
  await checkTools()
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
  expect(
    screen.getByText('Service', { selector: 'dt' }).nextElementSibling
  ).toHaveTextContent(/^This PC$/)
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
    key: '',
    passphrase: '',
    workspaceId: 'saved-bot',
  })
})

it('reviews the selected paired service computer instead of this PC or another paired host', async () => {
  preparedApi()
  hostStore.hosts = [
    {
      host_id: 'other-host',
      name: 'Other paired computer',
      base_url: 'https://other.test',
      certificate_sha256: 'other-certificate',
      client_id: 'other-client',
    },
    {
      host_id: 'service-host',
      name: 'Office bot server',
      base_url: 'https://office.test',
      certificate_sha256: 'office-certificate',
      client_id: 'office-client',
    },
  ]
  render(<GbotSetup save={vi.fn()} localReady={vi.fn()} cancel={vi.fn()} />)
  await chooseLan('service-host')
  expect(selectGbotService).toHaveBeenCalledWith({
    kind: 'paired_host',
    host_id: 'service-host',
  })
  fillConnection()
  fireEvent.click(screen.getByRole('button', { name: 'Import bot key' }))
  await checkTools()
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
  expect(
    screen.getByText('Service', { selector: 'dt' }).nextElementSibling
  ).toHaveTextContent(/^Office bot server$/)
  expect(screen.queryByText('This PC')).not.toBeInTheDocument()
})

it('keeps the review honest when the selected paired service disappears', async () => {
  preparedApi()
  hostStore.hosts = [
    {
      host_id: 'service-host',
      name: 'Office bot server',
      base_url: 'https://office.test',
      certificate_sha256: 'office-certificate',
      client_id: 'office-client',
    },
  ]
  const props = { save: vi.fn(), localReady: vi.fn(), cancel: vi.fn() }
  const view = render(<GbotSetup {...props} />)
  await chooseLan('service-host')
  fillConnection()
  fireEvent.click(screen.getByRole('button', { name: 'Import bot key' }))
  await checkTools()
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
  expect(
    screen.getByText('Service', { selector: 'dt' }).nextElementSibling
  ).toHaveTextContent(/^Office bot server$/)

  hostStore.hosts = []
  view.rerender(<GbotSetup {...props} />)
  expect(
    screen.getByText('Service', { selector: 'dt' }).nextElementSibling
  ).toHaveTextContent(/^Paired service computer \(unavailable\)$/)
  expect(screen.queryByText('This PC')).not.toBeInTheDocument()
  expect(selectGbotService).toHaveBeenCalledTimes(1)
})

it('keeps a failed save reviewable and allows retry', async () => {
  preparedApi()
  const save = vi
    .fn()
    .mockRejectedValueOnce(new Error('Vault unavailable'))
    .mockResolvedValueOnce(undefined)
  render(<GbotSetup save={save} localReady={vi.fn()} cancel={vi.fn()} />)
  await chooseLan()
  fillConnection()
  fireEvent.click(screen.getByRole('button', { name: 'Import bot key' }))
  await checkTools()
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
    .mockResolvedValueOnce({ installed: true, command: null, issue: null })
  const save = vi.fn().mockResolvedValue(undefined)
  render(<GbotSetup save={save} localReady={vi.fn()} cancel={vi.fn()} />)
  await chooseLan()
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
  await checkTools()
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

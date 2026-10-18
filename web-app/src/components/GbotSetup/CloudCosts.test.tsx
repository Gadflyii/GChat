import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import CloudCosts from './CloudCosts'
import { gbot, type CloudReview, type SshIdentity } from '@/services/gbot'

vi.mock('@/services/gbot', () => ({ gbot: vi.fn() }))
afterEach(() => {
  cleanup()
  vi.resetAllMocks()
})
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: Error) => void
  const promise = new Promise<T>((accept, decline) => {
    resolve = accept
    reject = decline
  })
  return { promise, resolve, reject }
}
function review(): CloudReview {
  const plan = {
    id: '22',
    name: 'cpx11',
    region: 'fsn1',
    vcpus: 2,
    memory_mib: 4096,
    disk_gb: 40,
    included_traffic_bytes: 20e12,
    recommended: true,
    compute: {
      monthly: { net: '4.1', gross: '4.879' },
      hourly: { net: '0.0061', gross: '0.007259' },
    },
    ipv4: {
      monthly: { net: '0.5', gross: '0.595' },
      hourly: { net: '0.0007', gross: '0.000833' },
    },
    traffic_per_tb: { net: '1', gross: '1.19' },
  }
  const now = Math.floor(Date.now() / 1000)
  return {
    id: 'review',
    name: 'Research bot',
    provider: 'hetzner',
    fetched_at: now,
    expires_at: now + 900,
    confirmed: false,
    catalog: {
      currency: 'EUR',
      tax: 'Provider VAT rate: 19%',
      regions: [{ id: 'fsn1', name: 'Falkenstein' }],
      plans: [plan],
    },
    quote: {
      id: 'quote',
      plan,
      quoted_at: now,
      expires_at: now + 900,
      total: {
        monthly: { net: '4.6', gross: '5.474' },
        hourly: { net: '0.0068', gross: '0.008092' },
      },
    },
  }
}

it('requires explicit cost consent and confirms the exact saved quote without creating a VM', async () => {
  const initial = review()
  const saving = deferred<CloudReview>()
  const refresh = deferred<void>()
  const reviewed = vi.fn().mockReturnValue(refresh.promise)
  vi.mocked(gbot).mockReturnValueOnce(saving.promise)
  render(
    <CloudCosts
      name="Research bot"
      initial={initial}
      busy={vi.fn()}
      reviewed={reviewed}
    />
  )
  expect(
    screen.getByText('EUR 4.6 before tax · EUR 5.474 including tax')
  ).toBeInTheDocument()
  expect(screen.getByText('Provider VAT rate: 19%')).toBeInTheDocument()
  expect(
    screen.getByRole('button', { name: 'Save cost review' })
  ).toBeDisabled()
  fireEvent.click(screen.getByRole('checkbox'))
  const save = screen.getByRole('button', { name: 'Save cost review' })
  fireEvent.click(save)
  expect(
    screen.getByRole('button', { name: 'Saving cost review…' })
  ).toBeDisabled()
  expect(
    screen.getByText('Saving cost review…', { selector: '[role="status"]' })
  ).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Refresh prices' })).toBeDisabled()
  fireEvent.click(save)
  expect(gbot).toHaveBeenCalledExactlyOnceWith('setup/cloud/confirm', {
    id: 'review',
    quote_id: 'quote',
  })
  await act(async () => saving.resolve({ ...initial, confirmed: true }))
  expect(
    screen.getByText('Cost review saved. No VM has been created.')
  ).toBeInTheDocument()
  expect(
    screen.getByText('Saving cost review…', { selector: '[role="status"]' })
  ).toBeInTheDocument()
  expect(reviewed).toHaveBeenCalledOnce()
  await act(async () => refresh.resolve())
  expect(
    screen.queryByText('Saving cost review…', { selector: '[role="status"]' })
  ).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Refresh prices' })).toBeEnabled()
  expect(screen.getByLabelText('Provider API token (access key)')).toHaveValue(
    ''
  )
})

it.each(['hetzner', 'digital_ocean'] as const)(
  'explains an initial %s price failure and requires an explicit token retry',
  async (provider) => {
    const prices = deferred<CloudReview>()
    const busy = vi.fn()
    vi.mocked(gbot).mockReturnValueOnce(prices.promise)
    render(
      <CloudCosts
        name="Research bot"
        provider={provider}
        busy={busy}
        reviewed={vi.fn()}
      />
    )
    const token = screen.getByLabelText('Provider API token (access key)')
    fireEvent.change(token, { target: { value: 'synthetic-original-token' } })
    const load = screen.getByRole('button', { name: 'Load live prices' })
    fireEvent.click(load)
    fireEvent.click(load)
    expect(token).toBeDisabled()
    expect(
      screen.getByRole('button', { name: 'Loading prices…' })
    ).toBeDisabled()
    expect(gbot).toHaveBeenCalledTimes(1)
    await act(async () => prices.reject(new Error('Catalog request refused')))
    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent('Could not load current prices.')
    expect(alert).toHaveTextContent(
      'Enter your provider API token again, then choose Load live prices to retry.'
    )
    const details = within(alert).getByText('Details')
    expect(details.closest('details')).not.toHaveAttribute('open')
    expect(within(alert).getByText('Catalog request refused')).not.toBeVisible()
    fireEvent.click(details)
    expect(within(alert).getByText('Catalog request refused')).toBeVisible()
    expect(token).toHaveValue('')
    expect(token).toBeEnabled()
    expect(load).toBeDisabled()
    expect(busy.mock.calls).toEqual([[true], [false]])
    expect(gbot).toHaveBeenCalledTimes(1)
    const next = { ...review(), provider, quote: null }
    vi.mocked(gbot).mockResolvedValueOnce(next)
    fireEvent.change(token, { target: { value: 'synthetic-corrected-token' } })
    expect(gbot).toHaveBeenCalledTimes(1)
    fireEvent.click(load)
    await screen.findByRole('button', { name: 'Refresh prices' })
    expect(gbot).toHaveBeenLastCalledWith('setup/cloud/catalog', {
      id: expect.any(String),
      name: 'Research bot',
      provider,
      api_token: 'synthetic-corrected-token',
    })
    expect(gbot).toHaveBeenCalledTimes(2)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(token).toHaveValue('')
    expect(screen.getByRole('button', { name: 'Review cost' })).toBeDisabled()
    expect(
      screen.queryByRole('button', { name: 'Save cost review' })
    ).not.toBeInTheDocument()
  }
)

it('clears entered tokens and withholds an old quote after a failed price refresh', async () => {
  const prices = deferred<CloudReview>()
  vi.mocked(gbot).mockReturnValueOnce(prices.promise)
  const busy = vi.fn()
  render(
    <CloudCosts
      name="Research bot"
      initial={review()}
      busy={busy}
      reviewed={vi.fn()}
    />
  )
  fireEvent.change(screen.getByLabelText('Provider API token (access key)'), {
    target: { value: 'fixture-secret' },
  })
  const refresh = screen.getByRole('button', { name: 'Refresh prices' })
  fireEvent.click(refresh)
  expect(screen.getByRole('button', { name: 'Loading prices…' })).toBeDisabled()
  expect(
    screen.getByText('Loading prices…', { selector: '[role="status"]' })
  ).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Review cost' })).toBeDisabled()
  fireEvent.click(refresh)
  await act(async () => prices.reject(new Error('Provider rate limit reached')))
  const alert = screen.getByRole('alert')
  expect(alert).toHaveTextContent('Could not refresh current prices.')
  expect(alert).toHaveTextContent(
    'Review Details, then choose Refresh prices to try again. Enter the API token again if it needs to be replaced.'
  )
  const details = within(alert).getByText('Details')
  expect(details.closest('details')).not.toHaveAttribute('open')
  expect(
    within(alert).getByText('Provider rate limit reached')
  ).not.toBeVisible()
  fireEvent.click(details)
  expect(within(alert).getByText('Provider rate limit reached')).toBeVisible()
  expect(screen.getByRole('button', { name: 'Refresh prices' })).toBeEnabled()
  expect(
    screen.queryByText('Loading prices…', { selector: '[role="status"]' })
  ).not.toBeInTheDocument()
  expect(busy.mock.calls).toEqual([[true], [false]])
  expect(screen.getByLabelText('Provider API token (access key)')).toHaveValue(
    ''
  )
  expect(
    screen.queryByRole('button', { name: 'Save cost review' })
  ).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Review cost' })).toBeDisabled()
  expect(gbot).toHaveBeenCalledExactlyOnceWith('setup/cloud/catalog', {
    id: 'review',
    name: 'Research bot',
    provider: 'hetzner',
    api_token: 'fixture-secret',
  })
  vi.mocked(gbot).mockResolvedValueOnce({ ...review(), quote: null })
  fireEvent.click(refresh)
  await screen.findByText('Choose region')
  expect(gbot).toHaveBeenLastCalledWith('setup/cloud/catalog', {
    id: 'review',
    name: 'Research bot',
    provider: 'hetzner',
  })
  expect(gbot).toHaveBeenCalledTimes(2)
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
})

it('explains cost calculation and allows a failed calculation to be retried', async () => {
  const initial = review()
  const quote = deferred<CloudReview>()
  vi.mocked(gbot).mockReturnValueOnce(quote.promise)
  render(
    <CloudCosts
      name="Research bot"
      initial={initial}
      busy={vi.fn()}
      reviewed={vi.fn()}
    />
  )
  const calculate = screen.getByRole('button', { name: 'Review cost' })
  fireEvent.click(calculate)
  expect(
    screen.getByRole('button', { name: 'Calculating cost…' })
  ).toBeDisabled()
  expect(
    screen.getByText('Calculating cost…', { selector: '[role="status"]' })
  ).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Refresh prices' })).toBeDisabled()
  fireEvent.click(calculate)
  expect(gbot).toHaveBeenCalledExactlyOnceWith('setup/cloud/select', {
    id: 'review',
    region: 'fsn1',
    plan: '22',
  })
  await act(async () =>
    quote.reject(new Error('Prices are temporarily unavailable'))
  )
  const alert = screen.getByRole('alert')
  expect(alert).toHaveTextContent(
    'Could not calculate the cost. Your region and plan are still selected. Choose Review cost to try again.'
  )
  const details = within(alert).getByText('Details')
  expect(details.closest('details')).not.toHaveAttribute('open')
  expect(
    within(alert).getByText('Prices are temporarily unavailable')
  ).not.toBeVisible()
  fireEvent.click(details)
  expect(
    within(alert).getByText('Prices are temporarily unavailable')
  ).toBeVisible()
  expect(gbot).toHaveBeenCalledTimes(1)
  expect(screen.getByRole('button', { name: 'Region' })).toHaveTextContent(
    'Falkenstein'
  )
  expect(screen.getByRole('button', { name: 'Plan' })).toHaveTextContent(
    'cpx11'
  )
  expect(screen.getByRole('checkbox')).not.toBeChecked()
  expect(calculate).toBeEnabled()
  expect(
    screen.queryByText('Calculating cost…', { selector: '[role="status"]' })
  ).not.toBeInTheDocument()
  vi.mocked(gbot).mockResolvedValueOnce(initial)
  fireEvent.click(calculate)
  await screen.findByRole('button', { name: 'Review cost' })
  expect(gbot).toHaveBeenCalledTimes(2)
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
})

it('allows cost confirmation to be retried after saving fails', async () => {
  const initial = review()
  const reviewed = vi.fn().mockResolvedValue(undefined)
  vi.mocked(gbot).mockRejectedValueOnce(
    new Error('Cost review could not be saved')
  )
  render(
    <CloudCosts
      name="Research bot"
      initial={initial}
      busy={vi.fn()}
      reviewed={reviewed}
    />
  )
  fireEvent.click(screen.getByRole('checkbox'))
  fireEvent.click(screen.getByRole('button', { name: 'Save cost review' }))
  const alert = await screen.findByRole('alert')
  expect(alert).toHaveTextContent(
    'Could not confirm the cost review was saved. Your cost consent is still selected. Choose Save cost review to try again.'
  )
  const details = within(alert).getByText('Details')
  expect(details.closest('details')).not.toHaveAttribute('open')
  expect(
    within(alert).getByText('Cost review could not be saved')
  ).not.toBeVisible()
  fireEvent.click(details)
  expect(
    within(alert).getByText('Cost review could not be saved')
  ).toBeVisible()
  expect(gbot).toHaveBeenCalledExactlyOnceWith('setup/cloud/confirm', {
    id: 'review',
    quote_id: 'quote',
  })
  expect(screen.getByRole('checkbox')).toBeChecked()
  expect(reviewed).not.toHaveBeenCalled()
  expect(screen.getByRole('button', { name: 'Save cost review' })).toBeEnabled()
  expect(
    screen.queryByText('Saving cost review…', { selector: '[role="status"]' })
  ).not.toBeInTheDocument()
  vi.mocked(gbot).mockResolvedValueOnce({ ...initial, confirmed: true })
  fireEvent.click(screen.getByRole('button', { name: 'Save cost review' }))
  await screen.findByText('Cost review saved. No VM has been created.')
  expect(gbot).toHaveBeenCalledTimes(2)
  expect(reviewed).toHaveBeenCalledOnce()
})

it('keeps a confirmed cost review when refreshing the computer list fails', async () => {
  const initial = review()
  const refresh = deferred<void>()
  const reviewed = vi.fn().mockReturnValue(refresh.promise)
  vi.mocked(gbot).mockResolvedValueOnce({ ...initial, confirmed: true })
  render(
    <CloudCosts
      name="Research bot"
      initial={initial}
      busy={vi.fn()}
      reviewed={reviewed}
    />
  )
  fireEvent.click(screen.getByRole('checkbox'))
  fireEvent.click(screen.getByRole('button', { name: 'Save cost review' }))
  await screen.findByText('Cost review saved. No VM has been created.')
  expect(
    screen.queryByRole('button', { name: 'Save cost review' })
  ).not.toBeInTheDocument()
  await act(async () => refresh.reject(new Error('Computer list unavailable')))
  const alert = screen.getByRole('alert')
  expect(alert).toHaveTextContent(
    'Your cost review was saved, but the computer list could not be refreshed. Close setup to try refreshing the list again.'
  )
  expect(alert).not.toHaveTextContent('Choose Save cost review')
  const details = within(alert).getByText('Details')
  expect(details.closest('details')).not.toHaveAttribute('open')
  expect(within(alert).getByText('Computer list unavailable')).not.toBeVisible()
  fireEvent.click(details)
  expect(within(alert).getByText('Computer list unavailable')).toBeVisible()
  expect(
    screen.getByText('Cost review saved. No VM has been created.')
  ).toBeInTheDocument()
  expect(
    screen.getByRole('checkbox', {
      name: /I authorize creating this computer/,
    })
  ).not.toBeChecked()
  expect(
    screen.getByRole('button', { name: 'Create cloud computer' })
  ).toBeDisabled()
  expect(gbot).toHaveBeenCalledExactlyOnceWith('setup/cloud/confirm', {
    id: 'review',
    quote_id: 'quote',
  })
  expect(reviewed).toHaveBeenCalledOnce()
})

it('requires a new plan selection after refreshing saved credentials', async () => {
  const initial = review()
  vi.mocked(gbot).mockResolvedValueOnce({
    ...initial,
    quote: null,
    confirmed: false,
  })
  render(
    <CloudCosts
      name="Research bot"
      initial={initial}
      busy={vi.fn()}
      reviewed={vi.fn()}
    />
  )
  fireEvent.click(screen.getByRole('button', { name: 'Refresh prices' }))
  await screen.findByText('Choose region')
  expect(gbot).toHaveBeenCalledExactlyOnceWith('setup/cloud/catalog', {
    id: 'review',
    name: 'Research bot',
    provider: 'hetzner',
  })
  expect(screen.queryByText('Estimated cost')).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Review cost' })).toBeDisabled()
})

it('prevents confirming expired prices on resume', async () => {
  const initial = review()
  initial.expires_at = Math.floor(Date.now() / 1000) - 1
  render(
    <CloudCosts
      name="Research bot"
      initial={initial}
      busy={vi.fn()}
      reviewed={vi.fn()}
    />
  )
  await screen.findByText('Prices expired. Refresh prices before continuing.')
  expect(
    screen.queryByRole('button', { name: 'Save cost review' })
  ).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Review cost' })).toBeDisabled()
  expect(gbot).not.toHaveBeenCalled()
})

function deployment(
  initial: CloudReview,
  phase: 'creating' | 'running' | 'check_required' = 'creating'
): CloudReview {
  return {
    ...initial,
    confirmed: true,
    deployment: {
      phase,
      plan: initial.quote!.plan,
      source_cidrs: ['203.0.113.10/32'],
      resources: [
        {
          kind: 'server',
          id: '42',
          name: 'owned-bot',
          ready: phase === 'running',
          address: '203.0.113.7',
          actions: [],
        },
      ],
      pending: null,
      issue: null,
    },
  }
}

it.each(['deleting', 'check_required'] as const)(
  'offers saved deployment issue recovery for %s after a resolved request',
  async (phase) => {
    const initial = deployment(review(), 'running')
    const diagnostic = `Provider operation failed: ${'request-id-'.repeat(24)}\nTry again later.`
    const failed: CloudReview = {
      ...initial,
      deployment: { ...initial.deployment!, phase, issue: diagnostic },
    }
    const recovered: CloudReview = {
      ...initial,
      deployment: {
        ...initial.deployment!,
        phase: phase === 'deleting' ? 'deleted' : 'running',
        resources: phase === 'deleting' ? [] : initial.deployment!.resources,
      },
    }
    const retry = deferred<CloudReview>()
    vi.mocked(gbot).mockResolvedValueOnce(failed)
    render(
      <CloudCosts
        name="Research bot"
        initial={initial}
        busy={vi.fn()}
        reviewed={vi.fn()}
      />
    )
    expect(gbot).not.toHaveBeenCalled()
    if (phase === 'deleting') {
      fireEvent.click(
        screen.getByRole('checkbox', { name: /Delete this setup/ })
      )
      fireEvent.click(
        screen.getByRole('button', { name: 'Delete cloud computer' })
      )
    } else {
      fireEvent.click(screen.getByRole('button', { name: 'Check progress' }))
    }
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(
      phase === 'deleting'
        ? 'Could not confirm the cloud computer was deleted. Provider charges may continue. Choose Check progress to check its state before trying Delete cloud computer again.'
        : 'The cloud computer needs attention. Review Details. Choose Check progress to check its state before continuing.'
    )
    expect(screen.getByText(/203\.0\.113\.7/)).toBeVisible()
    expect(
      screen.queryByText('Computer and owned provider resources deleted.')
    ).not.toBeInTheDocument()
    const details = within(alert).getByText('Details')
    const raw = within(alert).getByText(/Provider operation failed:/)
    expect(raw).toHaveTextContent(diagnostic.replace(/\s+/g, ' '))
    expect(raw).not.toBeVisible()
    expect(details.closest('details')).not.toHaveAttribute('open')
    fireEvent.click(details)
    expect(raw).toBeVisible()
    fireEvent.click(details)
    expect(raw).not.toBeVisible()
    expect(gbot).toHaveBeenCalledExactlyOnceWith(
      phase === 'deleting' ? 'setup/cloud/delete' : 'setup/cloud/check',
      phase === 'deleting' ? { id: 'review', consent: true } : { id: 'review' }
    )
    expect(
      screen.getByRole('button', { name: 'Delete cloud computer' })
    ).toBeDisabled()
    vi.mocked(gbot).mockReturnValueOnce(retry.promise)
    const check = screen.getByRole('button', { name: 'Check progress' })
    fireEvent.click(check)
    fireEvent.click(check)
    expect(
      screen.getByRole('button', { name: 'Checking cloud computer…' })
    ).toBeDisabled()
    expect(screen.getByRole('alert')).toBeVisible()
    expect(gbot).toHaveBeenCalledTimes(2)
    expect(gbot).toHaveBeenLastCalledWith('setup/cloud/check', { id: 'review' })
    await act(async () => retry.resolve(recovered))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(
      screen.queryByText(/Provider operation failed:/)
    ).not.toBeInTheDocument()
    if (phase === 'deleting') {
      expect(
        screen.getByText('Computer and owned provider resources deleted.')
      ).toBeVisible()
      expect(
        screen.getByRole('checkbox', { name: /authorize creating/ })
      ).not.toBeChecked()
      expect(
        screen.getByRole('button', { name: 'Create cloud computer' })
      ).toBeDisabled()
    } else {
      expect(screen.getByRole('button', { name: 'Check progress' })).toBeEnabled()
      expect(
        screen.getByRole('button', { name: 'Check SSH identity' })
      ).toBeEnabled()
      expect(
        screen.getByRole('button', { name: 'Connect bot desktop' })
      ).toBeDisabled()
    }
    expect(gbot).toHaveBeenCalledTimes(2)
  }
)

it.each([
  ['Error', new Error('SSH authentication failed')],
  ['native string', 'SSH authentication failed'],
])(
  'keeps failed SSH access guidance through progress refresh (%s)',
  async (_kind, failure) => {
    const initial = deployment(review(), 'running')
    const identity: SshIdentity = {
      public_key: { algorithm: 'ssh-ed25519', public_key: 'fixture-key' },
      fingerprint: 'SHA256:fixture',
    }
    const progress = deferred<CloudReview>()
    const retry = deferred<object>()
    vi.mocked(gbot).mockImplementation(async (path) => {
      if (path === 'setup/cloud/identity') return identity
      if (path === 'setup/cloud/check') return progress.promise
      return {}
    })
    render(
      <CloudCosts
        name="Research bot"
        initial={initial}
        busy={vi.fn()}
        reviewed={vi.fn()}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: 'Check SSH identity' }))
    await screen.findByText(identity.fingerprint)
    fireEvent.click(
      screen.getByRole('checkbox', { name: /fingerprint matches/ })
    )
    vi.mocked(gbot).mockResolvedValueOnce({}).mockRejectedValueOnce(failure)
    fireEvent.click(screen.getByRole('button', { name: 'Verify SSH access' }))
    await screen.findByText('SSH authentication failed')
    expect(gbot).toHaveBeenCalledWith('setup/cloud/attach', {
      id: 'review',
      pinned_host_key: identity.public_key,
      verified: true,
    })
    expect(gbot).toHaveBeenCalledWith('workspaces/ssh/check', {
      workspace_id: 'review',
    })
    const sshCalls = () =>
      vi
        .mocked(gbot)
        .mock.calls.filter(([path]) =>
          ['setup/cloud/attach', 'workspaces/ssh/check'].includes(path)
        )
    expect(sshCalls()).toHaveLength(2)

    fireEvent.click(screen.getByRole('button', { name: 'Check progress' }))
    expect(
      screen.getByRole('button', { name: 'Verify SSH access' })
    ).toBeDisabled()
    await act(async () => progress.resolve(initial))
    const guidance = screen.getByRole('alert')
    expect(guidance).toHaveTextContent(
      'Could not verify SSH access. Try Verify SSH access again before continuing.'
    )
    expect(
      screen.getByText('SSH authentication failed').closest('details')
    ).not.toHaveAttribute('open')
    expect(
      screen.getByRole('button', { name: 'Connect bot desktop' })
    ).toBeDisabled()
    expect(
      screen.queryByRole('button', { name: 'Check tools' })
    ).not.toBeInTheDocument()
    expect(sshCalls()).toHaveLength(2)

    vi.mocked(gbot).mockResolvedValueOnce({}).mockReturnValueOnce(retry.promise)
    fireEvent.click(screen.getByRole('button', { name: 'Verify SSH access' }))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Verifying SSH access…' })
    ).toBeDisabled()
    expect(
      screen.getByRole('button', { name: 'Connect bot desktop' })
    ).toBeDisabled()
    await act(async () => retry.resolve({}))
    expect(screen.getByRole('button', { name: 'Check tools' })).toBeEnabled()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(
      screen.getByRole('checkbox', { name: /fingerprint matches/ })
    ).toBeChecked()
    expect(sshCalls()).toEqual([
      [
        'setup/cloud/attach',
        { id: 'review', pinned_host_key: identity.public_key, verified: true },
      ],
      ['workspaces/ssh/check', { workspace_id: 'review' }],
      [
        'setup/cloud/attach',
        { id: 'review', pinned_host_key: identity.public_key, verified: true },
      ],
      ['workspaces/ssh/check', { workspace_id: 'review' }],
    ])
  }
)

it('creates only after separate billing consent with the reviewed quote and explicit SSH sources', async () => {
  const initial = { ...review(), confirmed: true }
  const creation = deferred<CloudReview>()
  vi.mocked(gbot).mockReturnValueOnce(creation.promise)
  render(
    <CloudCosts
      name="Research bot"
      initial={initial}
      busy={vi.fn()}
      reviewed={vi.fn()}
    />
  )
  expect(gbot).not.toHaveBeenCalled()
  const create = screen.getByRole('button', { name: 'Create cloud computer' })
  expect(create).toBeDisabled()
  fireEvent.change(screen.getByLabelText('Allowed SSH source networks'), {
    target: { value: '203.0.113.10/32\n2001:db8::1/128' },
  })
  expect(create).toBeDisabled()
  fireEvent.click(screen.getByRole('checkbox', { name: /authorize creating/ }))
  fireEvent.click(create)
  expect(
    screen.getByRole('button', { name: 'Creating cloud computer…' })
  ).toBeDisabled()
  expect(
    screen.getByText('Creating cloud computer…', {
      selector: '[role="status"]',
    })
  ).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Refresh prices' })).toBeDisabled()
  fireEvent.click(create)
  expect(gbot).toHaveBeenCalledExactlyOnceWith('setup/cloud/create', {
    id: 'review',
    quote_id: 'quote',
    consent: true,
    source_cidrs: ['203.0.113.10/32', '2001:db8::1/128'],
  })
  expect(
    screen.queryByRole('button', { name: 'Connect bot desktop' })
  ).not.toBeInTheDocument()
  await act(async () => creation.resolve(deployment(initial)))
  await screen.findByText(/Computer creating/)
  expect(
    screen.queryByText('Creating cloud computer…', {
      selector: '[role="status"]',
    })
  ).not.toBeInTheDocument()
})

it.each(['delete response', 'progress check'] as const)(
  'requires fresh billing consent after a %s confirms deletion of a created computer',
  async (confirmation) => {
    const initial = { ...review(), confirmed: true }
    const sources = '203.0.113.10/32\n2001:db8::1/128'
    const running = deployment(initial, 'running')
    running.deployment!.source_cidrs = sources.split('\n')
    const deleted: CloudReview = {
      ...running,
      deployment: {
        ...running.deployment!,
        phase: 'deleted',
        resources: [],
      },
    }
    const deleting: CloudReview = {
      ...running,
      deployment: {
        ...running.deployment!,
        phase: 'deleting',
        pending: {
          kind: 'server',
          name: 'owned-bot',
          deleting: running.deployment!.resources[0],
        },
      },
    }
    const creation = deferred<CloudReview>()
    const deletion = deferred<CloudReview>()
    const check = deferred<CloudReview>()
    const recreation = deferred<CloudReview>()
    vi.mocked(gbot)
      .mockReturnValueOnce(creation.promise)
      .mockReturnValueOnce(deletion.promise)
    render(
      <CloudCosts
        name="Research bot"
        initial={initial}
        busy={vi.fn()}
        reviewed={vi.fn()}
      />
    )
    fireEvent.change(screen.getByLabelText('Allowed SSH source networks'), {
      target: { value: sources },
    })
    fireEvent.click(
      screen.getByRole('checkbox', { name: /authorize creating/ })
    )
    const firstCreate = screen.getByRole('button', {
      name: 'Create cloud computer',
    })
    fireEvent.click(firstCreate)
    fireEvent.click(firstCreate)
    expect(gbot).toHaveBeenCalledExactlyOnceWith('setup/cloud/create', {
      id: 'review',
      quote_id: 'quote',
      consent: true,
      source_cidrs: ['203.0.113.10/32', '2001:db8::1/128'],
    })
    await act(async () => creation.resolve(running))
    const remove = screen.getByRole('button', {
      name: 'Delete cloud computer',
    })
    expect(remove).toBeDisabled()
    fireEvent.click(screen.getByRole('checkbox', { name: /Delete this setup/ }))
    fireEvent.click(remove)
    fireEvent.click(remove)
    expect(gbot).toHaveBeenCalledTimes(2)
    expect(gbot).toHaveBeenLastCalledWith('setup/cloud/delete', {
      id: 'review',
      consent: true,
    })
    await act(async () =>
      deletion.resolve(confirmation === 'delete response' ? deleted : deleting)
    )
    if (confirmation === 'progress check') {
      expect(
        screen.queryByRole('button', { name: 'Create cloud computer' })
      ).not.toBeInTheDocument()
      vi.mocked(gbot).mockReturnValueOnce(check.promise)
      const progress = screen.getByRole('button', { name: 'Check progress' })
      fireEvent.click(progress)
      fireEvent.click(progress)
      expect(gbot).toHaveBeenCalledTimes(3)
      expect(gbot).toHaveBeenLastCalledWith('setup/cloud/check', {
        id: 'review',
      })
      expect(
        screen.getByRole('button', { name: 'Checking cloud computer…' })
      ).toBeDisabled()
      await act(async () => check.resolve(deleted))
    }
    expect(
      screen.getByText('Computer and owned provider resources deleted.')
    ).toBeInTheDocument()
    const billing = screen.getByRole('checkbox', { name: /authorize creating/ })
    const nextCreate = screen.getByRole('button', {
      name: 'Create cloud computer',
    })
    expect(billing).not.toBeChecked()
    expect(nextCreate).toBeDisabled()
    expect(screen.getByLabelText('Allowed SSH source networks')).toHaveValue(
      sources
    )
    const beforeRecreation = confirmation === 'delete response' ? 2 : 3
    fireEvent.click(nextCreate)
    expect(gbot).toHaveBeenCalledTimes(beforeRecreation)
    fireEvent.click(billing)
    expect(nextCreate).toBeEnabled()
    expect(gbot).toHaveBeenCalledTimes(beforeRecreation)
    vi.mocked(gbot).mockReturnValueOnce(recreation.promise)
    fireEvent.click(nextCreate)
    fireEvent.click(nextCreate)
    expect(
      screen.getByRole('button', { name: 'Creating cloud computer…' })
    ).toBeDisabled()
    expect(gbot).toHaveBeenCalledTimes(beforeRecreation + 1)
    expect(gbot).toHaveBeenLastCalledWith('setup/cloud/create', {
      id: 'review',
      quote_id: 'quote',
      consent: true,
      source_cidrs: ['203.0.113.10/32', '2001:db8::1/128'],
    })
    await act(async () => recreation.resolve(deployment(initial)))
    expect(screen.getByText(/Computer creating/)).toBeInTheDocument()
    expect(gbot).toHaveBeenCalledTimes(beforeRecreation + 1)
  }
)

it('keeps recovery and consented deletion available after quote expiry', async () => {
  const initial = deployment(review(), 'check_required')
  initial.expires_at = 1
  initial.deployment!.issue =
    'Provider reply lost; checking before another create.'
  const check = deferred<CloudReview>()
  const deletion = deferred<CloudReview>()
  vi.mocked(gbot)
    .mockReturnValueOnce(check.promise)
    .mockReturnValueOnce(deletion.promise)
  render(
    <CloudCosts
      name="Research bot"
      initial={initial}
      busy={vi.fn()}
      reviewed={vi.fn()}
    />
  )
  fireEvent.click(screen.getByRole('button', { name: 'Check progress' }))
  expect(
    screen.getByRole('button', { name: 'Checking cloud computer…' })
  ).toBeDisabled()
  expect(
    screen.getByText('Checking cloud computer…', {
      selector: '[role="status"]',
    })
  ).toBeInTheDocument()
  expect(gbot).toHaveBeenCalledExactlyOnceWith('setup/cloud/check', {
    id: 'review',
  })
  await act(async () => check.resolve(initial))
  await vi.waitFor(() =>
    expect(screen.getByRole('button', { name: 'Check progress' })).toBeEnabled()
  )
  const remove = screen.getByRole('button', { name: 'Delete cloud computer' })
  expect(remove).toBeDisabled()
  fireEvent.click(screen.getByRole('checkbox', { name: /Delete this setup/ }))
  fireEvent.click(remove)
  expect(
    screen.getByRole('button', { name: 'Deleting cloud computer…' })
  ).toBeDisabled()
  expect(
    screen.getByText('Deleting cloud computer…', {
      selector: '[role="status"]',
    })
  ).toBeInTheDocument()
  fireEvent.click(remove)
  expect(gbot).toHaveBeenCalledTimes(2)
  await act(async () =>
    deletion.resolve({
      ...initial,
      deployment: { ...initial.deployment!, phase: 'deleted', resources: [] },
    })
  )
  await screen.findByText('Computer and owned provider resources deleted.')
  expect(gbot).toHaveBeenLastCalledWith('setup/cloud/delete', {
    id: 'review',
    consent: true,
  })
  expect(
    screen.getByRole('button', { name: 'Create cloud computer' })
  ).toBeDisabled()
})

it('requires verified SSH, installed tools and a successful desktop connection before completing setup', async () => {
  const initial = deployment(review(), 'running')
  const identity = {
    public_key: { algorithm: 'ssh-ed25519', public_key: 'fixture-key' },
    fingerprint: 'SHA256:fixture',
  }
  const connected = vi.fn().mockResolvedValue(undefined)
  const identityCheck = deferred<SshIdentity>()
  const accessCheck = deferred<object>()
  const connection = deferred<object>()
  vi.mocked(gbot).mockImplementation(async (path) => {
    if (path === 'setup/cloud/identity') return identityCheck.promise
    if (path === 'workspaces/ssh/check') return accessCheck.promise
    if (path === 'connect') return connection.promise
    if (path === 'workspaces/ssh/tools')
      return { installed: true, command: null, issue: null }
    return {}
  })
  render(
    <CloudCosts
      name="Research bot"
      initial={initial}
      busy={vi.fn()}
      reviewed={vi.fn()}
      connected={connected}
    />
  )
  const connect = screen.getByRole('button', { name: 'Connect bot desktop' })
  expect(connect).toBeDisabled()
  fireEvent.click(screen.getByRole('button', { name: 'Check SSH identity' }))
  expect(
    screen.getByRole('button', { name: 'Checking SSH identity…' })
  ).toBeDisabled()
  expect(
    screen.getByText('Checking SSH identity…', { selector: '[role="status"]' })
  ).toBeInTheDocument()
  await act(async () => identityCheck.resolve(identity))
  await screen.findByText('SHA256:fixture')
  expect(
    screen.getByRole('button', { name: 'Verify SSH access' })
  ).toBeDisabled()
  fireEvent.click(screen.getByRole('checkbox', { name: /fingerprint matches/ }))
  fireEvent.click(screen.getByRole('button', { name: 'Verify SSH access' }))
  expect(
    screen.getByRole('button', { name: 'Verifying SSH access…' })
  ).toBeDisabled()
  expect(
    screen.getByText('Verifying SSH access…', { selector: '[role="status"]' })
  ).toBeInTheDocument()
  await act(async () => accessCheck.resolve({}))
  await screen.findByRole('button', { name: 'Check tools' })
  expect(gbot).toHaveBeenCalledWith('setup/cloud/attach', {
    id: 'review',
    pinned_host_key: identity.public_key,
    verified: true,
  })
  expect(gbot).toHaveBeenCalledWith('workspaces/ssh/check', {
    workspace_id: 'review',
  })
  expect(connect).toBeDisabled()
  fireEvent.click(screen.getByRole('button', { name: 'Check tools' }))
  await vi.waitFor(() => expect(connect).toBeEnabled())
  expect(connected).not.toHaveBeenCalled()
  fireEvent.click(connect)
  expect(
    screen.getByRole('button', { name: 'Connecting bot desktop…' })
  ).toBeDisabled()
  expect(
    screen.getByText('Connecting bot desktop…', { selector: '[role="status"]' })
  ).toBeInTheDocument()
  fireEvent.click(connect)
  expect(gbot).toHaveBeenCalledTimes(5)
  await act(async () => connection.reject(new Error('Desktop not ready')))
  await screen.findByText('Desktop not ready')
  expect(connected).not.toHaveBeenCalled()
  expect(connect).toBeEnabled()
  const guidance = screen.getByRole('alert')
  expect(guidance).toHaveTextContent(
    'Could not connect the bot desktop. Choose Check progress to check the computer, then choose Connect bot desktop when the SSH and tool checks are complete.'
  )
  expect(
    within(guidance).getByText('Desktop not ready').closest('details')
  ).not.toHaveAttribute('open')
  const progress = deferred<CloudReview>()
  vi.mocked(gbot).mockReturnValueOnce(progress.promise)
  fireEvent.click(screen.getByRole('button', { name: 'Check progress' }))
  expect(screen.getByText('Desktop not ready')).toBeInTheDocument()
  expect(connect).toBeDisabled()
  expect(gbot).toHaveBeenLastCalledWith('setup/cloud/check', { id: 'review' })
  await act(async () => progress.resolve(initial))
  expect(screen.getByText('Desktop not ready')).toBeInTheDocument()
  expect(connect).toBeEnabled()
  expect(connected).not.toHaveBeenCalled()
  expect(
    screen.queryByText('Connecting bot desktop…', {
      selector: '[role="status"]',
    })
  ).not.toBeInTheDocument()
  vi.mocked(gbot).mockResolvedValueOnce({})
  fireEvent.click(connect)
  await vi.waitFor(() => expect(connected).toHaveBeenCalledWith('review'))
  expect(screen.queryByText('Desktop not ready')).not.toBeInTheDocument()
  expect(gbot).toHaveBeenLastCalledWith('connect', {
    workspace_id: 'review',
    session_id: expect.any(String),
  })
})

it('does not complete a replaced cloud setup when its desktop connection returns late', async () => {
  const initial = deployment(review(), 'running')
  const replacement = { ...initial, id: 'replacement', name: 'Replacement bot' }
  const connection = deferred<object>()
  const connected = vi.fn().mockResolvedValue(undefined)
  const oldBusy = vi.fn()
  const newBusy = vi.fn()
  const identity: SshIdentity = {
    public_key: { algorithm: 'ssh-ed25519', public_key: 'fixture-key' },
    fingerprint: 'SHA256:fixture',
  }
  vi.mocked(gbot).mockImplementation(async (path) => {
    if (path === 'setup/cloud/identity') return identity
    if (path === 'workspaces/ssh/tools')
      return { installed: true, command: null, issue: null }
    if (path === 'connect') return connection.promise
    return {}
  })
  const { rerender } = render(
    <CloudCosts
      key={initial.id}
      name={initial.name}
      initial={initial}
      busy={oldBusy}
      reviewed={vi.fn()}
      connected={connected}
    />
  )
  const prepare = async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Check SSH identity' }))
    await screen.findByText(identity.fingerprint)
    fireEvent.click(screen.getByRole('checkbox', { name: /fingerprint matches/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Verify SSH access' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Check tools' }))
    await vi.waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Connect bot desktop' })
      ).toBeEnabled()
    )
  }
  await prepare()
  fireEvent.click(screen.getByRole('button', { name: 'Connect bot desktop' }))
  expect(
    screen.getByRole('button', { name: 'Connecting bot desktop…' })
  ).toBeDisabled()
  expect(gbot).toHaveBeenLastCalledWith('connect', {
    workspace_id: initial.id,
    session_id: expect.any(String),
  })
  rerender(
    <CloudCosts
      key={replacement.id}
      name={replacement.name}
      initial={replacement}
      busy={newBusy}
      reviewed={vi.fn()}
      connected={connected}
    />
  )
  await act(async () => connection.resolve({}))
  expect(connected).not.toHaveBeenCalled()
  expect(newBusy).not.toHaveBeenCalled()
  expect(
    screen.getByRole('button', { name: 'Connect bot desktop' })
  ).toBeDisabled()
  expect(
    screen.queryByRole('button', { name: 'Connecting bot desktop…' })
  ).not.toBeInTheDocument()
  expect(
    vi.mocked(gbot).mock.calls.filter(([path]) => path === 'connect')
  ).toHaveLength(1)

  await prepare()
  expect(connected).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Connect bot desktop' }))
  await vi.waitFor(() =>
    expect(connected).toHaveBeenCalledExactlyOnceWith(replacement.id)
  )
  expect(gbot).toHaveBeenLastCalledWith('connect', {
    workspace_id: replacement.id,
    session_id: expect.any(String),
  })
  expect(
    vi.mocked(gbot).mock.calls.filter(([path]) => path === 'connect')
  ).toHaveLength(2)
})

it.each([
  {
    label: 'Check progress',
    progress: 'Checking cloud computer…',
    path: 'setup/cloud/check',
    tool: 'Check tools',
    toolProgress: 'Checking tools…',
    toolPath: 'workspaces/ssh/tools',
  },
  {
    label: 'Delete cloud computer',
    progress: 'Deleting cloud computer…',
    path: 'setup/cloud/delete',
    tool: 'Prepare tools',
    toolProgress: 'Preparing tools…',
    toolPath: 'workspaces/ssh/prepare',
  },
])(
  'blocks tool preparation and checks while cloud $label is pending',
  async ({ label, progress, path, tool, toolProgress, toolPath }) => {
    const initial = deployment(review(), 'running')
    const parentAction = deferred<CloudReview>()
    const tools = deferred<object>()
    const busy = vi.fn()
    vi.mocked(gbot).mockImplementation(async (request) => {
      if (request === 'setup/cloud/identity')
        return {
          public_key: { algorithm: 'ssh-ed25519', public_key: 'fixture-key' },
          fingerprint: 'SHA256:fixture',
        }
      if (request === path) return parentAction.promise
      if (
        request === 'workspaces/ssh/tools' ||
        request === 'workspaces/ssh/prepare'
      )
        return tools.promise
      return {}
    })
    render(
      <CloudCosts
        name="Research bot"
        initial={initial}
        busy={busy}
        reviewed={vi.fn()}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: 'Check SSH identity' }))
    await screen.findByText('SHA256:fixture')
    fireEvent.click(
      screen.getByRole('checkbox', { name: /fingerprint matches/ })
    )
    fireEvent.click(screen.getByRole('button', { name: 'Verify SSH access' }))
    const checkTools = await screen.findByRole('button', {
      name: 'Check tools',
    })
    const consent = screen.getByRole('checkbox', { name: /dedicated to Gbot/ })
    fireEvent.click(consent)
    fireEvent.click(screen.getByRole('checkbox', { name: /Delete this setup/ }))
    const prepareTools = screen.getByRole('button', { name: 'Prepare tools' })
    const parent = screen.getByRole('button', { name: label })
    expect(checkTools).toBeEnabled()
    expect(prepareTools).toBeEnabled()
    const toolCalls = () =>
      vi
        .mocked(gbot)
        .mock.calls.filter(([request]) =>
          ['workspaces/ssh/tools', 'workspaces/ssh/prepare'].includes(request)
        )
    const parentCalls = () =>
      vi.mocked(gbot).mock.calls.filter(([request]) => request === path)

    act(() => {
      parent.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      checkTools.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      prepareTools.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      parent.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(toolCalls()).toHaveLength(0)
    expect(parentCalls()).toEqual([
      [
        path,
        {
          id: 'review',
          ...(path.endsWith('/delete') ? { consent: true } : {}),
        },
      ],
    ])
    expect(screen.getByRole('button', { name: progress })).toBeDisabled()
    expect(
      screen.getByText(progress, { selector: '[role="status"]' })
    ).toBeVisible()
    expect(checkTools).toBeDisabled()
    expect(prepareTools).toBeDisabled()
    expect(consent).toBeDisabled()
    expect(consent).toBeChecked()
    expect(
      screen.getByRole('button', { name: 'Refresh prices' })
    ).toBeDisabled()
    expect(busy).toHaveBeenLastCalledWith(true)

    await act(async () =>
      parentAction.reject(new Error('Cloud provider unavailable'))
    )
    await within(screen.getByRole('alert')).findByText(
      'Cloud provider unavailable'
    )
    expect(toolCalls()).toHaveLength(0)
    expect(parentCalls()).toHaveLength(1)
    expect(screen.getByRole('button', { name: label })).toBeEnabled()
    expect(checkTools).toBeEnabled()
    expect(prepareTools).toBeEnabled()
    expect(consent).toBeEnabled()
    expect(consent).toBeChecked()
    expect(busy).toHaveBeenLastCalledWith(false)

    fireEvent.click(screen.getByRole('button', { name: tool }))
    expect(toolCalls()).toEqual([
      [
        toolPath,
        {
          workspace_id: 'review',
          ...(toolPath.endsWith('/prepare') ? { consent: true } : {}),
        },
      ],
    ])
    expect(screen.getByRole('button', { name: toolProgress })).toBeDisabled()
    expect(
      screen.getByRole('button', { name: 'Check progress' })
    ).toBeDisabled()
    expect(
      screen.getByRole('button', { name: 'Delete cloud computer' })
    ).toBeDisabled()
    expect(
      screen.getByRole('button', { name: 'Refresh prices' })
    ).toBeDisabled()
    expect(consent).toBeDisabled()
    expect(busy).toHaveBeenLastCalledWith(true)
    await act(async () =>
      tools.resolve({ installed: true, command: null, issue: null })
    )
    await vi.waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Connect bot desktop' })
      ).toBeEnabled()
    )
    expect(screen.getByRole('button', { name: 'Check progress' })).toBeEnabled()
    expect(
      screen.getByRole('button', { name: 'Delete cloud computer' })
    ).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Refresh prices' })).toBeEnabled()
    expect(consent).toBeEnabled()
    expect(busy).toHaveBeenLastCalledWith(false)
    expect(parentCalls()).toHaveLength(1)
    expect(toolCalls()).toHaveLength(1)
  }
)

it('blocks child actions while cloud prices refresh, then permits an explicit provider check', async () => {
  const initial = deployment(review(), 'running')
  const refreshed = { ...initial, quote: null, confirmed: false }
  const prices = deferred<CloudReview>()
  const progress = deferred<CloudReview>()
  const busy = vi.fn()
  vi.mocked(gbot).mockImplementation(async (path) => {
    if (path === 'setup/cloud/catalog') return prices.promise
    if (path === 'setup/cloud/check') return progress.promise
    return initial
  })
  render(
    <CloudCosts
      name="Research bot"
      initial={initial}
      busy={busy}
      reviewed={vi.fn()}
    />
  )
  const consent = screen.getByRole('checkbox', { name: /Delete this setup/ })
  fireEvent.click(consent)
  const refresh = screen.getByRole('button', { name: 'Refresh prices' })
  const check = screen.getByRole('button', { name: 'Check progress' })
  const remove = screen.getByRole('button', { name: 'Delete cloud computer' })
  expect(check).toBeEnabled()
  expect(remove).toBeEnabled()

  act(() => {
    refresh.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    check.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    remove.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    refresh.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
  expect(gbot).toHaveBeenCalledExactlyOnceWith('setup/cloud/catalog', {
    id: 'review',
    name: 'Research bot',
    provider: 'hetzner',
  })
  expect(screen.getByRole('button', { name: 'Loading prices…' })).toBeDisabled()
  expect(check).toBeDisabled()
  expect(remove).toBeDisabled()
  expect(consent).toBeDisabled()
  expect(consent).toBeChecked()
  expect(busy).toHaveBeenLastCalledWith(true)
  fireEvent.click(check)
  fireEvent.click(remove)
  expect(gbot).toHaveBeenCalledTimes(1)

  await act(async () => prices.resolve(refreshed))
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  expect(check).toBeEnabled()
  expect(remove).toBeEnabled()
  expect(consent).toBeEnabled()
  expect(consent).toBeChecked()
  expect(screen.getByText(/Computer running/)).toBeVisible()
  expect(screen.queryByText('Estimated cost')).not.toBeInTheDocument()
  expect(busy).toHaveBeenLastCalledWith(false)
  expect(gbot).toHaveBeenCalledTimes(1)

  act(() => {
    check.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    check.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    remove.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    refresh.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
  expect(gbot).toHaveBeenCalledTimes(2)
  expect(gbot).toHaveBeenLastCalledWith('setup/cloud/check', { id: 'review' })
  expect(
    screen.getByRole('button', { name: 'Checking cloud computer…' })
  ).toBeDisabled()
  expect(remove).toBeDisabled()
  expect(screen.getByRole('button', { name: 'Refresh prices' })).toBeDisabled()
  expect(busy).toHaveBeenLastCalledWith(true)
  await act(async () => progress.resolve(refreshed))
  expect(screen.getByRole('button', { name: 'Check progress' })).toBeEnabled()
  expect(remove).toBeEnabled()
  expect(screen.getByRole('button', { name: 'Refresh prices' })).toBeEnabled()
  expect(busy).toHaveBeenLastCalledWith(false)
  expect(gbot).toHaveBeenCalledTimes(2)
})

it('blocks child actions while cloud prices refresh, then permits explicit authenticated tool preparation after failure', async () => {
  const initial = deployment(review(), 'running')
  const prices = deferred<CloudReview>()
  const tools = deferred<object>()
  const busy = vi.fn()
  vi.mocked(gbot).mockImplementation(async (path) => {
    if (path === 'setup/cloud/identity')
      return {
        public_key: { algorithm: 'ssh-ed25519', public_key: 'fixture-key' },
        fingerprint: 'SHA256:fixture',
      }
    if (path === 'setup/cloud/catalog') return prices.promise
    if (path === 'workspaces/ssh/tools' || path === 'workspaces/ssh/prepare')
      return tools.promise
    return {}
  })
  render(
    <CloudCosts
      name="Research bot"
      initial={initial}
      busy={busy}
      reviewed={vi.fn()}
    />
  )
  fireEvent.click(screen.getByRole('button', { name: 'Check SSH identity' }))
  await screen.findByText('SHA256:fixture')
  fireEvent.click(screen.getByRole('checkbox', { name: /fingerprint matches/ }))
  fireEvent.click(screen.getByRole('button', { name: 'Verify SSH access' }))
  const check = await screen.findByRole('button', { name: 'Check tools' })
  const consent = screen.getByRole('checkbox', { name: /dedicated to Gbot/ })
  fireEvent.click(consent)
  const prepare = screen.getByRole('button', { name: 'Prepare tools' })
  const refresh = screen.getByRole('button', { name: 'Refresh prices' })
  const toolCalls = () =>
    vi
      .mocked(gbot)
      .mock.calls.filter(([path]) =>
        ['workspaces/ssh/tools', 'workspaces/ssh/prepare'].includes(path)
      )
  expect(prepare).toBeEnabled()
  act(() => {
    refresh.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    check.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    prepare.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    refresh.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
  expect(toolCalls()).toHaveLength(0)
  expect(gbot).toHaveBeenCalledTimes(4)
  expect(gbot).toHaveBeenLastCalledWith('setup/cloud/catalog', {
    id: 'review',
    name: 'Research bot',
    provider: 'hetzner',
  })
  expect(screen.getByRole('button', { name: 'Loading prices…' })).toBeDisabled()
  expect(check).toBeDisabled()
  expect(prepare).toBeDisabled()
  expect(consent).toBeDisabled()
  expect(consent).toBeChecked()
  expect(
    screen.getByRole('button', { name: 'Connect bot desktop' })
  ).toBeDisabled()
  expect(busy).toHaveBeenLastCalledWith(true)
  fireEvent.click(check)
  fireEvent.click(prepare)
  expect(toolCalls()).toHaveLength(0)

  await act(async () =>
    prices.reject(new Error('Prices temporarily unavailable'))
  )
  expect(screen.getByRole('alert')).toHaveTextContent(
    'Prices temporarily unavailable'
  )
  expect(check).toBeEnabled()
  expect(prepare).toBeEnabled()
  expect(consent).toBeEnabled()
  expect(consent).toBeChecked()
  expect(screen.getByText('SHA256:fixture')).toBeVisible()
  expect(busy).toHaveBeenLastCalledWith(false)
  expect(gbot).toHaveBeenCalledTimes(4)
  expect(toolCalls()).toHaveLength(0)

  act(() => {
    prepare.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    prepare.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    check.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    refresh.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
  expect(toolCalls()).toEqual([
    ['workspaces/ssh/prepare', { workspace_id: 'review', consent: true }],
  ])
  expect(
    screen.getByRole('button', { name: 'Preparing tools…' })
  ).toBeDisabled()
  expect(screen.getByRole('button', { name: 'Check progress' })).toBeDisabled()
  expect(screen.getByRole('button', { name: 'Refresh prices' })).toBeDisabled()
  expect(consent).toBeDisabled()
  expect(busy).toHaveBeenLastCalledWith(true)
  await act(async () =>
    tools.resolve({ installed: true, command: null, issue: null })
  )
  expect(
    screen.getByRole('button', { name: 'Connect bot desktop' })
  ).toBeEnabled()
  expect(screen.getByRole('button', { name: 'Check progress' })).toBeEnabled()
  expect(screen.getByRole('button', { name: 'Refresh prices' })).toBeEnabled()
  expect(consent).toBeEnabled()
  expect(busy).toHaveBeenLastCalledWith(false)
  expect(toolCalls()).toHaveLength(1)
  expect(gbot).toHaveBeenCalledTimes(5)
})

it.each(['successful', 'failed'] as const)(
  'keeps failed deletion guidance through a %s progress check',
  async (outcome) => {
    const initial = deployment(review(), 'running')
    const progress = deferred<CloudReview>()
    const retry = deferred<CloudReview>()
    const busy = vi.fn()
    vi.mocked(gbot)
      .mockRejectedValueOnce(new Error('Deletion result unavailable'))
      .mockReturnValueOnce(progress.promise)
    render(
      <CloudCosts
        name="Research bot"
        initial={initial}
        busy={busy}
        reviewed={vi.fn()}
      />
    )
    const consent = screen.getByRole('checkbox', { name: /Delete this setup/ })
    fireEvent.click(consent)
    fireEvent.click(
      screen.getByRole('button', { name: 'Delete cloud computer' })
    )
    await screen.findByText('Deletion result unavailable')
    fireEvent.click(screen.getByRole('button', { name: 'Check progress' }))
    expect(screen.getByText('Deletion result unavailable')).toBeInTheDocument()
    const warning = screen
      .getByText(
        'Could not confirm the cloud computer was deleted. Provider charges may continue. Choose Check progress to check its state before trying Delete cloud computer again.'
      )
      .closest('[role="alert"]')!
    expect(
      within(warning as HTMLElement)
        .getByText('Deletion result unavailable')
        .closest('details')
    ).not.toHaveAttribute('open')
    expect(
      screen.queryByText('Deletion result unavailable', {
        selector: 'details[open] p',
      })
    ).not.toBeInTheDocument()
    fireEvent.click(
      within(warning as HTMLElement).getByText('Details', {
        selector: 'summary',
      })
    )
    expect(screen.getByText('Deletion result unavailable')).toBeVisible()
    expect(gbot).toHaveBeenCalledTimes(2)
    expect(consent).toBeChecked()
    expect(consent).toBeDisabled()
    expect(
      screen.getByRole('button', { name: 'Delete cloud computer' })
    ).toBeDisabled()
    expect(busy).toHaveBeenLastCalledWith(true)
    if (outcome === 'failed') {
      await act(async () =>
        progress.reject(new Error('Progress status unavailable'))
      )
      const checkWarning = screen
        .getByText(
          'Could not check the cloud computer. Choose Check progress to try again.'
        )
        .closest('[role="alert"]')!
      expect(
        within(checkWarning as HTMLElement)
          .getByText('Progress status unavailable')
          .closest('details')
      ).not.toHaveAttribute('open')
      expect(
        screen.getByText('Deletion result unavailable')
      ).toBeInTheDocument()
      vi.mocked(gbot).mockResolvedValueOnce(initial)
      fireEvent.click(screen.getByRole('button', { name: 'Check progress' }))
      await vi.waitFor(() =>
        expect(
          screen.getByRole('button', { name: 'Check progress' })
        ).toBeEnabled()
      )
      expect(
        screen.queryByText('Progress status unavailable')
      ).not.toBeInTheDocument()
    } else {
      await act(async () => progress.resolve(initial))
    }
    expect(screen.getByText('Deletion result unavailable')).toBeInTheDocument()
    expect(consent).toBeChecked()
    expect(busy).toHaveBeenLastCalledWith(false)
    expect(
      vi
        .mocked(gbot)
        .mock.calls.filter(([path]) => path === 'setup/cloud/delete')
    ).toEqual([['setup/cloud/delete', { id: 'review', consent: true }]])
    vi.mocked(gbot).mockReturnValueOnce(retry.promise)
    const remove = screen.getByRole('button', { name: 'Delete cloud computer' })
    fireEvent.click(remove)
    fireEvent.click(remove)
    expect(
      screen.queryByText('Deletion result unavailable')
    ).not.toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Deleting cloud computer…' })
    ).toBeDisabled()
    expect(
      screen.getByRole('button', { name: 'Check progress' })
    ).toBeDisabled()
    expect(
      vi
        .mocked(gbot)
        .mock.calls.filter(([path]) => path === 'setup/cloud/delete')
    ).toEqual([
      ['setup/cloud/delete', { id: 'review', consent: true }],
      ['setup/cloud/delete', { id: 'review', consent: true }],
    ])
    await act(async () =>
      retry.resolve({
        ...initial,
        deployment: { ...initial.deployment!, phase: 'deleted', resources: [] },
      })
    )
    await screen.findByText('Computer and owned provider resources deleted.')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  }
)

it('clears an uncertain deletion warning only when progress confirms deletion', async () => {
  const initial = deployment(review(), 'running')
  const progress = deferred<CloudReview>()
  vi.mocked(gbot)
    .mockRejectedValueOnce('Deletion reply interrupted')
    .mockReturnValueOnce(progress.promise)
  render(
    <CloudCosts
      name="Research bot"
      initial={initial}
      busy={vi.fn()}
      reviewed={vi.fn()}
    />
  )
  fireEvent.click(screen.getByRole('checkbox', { name: /Delete this setup/ }))
  fireEvent.click(screen.getByRole('button', { name: 'Delete cloud computer' }))
  await screen.findByText('Deletion reply interrupted')
  fireEvent.click(screen.getByRole('button', { name: 'Check progress' }))
  expect(screen.getByText('Deletion reply interrupted')).toBeInTheDocument()
  await act(async () =>
    progress.resolve({
      ...initial,
      deployment: { ...initial.deployment!, phase: 'deleted', resources: [] },
    })
  )
  await screen.findByText('Computer and owned provider resources deleted.')
  expect(
    screen.queryByText('Deletion reply interrupted')
  ).not.toBeInTheDocument()
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  expect(
    screen.queryByRole('button', { name: 'Delete cloud computer' })
  ).not.toBeInTheDocument()
  expect(
    screen.getByRole('checkbox', { name: /I authorize creating this computer/ })
  ).not.toBeChecked()
  expect(
    screen.getByRole('button', { name: 'Create cloud computer' })
  ).toBeDisabled()
  expect(vi.mocked(gbot).mock.calls).toEqual([
    ['setup/cloud/delete', { id: 'review', consent: true }],
    ['setup/cloud/check', { id: 'review' }],
  ])
})

it.each(['create', 'identity'] as const)(
  'gives plain cloud %s recovery and preserves entries for an explicit retry',
  async (kind) => {
    const initial =
      kind === 'create'
        ? { ...review(), confirmed: true }
        : deployment(review(), 'running')
    const retry = deferred<unknown>()
    const label =
      kind === 'create' ? 'Create cloud computer' : 'Check SSH identity'
    const guidance =
      kind === 'create'
        ? 'Could not confirm the cloud computer was created. Cancel setup, then use Resume setup in the computer list to check its saved state before trying to create it again.'
        : 'Could not check the SSH identity. Choose Check SSH identity to try again.'
    vi.mocked(gbot).mockRejectedValueOnce('Cloud action unavailable')
    render(
      <CloudCosts
        name="Research bot"
        initial={initial}
        busy={vi.fn()}
        reviewed={vi.fn()}
      />
    )
    if (kind === 'create') {
      fireEvent.change(screen.getByLabelText('Allowed SSH source networks'), {
        target: { value: '203.0.113.9/32' },
      })
      fireEvent.click(
        screen.getByRole('checkbox', {
          name: /I authorize creating this computer/,
        })
      )
    }
    fireEvent.click(screen.getByRole('button', { name: label }))
    await screen.findByText(guidance)
    const warning = screen.getByRole('alert')
    expect(
      within(warning).getByText('Cloud action unavailable').closest('details')
    ).not.toHaveAttribute('open')
    fireEvent.click(
      within(warning).getByText('Details', { selector: 'summary' })
    )
    expect(screen.getByText('Cloud action unavailable')).toBeVisible()
    expect(gbot).toHaveBeenCalledTimes(1)
    if (kind === 'create') {
      expect(screen.getByLabelText('Allowed SSH source networks')).toHaveValue(
        '203.0.113.9/32'
      )
      expect(
        screen.getByRole('checkbox', {
          name: /I authorize creating this computer/,
        })
      ).toBeChecked()
    } else {
      expect(
        screen.queryByRole('button', { name: 'Verify SSH access' })
      ).not.toBeInTheDocument()
      expect(
        screen.getByRole('button', { name: 'Connect bot desktop' })
      ).toBeDisabled()
    }
    vi.mocked(gbot).mockReturnValueOnce(retry.promise)
    const action = screen.getByRole('button', { name: label })
    fireEvent.click(action)
    fireEvent.click(action)
    expect(
      screen.queryByText('Cloud action unavailable')
    ).not.toBeInTheDocument()
    expect(gbot).toHaveBeenCalledTimes(2)
    expect(gbot).toHaveBeenLastCalledWith(`setup/cloud/${kind}`, {
      id: 'review',
      ...(kind === 'create'
        ? { quote_id: 'quote', consent: true, source_cidrs: ['203.0.113.9/32'] }
        : {}),
    })
    await act(async () =>
      retry.resolve(
        kind === 'create'
          ? deployment(initial)
          : {
              public_key: {
                algorithm: 'ssh-ed25519',
                public_key: 'fixture-key',
              },
              fingerprint: 'SHA256:fixture',
            }
      )
    )
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  }
)

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import CloudCosts from './CloudCosts'
import { gbot, type CloudReview } from '@/services/gbot'

vi.mock('@/services/gbot', () => ({ gbot: vi.fn() }))
afterEach(() => {
  cleanup()
  vi.resetAllMocks()
})
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
  const reviewed = vi.fn().mockResolvedValue(undefined)
  vi.mocked(gbot).mockResolvedValueOnce({ ...initial, confirmed: true })
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
  fireEvent.click(screen.getByRole('button', { name: 'Save cost review' }))
  await screen.findByText('Cost review saved. No VM has been created.')
  expect(gbot).toHaveBeenCalledExactlyOnceWith('setup/cloud/confirm', {
    id: 'review',
    quote_id: 'quote',
  })
  expect(reviewed).toHaveBeenCalledOnce()
  expect(screen.getByLabelText('Provider API token')).toHaveValue('')
})

it('clears entered tokens and withholds an old quote after a failed price refresh', async () => {
  vi.mocked(gbot).mockRejectedValueOnce(
    new Error('Provider rate limit reached')
  )
  render(
    <CloudCosts
      name="Research bot"
      initial={review()}
      busy={vi.fn()}
      reviewed={vi.fn()}
    />
  )
  fireEvent.change(screen.getByLabelText('Provider API token'), {
    target: { value: 'fixture-secret' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Refresh prices' }))
  await screen.findByRole('alert')
  expect(screen.getByLabelText('Provider API token')).toHaveValue('')
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

function deployment(initial: CloudReview, phase: 'creating' | 'running' | 'check_required' = 'creating'): CloudReview {
  return { ...initial, confirmed: true, deployment: {
    phase,
    plan: initial.quote!.plan,
    source_cidrs: ['203.0.113.10/32'],
    resources: [{ kind: 'server', id: '42', name: 'owned-bot', ready: phase === 'running', address: '203.0.113.7', actions: [] }],
    pending: null,
    issue: null,
  } }
}

it('creates only after separate billing consent with the reviewed quote and explicit SSH sources', async () => {
  const initial = { ...review(), confirmed: true }
  vi.mocked(gbot).mockResolvedValueOnce(deployment(initial))
  render(<CloudCosts name="Research bot" initial={initial} busy={vi.fn()} reviewed={vi.fn()} />)
  expect(gbot).not.toHaveBeenCalled()
  const create = screen.getByRole('button', { name: 'Create cloud computer' })
  expect(create).toBeDisabled()
  fireEvent.change(screen.getByLabelText('Allowed SSH source networks'), { target: { value: '203.0.113.10/32\n2001:db8::1/128' } })
  expect(create).toBeDisabled()
  fireEvent.click(screen.getByRole('checkbox', { name: /authorize creating/ }))
  fireEvent.click(create)
  await screen.findByText(/Computer creating/)
  expect(gbot).toHaveBeenCalledExactlyOnceWith('setup/cloud/create', {
    id: 'review', quote_id: 'quote', consent: true, source_cidrs: ['203.0.113.10/32', '2001:db8::1/128'],
  })
  expect(screen.queryByRole('button', { name: 'Connect bot desktop' })).not.toBeInTheDocument()
})

it('keeps recovery and consented deletion available after quote expiry', async () => {
  const initial = deployment(review(), 'check_required')
  initial.expires_at = 1
  initial.deployment!.issue = 'Provider reply lost; checking before another create.'
  vi.mocked(gbot).mockResolvedValueOnce(initial).mockResolvedValueOnce({ ...initial, deployment: { ...initial.deployment!, phase: 'deleted', resources: [] } })
  render(<CloudCosts name="Research bot" initial={initial} busy={vi.fn()} reviewed={vi.fn()} />)
  fireEvent.click(screen.getByRole('button', { name: 'Check progress' }))
  await vi.waitFor(() => expect(gbot).toHaveBeenCalledExactlyOnceWith('setup/cloud/check', { id: 'review' }))
  await vi.waitFor(() => expect(screen.getByRole('button', { name: 'Check progress' })).toBeEnabled())
  const remove = screen.getByRole('button', { name: 'Delete cloud computer' })
  expect(remove).toBeDisabled()
  fireEvent.click(screen.getByRole('checkbox', { name: /Delete this setup/ }))
  fireEvent.click(remove)
  await screen.findByText('Computer and owned provider resources deleted.')
  expect(gbot).toHaveBeenLastCalledWith('setup/cloud/delete', { id: 'review', consent: true })
  expect(screen.getByRole('button', { name: 'Create cloud computer' })).toBeDisabled()
})

it('requires verified SSH, installed tools and a successful desktop connection before completing setup', async () => {
  const initial = deployment(review(), 'running')
  const identity = { public_key: { algorithm: 'ssh-ed25519', public_key: 'fixture-key' }, fingerprint: 'SHA256:fixture' }
  const connected = vi.fn().mockResolvedValue(undefined)
  vi.mocked(gbot).mockImplementation(async (path) => {
    if (path === 'setup/cloud/identity') return identity
    if (path === 'workspaces/ssh/tools') return { installed: true, command: null, issue: null }
    return {}
  })
  render(<CloudCosts name="Research bot" initial={initial} busy={vi.fn()} reviewed={vi.fn()} connected={connected} />)
  const connect = screen.getByRole('button', { name: 'Connect bot desktop' })
  expect(connect).toBeDisabled()
  fireEvent.click(screen.getByRole('button', { name: 'Check SSH identity' }))
  await screen.findByText('SHA256:fixture')
  expect(screen.getByRole('button', { name: 'Verify SSH access' })).toBeDisabled()
  fireEvent.click(screen.getByRole('checkbox', { name: /fingerprint matches/ }))
  fireEvent.click(screen.getByRole('button', { name: 'Verify SSH access' }))
  await screen.findByRole('button', { name: 'Check tools' })
  expect(gbot).toHaveBeenCalledWith('setup/cloud/attach', { id: 'review', pinned_host_key: identity.public_key, verified: true })
  expect(gbot).toHaveBeenCalledWith('workspaces/ssh/check', { workspace_id: 'review' })
  expect(connect).toBeDisabled()
  fireEvent.click(screen.getByRole('button', { name: 'Check tools' }))
  await vi.waitFor(() => expect(connect).toBeEnabled())
  expect(connected).not.toHaveBeenCalled()
  vi.mocked(gbot).mockRejectedValueOnce(new Error('Desktop not ready'))
  fireEvent.click(connect)
  await screen.findByText('Desktop not ready')
  expect(connected).not.toHaveBeenCalled()
  fireEvent.click(connect)
  await vi.waitFor(() => expect(connected).toHaveBeenCalledWith('review'))
  expect(gbot).toHaveBeenLastCalledWith('connect', { workspace_id: 'review', session_id: expect.any(String) })
})

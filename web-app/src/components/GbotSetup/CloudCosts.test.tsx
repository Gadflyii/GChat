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

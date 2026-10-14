import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import ServiceSetup from './ServiceSetup'
import { EngineGbotControl } from '@/containers/EngineGbotControl'
import { gbotControlGrant } from '@/services/gbot'

const refresh = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))
vi.mock('@/stores/engine-hosts-store', () => ({
  useEngineHosts: (select: (state: unknown) => unknown) =>
    select({
      hosts: [
        { host_id: 'online', name: 'Service PC', local: false },
        { host_id: 'offline', name: 'Offline PC', local: false },
        { host_id: 'local', name: 'This PC', local: true },
      ],
      errors: { offline: 'unavailable' },
      refresh,
    }),
}))
vi.mock('@/services/gbot', () => ({ gbotControlGrant: vi.fn() }))
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.clearAllMocks()
})

it('requires approved and configured service control before continuing', async () => {
  vi.mocked(gbotControlGrant).mockResolvedValue({
    status: 'not_requested',
    service_configured: true,
  })
  const change = vi.fn()
  render(
    <ServiceSetup
      target={{ kind: 'paired_host', host_id: 'online' }}
      change={change}
    />
  )
  await screen.findByText('Gbot control needs separate approval from pairing.')
  expect(change).toHaveBeenLastCalledWith(
    { kind: 'paired_host', host_id: 'online' },
    false
  )
  expect(
    screen.getByRole('option', { name: 'Offline PC · Offline' })
  ).toBeDisabled()
  expect(
    screen.queryByRole('option', { name: 'This PC' })
  ).not.toBeInTheDocument()
  vi.mocked(gbotControlGrant).mockResolvedValue({
    status: 'pending',
    service_configured: true,
  })
  fireEvent.click(screen.getByRole('button', { name: 'Request Gbot control' }))
  await screen.findByText('Waiting for approval on the service computer.')
  expect(gbotControlGrant).toHaveBeenLastCalledWith('online', 'request')
  vi.mocked(gbotControlGrant).mockResolvedValue({
    status: 'approved',
    service_configured: false,
  })
  fireEvent.click(screen.getByRole('button', { name: 'Check approval' }))
  await screen.findByText(/Enable and open Gbot once/)
  expect(change).toHaveBeenLastCalledWith(
    { kind: 'paired_host', host_id: 'online' },
    false
  )
  vi.mocked(gbotControlGrant).mockResolvedValue({
    status: 'approved',
    service_configured: true,
  })
  fireEvent.click(screen.getByRole('button', { name: 'Check approval' }))
  await waitFor(() =>
    expect(change).toHaveBeenLastCalledWith(
      { kind: 'paired_host', host_id: 'online' },
      true
    )
  )
})

it('asks the owner to confirm each device approval and revocation', async () => {
  const change = vi.fn().mockResolvedValue(true)
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
  const clients = [
    {
      client_id: 'requested',
      name: 'Laptop',
      local: false,
      gbot_control: { status: 'pending' as const },
    },
    {
      client_id: 'approved',
      name: 'Desk',
      local: false,
      gbot_control: { status: 'approved' as const },
    },
  ]
  render(
    <EngineGbotControl clients={clients} disabled={false} change={change} />
  )
  fireEvent.click(
    screen.getByRole('button', { name: 'Approve Gbot control for Laptop' })
  )
  expect(change).not.toHaveBeenCalled()
  confirm.mockReturnValue(true)
  fireEvent.click(
    screen.getByRole('button', { name: 'Approve Gbot control for Laptop' })
  )
  expect(change).toHaveBeenLastCalledWith('requested', 'approve')
  fireEvent.click(
    screen.getByRole('button', { name: 'Revoke Gbot control for Desk' })
  )
  expect(confirm).toHaveBeenLastCalledWith(
    expect.stringContaining('Running bot tasks continue')
  )
  expect(change).toHaveBeenLastCalledWith('approved', 'revoke')
})

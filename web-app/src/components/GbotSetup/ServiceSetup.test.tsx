import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import ServiceSetup from './ServiceSetup'
import { EngineGbotControl } from '@/containers/EngineGbotControl'
import { gbotControlGrant, type GbotControlGrant } from '@/services/gbot'

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
beforeEach(() => {
  refresh.mockResolvedValue(undefined)
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.clearAllMocks()
})

function pendingGrant() {
  let resolve!: (value: GbotControlGrant) => void
  let reject!: (cause: Error) => void
  const promise = new Promise<GbotControlGrant>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}

const approvedGrant = {
  status: 'approved',
  service_configured: true,
} satisfies GbotControlGrant

it.each(['success', 'failure'])(
  'shows the automatic approval check until %s without claiming approval is needed',
  async (outcome) => {
    const initial = pendingGrant()
    vi.mocked(gbotControlGrant).mockReturnValueOnce(initial.promise)
    render(
      <ServiceSetup
        target={{ kind: 'paired_host', host_id: 'online' }}
        change={vi.fn()}
      />
    )
    expect(screen.getByRole('status')).toHaveTextContent(
      'Checking Gbot control approval…'
    )
    expect(
      screen.queryByText('Gbot control needs separate approval from pairing.')
    ).not.toBeInTheDocument()
    await act(async () => {
      if (outcome === 'success') initial.resolve(approvedGrant)
      else initial.reject(new Error('Service computer unavailable'))
    })
    expect(screen.getByRole('status')).toHaveTextContent(
      outcome === 'success'
        ? 'Gbot control approved for this device.'
        : 'Could not confirm Gbot control approval. Try again.'
    )
  }
)

it.each([
  {
    status: 'not_requested' as const,
    action: 'request',
    label: 'Request Gbot control',
    pendingLabel: 'Requesting control…',
    progress: 'Requesting Gbot control from the service computer…',
  },
  {
    status: 'pending' as const,
    action: 'status',
    label: 'Check approval',
    pendingLabel: 'Checking approval…',
    progress: 'Checking Gbot control approval…',
  },
])(
  'reports $action progress, prevents duplicate requests and allows retry',
  async ({ status, action, label, pendingLabel, progress }) => {
    const pending = pendingGrant()
    vi.mocked(gbotControlGrant)
      .mockResolvedValueOnce({ status, service_configured: true })
      .mockReturnValueOnce(pending.promise)
      .mockResolvedValueOnce(approvedGrant)
    const change = vi.fn()
    render(
      <ServiceSetup
        target={{ kind: 'paired_host', host_id: 'online' }}
        change={change}
      />
    )
    await waitFor(() => expect(change).toHaveBeenCalledTimes(1))
    change.mockClear()
    const button = screen.getByRole('button', { name: label })
    act(() => {
      button.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      button.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(gbotControlGrant).toHaveBeenCalledTimes(2)
    expect(gbotControlGrant).toHaveBeenLastCalledWith('online', action)
    expect(screen.getByRole('status')).toHaveTextContent(progress)
    expect(screen.getByRole('button', { name: pendingLabel })).toBeDisabled()
    expect(screen.getByRole('combobox')).toBeDisabled()
    await act(async () =>
      pending.reject(new Error('Service computer unavailable'))
    )
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Service computer unavailable'
    )
    expect(screen.getByRole('combobox')).toHaveValue('online')
    expect(change).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: label }))
    await screen.findByText('Gbot control approved for this device.')
    expect(gbotControlGrant).toHaveBeenCalledTimes(3)
    expect(change).toHaveBeenCalledExactlyOnceWith(
      { kind: 'paired_host', host_id: 'online' },
      true
    )
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  }
)

it('ignores a pending approval after leaving the service step', async () => {
  const pending = pendingGrant()
  vi.mocked(gbotControlGrant)
    .mockResolvedValueOnce(approvedGrant)
    .mockReturnValueOnce(pending.promise)
  const change = vi.fn()
  const view = render(
    <ServiceSetup
      target={{ kind: 'paired_host', host_id: 'online' }}
      change={change}
    />
  )
  await screen.findByText('Gbot control approved for this device.')
  fireEvent.click(screen.getByRole('button', { name: 'Check approval' }))
  expect(gbotControlGrant).toHaveBeenLastCalledWith('online', 'status')
  view.unmount()
  change.mockClear()
  await act(async () => pending.resolve(approvedGrant))
  expect(change).not.toHaveBeenCalled()
})

it.each(['success', 'failure'])(
  'keeps the newly selected local service after a previous approval %s',
  async (outcome) => {
    const pending = pendingGrant()
    vi.mocked(gbotControlGrant)
      .mockResolvedValueOnce(approvedGrant)
      .mockReturnValueOnce(pending.promise)
    const change = vi.fn()
    const view = render(
      <ServiceSetup
        target={{ kind: 'paired_host', host_id: 'online' }}
        change={change}
      />
    )
    await screen.findByText('Gbot control approved for this device.')
    fireEvent.click(screen.getByRole('button', { name: 'Check approval' }))
    view.rerender(<ServiceSetup target={{ kind: 'local' }} change={change} />)
    change.mockClear()
    await act(async () => {
      if (outcome === 'success') pending.resolve(approvedGrant)
      else pending.reject(new Error('Old approval request failed'))
    })
    expect(change).not.toHaveBeenCalled()
    expect(
      screen.getByRole('radio', { name: 'This PC (recommended)' })
    ).toBeChecked()
    expect(
      screen.getByRole('radio', {
        name: 'Another PC on the home or office network (LAN)',
      })
    ).toBeEnabled()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  }
)

it('does not let an older automatic status replace a newer approval request', async () => {
  const initial = pendingGrant()
  vi.mocked(gbotControlGrant)
    .mockReturnValueOnce(initial.promise)
    .mockResolvedValueOnce(approvedGrant)
  const change = vi.fn()
  render(
    <ServiceSetup
      target={{ kind: 'paired_host', host_id: 'online' }}
      change={change}
    />
  )
  fireEvent.click(screen.getByRole('button', { name: 'Request Gbot control' }))
  await screen.findByText('Gbot control approved for this device.')
  expect(change).toHaveBeenCalledExactlyOnceWith(
    { kind: 'paired_host', host_id: 'online' },
    true
  )
  await act(async () =>
    initial.resolve({ status: 'not_requested', service_configured: true })
  )
  expect(change).toHaveBeenCalledTimes(1)
  expect(
    screen.getByText('Gbot control approved for this device.')
  ).toBeVisible()
  expect(screen.getByRole('button', { name: 'Check approval' })).toBeEnabled()
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

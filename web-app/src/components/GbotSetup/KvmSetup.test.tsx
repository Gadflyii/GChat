import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import KvmSetup from './KvmSetup'
const { call, events } = vi.hoisted(() => ({
  call: vi.fn(),
  events: { update: null as null | (() => void) },
}))
vi.mock('@/services/gbot', () => ({ gbot: call }))
vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn((_event, callback) => {
    events.update = callback
    return Promise.resolve(vi.fn())
  }),
}))
afterEach(() => {
  cleanup()
  call.mockReset()
  events.update = null
})
it('shows exact missing asset action and refuses creation without falling back to LAN', async () => {
  call.mockImplementation((path) =>
    Promise.resolve(
      path.endsWith('preflight')
        ? {
            ready: false,
            issues: [
              {
                code: 'asset_missing',
                message: 'Approved guest image is missing.',
                next_action:
                  'Stage the accepted image at /data/vms/assets/image.qcow2 and retry.',
              },
            ],
          }
        : []
    )
  )
  render(<KvmSetup name="Writer" connected={vi.fn()} />)
  expect(
    await screen.findByText('Approved guest image is missing.')
  ).toBeInTheDocument()
  expect(screen.getByText(/Stage the accepted image at/)).toBeInTheDocument()
  expect(
    screen.getByRole('button', { name: 'Create Writer’s computer' })
  ).toBeDisabled()
  expect(call.mock.calls.some(([path]) => path.endsWith('/start'))).toBe(false)
})
it('creates only after confirmation, shows event progress and retries the same owned identity', async () => {
  let record: {
    id: string
    name: string
    stage: string
    issue: null | { code: string; message: string; next_action: string }
  } | null = null
  call.mockImplementation((path, body) => {
    if (path.endsWith('preflight'))
      return Promise.resolve({ ready: true, issues: [] })
    if (path.endsWith('status')) return Promise.resolve(record ? [record] : [])
    if (path.endsWith('start')) {
      record = {
        id: body.id,
        name: body.name,
        stage: 'preparing_computer',
        issue: null,
      }
      return Promise.resolve(record)
    }
    return Promise.resolve([])
  })
  render(<KvmSetup name="Writer" connected={vi.fn()} />)
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'Create Writer’s computer' })
    ).toBeEnabled()
  )
  expect(call.mock.calls.some(([path]) => path.endsWith('/start'))).toBe(false)
  fireEvent.click(
    screen.getByRole('button', { name: 'Create Writer’s computer' })
  )
  await screen.findByText(/Writer · Preparing the guest disk/)
  const first = call.mock.calls.find(([path]) => path.endsWith('/start'))?.[1]
  record = {
    ...first,
    stage: 'connecting',
    issue: {
      code: 'guest_not_ready',
      message: 'Cloud-init not ready.',
      next_action: 'Repair guest services and retry.',
    },
  }
  events.update?.()
  await screen.findByText('Cloud-init not ready.')
  fireEvent.click(screen.getByRole('button', { name: 'Resume setup' }))
  await waitFor(() =>
    expect(
      call.mock.calls.filter(([path]) => path.endsWith('/start'))
    ).toHaveLength(2)
  )
  expect(
    call.mock.calls.filter(([path]) => path.endsWith('/start'))[1][1]
  ).toEqual(first)
})

it('shows a pending recheck once and clears earlier readiness when it fails', async () => {
  let rejectCheck!: (reason: Error) => void
  const pendingCheck = new Promise((_, reject) => {
    rejectCheck = reject
  })
  let checks = 0
  call.mockImplementation((path) => {
    if (path.endsWith('preflight')) {
      checks += 1
      return checks === 2
        ? pendingCheck
        : Promise.resolve({ ready: true, issues: [] })
    }
    return Promise.resolve([])
  })
  render(<KvmSetup name="Writer" connected={vi.fn()} />)
  const create = screen.getByRole('button', {
    name: 'Create Writer’s computer',
  })
  await waitFor(() => expect(create).toBeEnabled())
  fireEvent.click(
    screen.getByRole('button', { name: 'Check prerequisites again' })
  )
  const checking = screen.getByRole('button', {
    name: 'Checking prerequisites…',
  })
  expect(checking).toBeDisabled()
  expect(screen.getByRole('status')).toHaveTextContent(
    'Checking local VM prerequisites…'
  )
  expect(create).toBeDisabled()
  fireEvent.click(checking)
  fireEvent.click(create)
  expect(checks).toBe(2)
  expect(call.mock.calls.some(([path]) => path.endsWith('/start'))).toBe(false)
  rejectCheck(new Error('The Gbot service is unavailable.'))
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'The Gbot service is unavailable.'
  )
  expect(create).toBeDisabled()
  expect(screen.queryByRole('status')).not.toBeInTheDocument()
  fireEvent.click(
    screen.getByRole('button', { name: 'Check prerequisites again' })
  )
  await waitFor(() => expect(create).toBeEnabled())
  expect(checks).toBe(3)
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
})

it('does not retain a successful preflight when refreshing saved setups fails', async () => {
  call.mockImplementation((path) =>
    path.endsWith('preflight')
      ? Promise.resolve({ ready: true, issues: [] })
      : Promise.reject(new Error('Saved setups could not be read.'))
  )
  render(<KvmSetup name="Writer" connected={vi.fn()} />)
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Saved setups could not be read.'
  )
  expect(
    screen.getByRole('button', { name: 'Create Writer’s computer' })
  ).toBeDisabled()
  expect(
    screen.getByRole('button', { name: 'Check prerequisites again' })
  ).toBeEnabled()
  expect(call.mock.calls.some(([path]) => path.endsWith('/start'))).toBe(false)
})

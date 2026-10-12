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

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { AgentWorkerPools } from '../AgentWorkerPools'
import type { StudioCatalog } from '@/services/agent/studio'

const mocks = vi.hoisted(() => ({
  command: vi.fn(),
  refresh: vi.fn(),
  toast: vi.fn(),
  catalog: {} as StudioCatalog,
}))
vi.mock('@/hooks/useStudioCatalog', () => ({
  useStudioCatalog: () => ({ catalog: mocks.catalog, refresh: mocks.refresh }),
}))
vi.mock('@/services/agent/studio', () => ({ studioCommand: mocks.command }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: mocks.toast } }))
afterEach(cleanup)
beforeEach(() => {
  vi.clearAllMocks()
  mocks.catalog = {
    pools: [
      {
        id: 'coder',
        name: 'coder',
        members: [{ instanceId: 'instance', workerLimit: 1 }],
      },
    ],
    instances: [
      { id: 'instance', modelId: 'Muse', hostName: 'Server', concurrency: 3 },
    ],
    usage: {},
    aliases: {},
    fleetTargets: [],
    fleetHosts: [
      { id: 'server', name: 'Server', origins: ['https://192.168.1.10:7443'] },
    ],
    availablePoolIds: [],
    fleet: {
      authorityId: 'server',
      connected: true,
      revision: 10,
      migrationIssues: [],
    },
  }
})

it('shows an unassigned shared pool and freezes the reviewed revision across polling and a failed save', async () => {
  const view = render(<AgentWorkerPools />)
  fireEvent.click(screen.getByRole('button', { name: /coder · not assigned/ }))
  fireEvent.change(screen.getByLabelText('Pool name'), {
    target: { value: 'My reviewed draft' },
  })
  mocks.catalog = {
    ...mocks.catalog,
    fleet: { ...mocks.catalog.fleet, revision: 11 },
  }
  view.rerender(<AgentWorkerPools />)
  mocks.command.mockRejectedValueOnce(new Error('409: fleet revision changed'))
  fireEvent.click(screen.getByRole('button', { name: 'Save pool' }))
  await waitFor(() =>
    expect(mocks.toast).toHaveBeenCalledWith(expect.stringContaining('409'))
  )
  expect(mocks.command).toHaveBeenCalledWith('save_pool', {
    expectedRevision: 10,
    pool: {
      id: 'coder',
      name: 'My reviewed draft',
      members: [{ instanceId: 'instance', workerLimit: 1 }],
    },
  })
  expect(screen.getByLabelText('Pool name')).toHaveValue('My reviewed draft')
})

it('keeps cached pools visible and draft edits intact while offline, without issuing mutations', () => {
  mocks.catalog.fleet.connected = false
  render(<AgentWorkerPools />)
  fireEvent.click(screen.getByRole('button', { name: /coder · not assigned/ }))
  fireEvent.change(screen.getByLabelText('Pool name'), {
    target: { value: 'Keep this draft' },
  })
  expect(screen.getByRole('button', { name: 'Create pool' })).toBeDisabled()
  expect(screen.getByRole('button', { name: 'Save pool' })).toBeDisabled()
  expect(screen.getByRole('button', { name: 'Delete pool' })).toBeDisabled()
  expect(screen.getByLabelText('Pool name')).toHaveValue('Keep this draft')
  expect(mocks.command).not.toHaveBeenCalled()
})

it('requires an explicit paired coordinator choice for a first pool', async () => {
  mocks.catalog.fleet = { connected: false, migrationIssues: [] }
  render(<AgentWorkerPools />)
  expect(screen.getByRole('button', { name: 'Create pool' })).toBeDisabled()
  expect(mocks.command).not.toHaveBeenCalled()
  fireEvent.change(screen.getByLabelText('Fleet coordinator'), {
    target: { value: 'server' },
  })
  fireEvent.click(
    screen.getByRole('button', { name: 'Use selected coordinator' })
  )
  await waitFor(() =>
    expect(mocks.command).toHaveBeenCalledWith('fleet_authority', {
      hostId: 'server',
    })
  )
  expect(mocks.refresh).toHaveBeenCalledOnce()
})

it('requires a reachable address when this computer has no advertised shared origin', async () => {
  mocks.catalog.fleet = { connected: false, migrationIssues: [] }
  mocks.catalog.fleetHosts = [
    { id: 'local', name: 'This computer', origins: [] },
  ]
  render(<AgentWorkerPools />)
  fireEvent.change(screen.getByLabelText('Fleet coordinator'), {
    target: { value: 'local' },
  })
  const use = screen.getByRole('button', { name: 'Use selected coordinator' })
  expect(use).toBeDisabled()
  expect(mocks.command).not.toHaveBeenCalled()
  fireEvent.change(screen.getByLabelText(/Coordinator address/), {
    target: { value: 'https://192.168.1.10:7443' },
  })
  fireEvent.click(use)
  await waitFor(() =>
    expect(mocks.command).toHaveBeenCalledWith('fleet_authority', {
      hostId: 'local',
      origin: 'https://192.168.1.10:7443',
    })
  )
})

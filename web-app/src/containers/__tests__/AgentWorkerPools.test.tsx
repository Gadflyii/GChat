import {
  act,
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
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: Error) => void
  const promise = new Promise<T>((done, fail) => {
    resolve = done
    reject = fail
  })
  return { promise, resolve, reject }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.command.mockReset()
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

it('keeps the reviewed pool frozen and sends one save while saving', async () => {
  const saving = deferred<unknown>()
  mocks.command.mockReturnValueOnce(saving.promise)
  mocks.catalog.pools.push({ id: 'reviewer', name: 'reviewer', members: [] })
  render(<AgentWorkerPools />)
  fireEvent.click(screen.getByRole('button', { name: /coder · not assigned/ }))
  fireEvent.change(screen.getByLabelText('Pool name'), {
    target: { value: 'Reviewed pool' },
  })
  fireEvent.change(screen.getByLabelText('Worker limit'), {
    target: { value: '2' },
  })
  const save = screen.getByRole('button', { name: 'Save pool' })

  act(() => {
    fireEvent.click(save)
    fireEvent.click(save)
  })

  expect(screen.getByRole('button', { name: 'Saving…' })).toBeDisabled()
  expect(screen.getByLabelText('Pool name')).toBeDisabled()
  expect(screen.getByLabelText('Worker limit')).toBeDisabled()
  expect(screen.getByRole('checkbox')).toBeDisabled()
  expect(screen.getByRole('button', { name: 'Create pool' })).toBeDisabled()
  const otherPool = screen.getByRole('button', {
    name: /reviewer · not assigned/,
  })
  expect(otherPool).toBeDisabled()
  fireEvent.click(otherPool)
  fireEvent.click(screen.getByRole('button', { name: 'Create pool' }))
  expect(screen.getByLabelText('Pool name')).toHaveValue('Reviewed pool')
  expect(screen.getByLabelText('Worker limit')).toHaveValue(2)
  expect(mocks.command).toHaveBeenCalledOnce()
  expect(mocks.command).toHaveBeenCalledWith('save_pool', {
    expectedRevision: 10,
    pool: {
      id: 'coder',
      name: 'Reviewed pool',
      members: [{ instanceId: 'instance', workerLimit: 2 }],
    },
  })

  await act(async () => {
    saving.resolve(mocks.catalog.pools[0])
    await saving.promise
  })

  expect(screen.queryByLabelText('Pool name')).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Create pool' })).toBeEnabled()
})

it('retains the reviewed draft after a failed save and allows retry', async () => {
  const saving = deferred<unknown>()
  mocks.command.mockReturnValueOnce(saving.promise)
  render(<AgentWorkerPools />)
  fireEvent.click(screen.getByRole('button', { name: /coder · not assigned/ }))
  fireEvent.change(screen.getByLabelText('Pool name'), {
    target: { value: 'Keep this reviewed draft' },
  })
  fireEvent.change(screen.getByLabelText('Worker limit'), {
    target: { value: '2' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Save pool' }))

  await act(async () => {
    saving.reject(new Error('Coordinator unavailable'))
    await saving.promise.catch(() => undefined)
  })

  expect(mocks.toast).toHaveBeenCalledWith('Error: Coordinator unavailable')
  expect(screen.getByLabelText('Pool name')).toHaveValue(
    'Keep this reviewed draft'
  )
  expect(screen.getByLabelText('Worker limit')).toHaveValue(2)
  expect(screen.getByLabelText('Pool name')).toBeEnabled()
  expect(screen.getByRole('checkbox')).toBeEnabled()
  expect(screen.getByRole('button', { name: 'Save pool' })).toBeEnabled()
  mocks.command.mockResolvedValueOnce(mocks.catalog.pools[0])
  fireEvent.click(screen.getByRole('button', { name: 'Save pool' }))

  await waitFor(() =>
    expect(screen.queryByLabelText('Pool name')).not.toBeInTheDocument()
  )
  expect(mocks.refresh).toHaveBeenCalledOnce()
  expect(mocks.command).toHaveBeenCalledTimes(2)
  expect(mocks.command).toHaveBeenLastCalledWith('save_pool', {
    expectedRevision: 10,
    pool: {
      id: 'coder',
      name: 'Keep this reviewed draft',
      members: [{ instanceId: 'instance', workerLimit: 2 }],
    },
  })
})

it('sends one delete and blocks changing pools or editing while deleting', async () => {
  const deleting = deferred<unknown>()
  mocks.command.mockReturnValueOnce(deleting.promise)
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
  mocks.catalog.pools.push({ id: 'reviewer', name: 'reviewer', members: [] })
  render(<AgentWorkerPools />)
  fireEvent.click(screen.getByRole('button', { name: /coder · not assigned/ }))
  const remove = screen.getByRole('button', { name: 'Delete pool' })

  act(() => {
    fireEvent.click(remove)
    fireEvent.click(remove)
  })

  expect(confirm).toHaveBeenCalledOnce()
  expect(mocks.command).toHaveBeenCalledOnce()
  expect(mocks.command).toHaveBeenCalledWith('delete_pool', {
    id: 'coder',
    expectedRevision: 10,
  })
  expect(screen.getByRole('button', { name: 'Deleting…' })).toBeDisabled()
  expect(screen.getByRole('button', { name: 'Save pool' })).toBeDisabled()
  expect(screen.getByRole('button', { name: 'Create pool' })).toBeDisabled()
  expect(screen.getByLabelText('Pool name')).toBeDisabled()
  expect(screen.getByLabelText('Worker limit')).toBeDisabled()
  expect(screen.getByRole('checkbox')).toBeDisabled()
  const otherPool = screen.getByRole('button', {
    name: /reviewer · not assigned/,
  })
  expect(otherPool).toBeDisabled()
  fireEvent.click(otherPool)
  fireEvent.click(screen.getByRole('button', { name: 'Create pool' }))
  expect(screen.getByLabelText('Pool name')).toHaveValue('coder')

  await act(async () => {
    deleting.resolve(undefined)
    await deleting.promise
  })

  expect(screen.queryByLabelText('Pool name')).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Create pool' })).toBeEnabled()
})

it('restores the draft and controls after delete fails and allows retry', async () => {
  const deleting = deferred<unknown>()
  mocks.command.mockReturnValueOnce(deleting.promise)
  vi.spyOn(window, 'confirm').mockReturnValue(true)
  render(<AgentWorkerPools />)
  fireEvent.click(screen.getByRole('button', { name: /coder · not assigned/ }))
  fireEvent.change(screen.getByLabelText('Pool name'), {
    target: { value: 'Keep this deletion draft' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Delete pool' }))

  await act(async () => {
    deleting.reject(new Error('Delete was refused'))
    await deleting.promise.catch(() => undefined)
  })

  expect(mocks.toast).toHaveBeenCalledWith('Error: Delete was refused')
  expect(screen.getByLabelText('Pool name')).toHaveValue(
    'Keep this deletion draft'
  )
  expect(screen.getByLabelText('Pool name')).toBeEnabled()
  expect(screen.getByLabelText('Worker limit')).toBeEnabled()
  expect(screen.getByRole('checkbox')).toBeEnabled()
  expect(screen.getByRole('button', { name: 'Create pool' })).toBeEnabled()
  expect(screen.getByRole('button', { name: 'Delete pool' })).toBeEnabled()
  mocks.command.mockResolvedValueOnce(undefined)
  fireEvent.click(screen.getByRole('button', { name: 'Delete pool' }))

  await waitFor(() =>
    expect(screen.queryByLabelText('Pool name')).not.toBeInTheDocument()
  )
  expect(mocks.refresh).toHaveBeenCalledOnce()
  expect(mocks.command).toHaveBeenCalledTimes(2)
  expect(mocks.command).toHaveBeenLastCalledWith('delete_pool', {
    id: 'coder',
    expectedRevision: 10,
  })
})

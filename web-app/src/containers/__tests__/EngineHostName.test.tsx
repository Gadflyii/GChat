import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { EngineHostName } from '@/containers/EngineHostName'

const mocks = vi.hoisted(() => ({
  command: vi.fn(),
  refresh: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn() },
  state: {
    hosts: [] as { host_id: string; local?: boolean; name?: string }[],
    errors: {} as Record<string, string>,
    snapshots: {} as Record<string, { display_name?: string; lan_sharing?: { managed?: boolean } }>,
  },
}))
vi.mock('@/services/engines', () => ({ engineCommand: mocks.command }))
vi.mock('sonner', () => ({ toast: mocks.toast }))
vi.mock('@/stores/engine-hosts-store', () => ({
  useEngineHosts: () => ({ ...mocks.state, refresh: mocks.refresh }),
}))

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

beforeEach(() => {
  mocks.command.mockReset().mockResolvedValue({})
  mocks.refresh.mockReset().mockResolvedValue(undefined)
  mocks.toast.success.mockReset()
  mocks.toast.error.mockReset()
  mocks.state.hosts = [{ host_id: 'local', local: true, name: 'WORKSTATION' }]
  mocks.state.errors = {}
  mocks.state.snapshots = { local: { display_name: 'WORKSTATION', lan_sharing: { managed: true } } }
})
afterEach(cleanup)

it('edits the local host name in settings and refreshes the host registry', async () => {
  render(<EngineHostName />)
  expect(screen.getByLabelText('Host name')).toHaveValue('WORKSTATION')
  expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
  fireEvent.change(screen.getByLabelText('Host name'), { target: { value: '  Lab desktop  ' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save' }))
  await waitFor(() => expect(mocks.command).toHaveBeenCalledWith('host_name', { host_id: 'local', body: { name: 'Lab desktop' } }))
  await waitFor(() => expect(mocks.refresh).toHaveBeenCalledTimes(1))
  expect(await screen.findByText('Host name saved.')).toBeVisible()
})

it('keeps a rejected draft and its plain inline error through a successful status read until an explicit Save retry', async () => {
  const save = deferred<unknown>()
  mocks.command.mockReturnValueOnce(save.promise)
  const view = render(<EngineHostName />)
  fireEvent.change(screen.getByLabelText('Host name'), { target: { value: 'Lab desktop' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save' }))
  await act(async () => { save.reject(new Error('rename connection reset at /host/name')) })

  const guidance = 'Could not save the Host name. Check the connection and try Save again.'
  expect(await screen.findByText(guidance)).toBeVisible()
  expect(screen.getByLabelText('Host name')).toHaveValue('Lab desktop')
  expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled()
  const details = screen.getByText('Technical details').closest('details')
  expect(details).not.toHaveAttribute('open')
  expect(details).toHaveTextContent('rename connection reset at /host/name')
  expect(screen.getByText(/rename connection reset at \/host\/name/)).not.toBeVisible()
  expect(mocks.refresh).not.toHaveBeenCalled()
  expect(screen.queryByText('Host name saved.')).not.toBeInTheDocument()

  await act(async () => { await mocks.refresh() })
  mocks.state.snapshots.local = { display_name: 'WORKSTATION', lan_sharing: { managed: true } }
  view.rerender(<EngineHostName />)
  expect(screen.getByText(guidance)).toBeVisible()
  expect(screen.getByLabelText('Host name')).toHaveValue('Lab desktop')
  expect(mocks.command).toHaveBeenCalledTimes(1)

  fireEvent.click(screen.getByRole('button', { name: 'Save' }))
  expect(await screen.findByText('Host name saved.')).toBeVisible()
  expect(screen.queryByText(guidance)).not.toBeInTheDocument()
  expect(mocks.command).toHaveBeenCalledTimes(2)
  expect(mocks.command).toHaveBeenLastCalledWith('host_name', { host_id: 'local', body: { name: 'Lab desktop' } })
  expect(mocks.refresh).toHaveBeenCalledTimes(2)
})

it('preserves a successful rename when refresh fails and retries only the status read', async () => {
  const retry = deferred<void>()
  mocks.refresh.mockRejectedValueOnce(new Error('status GET /hosts/local failed'))
    .mockReturnValueOnce(retry.promise)
  const view = render(<EngineHostName />)
  fireEvent.change(screen.getByLabelText('Host name'), { target: { value: 'Lab desktop' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save' }))

  const guidance = 'The name was saved, but GChat could not refresh its status. Try Retry status.'
  expect(await screen.findByText(guidance)).toBeVisible()
  expect(screen.getByText('Host name saved.')).toBeVisible()
  expect(screen.queryByText('Could not save the Host name. Check the connection and try Save again.')).not.toBeInTheDocument()
  expect(screen.getByLabelText('Host name')).toHaveValue('Lab desktop')
  expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
  const details = screen.getByText('Technical details').closest('details')
  expect(details).not.toHaveAttribute('open')
  expect(details).toHaveTextContent('status GET /hosts/local failed')
  expect(screen.getByText(/status GET \/hosts\/local failed/)).not.toBeVisible()

  const retryButton = screen.getByRole('button', { name: 'Retry status' })
  fireEvent.click(retryButton)
  expect(retryButton).toBeDisabled()
  expect(screen.getByLabelText('Host name')).toBeDisabled()
  expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
  fireEvent.click(retryButton)
  expect(mocks.refresh).toHaveBeenCalledTimes(2)
  expect(mocks.command).toHaveBeenCalledTimes(1)
  await act(async () => {
    mocks.state.snapshots.local = { display_name: 'Lab desktop', lan_sharing: { managed: true } }
    retry.resolve(undefined)
  })
  view.rerender(<EngineHostName />)

  await waitFor(() => expect(screen.queryByText(guidance)).not.toBeInTheDocument())
  expect(screen.queryByText('Technical details')).not.toBeInTheDocument()
  expect(screen.getByText('Host name saved.')).toBeVisible()
  expect(screen.getByLabelText('Host name')).toHaveValue('Lab desktop')
  expect(screen.getByLabelText('Host name')).toBeEnabled()
  expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
  expect(mocks.command).toHaveBeenCalledTimes(1)
  expect(mocks.refresh).toHaveBeenCalledTimes(2)
})

it('shows a pending save and prevents duplicate submissions or editing until it finishes', async () => {
  const save = deferred<unknown>()
  mocks.command.mockReturnValueOnce(save.promise)
  render(<EngineHostName />)
  fireEvent.change(screen.getByLabelText('Host name'), { target: { value: 'Lab desktop' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save' }))

  const pendingButton = screen.getByRole('button', { name: 'Saving…' })
  expect(pendingButton).toBeDisabled()
  expect(screen.getByLabelText('Host name')).toBeDisabled()
  fireEvent.click(pendingButton)
  expect(mocks.command).toHaveBeenCalledTimes(1)
  expect(mocks.refresh).not.toHaveBeenCalled()
  await act(async () => { save.resolve({}) })

  expect(await screen.findByText('Host name saved.')).toBeVisible()
  expect(screen.getByLabelText('Host name')).toBeEnabled()
  expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
  expect(mocks.command).toHaveBeenCalledTimes(1)
  expect(mocks.refresh).toHaveBeenCalledTimes(1)
})

it.each(['unmanaged', 'missing snapshot', 'unavailable'] as const)('does not allow rename when the local Host is %s', state => {
  if (state === 'unmanaged') mocks.state.snapshots.local.lan_sharing = { managed: false }
  if (state === 'missing snapshot') mocks.state.snapshots = {}
  if (state === 'unavailable') mocks.state.errors.local = 'Host unavailable'
  render(<EngineHostName />)
  expect(screen.getByLabelText('Host name')).toBeDisabled()
  expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
  fireEvent.click(screen.getByRole('button', { name: 'Save' }))
  expect(mocks.command).not.toHaveBeenCalled()
  expect(mocks.refresh).not.toHaveBeenCalled()
})

it('explains when no local Host is available', () => {
  mocks.state.hosts = [{ host_id: 'remote', name: 'Lab server' }]
  render(<EngineHostName />)
  expect(screen.getByText('Available when the local GInfer host is running.')).toBeVisible()
  expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument()
  expect(mocks.command).not.toHaveBeenCalled()
})

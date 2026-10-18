import { spyConfirm } from '@/test/confirm'
import userEvent from '@testing-library/user-event'
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { toast } from 'sonner'
import type { ComponentType, ReactNode } from 'react'
import type {
  EngineInstance,
  EngineLaunchProfile,
  EngineSnapshot,
  NearbyHost,
} from '@/services/engines'

const mocks = vi.hoisted(() => ({
  command: vi.fn(),
  refresh: vi.fn(),
  publishSnapshot: vi.fn(),
  snapshot: null as EngineSnapshot | null,
  storeVersion: 0,
  storeListeners: new Set<() => void>(),
  error: '',
  local: false,
  hasHost: true,
  refreshing: false,
  resources: { ready: true as boolean | null, error: '' },
  nearby: [] as NearbyHost[],
  instances: [] as EngineInstance[],
}))
vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: unknown) => ({ options }),
}))
vi.mock('@/containers/HeaderPage', () => ({
  default: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}))
vi.mock('@/services/engines', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/engines')>()),
  engineCommand: mocks.command,
}))
vi.mock('@/stores/engine-discovery-store', () => ({
  useEngineDiscovery: () => ({
    enabled: mocks.nearby.length > 0,
    ignored: {},
    setEnabled: vi.fn(),
    ignore: vi.fn(),
    restore: vi.fn(),
  }),
}))
vi.mock('@/hooks/useBundledResources', () => ({
  useBundledResources: () => mocks.resources,
}))
vi.mock('@/stores/engine-hosts-store', async () => {
  const { useSyncExternalStore } = await import('react')
  const subscribe = (listener: () => void) => {
    mocks.storeListeners.add(listener)
    return () => { mocks.storeListeners.delete(listener) }
  }
  const useEngineHosts = (
    selector?: (state: { refresh: typeof mocks.refresh }) => unknown
  ) => {
    useSyncExternalStore(subscribe, () => mocks.storeVersion)
    const state = {
      hosts: mocks.hasHost ? [
        {
          host_id: 'host',
          name: 'Lab host',
          base_url: 'https://host:7443',
          local: mocks.local,
        },
      ] : [],
      nearby: mocks.nearby,
      errors: mocks.error ? { host: mocks.error } : {},
      refresh: mocks.refresh,
      publishSnapshot: mocks.publishSnapshot,
      refreshing: mocks.refreshing,
      discoveryError: null,
      snapshots: {
        host: mocks.snapshot ?? {
          host_id: 'host',
          display_name: 'Lab host',
          revision: 1,
          instances: mocks.instances,
          lan_sharing: {
            managed: true,
            enabled: true,
            active: true,
            port: 7444,
          },
          gpus: [{ uuid: 'GPU-one', name: 'RTX 5090', memory_mib: 32768 }],
          models: [
            {
              id: 'model',
              artifact_set: false,
              path: '/models/qwen.ginfer',
              metadata: {
                identity: { model_id: 'qwen3.8-27b', weights_id: 'nvfp4' },
                tp_size: 1,
                draft_tp: 0,
                size_bytes: 1024,
              },
            },
          ],
        },
      },
    }
    return selector ? selector(state) : state
  }
  return { useEngineHosts }
})
import { Route } from './index'
const Page = Route.options.component as ComponentType

function publishHostSnapshot(snapshot: EngineSnapshot) {
  mocks.snapshot = snapshot
  mocks.error = ''
  mocks.storeVersion++
  mocks.storeListeners.forEach(listener => listener())
}

function sharingSnapshot(enabled: boolean, revision = 1): EngineSnapshot {
  return {
    host_id: 'host', display_name: 'Lab host', revision,
    instances: [], gpus: [], models: [],
    lan_sharing: { managed: true, enabled, active: enabled, port: 7444 },
  }
}

function renderExpandedPage() {
  const view = render(<Page />)
  fireEvent.click(
    screen.getByText('Start a model with saved settings', { selector: 'summary' })
  )
  fireEvent.click(screen.getByText('Model and memory settings', { selector: 'summary' }))
  return view
}

beforeEach(() => {
  mocks.error = ''
  mocks.local = false
  mocks.hasHost = true
  mocks.refreshing = false
  mocks.resources = { ready: true, error: '' }
  mocks.nearby = []
  mocks.instances = []
  mocks.snapshot = null
  mocks.storeVersion = 0
  mocks.storeListeners.clear()
  mocks.publishSnapshot.mockReset().mockImplementation((_hostId: string, snapshot: EngineSnapshot) => publishHostSnapshot(snapshot))
  mocks.command
    .mockReset()
    .mockImplementation(async (action: string, args?: { body?: { enabled?: boolean } }) =>
      action === 'credential_status'
        ? { ready: true, platform: 'linux', can_install: false }
        : action === 'first_run'
          ? {
              step: 'complete',
              gpu_uuids: [],
              storage: { path: '/models' },
              models: [],
            }
          : action === 'lan_sharing'
            ? sharingSnapshot(args?.body?.enabled ?? true, 2)
            : {}
    )
  mocks.refresh.mockReset().mockResolvedValue(undefined)
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('Engines host intake and launch controls', () => {
  it('explains the empty Host list and disabled Refresh while bundled files are being prepared', async () => {
    mocks.hasHost = false
    mocks.refreshing = true
    mocks.resources = { ready: false, error: '' }
    const view = render(<Page />)
    const refresh = screen.getByRole('button', { name: 'Refresh' })
    expect(refresh).toBeDisabled()
    expect(refresh).toHaveAccessibleDescription(/Refresh is waiting for preparation to finish/)
    const preparation = screen.getByText(/GChat is installing and checking its bundled files\./)
    expect(preparation).toHaveAttribute('role', 'status')
    expect(preparation).toHaveTextContent('The local Host will appear when it is ready')
    await screen.findByText('Secure storage is ready.')

    mocks.resources = { ready: true, error: '' }
    mocks.refreshing = false
    view.rerender(<Page />)
    expect(screen.queryByText(/GChat is installing and checking/)).not.toBeInTheDocument()
    expect(refresh).toBeEnabled()
    expect(refresh).not.toHaveAttribute('aria-describedby')
  })

  it('shows an actionable preparation failure with closed diagnostics', async () => {
    mocks.hasHost = false
    mocks.resources = { ready: null, error: 'runtime file hash mismatch: bin/ginfer' }
    render(<Page />)
    expect(screen.getByRole('alert')).toHaveTextContent('Restart GChat to try again. If this keeps happening, reinstall GChat.')
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeDisabled()
    expect(screen.getByText('runtime file hash mismatch: bin/ginfer')).not.toBeVisible()
    fireEvent.click(screen.getByText('GInfer preparation error details'))
    expect(screen.getByText('runtime file hash mismatch: bin/ginfer')).toBeVisible()
    await screen.findByText('Secure storage is ready.')
  })

  it('keeps launch and details independently collapsed without hiding host controls', async () => {
    render(<Page />)
    const launch = screen.getByText('Start a model with saved settings', {
      selector: 'summary',
    })
    const details = screen.getByText('Model and memory settings', { selector: 'summary' })
    expect(launch.closest('details')).not.toHaveAttribute('open')
    expect(details.closest('details')).not.toHaveAttribute('open')
    fireEvent.click(launch)
    expect(
      screen.getByRole('button', { name: 'Lab host model' })
    ).toBeVisible()
    expect(details.closest('details')).not.toHaveAttribute('open')
    fireEvent.click(details)
    fireEvent.click(launch)
    expect(details.closest('details')).toHaveAttribute('open')
    expect(launch.closest('details')).not.toHaveAttribute('open')
    await screen.findByText('Secure storage is ready.')
  })

  it('shows the automatic local host without a forget action', async () => {
    mocks.local = true
    renderExpandedPage()
    expect(screen.getByText('This computer')).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Remove connection' })
    ).not.toBeInTheDocument()
    await screen.findByText('Secure storage is ready.')
  })
  it('shares independently of discovery', async () => {
    mocks.local = true
    renderExpandedPage()
    const share = screen.getByRole('switch', { name: 'Share this host' })
    expect(share).toBeChecked()
    expect(
      screen.getByRole('switch', { name: 'Discover nearby GInfer hosts' })
    ).not.toBeChecked()
    fireEvent.click(share)
    await waitFor(() =>
      expect(mocks.command).toHaveBeenCalledWith('lan_sharing', {
        host_id: 'host',
        body: { enabled: false },
      })
    )
    await waitFor(() => expect(share).toBeEnabled())
  })

  it.each([
    { label: 'off', initiallyEnabled: true, acceptedEnabled: false },
    { label: 'on', initiallyEnabled: false, acceptedEnabled: true },
  ])('preserves network sharing $label after an accepted command and failed refresh', async ({ label, initiallyEnabled, acceptedEnabled }) => {
    mocks.local = true
    mocks.snapshot = sharingSnapshot(initiallyEnabled)
    const accepted = sharingSnapshot(acceptedEnabled, 2)
    const successMessage = `Network sharing turned ${label}.`
    const refreshMessage = 'Could not refresh the host list. Choose Refresh above to try again.'
    let finishSharing!: (snapshot: EngineSnapshot) => void
    let rejectRefresh!: (reason: Error) => void
    const original = mocks.command.getMockImplementation()!
    mocks.command.mockImplementation((action: string, args: unknown) => action === 'lan_sharing'
      ? new Promise<EngineSnapshot>((resolve) => { finishSharing = resolve })
      : original(action, args))
    render(<Page />)
    await screen.findByText('Secure storage is ready.')
    mocks.refresh.mockClear().mockImplementationOnce(() => new Promise<undefined>((_resolve, reject) => { rejectRefresh = reject }))
    const share = screen.getByRole('switch', { name: 'Share this host' })
    if (initiallyEnabled) expect(share).toBeChecked()
    else expect(share).not.toBeChecked()
    fireEvent.click(share)
    expect(share).toBeDisabled()
    fireEvent.click(share)
    expect(mocks.command.mock.calls.filter(([action]) => action === 'lan_sharing')).toEqual([
      ['lan_sharing', { host_id: 'host', body: { enabled: acceptedEnabled } }],
    ])
    expect(mocks.publishSnapshot).not.toHaveBeenCalled()
    expect(mocks.refresh).not.toHaveBeenCalled()

    await act(async () => finishSharing(accepted))
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalledOnce())
    if (acceptedEnabled) expect(share).toBeChecked()
    else expect(share).not.toBeChecked()
    expect(mocks.publishSnapshot).toHaveBeenCalledExactlyOnceWith('host', accepted)
    expect(screen.getByText(successMessage)).toHaveAttribute('role', 'status')
    expect(share).toBeDisabled()
    fireEvent.click(share)
    expect(mocks.command.mock.calls.filter(([action]) => action === 'lan_sharing')).toHaveLength(1)

    await act(async () => rejectRefresh(new Error('Host list unavailable')))
    await waitFor(() => expect(share).toBeEnabled())
    const feedback = screen.getByRole('alert')
    expect(feedback).toHaveTextContent(refreshMessage)
    expect(screen.getByText(successMessage)).toBeVisible()
    const details = within(feedback).getByText('Error: Host list unavailable')
    expect(details).not.toBeVisible()
    fireEvent.click(within(feedback).getByText('Host refresh error details'))
    expect(details).toBeVisible()
    expect(screen.queryByText(/Could not change network sharing/)).not.toBeInTheDocument()

    mocks.refresh.mockRejectedValueOnce(new Error('Host list still unavailable'))
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
    await waitFor(() => expect(feedback).toHaveTextContent('Error: Host list still unavailable'))
    expect(feedback).toHaveTextContent(refreshMessage)
    expect(screen.getByText(successMessage)).toBeVisible()
    if (acceptedEnabled) expect(share).toBeChecked()
    else expect(share).not.toBeChecked()
    expect(mocks.command.mock.calls.filter(([action]) => action === 'lan_sharing')).toHaveLength(1)

    mocks.refresh.mockImplementationOnce(async () => { publishHostSnapshot(sharingSnapshot(initiallyEnabled, 3)) })
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
    await waitFor(() => expect(feedback).not.toBeInTheDocument())
    expect(mocks.refresh).toHaveBeenCalledTimes(3)
    expect(screen.getByText(successMessage)).toBeVisible()
    if (initiallyEnabled) expect(share).toBeChecked()
    else expect(share).not.toBeChecked()
    expect(mocks.publishSnapshot).toHaveBeenCalledExactlyOnceWith('host', accepted)
    expect(mocks.command.mock.calls.filter(([action]) => action === 'lan_sharing')).toHaveLength(1)
  })

  it('preserves network sharing failure through refresh and allows explicit switch retry', async () => {
    mocks.local = true
    mocks.snapshot = sharingSnapshot(true)
    const sharingMessage = 'Could not change network sharing. Check that the model service on this computer is reachable, then try Share this host again.'
    const refreshMessage = 'Could not refresh the host list. Choose Refresh above to try again.'
    let rejectSharing!: (reason: Error) => void
    let rejectRefresh!: (reason: Error) => void
    const original = mocks.command.getMockImplementation()!
    mocks.command.mockImplementation((action: string, args: unknown) => action === 'lan_sharing'
      ? new Promise<EngineSnapshot>((_resolve, reject) => { rejectSharing = reject })
      : original(action, args))
    render(<Page />)
    await screen.findByText('Secure storage is ready.')
    mocks.refresh.mockClear().mockImplementationOnce(() => new Promise<undefined>((_resolve, reject) => { rejectRefresh = reject }))
    const share = screen.getByRole('switch', { name: 'Share this host' })
    fireEvent.click(share)
    expect(share).toBeDisabled()
    fireEvent.click(share)
    expect(share).toBeChecked()
    expect(mocks.command.mock.calls.filter(([action]) => action === 'lan_sharing')).toHaveLength(1)
    await act(async () => rejectSharing(new Error('Host policy refused sharing change')))
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalledOnce())
    const sharingFeedback = screen.getByRole('alert')
    expect(sharingFeedback).toHaveTextContent(sharingMessage)
    const details = within(sharingFeedback).getByText('Error: Host policy refused sharing change')
    expect(details).not.toBeVisible()
    fireEvent.click(within(sharingFeedback).getByText('Network sharing error details'))
    expect(details).toBeVisible()
    expect(share).toBeChecked()
    expect(share).toBeDisabled()
    expect(mocks.publishSnapshot).not.toHaveBeenCalled()

    await act(async () => rejectRefresh(new Error('Host list unavailable')))
    await waitFor(() => expect(share).toBeEnabled())
    expect(sharingFeedback).toHaveTextContent(sharingMessage)
    expect(screen.getByText(refreshMessage)).toBeVisible()
    expect(screen.getByText('Error: Host list unavailable')).not.toBeVisible()
    expect(share).toBeChecked()
    expect(screen.queryByText(/Network sharing turned/)).not.toBeInTheDocument()
    mocks.refresh.mockRejectedValueOnce(new Error('Host list still unavailable'))
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
    await waitFor(() => expect(screen.getByText('Error: Host list still unavailable')).toBeInTheDocument())
    expect(sharingFeedback).toHaveTextContent(sharingMessage)
    expect(details).toBeVisible()
    expect(share).toBeChecked()
    expect(mocks.command.mock.calls.filter(([action]) => action === 'lan_sharing')).toHaveLength(1)

    let finishRetry!: (snapshot: EngineSnapshot) => void
    mocks.command.mockImplementation((action: string, args: unknown) => action === 'lan_sharing'
      ? new Promise<EngineSnapshot>((resolve) => { finishRetry = resolve })
      : original(action, args))
    await act(async () => {
      fireEvent.click(share)
      fireEvent.click(share)
    })
    expect(share).toBeDisabled()
    expect(share).toBeChecked()
    expect(screen.queryByText(sharingMessage)).not.toBeInTheDocument()
    expect(screen.queryByText(refreshMessage)).not.toBeInTheDocument()
    expect(mocks.command.mock.calls.filter(([action]) => action === 'lan_sharing')).toEqual([
      ['lan_sharing', { host_id: 'host', body: { enabled: false } }],
      ['lan_sharing', { host_id: 'host', body: { enabled: false } }],
    ])
    const accepted = sharingSnapshot(false, 2)
    await act(async () => finishRetry(accepted))
    await waitFor(() => expect(share).toBeEnabled())
    expect(share).not.toBeChecked()
    expect(screen.getByText('Network sharing turned off.')).toHaveAttribute('role', 'status')
    expect(screen.queryByText(sharingMessage)).not.toBeInTheDocument()
    expect(screen.queryByText(refreshMessage)).not.toBeInTheDocument()
    expect(mocks.refresh).toHaveBeenCalledTimes(3)
    expect(mocks.publishSnapshot).toHaveBeenCalledExactlyOnceWith('host', accepted)
  })

  it('does not change sharing on a remote host', async () => {
    renderExpandedPage()
    expect(
      screen.getByRole('switch', { name: 'Share this host' })
    ).toBeDisabled()
    expect(
      screen.queryByRole('button', { name: 'Generate pairing code' })
    ).not.toBeInTheDocument()
    await screen.findByText('Secure storage is ready.')
  })

  it('offers Pair and Ignore for a discovered host without requiring address selection', async () => {
    mocks.nearby = [
      {
        host_id: 'nearby-host',
        name: 'Server 2',
        urls: ['https://192.168.1.111:7444', 'https://10.0.0.1:7444'],
      },
    ]
    renderExpandedPage()
    expect(
      screen.getByRole('button', { name: 'Ignore', exact: true })
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /https:/ })
    ).not.toBeInTheDocument()
    const pair = screen.getByRole('button', { name: 'Pair', exact: true })
    expect(pair).toHaveAccessibleDescription(/Pairing needs secure storage/)
    await waitFor(() => expect(pair).toBeEnabled())
    expect(pair).not.toHaveAccessibleDescription(/Pairing needs secure storage/)
    fireEvent.click(pair)
    await waitFor(() =>
      expect(mocks.command).toHaveBeenCalledWith('pair', {
        host_id: 'nearby-host',
      })
    )
    expect(
      screen.queryByLabelText('Certificate SHA256')
    ).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Pairing code')).not.toBeInTheDocument()
  })

  it('keeps nearby pairing failure actionable through Refresh and explicit retry', async () => {
    mocks.nearby = [
      {
        host_id: 'nearby-host',
        name: 'Server 2',
        urls: ['https://192.168.1.111:7444'],
      },
    ]
    let fail!: (error: Error) => void
    const original = mocks.command.getMockImplementation()!
    mocks.command.mockImplementation((action: string, args: unknown) =>
      action === 'pair'
        ? new Promise((_resolve, reject) => {
            fail = reject
          })
        : original(action, args)
    )
    render(<Page />)
    await screen.findByText('Secure storage is ready.')
    mocks.refresh.mockClear()
    const card = screen.getByText('New host found: Server 2').parentElement!
    const pair = within(card).getByRole('button', { name: 'Pair', exact: true })
    fireEvent.click(pair)
    expect(pair).toHaveTextContent('Pairing…')
    expect(pair).toBeDisabled()
    fireEvent.click(pair)
    expect(mocks.command.mock.calls.filter(([action]) => action === 'pair')).toEqual([
      ['pair', { host_id: 'nearby-host' }],
    ])
    await act(async () => fail(new Error('Host unavailable')))
    await waitFor(() => expect(pair).toBeEnabled())
    const feedback = within(card).getByRole('alert')
    const message = 'Could not pair with Server 2. Check that GInfer sharing is on at the other computer, then choose Pair to try again.'
    expect(feedback).toHaveTextContent(message)
    expect(pair).toHaveAccessibleDescription(new RegExp(message.replaceAll('.', '\\.')))
    const diagnostic = within(feedback).getByText('Error: Host unavailable')
    expect(diagnostic).not.toBeVisible()
    expect(diagnostic.closest('details')).not.toHaveAttribute('open')
    fireEvent.click(within(feedback).getByText('Pairing error details'))
    expect(diagnostic).toBeVisible()
    expect(mocks.refresh).not.toHaveBeenCalled()

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Refresh', exact: true }))
    })
    expect(mocks.refresh).toHaveBeenCalledOnce()
    expect(feedback).toBeInTheDocument()
    expect(diagnostic).toBeVisible()
    expect(pair).toHaveAccessibleDescription(new RegExp(message.replaceAll('.', '\\.')))
    expect(mocks.command.mock.calls.filter(([action]) => action === 'pair')).toHaveLength(1)

    let finishRetry!: (result: object) => void
    mocks.command.mockImplementation((action: string, args: unknown) => action === 'pair'
      ? new Promise((resolve) => { finishRetry = resolve })
      : original(action, args))
    fireEvent.click(pair)
    expect(pair).toBeDisabled()
    expect(pair).toHaveTextContent('Pairing…')
    expect(within(card).queryByRole('alert')).not.toBeInTheDocument()
    expect(pair).not.toHaveAccessibleDescription(new RegExp(message.replaceAll('.', '\\.')))
    fireEvent.click(pair)
    expect(mocks.command.mock.calls.filter(([action]) => action === 'pair')).toEqual([
      ['pair', { host_id: 'nearby-host' }],
      ['pair', { host_id: 'nearby-host' }],
    ])
    await act(async () => finishRetry({}))
    await waitFor(() => expect(pair).toBeEnabled())
    expect(within(card).queryByRole('alert')).not.toBeInTheDocument()
    expect(mocks.refresh).toHaveBeenCalledTimes(2)
  })

  it('keeps nearby pairing failure scoped when another host fails then pairs successfully', async () => {
    mocks.nearby = [
      { host_id: 'server-2', name: 'Server 2', urls: ['https://server-2:7444'] },
      { host_id: 'server-3', name: 'Server 3', urls: ['https://server-3:7444'] },
    ]
    let finishRetry!: (result: object) => void
    const otherPair = vi.fn()
      .mockRejectedValueOnce(new Error('Server 3 refused pairing'))
      .mockImplementationOnce(() => new Promise((resolve) => { finishRetry = resolve }))
    const original = mocks.command.getMockImplementation()!
    mocks.command.mockImplementation((action: string, args?: { host_id?: string }) => action === 'pair'
      ? args?.host_id === 'server-2'
        ? Promise.reject(new Error('Server 2 unavailable'))
        : otherPair()
      : original(action, args))
    render(<Page />)
    await screen.findByText('Secure storage is ready.')
    mocks.refresh.mockClear()
    const failedCard = screen.getByText('New host found: Server 2').parentElement!
    const otherCard = screen.getByText('New host found: Server 3').parentElement!
    const failedPair = within(failedCard).getByRole('button', { name: 'Pair', exact: true })
    const otherPairButton = within(otherCard).getByRole('button', { name: 'Pair', exact: true })
    fireEvent.click(failedPair)
    await waitFor(() => expect(failedPair).toBeEnabled())
    const failedFeedback = within(failedCard).getByRole('alert')
    expect(failedFeedback).toHaveTextContent('Could not pair with Server 2.')
    expect(within(otherCard).queryByRole('alert')).not.toBeInTheDocument()
    expect(otherPairButton).not.toHaveAccessibleDescription(/Could not pair/)

    fireEvent.click(otherPairButton)
    await waitFor(() => expect(otherPairButton).toBeEnabled())
    const otherFeedback = within(otherCard).getByRole('alert')
    expect(otherFeedback).toHaveTextContent('Could not pair with Server 3.')
    expect(within(otherFeedback).getByText('Error: Server 3 refused pairing')).not.toBeVisible()
    expect(otherPairButton).toHaveAccessibleDescription(/Could not pair with Server 3\./)
    expect(failedFeedback).toBeInTheDocument()
    expect(within(failedFeedback).getByText('Error: Server 2 unavailable')).not.toBeVisible()
    expect(failedPair).toHaveAccessibleDescription(/Could not pair with Server 2\./)
    expect(mocks.refresh).not.toHaveBeenCalled()

    fireEvent.click(otherPairButton)
    expect(otherPairButton).toBeDisabled()
    expect(otherPairButton).toHaveTextContent('Pairing…')
    expect(within(otherCard).queryByRole('alert')).not.toBeInTheDocument()
    expect(otherPairButton).not.toHaveAccessibleDescription(/Could not pair/)
    expect(failedFeedback).toBeInTheDocument()
    expect(failedPair).toBeDisabled()
    expect(failedPair).toHaveAccessibleDescription(/Could not pair with Server 2\./)
    fireEvent.click(otherPairButton)
    await act(async () => finishRetry({}))
    await waitFor(() => expect(otherPairButton).toBeEnabled())
    expect(failedFeedback).toBeInTheDocument()
    expect(failedPair).toBeEnabled()
    expect(failedPair).toHaveAccessibleDescription(/Could not pair with Server 2\./)
    expect(within(otherCard).queryByRole('alert')).not.toBeInTheDocument()
    expect(mocks.refresh).toHaveBeenCalledOnce()
    expect(mocks.command.mock.calls.filter(([action]) => action === 'pair')).toEqual([
      ['pair', { host_id: 'server-2' }],
      ['pair', { host_id: 'server-3' }],
      ['pair', { host_id: 'server-3' }],
    ])
  })

  it('starts saved instances and confirms a running-instance restart', async () => {
    const profile: EngineLaunchProfile = {
      model_id: 'model',
      gpu_uuids: ['GPU-one'],
      max_context: 8192,
      concurrency: 1,
      vision: false,
      structured_outputs: true,
      spec: 'none',
      draft_tokens: 0,
      draft_tp: 0,
      kv_dtype: 'auto',
      kv_arena_bytes: null,
      host_kv_cache_bytes: 0,
      prefill_chunk: 0,
      no_cuda_graph: false,
    }
    mocks.instances = [
      {
        instance_id: 'instance',
        session_id: null,
        display_name: 'Saved model',
        upstream_model_id: 'model',
        status: 'stopped',
        configuration: profile,
        profile,
      },
    ]
    const view = renderExpandedPage()
    fireEvent.click(screen.getByRole('button', { name: 'Edit settings' }))
    expect(
      screen.getByText('Change model settings').closest('details')
    ).toHaveAttribute('open')
    expect(screen.getByLabelText('Installed model')).toHaveFocus()
    expect(screen.getByLabelText('Conversation length (tokens)')).toHaveValue(8192)
    fireEvent.click(screen.getByRole('button', { name: 'Cancel editing' }))
    expect(screen.getByRole('button', { name: 'Restart model' })).toBeDisabled()
    fireEvent.click(within(screen.getByRole('button', { name: 'Stop model', exact: true }).parentElement!).getByRole('button', { name: 'Start model', exact: true }))
    await waitFor(() =>
      expect(mocks.command).toHaveBeenCalledWith('start', {
        host_id: 'host',
        instance_id: 'instance',
        body: {},
      })
    )
    mocks.instances[0].status = 'ready'
    view.rerender(<Page />)
    expect(within(screen.getByRole('button', { name: 'Stop model', exact: true }).parentElement!).getByRole('button', { name: 'Start model', exact: true })).toBeDisabled()
    const confirmation = spyConfirm().mockReturnValue(false)
    fireEvent.click(screen.getByRole('button', { name: 'Restart model' }))
    expect(mocks.command).not.toHaveBeenCalledWith('restart', expect.anything())
    confirmation.mockReturnValue(true)
    fireEvent.click(screen.getByRole('button', { name: 'Restart model' }))
    await waitFor(() =>
      expect(mocks.command).toHaveBeenCalledWith('restart', {
        host_id: 'host',
        instance_id: 'instance',
        body: { force: false, expected_session_id: null },
      })
    )
    expect(
      screen.getByText(/Model server 1 · Saved model .* · Ready to chat/, { selector: 'p' })
    ).toBeInTheDocument()
    fireEvent.click(screen.getByText('Model and memory settings', { selector: 'summary' }))
    expect(
      screen.getByText('Model and memory settings').closest('details')
    ).not.toHaveAttribute('open')
    expect(screen.getByRole('button', { name: 'Stop model' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Restart model' })).toBeEnabled()
  })

  it('labels adjacent selectors and resolves generated instance names without changing command IDs', async () => {
    const user = userEvent.setup()
    const profile: EngineLaunchProfile = {
      model_id: 'model',
      gpu_uuids: ['GPU-one'],
      max_context: 131072,
      concurrency: 4,
      vision: true,
      structured_outputs: true,
      spec: 'none',
      draft_tokens: 0,
      draft_tp: 0,
      kv_dtype: 'auto',
      kv_arena_bytes: null,
      host_kv_cache_bytes: 0,
      prefill_chunk: 0,
      no_cuda_graph: false,
    }
    mocks.instances = ['stopped', 'ready'].map((status, index) => ({
      instance_id: `internal-id-${index}`,
      session_id: null,
      display_name: 'model',
      upstream_model_id: 'model',
      status: status as EngineInstance['status'],
      configuration: profile,
      profile,
    }))
    renderExpandedPage()
    const instance = screen.getByRole('button', {
      name: 'Lab host serving instance',
    })
    const model = screen.getByRole('button', { name: 'Lab host model' })
    expect(instance.closest('label')).toHaveTextContent('Model server')
    expect(model.closest('label')).toHaveTextContent('Model')
    await user.click(instance)
    expect(screen.getByRole('menuitemradio', { name: /^Model server 2 ·/ })).toBeChecked()
    await user.keyboard('{Escape}')
    const hardwareProfile = screen.getByRole('button', {
      name: 'Saved model settings',
    })
    expect(model.parentElement?.parentElement).toContainElement(hardwareProfile)
    expect(
      within(model.parentElement!.parentElement!).getAllByRole('button')
    ).toHaveLength(3)
    expect(
      model.compareDocumentPosition(hardwareProfile) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
    expect(instance).toHaveTextContent(
      'Qwen 3.8 27B — NVFP4 · 4 requests at once · 131,072 conversation tokens · Graphics cards 1'
    )
    expect(instance).not.toHaveTextContent('internal-id')
    expect(model).toHaveTextContent('Qwen 3.8 27B — NVFP4')
    await user.click(instance)
    await user.click(screen.getByRole('menuitemradio', { name: /^Model server 1 ·/ }))
    fireEvent.click(within(screen.getByRole('button', { name: 'Stop model', exact: true }).parentElement!).getByRole('button', { name: 'Start model', exact: true }))
    await waitFor(() =>
      expect(mocks.command).toHaveBeenCalledWith('start', {
        host_id: 'host',
        instance_id: 'internal-id-0',
        body: {},
      })
    )
  })

  it('says why Pair host is disabled until secure storage has been checked', () => {
    renderExpandedPage()
    fireEvent.click(screen.getByText('Enter a host address manually'))
    fireEvent.change(screen.getByLabelText('Host address'), {
      target: { value: 'https://host:7443' },
    })
    const pair = screen.getByRole('button', { name: 'Pair host' })
    expect(pair).toBeDisabled()
    expect(pair).toHaveAccessibleDescription(
      'Pairing needs secure storage. Choose Check secure storage above first.'
    )
  })

  it('pairs a manually entered address without a code', async () => {
    renderExpandedPage()
    fireEvent.click(screen.getByText('Enter a host address manually'))
    fireEvent.change(screen.getByLabelText('Host address'), {
      target: { value: 'https://host:7443' },
    })
    expect(screen.getByRole('button', { name: 'Pair host' })).toBeDisabled()
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Pair host' })).toBeEnabled()
    )
    fireEvent.click(screen.getByRole('button', { name: 'Pair host' }))
    await waitFor(() =>
      expect(mocks.command).toHaveBeenCalledWith('pair', {
        base_url: 'https://host:7443',
      })
    )
  })

  it.each(['manual', 'nearby'] as const)('keeps successful %s pairing distinct from a failed refresh and retries only the refresh', async (method) => {
    if (method === 'nearby') mocks.nearby = [{
      host_id: 'nearby-host', name: 'Server 2', urls: ['https://host:7444'],
    }]
    const original = mocks.command.getMockImplementation()!
    mocks.command.mockImplementation(async (action: string) => action === 'pair'
      ? { credential_cleanup_warning: 'Old credential could not be removed' }
      : original(action))
    const success = vi.spyOn(toast, 'success')
    const warning = vi.spyOn(toast, 'warning')
    const error = vi.spyOn(toast, 'error')
    render(<Page />)
    await screen.findByText('Secure storage is ready.')
    if (method === 'manual') {
      fireEvent.click(screen.getByText('Enter a host address manually'))
      fireEvent.change(screen.getByLabelText('Host address'), { target: { value: 'https://host:7444' } })
    }
    mocks.refresh.mockRejectedValueOnce(new Error('Host list unavailable'))
    fireEvent.click(screen.getByRole('button', { name: method === 'manual' ? 'Pair host' : 'Pair', exact: true }))
    const feedback = await screen.findByRole('alert')
    expect(feedback).toHaveTextContent('Host paired. Could not refresh the host list. Choose Refresh above to try again.')
    expect(screen.queryByText(/Could not pair this host/)).not.toBeInTheDocument()
    expect(success).toHaveBeenCalledWith('Host paired')
    expect(warning).toHaveBeenCalledWith('Pairing saved; cleanup needs attention: Old credential could not be removed')
    expect(error).not.toHaveBeenCalled()
    expect(screen.getByLabelText('Host address')).toHaveValue('')
    expect(screen.getByText('Error: Host list unavailable')).not.toBeVisible()
    fireEvent.click(screen.getByText('Host refresh error details'))
    expect(screen.getByText('Error: Host list unavailable')).toBeVisible()

    mocks.refresh.mockRejectedValueOnce(new Error('Still unavailable'))
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
    await waitFor(() => expect(error).toHaveBeenCalledWith('Error: Still unavailable'))
    expect(feedback).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
    await waitFor(() => expect(feedback).not.toBeInTheDocument())
    expect(mocks.command.mock.calls.filter(([action]) => action === 'pair')).toHaveLength(1)
  })

  it('explains malformed host addresses without attempting pairing and clears the error on correction', async () => {
    renderExpandedPage()
    fireEvent.click(screen.getByText('Enter a host address manually'))
    await screen.findByText('Secure storage is ready.')
    const input = screen.getByLabelText('Host address')
    const pair = screen.getByRole('button', { name: 'Pair host' })
    for (const value of ['', '   ']) {
      fireEvent.change(input, { target: { value } })
      expect(pair).toBeDisabled()
      expect(input).not.toBeInvalid()
    }
    for (const value of ['not-a-host', 'http://host:7444', 'https://host:7444/path', 'https://user:secret@host:7444', 'https://host:7444?', 'https://host:7444#']) {
      fireEvent.change(input, { target: { value } })
      expect(input).toBeInvalid()
      expect(input).toHaveAccessibleDescription(/Use an address starting with https:\/\//)
      expect(screen.getByRole('alert')).toHaveTextContent('host name or IP address and port')
      expect(pair).toBeDisabled()
      fireEvent.click(pair)
    }
    expect(mocks.command).not.toHaveBeenCalledWith('pair', expect.anything())
    fireEvent.change(input, { target: { value: '  https://host:7444  ' } })
    expect(input).not.toBeInvalid()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(pair).toBeEnabled()
    fireEvent.click(pair)
    await waitFor(() => expect(mocks.command).toHaveBeenCalledWith('pair', { base_url: 'https://host:7444' }))
  })

  it('keeps a failed manual pairing draft and actionable feedback through refresh, then permits retry', async () => {
    const original = mocks.command.getMockImplementation()!
    mocks.command.mockImplementation(async (action: string) => {
      if (action === 'pair') throw new Error('connection refused')
      return original(action)
    })
    renderExpandedPage()
    fireEvent.click(screen.getByText('Enter a host address manually'))
    await screen.findByText('Secure storage is ready.')
    const input = screen.getByLabelText('Host address')
    const pair = screen.getByRole('button', { name: 'Pair host' })
    fireEvent.change(input, { target: { value: 'https://host:7444' } })
    fireEvent.click(pair)
    const feedback = await screen.findByRole('alert')
    expect(feedback).toHaveTextContent('Check the address and that GInfer sharing is on')
    expect(input).toHaveValue('https://host:7444')
    expect(input).toBeEnabled()
    expect(pair).toBeEnabled()
    fireEvent.click(screen.getByText('Pairing error details'))
    expect(feedback.querySelector('details')).toHaveAttribute('open')
    expect(feedback).toHaveTextContent('connection refused')
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
    expect(feedback).toBeInTheDocument()
    expect(feedback.querySelector('details')).toHaveAttribute('open')
    mocks.command.mockImplementation(original)
    fireEvent.click(pair)
    await waitFor(() => expect(input).toHaveValue(''))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(mocks.command.mock.calls.filter(([action]) => action === 'pair')).toHaveLength(2)
  })

  it('blocks fractional launch values but allows Qwen Vision with speculation', async () => {
    const user = userEvent.setup()
    renderExpandedPage()
    fireEvent.click(screen.getByText('Choose model settings'))
    await user.click(screen.getByRole('button', { name: 'Installed model' }))
    await user.click(screen.getByRole('menuitemradio', { name: /^Qwen 3.8 27B — NVFP4/ }))
    expect(screen.getByLabelText('Graphics card 1: RTX 5090')).toBeChecked()
    const load = screen.getByRole('button', { name: 'Start model with these settings' })
    expect(load).toBeEnabled()
    fireEvent.change(screen.getByLabelText('Requests at once'), {
      target: { value: '1.5' },
    })
    expect(load).toBeDisabled()
    expect(screen.getByRole('alert')).toHaveTextContent('Use whole numbers')
    fireEvent.change(screen.getByLabelText('Requests at once'), {
      target: { value: '4' },
    })
    await user.click(screen.getByRole('button', { name: 'Reply speedup' }))
    await user.click(screen.getByRole('menuitemradio', { name: 'Automatic' }))
    expect(load).toBeEnabled()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Reply speedup' }))
    await user.click(screen.getByRole('menuitemradio', { name: 'Off' }))
    fireEvent.click(load)
    await waitFor(() =>
      expect(mocks.command).toHaveBeenCalledWith('launch', {
        host_id: 'host',
        body: expect.objectContaining({
          model_id: 'model',
          gpu_uuids: ['GPU-one'],
          concurrency: 4,
          spec: 'none',
        }),
      })
    )
  })

  it('retains unavailable host inventory without permitting a new load', async () => {
    const user = userEvent.setup()
    mocks.error =
      'error sending request for url (https://192.168.1.111:7444/host/v1/snapshot): tcp connect error: connection refused (os error 10061)'
    renderExpandedPage()
    fireEvent.click(screen.getByText('Choose model settings'))
    await user.click(screen.getByRole('button', { name: 'Installed model' }))
    await user.click(screen.getByRole('menuitemradio', { name: /^Qwen 3.8 27B — NVFP4/ }))
    fireEvent.click(screen.getByLabelText('Graphics card 1: RTX 5090'))
    expect(screen.getByRole('button', { name: 'Start model with these settings' })).toBeDisabled()
    expect(screen.getByText(/Computer not reachable/)).toHaveClass(
      'text-muted-foreground'
    )
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.queryByText(/error sending request/)).not.toBeInTheDocument()
    expect(mocks.command).not.toHaveBeenCalledWith('launch', expect.anything())
    await screen.findByText('Secure storage is ready.')
  })
  it('launches structured outputs by default and preserves explicit OFF and Host KV AUTO or zero', async () => {
    const user = userEvent.setup()
    renderExpandedPage()
    fireEvent.click(screen.getByText('Choose model settings'))
    fireEvent.click(screen.getByText('Advanced model settings'))
    await user.click(screen.getByRole('button', { name: 'Installed model' }))
    await user.click(screen.getByRole('menuitemradio', { name: /^Qwen 3.8 27B — NVFP4/ }))
    const structured = screen.getByRole('checkbox', {
      name: 'Follow a response format',
      exact: true,
    })
    const cache = screen.getByLabelText(
      'Computer conversation memory (bytes)'
    )
    const load = screen.getByRole('button', { name: 'Start model with these settings' })
    expect(structured).toBeChecked()
    expect(cache).toHaveValue(null)
    fireEvent.click(load)
    await waitFor(() =>
      expect(mocks.command).toHaveBeenCalledWith('launch', {
        host_id: 'host',
        body: expect.objectContaining({
          structured_outputs: true,
          host_kv_cache_bytes: null,
        }),
      })
    )
    await waitFor(() => expect(load).toBeEnabled())
    fireEvent.click(structured)
    fireEvent.change(cache, { target: { value: '0' } })
    fireEvent.click(load)
    await waitFor(() =>
      expect(mocks.command).toHaveBeenCalledWith('launch', {
        host_id: 'host',
        body: expect.objectContaining({
          structured_outputs: false,
          host_kv_cache_bytes: 0,
        }),
      })
    )
    await waitFor(() => expect(load).toBeEnabled())
    fireEvent.change(cache, { target: { value: '' } })
    fireEvent.click(load)
    await waitFor(() =>
      expect(mocks.command).toHaveBeenCalledWith('launch', {
        host_id: 'host',
        body: expect.objectContaining({
          structured_outputs: false,
          host_kv_cache_bytes: null,
        }),
      })
    )
  })

  it('loads saved structured-output OFF and disabled Host KV cache without resetting them', async () => {
    const profile: EngineLaunchProfile = {
      model_id: 'model',
      gpu_uuids: ['GPU-one'],
      max_context: 8192,
      concurrency: 1,
      vision: false,
      structured_outputs: false,
      spec: 'none',
      draft_tokens: 0,
      draft_tp: 0,
      kv_dtype: 'auto',
      kv_arena_bytes: null,
      host_kv_cache_bytes: 0,
      prefill_chunk: 0,
      no_cuda_graph: false,
    }
    mocks.instances = [
      {
        instance_id: 'instance',
        session_id: 'session',
        display_name: 'Saved model',
        upstream_model_id: 'model',
        status: 'ready',
        configuration: profile,
        profile,
      },
    ]
    spyConfirm().mockReturnValue(true)
    renderExpandedPage()
    fireEvent.click(screen.getByRole('button', { name: 'Edit settings' }))
    fireEvent.click(screen.getByText('Advanced model settings'))
    expect(
      screen.getByRole('checkbox', { name: 'Follow a response format', exact: true })
    ).not.toBeChecked()
    expect(
      screen.getByLabelText(
        'Computer conversation memory (bytes)'
      )
    ).toHaveValue(0)
    fireEvent.click(
      screen.getByRole('button', { name: 'Save and restart model' })
    )
    await waitFor(() =>
      expect(mocks.command).toHaveBeenCalledWith('reload', {
        host_id: 'host',
        instance_id: 'instance',
        body: expect.objectContaining({
          configuration: expect.objectContaining({
            structured_outputs: false,
            host_kv_cache_bytes: 0,
          }),
        }),
      })
    )
  })
  it('blocks pairing when storage is unavailable even after skipping setup', async () => {
    mocks.command.mockResolvedValue({
      ready: false,
      platform: 'linux',
      can_install: false,
    })
    renderExpandedPage()
    fireEvent.click(screen.getByText('Enter a host address manually'))
    fireEvent.change(screen.getByLabelText('Host address'), {
      target: { value: 'https://host:7443' },
    })
    await screen.findByText(
      'Secure storage is unavailable. Set it up or unlock it before connecting accounts or computers.'
    )
    fireEvent.click(screen.getByRole('button', { name: 'Skip for now' }))
    expect(screen.getByRole('button', { name: 'Pair host' })).toBeDisabled()
    expect(mocks.command).not.toHaveBeenCalledWith('pair', expect.anything())
  })
})

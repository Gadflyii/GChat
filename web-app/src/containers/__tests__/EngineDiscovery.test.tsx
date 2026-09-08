import { act, render, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { EngineDiscovery } from '@/containers/EngineDiscovery'
import { useEngineDiscovery } from '@/stores/engine-discovery-store'
import { localStorageKey } from '@/constants/localStorage'

const mocks = vi.hoisted(() => ({
  discover: vi.fn().mockResolvedValue(undefined),
  refresh: vi.fn().mockResolvedValue(undefined),
  info: vi.fn(),
}))
vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => true }))
vi.mock('sonner', () => ({ toast: { info: mocks.info } }))
vi.mock('@/stores/engine-hosts-store', () => ({ useEngineHosts: { getState: () => ({
  ...mocks, hosts: [{ host_id: 'paired' }], nearby: [
    { host_id: 'paired', name: 'Paired' }, { host_id: 'ignored', name: 'Ignored' },
    { host_id: 'new', name: 'New host' },
  ],
}) } }))

describe('LAN discovery preferences', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    useEngineDiscovery.setState({ enabled: true, ignored: {}, notified: [] })
  })

  it('honors disabled discovery while still refreshing paired hosts', async () => {
    // Read the saved preference as a new application session would.
    localStorage.setItem(localStorageKey.engineDiscovery, JSON.stringify({ state: { enabled: false, ignored: {}, notified: [] }, version: 0 }))
    await useEngineDiscovery.persist.rehydrate()
    const view = render(<EngineDiscovery />)
    await waitFor(() => expect(mocks.discover).toHaveBeenCalledWith(false))
    expect(mocks.refresh).toHaveBeenCalled()
    expect(mocks.info).not.toHaveBeenCalled()
    act(() => useEngineDiscovery.getState().setEnabled(true))
    await waitFor(() => expect(mocks.discover).toHaveBeenLastCalledWith(true))
    view.unmount()
  })

  it('suppresses paired, ignored, and previously notified hosts across mounts', async () => {
    useEngineDiscovery.getState().ignore('ignored', 'Ignored')
    const first = render(<EngineDiscovery />)
    await waitFor(() => expect(mocks.info).toHaveBeenCalledTimes(1))
    expect(mocks.info.mock.calls[0][0]).toContain('New host')
    first.unmount()
    await useEngineDiscovery.persist.rehydrate()
    const second = render(<EngineDiscovery />)
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalledTimes(2))
    expect(mocks.info).toHaveBeenCalledTimes(1)
    second.unmount()
    useEngineDiscovery.getState().restore('ignored')
    const third = render(<EngineDiscovery />)
    await waitFor(() => expect(mocks.info).toHaveBeenCalledTimes(2))
    expect(mocks.info.mock.calls[1][0]).toContain('Ignored')
    third.unmount()
  })
})

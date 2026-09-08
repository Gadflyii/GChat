import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { EngineIntake } from '@/containers/EngineIntake'
import { useEngineDiscovery } from '@/stores/engine-discovery-store'

vi.mock('@/stores/engine-hosts-store', () => ({ useEngineHosts: (select: (s: unknown) => unknown) => select({
  hosts: [], nearby: [{ host_id: 'server', name: 'Lab host' }],
}) }))

describe('network host intake', () => {
  beforeEach(() => useEngineDiscovery.setState({ enabled: true, ignored: {}, notified: [] }))
  it('offers the network path without requiring local hardware or a model', () => {
    const connect = vi.fn()
    const view = render(<EngineIntake onConnect={connect} />)
    expect(screen.getByText('Nearby: Lab host')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Connect a network host' }))
    expect(connect).toHaveBeenCalledOnce()
    view.unmount()
  })
  it('keeps manual intake available with discovery disabled', () => {
    useEngineDiscovery.getState().setEnabled(false)
    const view = render(<EngineIntake onConnect={vi.fn()} />)
    expect(screen.queryByText('Nearby: Lab host')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Connect a network host' })).toBeEnabled()
    view.unmount()
  })
})

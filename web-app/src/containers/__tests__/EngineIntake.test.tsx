import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { EngineIntake } from '@/containers/EngineIntake'
import { useEngineDiscovery } from '@/stores/engine-discovery-store'

const mocks = vi.hoisted(() => ({ hosts: [] as { host_id: string; local?: boolean }[] }))
vi.mock('@/stores/engine-hosts-store', () => ({ useEngineHosts: (select: (s: unknown) => unknown) => select({
  hosts: mocks.hosts, nearby: [{ host_id: 'server', name: 'Lab host' }],
}) }))

describe('network host intake', () => {
  beforeEach(() => {
    mocks.hosts = []
    useEngineDiscovery.setState({ enabled: true, ignored: {}, notified: [] })
  })
  it('offers the network path without requiring local hardware or a model', () => {
    const connect = vi.fn()
    const view = render(<EngineIntake onConnect={connect} />)
    expect(screen.getByText('Nearby: Lab host')).toBeInTheDocument()
    // Same card shape as the other first-run cards, so the screen reads as one list.
    expect(view.container.firstElementChild).toHaveClass('rounded-xl', 'p-5')
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
  it('does not call this computer\'s own host a paired network host', () => {
    mocks.hosts = [{ host_id: 'local', local: true }]
    const view = render(<EngineIntake onConnect={vi.fn()} />)
    expect(screen.queryByText(/paired host/)).not.toBeInTheDocument()
    view.unmount()
    mocks.hosts = [{ host_id: 'local', local: true }, { host_id: 'lab' }]
    render(<EngineIntake onConnect={vi.fn()} />)
    expect(screen.getByText(/1 paired host\s+available in GInfer Hosts\./)).toBeInTheDocument()
  })
})

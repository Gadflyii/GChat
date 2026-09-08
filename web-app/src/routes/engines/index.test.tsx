import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ComponentType, ReactNode } from 'react'

const mocks = vi.hoisted(() => ({ command: vi.fn(), refresh: vi.fn(), error: '' }))
vi.mock('@tanstack/react-router', () => ({ createFileRoute: () => (options: unknown) => ({ options }) }))
vi.mock('@/containers/HeaderPage', () => ({ default: ({ children }: { children: ReactNode }) => <div>{children}</div> }))
vi.mock('@/services/engines', () => ({ engineCommand: mocks.command }))
vi.mock('@/stores/engine-discovery-store', () => ({ useEngineDiscovery: () => ({ enabled: false, ignored: {}, setEnabled: vi.fn(), ignore: vi.fn(), restore: vi.fn() }) }))
vi.mock('@/stores/engine-hosts-store', () => ({ useEngineHosts: (selector?: (state: { refresh: typeof mocks.refresh }) => unknown) => {
  if (selector) return selector({ refresh: mocks.refresh })
  return {
    hosts: [{ host_id: 'host', name: 'Lab host', base_url: 'https://host:7443' }],
    nearby: [], errors: mocks.error ? { host: mocks.error } : {}, refresh: mocks.refresh,
    refreshing: false, discoveryError: null,
    snapshots: { host: { host_id: 'host', display_name: 'Lab host', revision: 1, instances: [],
      gpus: [{ uuid: 'GPU-one', name: 'RTX 5090', memory_mib: 32768 }],
      models: [{ id: 'model', artifact_set: false, path: '/models/qwen.ginfer', metadata: {
        identity: { model_id: 'qwen3.8-27b', weights_id: 'nvfp4' }, tp_size: 1, draft_tp: 0, size_bytes: 1024,
      } }],
    } },
  }
} }))
import { Route } from './index'
const Page = Route.options.component as ComponentType

beforeEach(() => {
  mocks.error = ''
  mocks.command.mockReset().mockImplementation(async (action: string) => action === 'credential_status' ? { ready: true, platform: 'linux', can_install: false } : {})
  mocks.refresh.mockReset().mockResolvedValue(undefined)
})
afterEach(cleanup)

describe('Engines host intake and launch controls', () => {
  it('requires a hexadecimal fingerprint and numeric pairing code before submitting', async () => {
    render(<Page />)
    fireEvent.change(screen.getByLabelText('Host address'), { target: { value: 'https://host:7443' } })
    fireEvent.change(screen.getByLabelText('Certificate SHA256'), { target: { value: 'z'.repeat(64) } })
    fireEvent.change(screen.getByLabelText('Pairing code'), { target: { value: 'abcdefgh' } })
    expect(screen.getByRole('button', { name: 'Pair host' })).toBeDisabled()
    fireEvent.change(screen.getByLabelText('Certificate SHA256'), { target: { value: 'a'.repeat(64) } })
    fireEvent.change(screen.getByLabelText('Pairing code'), { target: { value: '12345678' } })
    await waitFor(() => expect(screen.getByRole('button', { name: 'Pair host' })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: 'Pair host' }))
    await waitFor(() => expect(mocks.command).toHaveBeenCalledWith('pair', {
      base_url: 'https://host:7443', fingerprint: 'a'.repeat(64), code: '12345678',
    }))
  })

  it('blocks fractional launch values and the displayed Qwen vision conflict', async () => {
    render(<Page />)
    fireEvent.change(screen.getByLabelText('Model'), { target: { value: 'model' } })
    fireEvent.click(screen.getByLabelText(/RTX 5090 \(GPU-one\)/))
    const load = screen.getByRole('button', { name: 'Load model' })
    expect(load).toBeEnabled()
    fireEvent.change(screen.getByLabelText('Concurrent requests'), { target: { value: '1.5' } })
    expect(load).toBeDisabled()
    expect(screen.getByRole('alert')).toHaveTextContent('Use whole numbers')
    fireEvent.change(screen.getByLabelText('Concurrent requests'), { target: { value: '4' } })
    fireEvent.change(screen.getByLabelText('Speculative decoding'), { target: { value: 'auto' } })
    expect(load).toBeDisabled()
    expect(screen.getByRole('alert')).toHaveTextContent('Qwen Vision requires')
    fireEvent.change(screen.getByLabelText('Speculative decoding'), { target: { value: 'none' } })
    fireEvent.click(load)
    await waitFor(() => expect(mocks.command).toHaveBeenCalledWith('launch', {
      host_id: 'host', body: expect.objectContaining({ model_id: 'model', gpu_uuids: ['GPU-one'], concurrency: 4, spec: 'none' }),
    }))
  })

  it('retains unavailable host inventory without permitting a new load', () => {
    mocks.error = 'Connection refused'
    render(<Page />)
    fireEvent.change(screen.getByLabelText('Model'), { target: { value: 'model' } })
    fireEvent.click(screen.getByLabelText(/RTX 5090 \(GPU-one\)/))
    expect(screen.getByRole('button', { name: 'Load model' })).toBeDisabled()
    expect(screen.getByRole('alert')).toHaveTextContent('last known')
    expect(mocks.command).not.toHaveBeenCalledWith('launch', expect.anything())
  })
  it('blocks pairing when storage is unavailable even after skipping setup', async () => {
    mocks.command.mockResolvedValue({ ready: false, platform: 'linux', can_install: false })
    render(<Page />)
    fireEvent.change(screen.getByLabelText('Host address'), { target: { value: 'https://host:7443' } })
    fireEvent.change(screen.getByLabelText('Certificate SHA256'), { target: { value: 'a'.repeat(64) } })
    fireEvent.change(screen.getByLabelText('Pairing code'), { target: { value: '12345678' } })
    await screen.findByText('Secure storage is unavailable. Set it up or unlock it before pairing.')
    fireEvent.click(screen.getByRole('button', { name: 'Skip for now' }))
    expect(screen.getByRole('button', { name: 'Pair host' })).toBeDisabled()
    expect(mocks.command).not.toHaveBeenCalledWith('pair', expect.anything())
  })
})

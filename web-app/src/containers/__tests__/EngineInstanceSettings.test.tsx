import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { EngineInstanceSettings } from '@/containers/EngineInstanceSettings'
import type { EngineInstance } from '@/services/engines'

const instance: EngineInstance = {
  instance_id: 'instance', session_id: 'session', display_name: 'Muse', upstream_model_id: 'muse', status: 'ready',
  configuration: { gpu_uuids: ['GPU-one'], tp: 1, concurrency: 4, max_context: 16384, spec: 'auto', kv_dtype: 'auto', vision: true },
  model_metadata: { max_model_len: 8192 },
}
describe('engine-reported and requested configuration', () => {
  it('does not substitute requested context for the engine-reported limit', () => {
    const view = render(<EngineInstanceSettings instance={instance} online />)
    expect(screen.getByText('Engine-reported context: 8,192 tokens')).toBeInTheDocument()
    expect(screen.getByText(/Launch settings:.*16,384 context tokens/)).toBeInTheDocument()
    expect(screen.getByText(/Automatic launch settings are not measured runtime values/)).toBeInTheDocument()
    view.rerender(<EngineInstanceSettings instance={instance} online={false} />)
    expect(screen.getByText('Last reported context: 8,192 tokens')).toBeInTheDocument()
    view.unmount()
  })
  it('does not reuse stale metadata for a stopped or newly starting instance', () => {
    const view = render(<EngineInstanceSettings instance={{ ...instance, status: 'starting' }} online />)
    expect(screen.getByText('Effective context: not reported by a ready engine')).toBeInTheDocument()
    expect(screen.queryByText(/Engine-reported context/)).not.toBeInTheDocument()
    view.unmount()
  })
})

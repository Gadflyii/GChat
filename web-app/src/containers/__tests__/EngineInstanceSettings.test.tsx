import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { EngineInstanceSettings } from '@/containers/EngineInstanceSettings'
import type { EngineInstance } from '@/services/engines'

const instance: EngineInstance = {
  instance_id: 'instance', session_id: 'session', display_name: 'Muse', upstream_model_id: 'muse', status: 'ready',
  configuration: { gpu_uuids: ['GPU-one'], tp: 1, concurrency: 4, max_context: 16384, spec: 'auto', kv_dtype: 'auto', vision: true },
  model_metadata: { max_model_len: 8192 },
}

describe('engine-reported and configured settings', () => {
  it('separates the reported context from the configured values and explains the launch controls', () => {
    render(<EngineInstanceSettings instance={instance} online />)

    expect(screen.getByText('Engine-reported context: 8,192 tokens')).toBeVisible()
    const configured = screen.getByRole('region', { name: 'Configured launch settings' })
    expect(within(configured).getByText('Model split (TP): 1 GPU')).toBeVisible()
    expect(within(configured).getByText('Parallel requests (C): 4')).toBeVisible()
    expect(within(configured).getByText('Configured context limit: 16,384 tokens')).toBeVisible()
    expect(within(configured).getByText(/number of GPUs sharing this model/i)).toBeVisible()
    expect(within(configured).getByText(/requests the model can process at the same time/)).toBeVisible()
    expect(screen.getByText(/tokens \(pieces of text\)/)).toBeVisible()
    expect(screen.queryByText('Engine-reported context: 16,384 tokens')).not.toBeInTheDocument()
  })

  it('identifies cached context as last reported when the host is offline', () => {
    render(<EngineInstanceSettings instance={instance} online={false} />)

    expect(screen.getByText('Last reported context: 8,192 tokens')).toBeVisible()
    expect(screen.queryByText(/Engine-reported context/)).not.toBeInTheDocument()
  })

  it.each(['starting', 'stopped'] as const)('does not present stale context as effective when %s', (status) => {
    render(<EngineInstanceSettings instance={{ ...instance, status }} online />)

    expect(screen.getByText('Effective context: not reported by a ready engine')).toBeVisible()
    expect(screen.queryByText(/Engine-reported context/)).not.toBeInTheDocument()
    expect(screen.getByText('Configured context limit: 16,384 tokens')).toBeVisible()
  })

  it.each([undefined, 0, 8192.5])('does not invent an effective context for invalid metadata %s', (max_model_len) => {
    render(<EngineInstanceSettings instance={{ ...instance, model_metadata: { max_model_len } }} online />)

    expect(screen.getByText('Effective context: not reported by a ready engine')).toBeVisible()
    expect(screen.queryByText(/Engine-reported context/)).not.toBeInTheDocument()
  })

  it('uses the configured GPU group size when a TP number is absent', () => {
    render(<EngineInstanceSettings instance={{
      ...instance,
      configuration: { ...instance.configuration, tp: undefined, gpu_uuids: ['GPU-one', 'GPU-two'] },
    }} online />)

    expect(screen.getByText('Model split (TP): 2 GPUs')).toBeVisible()
  })

  it('labels automatic speculation and KV settings as configuration rather than resolved runtime values', () => {
    render(<EngineInstanceSettings instance={instance} online />)

    expect(screen.getByText('Speculative decoding: Automatic')).toBeVisible()
    expect(screen.getByText('Conversation memory (KV): Automatic')).toBeVisible()
    expect(screen.getByText(/Proposes tokens ahead for the model to check/)).toBeVisible()
    expect(screen.getByText(/Stores earlier tokens so the model can continue the conversation/)).toBeVisible()
    expect(screen.getByText(/Automatic launch settings are not measured runtime values/)).toBeVisible()
  })

  it.each([
    { spec: 'none', speculation: 'Disabled', kv_dtype: 'bf16', memory: 'BF16' },
    { spec: 'dflash', speculation: 'DFlash', kv_dtype: 'int8', memory: 'INT8' },
    { spec: 'mtp', speculation: 'MTP', kv_dtype: 'nvfp4', memory: 'NVFP4' },
  ] as const)('shows the requested $spec and $kv_dtype choices without relabeling them as automatic', ({ spec, speculation, kv_dtype, memory }) => {
    render(<EngineInstanceSettings instance={{
      ...instance,
      configuration: { ...instance.configuration, spec, kv_dtype },
    }} online />)

    expect(screen.getByText(`Speculative decoding: ${speculation}`)).toBeVisible()
    expect(screen.getByText(`Conversation memory (KV): ${memory}`)).toBeVisible()
    expect(screen.queryByText('Speculative decoding: Automatic')).not.toBeInTheDocument()
    expect(screen.queryByText('Conversation memory (KV): Automatic')).not.toBeInTheDocument()
  })

  it('keeps technical details collapsed until requested, without losing configured facts or reporting limits', async () => {
    const user = userEvent.setup()
    render(<EngineInstanceSettings instance={instance} online />)

    const summary = screen.getByText('Technical details')
    const vision = screen.getByText('Vision enabled')
    const graphs = screen.getByText('CUDA Graphs enabled')
    expect(summary).toBeVisible()
    expect(vision).not.toBeVisible()
    expect(graphs).not.toBeVisible()
    expect(screen.getByText('Structured outputs: not reported')).not.toBeVisible()

    await user.click(summary)

    expect(vision).toBeVisible()
    expect(graphs).toBeVisible()
    expect(screen.getByText('Structured outputs: not reported')).toBeVisible()
    expect(screen.getByText(/does not currently report resolved KV format, draft window, or graph state/)).toBeVisible()

    await user.click(summary)
    expect(vision).not.toBeVisible()
  })

  it('preserves explicit disabled technical settings and structured output choices', async () => {
    const user = userEvent.setup()
    const view = render(<EngineInstanceSettings instance={{
      ...instance,
      configuration: { ...instance.configuration, vision: false, no_cuda_graph: true, structured_outputs: true },
    }} online />)
    await user.click(screen.getByText('Technical details'))

    expect(screen.getByText('Vision disabled')).toBeVisible()
    expect(screen.getByText('CUDA Graphs disabled')).toBeVisible()
    expect(screen.getByText('Structured outputs: enabled')).toBeVisible()

    view.rerender(<EngineInstanceSettings instance={{
      ...instance,
      configuration: { ...instance.configuration, structured_outputs: false },
    }} online />)
    expect(screen.getByText('Structured outputs: disabled')).toBeVisible()
  })
})

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

    expect(screen.getByText('Conversation length reported by the model: 8,192 tokens')).toBeVisible()
    const configured = screen.getByRole('region', { name: 'Chosen model settings' })
    expect(within(configured).getByText('Graphics cards sharing this model: 1')).toBeVisible()
    expect(within(configured).getByText('Requests at once: 4')).toBeVisible()
    expect(within(configured).getByText('Chosen conversation limit: 16,384 tokens')).toBeVisible()
    expect(within(configured).getByText(/split across several matching cards/i)).toBeVisible()
    expect(within(configured).getByText(/replies the model can generate at the same time/)).toBeVisible()
    expect(screen.getByText(/tokens \(pieces of text\)/)).toBeVisible()
    expect(screen.queryByText('Conversation length reported by the model: 16,384 tokens')).not.toBeInTheDocument()
  })

  it('identifies cached context as last reported when the host is offline', () => {
    render(<EngineInstanceSettings instance={instance} online={false} />)

    expect(screen.getByText('Last reported conversation length: 8,192 tokens')).toBeVisible()
    expect(screen.queryByText(/Conversation length reported by the model/)).not.toBeInTheDocument()
  })

  it.each(['starting', 'stopped'] as const)('does not present stale context as effective when %s', (status) => {
    render(<EngineInstanceSettings instance={{ ...instance, status }} online />)

    expect(screen.getByText('The model has not reported its conversation length yet.')).toBeVisible()
    expect(screen.queryByText(/Conversation length reported by the model/)).not.toBeInTheDocument()
    expect(screen.getByText('Chosen conversation limit: 16,384 tokens')).toBeVisible()
  })

  it.each([undefined, 0, 8192.5])('does not invent an effective context for invalid metadata %s', (max_model_len) => {
    render(<EngineInstanceSettings instance={{ ...instance, model_metadata: { max_model_len } }} online />)

    expect(screen.getByText('The model has not reported its conversation length yet.')).toBeVisible()
    expect(screen.queryByText(/Conversation length reported by the model/)).not.toBeInTheDocument()
  })

  it('uses the configured GPU group size when a TP number is absent', () => {
    render(<EngineInstanceSettings instance={{
      ...instance,
      configuration: { ...instance.configuration, tp: undefined, gpu_uuids: ['GPU-one', 'GPU-two'] },
    }} online />)

    expect(screen.getByText('Graphics cards sharing this model: 2')).toBeVisible()
  })

  it('labels automatic speculation and KV settings as configuration rather than resolved runtime values', () => {
    render(<EngineInstanceSettings instance={instance} online />)

    expect(screen.getByText('Reply speedup: Automatic')).toBeVisible()
    expect(screen.getByText('Conversation memory format: Automatic')).toBeVisible()
    expect(screen.getByText(/Drafts text ahead for the model to check/)).toBeVisible()
    expect(screen.getByText(/Stores earlier text so the model can continue the conversation/)).toBeVisible()
    expect(screen.getByText(/Automatic means GInfer chooses a value/)).toBeVisible()
  })

  it.each([
    { spec: 'none', speculation: 'Off', kv_dtype: 'bf16', memory: 'BF16' },
    { spec: 'dflash', speculation: 'DFlash', kv_dtype: 'int8', memory: 'INT8' },
    { spec: 'mtp', speculation: 'MTP', kv_dtype: 'nvfp4', memory: 'NVFP4' },
  ] as const)('shows the requested $spec and $kv_dtype choices without relabeling them as automatic', ({ spec, speculation, kv_dtype, memory }) => {
    render(<EngineInstanceSettings instance={{
      ...instance,
      configuration: { ...instance.configuration, spec, kv_dtype },
    }} online />)

    expect(screen.getByText(`Reply speedup: ${speculation}`)).toBeVisible()
    expect(screen.getByText(`Conversation memory format: ${memory}`)).toBeVisible()
    expect(screen.queryByText('Reply speedup: Automatic')).not.toBeInTheDocument()
    expect(screen.queryByText('Conversation memory format: Automatic')).not.toBeInTheDocument()
  })

  it('keeps technical details collapsed until requested, without losing configured facts or reporting limits', async () => {
    const user = userEvent.setup()
    render(<EngineInstanceSettings instance={instance} online />)

    const summary = screen.getByText('Technical details')
    const vision = screen.getByText('Read images: on')
    const graphs = screen.getByText('CUDA Graphs enabled')
    expect(summary).toBeVisible()
    expect(vision).not.toBeVisible()
    expect(graphs).not.toBeVisible()
    expect(screen.getByText('Follow a response format: not reported')).not.toBeVisible()

    await user.click(summary)

    expect(vision).toBeVisible()
    expect(graphs).toBeVisible()
    expect(screen.getByText('Follow a response format: not reported')).toBeVisible()
    expect(screen.getByText(/does not currently report the memory format, amount of text drafted ahead or CUDA Graphs setting actually in use/)).toBeVisible()

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

    expect(screen.getByText('Read images: off')).toBeVisible()
    expect(screen.getByText('CUDA Graphs disabled')).toBeVisible()
    expect(screen.getByText('Follow a response format: on')).toBeVisible()

    view.rerender(<EngineInstanceSettings instance={{
      ...instance,
      configuration: { ...instance.configuration, structured_outputs: false },
    }} online />)
    expect(screen.getByText('Follow a response format: off')).toBeVisible()
  })
})

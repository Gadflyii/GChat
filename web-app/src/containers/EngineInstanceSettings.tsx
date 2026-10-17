import type { EngineInstance } from '@/services/engines'

export function EngineInstanceSettings({ instance, online }: { instance: EngineInstance; online: boolean }) {
  const reported = instance.model_metadata?.max_model_len
  const hasReported = typeof reported === 'number' && Number.isSafeInteger(reported) && reported > 0 && instance.status === 'ready'
  const config = instance.configuration
  const gpuCount = config.tp ?? config.gpu_uuids.length
  const speculation = { auto: 'Automatic', none: 'Disabled', dflash: 'DFlash', mtp: 'MTP' }[config.spec ?? 'auto']
  const kvFormat = config.kv_dtype === undefined || config.kv_dtype === 'auto' ? 'Automatic' : config.kv_dtype.toUpperCase()

  return <div className="space-y-3 text-sm text-muted-foreground">
    <p>{hasReported ? `${online ? 'Engine-reported' : 'Last reported'} context: ${reported.toLocaleString()} tokens` : 'Effective context: not reported by a ready engine'}</p>
    <p className="text-xs">Context is the space for input and generated text, measured in tokens (pieces of text).</p>
    <section aria-label="Configured launch settings" className="space-y-2">
      <p className="font-medium text-foreground">Configured launch settings</p>
      <p className="text-xs">These are the requested settings, separate from what the Engine reports above.</p>
      <div>
        <p>Model split (TP): {gpuCount} {gpuCount === 1 ? 'GPU' : 'GPUs'}</p>
        <p className="text-xs">The number of GPUs sharing this model.</p>
      </div>
      <div>
        <p>Parallel requests (C): {config.concurrency}</p>
        <p className="text-xs">The maximum number of requests the model can process at the same time.</p>
      </div>
      <p>Configured context limit: {config.max_context.toLocaleString()} tokens</p>
      <div>
        <p>Speculative decoding: {speculation}</p>
        <p className="text-xs">Proposes tokens ahead for the model to check, which can speed up replies. Automatic lets the Engine choose at startup.</p>
      </div>
      <div>
        <p>Conversation memory (KV): {kvFormat}</p>
        <p className="text-xs">Stores earlier tokens so the model can continue the conversation. Automatic lets the Engine choose the memory format at startup.</p>
      </div>
      <p className="text-xs">Automatic launch settings are not measured runtime values.</p>
    </section>
    <details className="space-y-1">
      <summary className="cursor-pointer">Technical details</summary>
      <p>Vision {config.vision ? 'enabled' : 'disabled'}</p>
      <p>CUDA Graphs {config.no_cuda_graph ? 'disabled' : 'enabled'}</p>
      <p>Structured outputs: {config.structured_outputs === undefined ? 'not reported' : config.structured_outputs ? 'enabled' : 'disabled'}</p>
      <p className="text-xs">The engine does not currently report resolved KV format, draft window, or graph state through its model endpoint.</p>
    </details>
  </div>
}

import type { EngineInstance } from '@/services/engines'

export function EngineInstanceSettings({ instance, online }: { instance: EngineInstance; online: boolean }) {
  const reported = instance.model_metadata?.max_model_len
  const hasReported = typeof reported === 'number' && Number.isSafeInteger(reported) && reported > 0 && instance.status === 'ready'
  const config = instance.configuration
  const gpuCount = config.tp ?? config.gpu_uuids.length
  const speculation = { auto: 'Automatic', none: 'Off', dflash: 'DFlash', mtp: 'MTP' }[config.spec ?? 'auto']
  const cpu = config.device === 'cpu'
  const kvFormat = config.kv_dtype === undefined || config.kv_dtype === 'auto' ? 'Automatic' : config.kv_dtype.toUpperCase()

  return <div className="space-y-3 text-sm text-muted-foreground">
    <p>{hasReported ? `${online ? 'Context length reported by the model' : 'Last reported context length'}: ${reported.toLocaleString()} tokens` : 'The model has not reported its context length yet.'}</p>
    <p className="text-xs">Context length includes your messages, earlier conversation and the reply. It is measured in tokens (pieces of text).</p>
    <section aria-label="Chosen model settings" className="space-y-2">
      <p className="font-medium text-foreground">Chosen model settings</p>
      <p className="text-xs">These are the settings you requested. The running model’s reported limit appears above.</p>
      <div>
        <p>Device: {cpu ? 'CPU' : 'GPU'}</p>
        <p className="text-xs">Where the model runs: NVIDIA graphics cards (GPU), or the processor and system memory (CPU).</p>
      </div>
      {!cpu && <div>
        <p>Tensor parallel (GPUs): {gpuCount}</p>
        <p className="text-xs">A model can use one graphics card or be split across several matching cards.</p>
      </div>}
      <div>
        <p>Concurrency: {config.concurrency}</p>
        <p className="text-xs">The maximum number of replies the model can generate at the same time.</p>
      </div>
      <p>Chosen context length: {config.max_context.toLocaleString()} tokens</p>
      <div>
        <p>Speculative Decoding: {speculation}</p>
        <p className="text-xs">Drafts text ahead for the model to check, which can speed up replies. DFlash and MTP are drafting methods. Automatic lets GInfer choose when the model starts.</p>
      </div>
      <div>
        <p>K/V cache format: {kvFormat}</p>
        <p className="text-xs">Stores earlier text so the model can continue the conversation. Automatic lets GInfer choose the memory format when the model starts.</p>
      </div>
      <p className="text-xs">Automatic means GInfer chooses a value; it does not show which value the running model is using.</p>
    </section>
    <details className="space-y-1">
      <summary className="cursor-pointer">Technical details</summary>
      <p>Vision: {config.vision ? 'on' : 'off'}</p>
      <p>CUDA Graphs {config.no_cuda_graph || cpu ? 'disabled' : 'enabled'}</p>
      <p>Structured outputs (JSON): {config.structured_outputs === undefined ? 'not reported' : config.structured_outputs ? 'on' : 'off'}</p>
      <p className="text-xs">Response formats let apps request replies such as JSON. CUDA Graphs reduce repeated setup work on the graphics card. GInfer does not currently report the memory format, amount of text drafted ahead or CUDA Graphs setting actually in use.</p>
    </details>
  </div>
}

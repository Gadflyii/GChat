import type { EngineInstance } from '@/services/engines'

export function EngineInstanceSettings({ instance, online }: { instance: EngineInstance; online: boolean }) {
  const reported = instance.model_metadata?.max_model_len
  const hasReported = typeof reported === 'number' && Number.isSafeInteger(reported) && reported > 0 && instance.status === 'ready'
  const config = instance.configuration
  return <div className="space-y-1 text-sm text-muted-foreground">
    <p>{hasReported ? `${online ? 'Engine-reported' : 'Last reported'} context: ${reported.toLocaleString()} tokens` : 'Effective context: not reported by a ready engine'}</p>
    <p>Launch settings: TP{config.tp ?? config.gpu_uuids.length} · C{config.concurrency} · {config.max_context.toLocaleString()} context tokens</p>
    <p>Vision {config.vision ? 'enabled' : 'disabled'} · Speculation {config.spec ?? 'auto'} · KV {config.kv_dtype ?? 'auto'} · CUDA Graphs {config.no_cuda_graph ? 'disabled' : 'enabled'}</p>
    <p className="text-xs">The engine does not currently report resolved KV format, draft window, or graph state through its model endpoint. Automatic launch settings are not measured runtime values.</p>
  </div>
}

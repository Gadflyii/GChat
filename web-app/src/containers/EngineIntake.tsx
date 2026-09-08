import { Button } from '@/components/ui/button'
import { useEngineHosts } from '@/stores/engine-hosts-store'
import { useEngineDiscovery } from '@/stores/engine-discovery-store'

/** LAN is an alternative to downloading a model, including on GPU-less clients. */
export function EngineIntake({ onConnect }: { onConnect: () => void }) {
  const nearby = useEngineHosts((s) => s.nearby)
  const hosts = useEngineHosts((s) => s.hosts)
  const { enabled, ignored } = useEngineDiscovery()
  const visible = enabled ? nearby.filter((h) => !ignored[h.host_id] && !hosts.some((saved) => saved.host_id === h.host_id)) : []
  return <section className="rounded-lg border p-4 space-y-2">
    <h2 className="font-medium">Use a GInfer host on your network</h2>
    <p className="text-sm text-muted-foreground">Already running GInfer elsewhere? Connect to its models without downloading weights or needing a GPU on this computer.</p>
    {!!visible.length && <p className="text-sm">Nearby: {visible.map((host) => host.name).join(', ')}</p>}
    {!!hosts.length && <p className="text-sm">{hosts.length} paired {hosts.length === 1 ? 'host' : 'hosts'} available in Engines.</p>}
    <Button variant="outline" onClick={onConnect}>Connect a network host</Button>
    <p className="text-xs text-muted-foreground">Pair a discovered host or enter its address manually.</p>
  </section>
}

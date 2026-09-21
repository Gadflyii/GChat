import type { EngineSnapshot } from '@/services/engines'

export function EngineHostSharing({ sharing }: { sharing: EngineSnapshot['lan_sharing'] }) {
  if (!sharing?.managed) return <p className="text-xs text-muted-foreground">LAN sharing is managed by the host service.</p>
  return <div className="rounded border p-3 space-y-2">
    <p className="text-xs text-muted-foreground">{sharing.active ? 'Other computers on your network can pair with this host.' : 'This host is available only on this computer.'} Changing sharing keeps local models running.</p>
    {sharing.error && <p role="alert" className="text-sm text-destructive">{sharing.error}</p>}
  </div>
}

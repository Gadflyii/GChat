import type { EngineSnapshot } from '@/services/engines'

export function EngineHostSharing({ sharing, managementNotice }: { sharing: EngineSnapshot['lan_sharing']; managementNotice?: string | null }) {
  return <div className="rounded border p-3 space-y-2">
    {managementNotice && <p role="status" className="text-sm text-muted-foreground">{managementNotice}</p>}
    {sharing?.managed ? <>
      <p className="text-xs text-muted-foreground">{sharing.active ? 'Other computers on your network can pair with this host.' : 'This host is available only on this computer.'} Changing sharing keeps local models running.</p>
      {sharing.notice && <p role="status" className="text-sm text-muted-foreground">{sharing.notice}</p>}
      {sharing.error && <p role="alert" className="text-sm text-destructive">{sharing.error}</p>}
    </> : <p className="text-xs text-muted-foreground">LAN sharing is managed by the host service.</p>}
  </div>
}

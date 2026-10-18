import type { EngineSnapshot } from '@/services/engines'

export function EngineHostSharing({ sharing, managementNotice }: { sharing: EngineSnapshot['lan_sharing']; managementNotice?: string | null }) {
  return (
    <div className="rounded border p-3 space-y-2">
      {managementNotice && <>
        <p role="status" className="text-sm text-muted-foreground">
          GChat is using a different connection address to manage models on this computer.
        </p>
        <details className="text-sm text-muted-foreground">
          <summary className="cursor-pointer">Technical details</summary>
          <p className="mt-2 break-words">{managementNotice}</p>
        </details>
      </>}
      {sharing?.managed ? <>
        <p className="text-xs text-muted-foreground">
          {sharing.active
            ? 'Other computers on your network can connect after you pair them.'
            : 'Only apps on this computer can connect.'}{' '}
          Changing network sharing keeps your models running.
        </p>
        {sharing.notice && <>
          <p role="status" className="text-sm text-muted-foreground">
            Network sharing is using a saved connection address.
          </p>
          <details className="text-sm text-muted-foreground">
            <summary className="cursor-pointer">Technical details</summary>
            <p className="mt-2 break-words">{sharing.notice}</p>
          </details>
        </>}
        {sharing.error && <>
          <p role="alert" className="text-sm text-destructive">
            Network sharing needs attention. Check your network connection and sharing settings, then try again.
          </p>
          <details className="text-sm text-muted-foreground">
            <summary className="cursor-pointer">Technical details</summary>
            <p className="mt-2 break-words">{sharing.error}</p>
          </details>
        </>}
      </> : <p className="text-xs text-muted-foreground">
        Network sharing is managed outside GChat by the GInfer service on this computer.
      </p>}
    </div>
  )
}

import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { engineCommand, type EngineSnapshot } from '@/services/engines'

type Pairing = { code: string; certificate_sha256: string; expires_in_seconds: number }

export function EngineHostSharing({ hostId, sharing }: { hostId: string; sharing: EngineSnapshot['lan_sharing'] }) {
  const [busy, setBusy] = useState(false)
  const [pairing, setPairing] = useState<Pairing | null>(null)
  const [expires, setExpires] = useState('')
  useEffect(() => { setPairing(null) }, [hostId, sharing?.active])
  if (!sharing?.managed) return <p className="text-xs text-muted-foreground">LAN sharing is managed by the host service. Desktop hosts need an updated host executable.</p>
  return <div className="rounded border p-3 space-y-2">
    <p className="text-xs text-muted-foreground">{sharing.active ? 'Visible to GChat on your network. Pairing is required to connect.' : 'This host is available only on this computer.'} Changing sharing keeps local models running.</p>
    {sharing.error && <p role="alert" className="text-sm text-destructive">{sharing.error}</p>}
    {sharing.active && <>
      <p className="text-xs text-muted-foreground">For manual pairing, use this computer’s LAN address with port {sharing.port}. Network access uses TCP {sharing.port} and discovery uses UDP 5353.</p>
      <Button variant="outline" disabled={busy} onClick={async () => {
        setBusy(true)
        setPairing(null)
        try {
          const result = await engineCommand<Pairing>('pairing', { host_id: hostId })
          setPairing(result)
          setExpires(new Date(Date.now() + result.expires_in_seconds * 1000).toLocaleTimeString())
        } catch (error) { toast.error(String(error)) } finally { setBusy(false) }
      }}>Generate pairing code</Button>
      {pairing && <div className="space-y-1 text-sm">
        <p>One-use pairing code: <strong className="font-mono select-all">{pairing.code}</strong> · expires at {expires}</p>
        <p className="break-all text-xs">Certificate SHA256: <span className="font-mono select-all">{pairing.certificate_sha256}</span></p>
        <p className="text-xs text-muted-foreground">Enter this code and verify the fingerprint on the other computer.</p>
      </div>}
    </>}
  </div>
}

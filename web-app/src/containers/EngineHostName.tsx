import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useEngineHosts } from '@/stores/engine-hosts-store'
import { engineCommand } from '@/services/engines'

export function EngineHostName() {
  const { hosts, snapshots, errors, refresh } = useEngineHosts()
  const host = hosts.find(host => host.local)
  const snapshot = host ? snapshots[host.host_id] : undefined
  const current = snapshot?.display_name ?? host?.name ?? ''
  const [name, setName] = useState(current)
  const [busy, setBusy] = useState(false)
  useEffect(() => { setName(current) }, [current])
  if (!host) return <p className="text-sm text-muted-foreground">Available when the local GInfer host is running.</p>
  return <div className="flex items-center gap-2">
    <Input aria-label="Host name" value={name} maxLength={80} disabled={busy || !snapshot?.lan_sharing?.managed || !!errors[host.host_id]} onChange={event => setName(event.target.value)} />
    <Button variant="outline" size="sm" disabled={busy || !snapshot?.lan_sharing?.managed || !!errors[host.host_id] || !name.trim() || name.trim() === current} onClick={async () => {
      setBusy(true)
      try {
        await engineCommand('host_name', { host_id: host.host_id, body: { name: name.trim() } })
        await refresh()
        toast.success('Host name saved')
      } catch (error) { toast.error(String(error)) } finally { setBusy(false) }
    }}>Save</Button>
  </div>
}

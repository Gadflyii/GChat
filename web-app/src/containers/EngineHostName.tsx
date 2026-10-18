import { useEffect, useRef, useState } from 'react'
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
  const [acceptedName, setAcceptedName] = useState<string | null>(null)
  const [busy, setBusy] = useState<'save' | 'refresh' | null>(null)
  const pending = useRef(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [refreshError, setRefreshError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  useEffect(() => { setName(current); setAcceptedName(null) }, [current])
  if (!host) return <p className="text-sm text-muted-foreground">Available when the local GInfer host is running.</p>
  const unavailable = !snapshot?.lan_sharing?.managed || !!errors[host.host_id]
  const cannotSave = unavailable || !name.trim() || name.trim() === (acceptedName ?? current)
  const refreshStatus = async () => {
    try { await refresh(); setRefreshError(null) }
    catch (error) { setRefreshError(String(error)) }
  }
  const save = async () => {
    if (pending.current || cannotSave) return
    pending.current = true
    setBusy('save')
    setSaveError(null)
    setRefreshError(null)
    setSaved(false)
    const submittedName = name.trim()
    try {
      try {
        await engineCommand('host_name', { host_id: host.host_id, body: { name: submittedName } })
      } catch (error) {
        setSaveError(String(error))
        toast.error('Could not save the Host name. Check the connection and try Save again.')
        return
      }
      setName(submittedName)
      setAcceptedName(submittedName)
      setSaved(true)
      toast.success('Host name saved')
      await refreshStatus()
    } finally { pending.current = false; setBusy(null) }
  }
  const retryStatus = async () => {
    if (pending.current) return
    pending.current = true
    setBusy('refresh')
    try { await refreshStatus() }
    finally { pending.current = false; setBusy(null) }
  }
  return <div className="space-y-2">
    <div className="flex items-center gap-2">
      <Input aria-label="Host name" value={name} maxLength={80} disabled={!!busy || unavailable} onChange={event => { setName(event.target.value); setSaved(false) }} />
      <Button type="button" variant="outline" size="sm" disabled={!!busy || cannotSave} onClick={save}>{busy === 'save' ? 'Saving…' : 'Save'}</Button>
    </div>
    {saved && <p role="status" className="text-sm text-muted-foreground">Host name saved.</p>}
    {saveError !== null && <div role="alert" className="space-y-2 text-sm text-destructive">
      <p>Could not save the Host name. Check the connection and try Save again.</p>
      <details><summary className="cursor-pointer">Technical details</summary><p className="mt-2 whitespace-pre-wrap break-words">{saveError}</p></details>
    </div>}
    {refreshError !== null && <div role="alert" className="space-y-2 text-sm text-destructive">
      <p>The name was saved, but GChat could not refresh its status. Try Retry status.</p>
      <details><summary className="cursor-pointer">Technical details</summary><p className="mt-2 whitespace-pre-wrap break-words">{refreshError}</p></details>
      <Button type="button" variant="outline" size="sm" disabled={!!busy} onClick={retryStatus}>{busy === 'refresh' ? 'Refreshing…' : 'Retry status'}</Button>
    </div>}
  </div>
}

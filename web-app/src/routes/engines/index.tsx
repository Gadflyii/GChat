import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import HeaderPage from '@/containers/HeaderPage'
import { CredentialSetup } from '@/containers/CredentialSetup'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { route } from '@/constants/routes'
import { engineCommand, type NearbyHost } from '@/services/engines'
import { useEngineHosts } from '@/stores/engine-hosts-store'
import { useEngineDiscovery } from '@/stores/engine-discovery-store'
import { HostCard } from '@/containers/EngineHostModels'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const Route = createFileRoute(route.engines.index as any)({ component: EnginesPage })

function EnginesPage() {
  const [credentialReady, setCredentialReady] = useState(false)
  const { hosts, nearby, snapshots, errors, refreshing, discoveryError, refresh } = useEngineHosts()
  const { enabled, ignored, setEnabled, ignore, restore } = useEngineDiscovery()
  const local = hosts.find(host => host.local)
  const sharing = local ? snapshots[local.host_id]?.lan_sharing : undefined
  const [sharingBusy, setSharingBusy] = useState(false)
  const share = async (enabled: boolean) => {
    if (!local) return
    setSharingBusy(true)
    try { await engineCommand('lan_sharing', { host_id: local.host_id, body: { enabled } }) }
    catch (error) { toast.error(String(error)) }
    finally {
      try { await refresh() } catch (error) { toast.error(String(error)) }
      setSharingBusy(false)
    }
  }
  const [selectedHost, setSelectedHost] = useState<NearbyHost | null>(null)
  const [address, setAddress] = useState('')
  const [fingerprint, setFingerprint] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    const update = () => void refresh().catch((e) => toast.error(String(e)))
    update()
  }, [refresh])
  const pair = async () => {
    if (!credentialReady) return
    setBusy(true)
    try {
      const result = await engineCommand<{ credential_cleanup_warning?: string }>('pair', { ...(selectedHost ? { host_id: selectedHost.host_id } : { base_url: address.trim() }), fingerprint: fingerprint.trim(), code: code.trim() })
      setCode(''); setFingerprint(''); setSelectedHost(null); await refresh(); toast.success('Host paired')
      if (result.credential_cleanup_warning) toast.warning(`Pairing saved; cleanup needs attention: ${result.credential_cleanup_warning}`)
    }
    catch (e) { toast.error(String(e)) } finally { setBusy(false) }
  }
  return <div className="flex h-full flex-col">
    <HeaderPage><div className="flex w-full items-center justify-between"><h1>GInfer Hosts</h1><Button variant="outline" disabled={refreshing} onClick={() => void refresh().catch((e) => toast.error(String(e)))}>Refresh</Button></div></HeaderPage>
    <main className="overflow-y-auto p-6 space-y-6">
      <p className="text-muted-foreground">Manage local serving and GInfer hosts on your network. Your computer does not need a local GPU to use remote hosts.</p>
      <div className="flex flex-wrap items-center gap-6">
      <label className="flex items-center gap-2"><input type="checkbox" role="switch" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />Discover nearby GInfer hosts</label>
        <label className="flex items-center gap-2"><input type="checkbox" checked={sharing?.enabled ?? false} disabled={!sharing?.managed || sharingBusy || !!(local && errors[local.host_id])} onChange={event => void share(event.target.checked)} />Share this host</label>
      </div>
      <p className="text-sm text-muted-foreground">Discovery finds other hosts. Sharing makes this host visible on your network; pairing is required to connect. Turning sharing off disconnects remote clients and keeps local models running.</p>
      {discoveryError && <p role="alert" className="text-sm text-destructive">Discovery unavailable: {discoveryError}. You can still enter a host address manually.</p>}
      {enabled && nearby.filter((h) => !ignored[h.host_id] && !hosts.some((saved) => saved.host_id === h.host_id)).map((host) => <div key={host.host_id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-4">
        <span>New host found: {host.name}</span><div className="flex gap-2">
          <Button onClick={() => { setSelectedHost(host); setCode(''); setFingerprint('') }}>Pair</Button>
          <Button variant="outline" onClick={() => { ignore(host.host_id, host.name); if (selectedHost?.host_id === host.host_id) setSelectedHost(null) }}>Ignore</Button>
        </div>
        <details className="w-full text-xs text-muted-foreground"><summary className="cursor-pointer">Connection details</summary>{host.urls.map(url => <p key={url} className="break-all font-mono">{url}</p>)}</details>
      </div>)}
      {!!Object.keys(ignored).length && <details className="rounded-lg border p-4"><summary className="cursor-pointer">Ignored hosts ({Object.keys(ignored).length})</summary><p className="text-sm text-muted-foreground">Ignored hosts do not appear in nearby results or trigger notifications. This does not revoke an existing pairing.</p>{Object.entries(ignored).map(([id, name]) => <div key={id} className="mt-2 flex items-center justify-between gap-2"><span>{name}</span><Button variant="outline" onClick={() => restore(id)}>Show again</Button></div>)}</details>}
      <section className="rounded-xl border p-5 space-y-3">
        <h2 className="font-semibold">{selectedHost ? `Pair with ${selectedHost.name}` : 'Pair a host manually'}</h2>
        <p className="text-sm text-muted-foreground">On the other computer, click Generate pairing code. Copy its code and certificate fingerprint here to confirm the connection.</p>
        {selectedHost ? <p className="text-sm text-muted-foreground">GChat chooses the connection automatically. <button className="underline" onClick={() => setSelectedHost(null)}>Enter an address manually</button></p> : <label className="block text-sm">Host address<Input placeholder="https://192.168.1.10:7444" value={address} onChange={(e) => setAddress(e.target.value)} /></label>}
        <label className="block text-sm">Certificate SHA256<Input placeholder="64 hexadecimal characters from the host" value={fingerprint} onChange={(e) => setFingerprint(e.target.value)} /></label>
        <label className="block text-sm">Pairing code<Input autoComplete="off" placeholder="Eight-digit code" value={code} onChange={(e) => setCode(e.target.value)} /></label>
        <CredentialSetup onReady={setCredentialReady} />
        <Button disabled={!credentialReady || busy || (!selectedHost && !address.trim()) || !/^[a-fA-F0-9]{64}$/.test(fingerprint.trim()) || !/^\d{8}$/.test(code.trim())} onClick={() => void pair()}>{busy ? 'Pairing…' : 'Pair host'}</Button>
      </section>
      {hosts.map((host) => <HostCard key={host.host_id} host={host} snapshot={snapshots[host.host_id]} error={errors[host.host_id]} />)}

    </main>
  </div>
}

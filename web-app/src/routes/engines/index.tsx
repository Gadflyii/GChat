import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import HeaderPage from '@/containers/HeaderPage'
import { CredentialSetup } from '@/containers/CredentialSetup'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { route } from '@/constants/routes'
import { engineCommand } from '@/services/engines'
import { useEngineHosts } from '@/stores/engine-hosts-store'
import { useEngineDiscovery } from '@/stores/engine-discovery-store'
import { HostCard } from '@/containers/EngineHostModels'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const Route = createFileRoute(route.engines.index as any)({ component: EnginesPage })

function EnginesPage() {
  const [credentialReady, setCredentialReady] = useState(false)
  const { hosts, nearby, snapshots, errors, refreshing, discoveryError, refresh } = useEngineHosts()
  const { enabled, ignored, setEnabled, ignore, restore } = useEngineDiscovery()
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
      const result = await engineCommand<{ credential_cleanup_warning?: string }>('pair', { base_url: address.trim(), fingerprint: fingerprint.trim(), code: code.trim() })
      setCode(''); setFingerprint(''); await refresh(); toast.success('Host paired')
      if (result.credential_cleanup_warning) toast.warning(`Pairing saved; cleanup needs attention: ${result.credential_cleanup_warning}`)
    }
    catch (e) { toast.error(String(e)) } finally { setBusy(false) }
  }
  return <div className="flex h-full flex-col">
    <HeaderPage><div className="flex w-full items-center justify-between"><h1>Engines</h1><Button variant="outline" disabled={refreshing} onClick={() => void refresh().catch((e) => toast.error(String(e)))}>Refresh</Button></div></HeaderPage>
    <main className="overflow-y-auto p-6 space-y-6">
      <p className="text-muted-foreground">Connect to GInfer hosts on your network. Your computer does not need a local GPU to use them.</p>
      <label className="flex items-center gap-2"><input type="checkbox" role="switch" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />Discover nearby GInfer hosts</label>
      <p className="text-sm text-muted-foreground">Turning discovery off stops LAN announcements from being browsed. Paired hosts still refresh; manual pairing remains available.</p>
      {discoveryError && <p role="alert" className="text-sm text-destructive">Discovery unavailable: {discoveryError}. You can still enter a host address manually.</p>}
      {enabled && nearby.filter((h) => !ignored[h.host_id] && !hosts.some((saved) => saved.host_id === h.host_id)).map((host) => <div key={host.host_id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-4">
        <span>New host found: {host.name}</span><div className="flex flex-wrap gap-2">{host.urls.map((url) => <Button variant="outline" key={url} onClick={() => setAddress(url)}>{url}</Button>)}<Button variant="outline" onClick={() => ignore(host.host_id, host.name)}>Ignore</Button></div>
      </div>)}
      {!!Object.keys(ignored).length && <details className="rounded-lg border p-4"><summary className="cursor-pointer">Ignored hosts ({Object.keys(ignored).length})</summary><p className="text-sm text-muted-foreground">Ignored hosts do not appear in nearby results or trigger notifications. This does not revoke an existing pairing.</p>{Object.entries(ignored).map(([id, name]) => <div key={id} className="mt-2 flex items-center justify-between gap-2"><span>{name}</span><Button variant="outline" onClick={() => restore(id)}>Show again</Button></div>)}</details>}
      <section className="rounded-xl border p-5 space-y-3">
        <h2 className="font-semibold">Pair a host</h2>
        <p className="text-sm text-muted-foreground">Enable pairing on the host, then copy its address, certificate fingerprint, and five-minute code here. Verify the fingerprint from the host’s own display.</p>
        <label className="block text-sm">Host address<Input placeholder="https://192.168.1.10:7443" value={address} onChange={(e) => setAddress(e.target.value)} /></label>
        <label className="block text-sm">Certificate SHA256<Input placeholder="64 hexadecimal characters from the host" value={fingerprint} onChange={(e) => setFingerprint(e.target.value)} /></label>
        <label className="block text-sm">Pairing code<Input autoComplete="off" placeholder="Eight-digit code" value={code} onChange={(e) => setCode(e.target.value)} /></label>
        <CredentialSetup onReady={setCredentialReady} />
        <Button disabled={!credentialReady || busy || !address.trim() || !/^[a-fA-F0-9]{64}$/.test(fingerprint.trim()) || !/^\d{8}$/.test(code.trim())} onClick={() => void pair()}>{busy ? 'Pairing…' : 'Pair host'}</Button>
      </section>
      {hosts.map((host) => <HostCard key={host.host_id} host={host} snapshot={snapshots[host.host_id]} error={errors[host.host_id]} />)}
    </main>
  </div>
}

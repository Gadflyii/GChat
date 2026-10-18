import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import HeaderPage from '@/containers/HeaderPage'
import { CredentialSetup } from '@/containers/CredentialSetup'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { IconRefresh } from '@tabler/icons-react'
import { route } from '@/constants/routes'
import { engineCommand } from '@/services/engines'
import { useEngineHosts } from '@/stores/engine-hosts-store'
import { useEngineDiscovery } from '@/stores/engine-discovery-store'
import { useBundledResources } from '@/hooks/useBundledResources'
import { HostCard } from '@/containers/EngineHostModels'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const Route = createFileRoute(route.engines.index as any)({ component: EnginesPage })

function validHostAddress(value: string) {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && !!url.hostname && url.pathname === '/'
      && !url.username && !url.password && !url.href.includes('?') && !url.href.includes('#')
  } catch { return false }
}

function EnginesPage() {
  const [credentialReady, setCredentialReady] = useState(false)
  const { hosts, nearby, snapshots, errors, refreshing, discoveryError, refresh } = useEngineHosts()
  const { enabled, ignored, setEnabled, ignore, restore } = useEngineDiscovery()
  const resources = useBundledResources()
  const resourcesReady = resources.ready === true && !resources.error
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
  const [address, setAddress] = useState('')
  const [pairError, setPairError] = useState<string | null>(null)
  const addressInvalid = !!address.trim() && !validHostAddress(address.trim())
  const [busy, setBusy] = useState<string | null>(null)
  useEffect(() => {
    const update = () => void refresh().catch((e) => toast.error(String(e)))
    update()
  }, [refresh])
  const pair = async (hostId?: string) => {
    if (!credentialReady || busy || (!hostId && (!address.trim() || addressInvalid))) return
    if (!hostId) setPairError(null)
    setBusy(hostId ?? 'manual')
    try {
      const result = await engineCommand<{ credential_cleanup_warning?: string }>('pair', hostId ? { host_id: hostId } : { base_url: address.trim() })
      setAddress(''); setPairError(null); await refresh(); toast.success('Host paired')
      if (result.credential_cleanup_warning) toast.warning(`Pairing saved; cleanup needs attention: ${result.credential_cleanup_warning}`)
    }
    catch (e) {
      if (hostId) toast.error(String(e))
      else setPairError(String(e))
    } finally { setBusy(null) }
  }
  return <div className="flex h-svh min-h-0 flex-col overflow-hidden">
    <HeaderPage><div className="flex w-full items-center justify-between pr-4"><h1>GInfer Hosts</h1><Button size="sm" variant="outline" disabled={refreshing || !resourcesReady} aria-describedby={!resourcesReady ? 'host-runtime-preparation' : undefined} onClick={() => void refresh().catch((e) => toast.error(String(e)))}><IconRefresh size={16} className={refreshing ? 'animate-spin' : undefined} />Refresh</Button></div></HeaderPage>
    <main className="min-h-0 flex-1 overflow-y-auto p-6 space-y-6">
      <p className="text-muted-foreground">Manage local serving and GInfer hosts on your network. Your computer does not need a local GPU to use remote hosts.</p>
      {!resourcesReady && (resources.error
        ? <div id="host-runtime-preparation" role="alert" className="space-y-2 text-sm text-destructive"><p>Could not prepare GInfer to run models on this computer. Restart GChat to try again. If this keeps happening, reinstall GChat.</p><details><summary className="cursor-pointer">GInfer preparation error details</summary><p className="whitespace-pre-wrap break-all">{resources.error}</p></details></div>
        : <p id="host-runtime-preparation" role="status" className="text-sm">Preparing GInfer to run models on this computer… GChat is installing and checking its bundled files. This may take a few minutes. The local Host will appear when it is ready; Refresh is waiting for preparation to finish.</p>)}
      <div className="flex flex-wrap items-center gap-6">
      <div className="flex items-center gap-2"><Switch id="discover-hosts" checked={enabled} onCheckedChange={setEnabled} /><label htmlFor="discover-hosts">Discover nearby GInfer hosts</label></div>
        <div className="flex items-center gap-2"><Switch id="share-host" checked={sharing?.enabled ?? false} disabled={!sharing?.managed || sharingBusy || !!(local && errors[local.host_id])} onCheckedChange={(checked) => void share(checked)} /><label htmlFor="share-host">Share this host</label></div>
      </div>
      <p className="text-sm text-muted-foreground">Discovery finds other hosts. Sharing lets other computers on your network pair with this host. Turning sharing off disconnects remote clients and keeps local models running.</p>
      {discoveryError && <p role="alert" className="text-sm text-destructive">Discovery unavailable: {discoveryError}. You can still enter a host address manually.</p>}
      <CredentialSetup onReady={setCredentialReady} />
      {enabled && nearby.filter((h) => !ignored[h.host_id] && !hosts.some((saved) => saved.host_id === h.host_id)).map((host) => <div key={host.host_id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-4">
        <span>New host found: {host.name}</span><div className="flex gap-2">
          <Button aria-describedby={credentialReady ? undefined : `pair-needs-storage-${host.host_id}`} disabled={!credentialReady || busy !== null} onClick={() => void pair(host.host_id)}>{busy === host.host_id ? 'Pairing…' : 'Pair'}</Button>
          <Button variant="outline" disabled={busy === host.host_id} onClick={() => ignore(host.host_id, host.name)}>Ignore</Button>
        </div>
        {!credentialReady && <p id={`pair-needs-storage-${host.host_id}`} className="w-full text-sm text-muted-foreground">Pairing needs secure storage. Choose Check secure storage above first.</p>}
        <details className="w-full text-xs text-muted-foreground"><summary className="cursor-pointer">Connection details</summary>{host.urls.map(url => <p key={url} className="break-all font-mono">{url}</p>)}</details>
      </div>)}
      {!!Object.keys(ignored).length && <details className="rounded-lg border p-4"><summary className="cursor-pointer">Ignored hosts ({Object.keys(ignored).length})</summary><p className="text-sm text-muted-foreground">Ignored hosts do not appear in nearby results or trigger notifications. This does not revoke an existing pairing.</p>{Object.entries(ignored).map(([id, name]) => <div key={id} className="mt-2 flex items-center justify-between gap-2"><span>{name}</span><Button variant="outline" onClick={() => restore(id)}>Show again</Button></div>)}</details>}
      <details className="rounded-xl border p-5 space-y-3">
        <summary className="cursor-pointer font-semibold">Enter a host address manually</summary>
        <label className="block text-sm">Host address<Input placeholder="https://192.168.1.10:7444" value={address} disabled={busy === 'manual'} aria-invalid={addressInvalid || undefined} aria-describedby={`host-address-help${addressInvalid ? ' host-address-error' : ''}${pairError !== null ? ' host-pair-error' : ''}`} onChange={(e) => { setAddress(e.target.value); setPairError(null) }} /></label>
        <p id="host-address-help" className="text-sm text-muted-foreground">Enter the HTTPS address shown by the other computer, for example https://192.168.1.10:7444.</p>
        {addressInvalid && <p id="host-address-error" role="alert" className="text-sm text-destructive">Use an address starting with https:// and only the host name or IP address and port. Remove any sign-in details, path, question mark or # fragment.</p>}
        {pairError !== null && <div id="host-pair-error" role="alert" className="space-y-2 text-sm text-destructive"><p>Could not pair this host. Check the address and that GInfer sharing is on at the other computer, then choose Pair host to try again.</p><details><summary className="cursor-pointer">Pairing error details</summary><p className="whitespace-pre-wrap break-all">{pairError}</p></details></div>}
        <Button aria-describedby={credentialReady ? undefined : 'pair-needs-storage'} disabled={!credentialReady || busy !== null || !address.trim() || addressInvalid} onClick={() => void pair()}>{busy === 'manual' ? 'Pairing…' : 'Pair host'}</Button>
        {!credentialReady && <p id="pair-needs-storage" className="text-sm text-muted-foreground">Pairing needs secure storage. Choose Check secure storage above first.</p>}
      </details>
      {hosts.map((host) => <HostCard key={host.host_id} host={host} snapshot={snapshots[host.host_id]} error={errors[host.host_id]} />)}

    </main>
  </div>
}

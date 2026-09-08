import { useCallback, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { engineCommand } from '@/services/engines'

type Status = { ready: boolean; platform: string; can_install: boolean; error?: string }

/** Shared first-run and pairing prerequisite. Skipping never authorizes pairing. */
export function CredentialSetup({ onReady }: { onReady?: (ready: boolean) => void }) {
  const [status, setStatus] = useState<Status>()
  const [busy, setBusy] = useState(false)
  const [skipped, setSkipped] = useState(false)
  const [guide, setGuide] = useState(false)
  const [message, setMessage] = useState('')
  const check = useCallback(async () => {
    setBusy(true)
    onReady?.(false)
    try {
      const result = await engineCommand<Status>('credential_status')
      setStatus(result)
      onReady?.(result.ready === true)
    } catch (error) {
      setStatus({ ready: false, platform: 'unknown', can_install: false, error: String(error) })
    } finally { setBusy(false) }
  }, [onReady])
  useEffect(() => { void check() }, [check])
  const install = async () => {
    setBusy(true)
    setMessage('Approve the system administrator prompt to install GNOME Keyring. GChat never receives your administrator password.')
    try {
      await engineCommand('credential_install', { confirmed: true })
      setMessage('Installation finished. If secure storage is still unavailable, sign out and back in, then unlock your keyring and check again.')
      await check()
    } catch (error) { setMessage(String(error)) }
    finally { setBusy(false) }
  }
  if (status?.ready) return <p className="text-sm text-muted-foreground" role="status">Secure credential storage is ready for LAN pairing.</p>
  if (skipped) return <div className="text-sm"><p>LAN pairing needs secure storage. Local models remain available.</p><Button variant="outline" onClick={() => setSkipped(false)}>Set up secure storage</Button></div>
  return <section className="rounded-lg border p-4 space-y-3" aria-label="Secure storage setup">
    <h3 className="font-medium">Secure storage for your LAN connections</h3>
    <p className="text-sm text-muted-foreground">GChat stores pairing credentials in your desktop keyring, never in plain text. This is needed only on this computer, not your inference servers. Your desktop may ask you to unlock its keyring.</p>
    {busy && <p role="status">Checking or setting up secure storage…</p>}
    {!busy && status && <p role="alert">Secure storage is unavailable. Set it up or unlock it before pairing.</p>}
    {status?.can_install && <p className="text-sm">Automatic setup installs GNOME Keyring through your system package manager. Clicking below requests administrator approval; nothing is installed silently.</p>}
    <div className="flex flex-wrap gap-2">
      <Button disabled={busy} onClick={() => status?.can_install ? void install() : setGuide(true)}>Set up secure storage</Button>
      <Button variant="outline" disabled={busy} onClick={() => void check()}>Check again</Button>
      <Button variant="ghost" onClick={() => setSkipped(true)}>Skip for now</Button>
    </div>
    {guide && <div className="text-sm space-y-2">
      <p>On Linux, open your system software manager and install GNOME Keyring if no Secret Service provider is installed. If a keyring is already installed, unlock it using your desktop’s password/keyring application. Sign out and back in if the service is not running, then click Check again.</p>
      <p>On Windows, GChat uses Windows Credential Manager. If it is unavailable, check your Windows credential-service settings or contact your administrator.</p>
      <p>Automatic installation is offered only on supported Linux distributions with an administrator authentication service. GChat does not replace an existing keyring or change its password.</p>
    </div>}
    {!!message && <p role="status" className="text-sm whitespace-pre-wrap">{message}</p>}
    {status?.error && <details className="text-xs"><summary>Diagnostic details</summary><p className="break-words">{status.error}</p></details>}
  </section>
}

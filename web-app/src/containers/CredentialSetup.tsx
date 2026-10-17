import { useCallback, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { engineCommand } from '@/services/engines'

type Status = {
  ready: boolean
  platform: string
  can_install: boolean
  tier?: 'native' | 'passphrase' | null
  state?: string
  can_create?: boolean
  migrating?: boolean
  error?: string
}

/** Shared first-run and pairing prerequisite. Skipping never authorizes pairing. */
export function CredentialSetup({
  onReady,
}: {
  onReady?: (ready: boolean) => void
}) {
  const [status, setStatus] = useState<Status>()
  const [busy, setBusy] = useState(false)
  const [skipped, setSkipped] = useState(false)
  const [guide, setGuide] = useState(false)
  const [message, setMessage] = useState('')
  const [intent, setIntent] = useState<'create' | 'unlock'>()
  const [passphrase, setPassphrase] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const check = useCallback(
    async (interactive = false) => {
      setBusy(true)
      onReady?.(false)
      try {
        const result = await engineCommand<Status>('credential_status', {
          check: interactive,
        })
        setStatus(result)
        onReady?.(result.ready === true)
      } catch (error) {
        setStatus({
          ready: false,
          platform: 'unknown',
          can_install: false,
          error: String(error),
        })
      } finally {
        setBusy(false)
      }
    },
    [onReady]
  )
  useEffect(() => {
    void check()
  }, [check])
  const install = async () => {
    setBusy(true)
    setMessage(
      'Approve the system administrator prompt to install GNOME Keyring. GChat never receives your administrator password.'
    )
    try {
      await engineCommand('credential_install', { confirmed: true })
      setMessage(
        'Installation finished. If secure storage is still unavailable, sign out and back in, then unlock your keyring and check again.'
      )
      await check(true)
    } catch (error) {
      setMessage(String(error))
    } finally {
      setBusy(false)
    }
  }
  const change = async (action: 'create' | 'unlock' | 'lock') => {
    if (
      action === 'create' &&
      !status?.migrating &&
      passphrase !== confirmation
    ) {
      setMessage('The passphrases do not match.')
      return
    }
    const secret = passphrase
    setPassphrase('')
    setConfirmation('')
    setMessage('')
    setBusy(true)
    onReady?.(false)
    try {
      const result = await engineCommand<Status>(
        `credential_${action}`,
        action === 'lock'
          ? {}
          : {
              passphrase: secret,
              ...(action === 'create' ? { confirmed: true } : {}),
            }
      )
      setStatus(result)
      onReady?.(result.ready === true)
      setIntent(undefined)
    } catch (error) {
      setMessage(String(error))
      await check()
    } finally {
      setBusy(false)
    }
  }
  const choose = (action: 'create' | 'unlock') => {
    setIntent(action)
    setPassphrase('')
    setConfirmation('')
    setMessage('')
  }
  if (status?.ready && !intent)
    return (
      <section
        className="rounded-xl border p-5 space-y-3"
        aria-label="Secure storage setup"
      >
        <h3 className="font-medium">Secure storage</h3>
        <p className="text-sm" role="status">
          Secure storage is ready.
        </p>
        <p className="text-sm text-muted-foreground">
          GChat can now protect your connected accounts, Gbot access keys and
          connections to other computers. You can continue setup.
        </p>
        {status.tier === 'passphrase' && (
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => void change('lock')}
          >
            Lock vault
          </Button>
        )}
        {status.tier === 'native' && status.platform === 'linux' && (
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => choose('create')}
          >
            Use a passphrase vault
          </Button>
        )}
        {!!message && (
          <p role="alert" className="text-sm">
            {message}
          </p>
        )}
      </section>
    )
  if (skipped)
    return (
      <section
        className="rounded-xl border p-5 space-y-3"
        aria-label="Secure storage setup"
      >
        <h3 className="font-medium">Secure storage</h3>
        <p className="text-sm">
          Setup skipped. Local models remain available. Set up secure storage
          before connecting accounts, Gbot or another computer.
        </p>
        <Button variant="outline" onClick={() => setSkipped(false)}>
          Set up secure storage
        </Button>
      </section>
    )
  return (
    <section
      className="rounded-xl border p-5 space-y-3"
      aria-label="Secure storage setup"
    >
      <h3 className="font-medium">Secure storage</h3>
      <p className="text-sm text-muted-foreground">
        Secure storage protects the sign-in details and access keys GChat uses
        for connected accounts, Gbot and other computers. Check it now to make
        sure these connections can be saved safely. Local models do not need
        this step.
      </p>
      {busy && <p role="status">Checking or setting up secure storage…</p>}
      {!busy && status && !status.ready && (
        <p role={status.state === 'unchecked' ? 'status' : 'alert'}>
          {status.state === 'unchecked'
            ? 'Choose Check secure storage to confirm it is ready. Your computer may ask you to unlock its password storage. GChat only opens this storage when you ask to check it or connect an account or computer.'
            : 'Secure storage is unavailable. Set it up or unlock it before connecting accounts or computers.'}
        </p>
      )}
      {(status?.tier === 'passphrase' ||
        intent === 'create' ||
        status?.migrating) && (
        <p className="text-sm">
          A passphrase vault is a password-protected store for your connection
          details. Unlock it after restarting GChat; tasks that need saved
          connections wait until then. Keep your passphrase safe. If you lose
          it, you will need to reconnect your accounts and computers.
        </p>
      )}
      {intent && (
        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault()
            void change(intent)
          }}
        >
          {intent === 'create' && (
            <p className="text-sm">
              {status?.migrating
                ? 'Enter the same passphrase to finish moving your saved connections into the vault.'
                : 'Choose a passphrase to protect your saved connections. GChat copies any connection details it already uses into the vault and checks the copies before switching. The originals stay in your computer’s password storage.'}
            </p>
          )}
          <label className="block text-sm">
            Passphrase
            <input
              className="block w-full rounded-md border bg-background p-2"
              type="password"
              required
              autoComplete={
                intent === 'create' && !status?.migrating
                  ? 'new-password'
                  : 'current-password'
              }
              value={passphrase}
              onChange={(event) => setPassphrase(event.target.value)}
            />
          </label>
          {intent === 'create' && !status?.migrating && (
            <label className="block text-sm">
              Confirm passphrase
              <input
                className="block w-full rounded-md border bg-background p-2"
                type="password"
                required
                autoComplete="new-password"
                value={confirmation}
                onChange={(event) => setConfirmation(event.target.value)}
              />
            </label>
          )}
          <div className="flex gap-2">
            <Button type="submit" disabled={busy}>
              {intent === 'unlock'
                ? 'Unlock vault'
                : status?.migrating
                  ? 'Resume migration'
                  : 'Create passphrase vault'}
            </Button>
            <Button
              type="button"
              variant="ghost"
              disabled={busy}
              onClick={() => {
                setIntent(undefined)
                setPassphrase('')
                setConfirmation('')
              }}
            >
              Cancel
            </Button>
          </div>
        </form>
      )}
      {status?.can_install && (
        <p className="text-sm">
          On this Linux computer, Set up secure storage installs GNOME Keyring,
          an app that protects saved passwords. Your computer will ask for
          administrator approval before installing it.
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        {!intent && status?.tier === 'passphrase' && (
          <Button disabled={busy} onClick={() => choose('unlock')}>
            Unlock vault
          </Button>
        )}
        {!intent && status?.migrating && (
          <Button disabled={busy} onClick={() => choose('create')}>
            Resume migration
          </Button>
        )}
        {!intent && status?.can_create && !status.migrating && (
          <Button disabled={busy} onClick={() => choose('create')}>
            Use a passphrase vault
          </Button>
        )}
        {status?.tier !== 'passphrase' && status?.state !== 'unchecked' && (
          <Button
            disabled={busy}
            onClick={() =>
              status?.can_install ? void install() : setGuide(true)
            }
          >
            Set up secure storage
          </Button>
        )}
        <Button
          variant={status?.state === 'unchecked' ? 'default' : 'outline'}
          disabled={busy}
          onClick={() => void check(true)}
        >
          {status?.state === 'unchecked'
            ? 'Check secure storage'
            : 'Check again'}
        </Button>
        <Button variant="ghost" onClick={() => setSkipped(true)}>
          Skip for now
        </Button>
      </div>
      {guide && (
        <div className="text-sm space-y-2">
          <p>
            On Linux, open your system software manager and install GNOME
            Keyring if no Secret Service provider is installed. If a keyring is
            already installed, unlock it using your desktop’s password/keyring
            application. Sign out and back in if the service is not running,
            then click Check again.
          </p>
          <p>
            On Windows, GChat uses Windows Credential Manager. If it is
            unavailable, check your Windows credential-service settings or
            contact your administrator.
          </p>
          <p>
            Automatic installation is offered only on supported Linux
            distributions with an administrator authentication service. GChat
            does not replace an existing keyring or change its password.
          </p>
        </div>
      )}
      {!!message && (
        <p role="status" className="text-sm whitespace-pre-wrap">
          {message}
        </p>
      )}
      {status?.error && (
        <details className="text-xs">
          <summary>Diagnostic details</summary>
          <p className="break-words">{status.error}</p>
        </details>
      )}
    </section>
  )
}

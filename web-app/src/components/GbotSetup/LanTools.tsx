import { useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { gbot, type LanPreparation } from '@/services/gbot'

export default function LanTools({
  workspaceId,
  ready,
  busy,
  cloud = false,
  disabled = false,
  canStart,
}: {
  workspaceId: string
  ready: (value: boolean) => void
  busy: (value: boolean) => void
  cloud?: boolean
  disabled?: boolean
  canStart?: () => boolean
}) {
  const [consent, setConsent] = useState(false)
  const [action, setAction] = useState<'prepare' | 'check' | null>(null)
  const pending = useRef(false)
  const working = action !== null
  const [command, setCommand] = useState('')
  const [installed, setInstalled] = useState(false)
  const [issue, setIssue] = useState<{
    message: string
    action: 'prepare' | 'check'
    diagnostic: boolean
  } | null>(null)
  const run = async (prepare: boolean) => {
    if (pending.current || disabled || (canStart && !canStart())) return
    pending.current = true
    setAction(prepare ? 'prepare' : 'check')
    busy(true)
    ready(false)
    setInstalled(false)
    setCommand('')
    setIssue(null)
    try {
      const result = await gbot<LanPreparation>(
        prepare ? 'workspaces/ssh/prepare' : 'workspaces/ssh/tools',
        { workspace_id: workspaceId, ...(prepare ? { consent } : {}) }
      )
      setCommand(result.command ?? '')
      if (result.issue) {
        setIssue({
          message: result.issue,
          action: prepare ? 'prepare' : 'check',
          diagnostic: /^Guest (archive|installer) upload failed:/.test(
            result.issue
          ),
        })
      }
      setInstalled(result.installed)
      ready(result.installed)
    } catch (cause) {
      setIssue({
        message: String(cause instanceof Error ? cause.message : cause),
        action: prepare ? 'prepare' : 'check',
        diagnostic: true,
      })
    } finally {
      pending.current = false
      setAction(null)
      busy(false)
    }
  }
  return (
    <div className="space-y-2">
      <p>
        SSH access verified. Gbot needs desktop, browser and media tools so it
        can see and use this computer. Choose Check tools if they are already
        installed, or approve installation and choose Prepare tools for this
        dedicated Debian 13 computer.
      </p>
      <label className="flex items-start gap-2">
        <input
          type="checkbox"
          className="mt-1 size-4 shrink-0 accent-primary"
          checked={consent}
          disabled={working || disabled}
          onChange={(event) => setConsent(event.target.checked)}
        />
        This computer is dedicated to Gbot. I authorize installing its desktop,
        browser, driver and media tools.
      </label>
      <p className="text-xs text-muted-foreground">
        {cloud
          ? 'GChat installs the pinned tools through the computer’s setup helper.'
          : 'Sign out of graphical sessions first. Your SSH settings and firewall stay in place.'}
      </p>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          disabled={working || disabled || !consent}
          onClick={() => void run(true)}
        >
          {action === 'prepare' ? 'Preparing tools…' : 'Prepare tools'}
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={working || disabled}
          onClick={() => void run(false)}
        >
          {action === 'check' ? 'Checking tools…' : 'Check tools'}
        </Button>
      </div>
      {working && (
        <p role="status" aria-live="polite">
          {action === 'prepare'
            ? 'Preparing tools on the bot computer…'
            : 'Checking tools on the bot computer…'}
        </p>
      )}
      {command && (
        <div className="space-y-2">
          <p>
            Open a terminal on the bot computer and run this command as the SSH
            user you entered above. Enter that computer’s administrator password
            there if asked, then return here and choose Check tools. Ask the
            computer’s owner for help if you cannot install software.
          </p>
          <textarea
            aria-label="Bot tools administrator command"
            readOnly
            className="min-h-16 w-full rounded-md border bg-background p-2 font-mono text-xs"
            value={command}
          />
        </div>
      )}
      {issue && (
        <div role="alert" className="space-y-2 text-destructive">
          {issue.diagnostic ? (
            <>
              <p>
                {issue.action === 'prepare'
                  ? 'GChat could not finish preparing the tools. Check the computer’s connection and available disk space, then choose Prepare tools to try again. If you already ran the installation command, choose Check tools first.'
                  : 'GChat could not check the tools. Check the computer’s connection, then choose Check tools to try again.'}
              </p>
              <details>
                <summary className="cursor-pointer">Details</summary>
                <p className="whitespace-pre-wrap break-words">
                  {issue.message}
                </p>
              </details>
            </>
          ) : (
            <p className="whitespace-pre-wrap break-words">{issue.message}</p>
          )}
        </div>
      )}
      {installed && (
        <p role="status">
          Tools installed. Continue to connect and check the bot desktop.
        </p>
      )}
    </div>
  )
}

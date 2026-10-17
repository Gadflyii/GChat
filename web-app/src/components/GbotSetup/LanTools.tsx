import { useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { gbot, type LanPreparation } from '@/services/gbot'

export default function LanTools({
  workspaceId,
  ready,
  busy,
  cloud = false,
}: {
  workspaceId: string
  ready: (value: boolean) => void
  busy: (value: boolean) => void
  cloud?: boolean
}) {
  const [consent, setConsent] = useState(false)
  const [action, setAction] = useState<'prepare' | 'check' | null>(null)
  const pending = useRef(false)
  const working = action !== null
  const [command, setCommand] = useState('')
  const [installed, setInstalled] = useState(false)
  const [issue, setIssue] = useState('')
  const run = async (prepare: boolean) => {
    if (pending.current) return
    pending.current = true
    setAction(prepare ? 'prepare' : 'check')
    busy(true)
    ready(false)
    setInstalled(false)
    setCommand('')
    setIssue('')
    try {
      const result = await gbot<LanPreparation>(
        prepare ? 'workspaces/ssh/prepare' : 'workspaces/ssh/tools',
        { workspace_id: workspaceId, ...(prepare ? { consent } : {}) }
      )
      setCommand(result.command ?? '')
      setIssue(result.issue ?? '')
      setInstalled(result.installed)
      ready(result.installed)
    } catch (cause) {
      setIssue(String(cause instanceof Error ? cause.message : cause))
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
          disabled={working}
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
          disabled={working || !consent}
          onClick={() => void run(true)}
        >
          {action === 'prepare' ? 'Preparing tools…' : 'Prepare tools'}
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={working}
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
        <p role="alert" className="text-destructive">
          {issue}
        </p>
      )}
      {installed && (
        <p role="status">
          Tools installed. Continue to connect and check the bot desktop.
        </p>
      )}
    </div>
  )
}

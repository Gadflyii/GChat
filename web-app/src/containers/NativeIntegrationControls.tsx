import { useId, useState } from 'react'
import { Link, useNavigate } from '@tanstack/react-router'
import { route } from '@/constants/routes'
import { Switch } from '@/components/ui/switch'
import { stopCodeTerminals, stopTerminal } from '@/services/terminal/tauri'
import { useCodeTerminalStore } from '@/stores/code-terminal-store'
import { useHermesAgentStore } from '@/stores/hermes-agent-store'
import { useGeneralSetting } from '@/hooks/useGeneralSetting'

export function NativeIntegrationControls({ compact = false }: { compact?: boolean }) {
  const id = useId()
  const navigate = useNavigate()
  const [showDescriptions, setShowDescriptions] = useState(false)
  const descriptionsHidden = compact && !showDescriptions
  const rowClass = compact
    ? 'flex items-start justify-between gap-2 py-1.5'
    : 'flex items-start justify-between gap-4 rounded-md border p-3'
  const gbotEnabled = useGeneralSetting(state => state.gbotEnabled)
  const setGbotEnabled = useGeneralSetting(state => state.setGbotEnabled)
  const codeEnabled = useCodeTerminalStore(state => state.enabled)
  const setCodeEnabled = useCodeTerminalStore(state => state.setEnabled)
  const codeStopping = useCodeTerminalStore(state => state.disabling)
  const setCodeStopping = useCodeTerminalStore(state => state.setDisabling)
  const [codeStopError, setCodeStopError] = useState<string>()
  const hermesEnabled = useHermesAgentStore(state => state.enabled)
  const setHermesEnabled = useHermesAgentStore(state => state.setEnabled)

  const changeCodeEnabled = async (enabled: boolean) => {
    if (useCodeTerminalStore.getState().disabling) return
    setCodeStopError(undefined)
    if (enabled) {
      setCodeEnabled(true)
      return
    }
    setCodeStopping(true)
    try {
      await stopCodeTerminals()
      setCodeEnabled(false)
    } catch (reason) {
      setCodeStopError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setCodeStopping(false)
    }
  }

  return (
    <section className={compact ? 'space-y-1' : 'space-y-3'}>
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Built-in tools
        </h2>
        {compact && (
          <button
            type="button"
            className="rounded-sm text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-expanded={showDescriptions}
            aria-controls={`${id}-gbot-description ${id}-code-description ${id}-hermes-description`}
            onClick={() => setShowDescriptions(value => !value)}
          >
            {showDescriptions ? 'Hide help' : 'Show help'}
          </button>
        )}
      </div>
      <div className={rowClass}>
        <div className="min-w-0 space-y-1">
          <label htmlFor={`${id}-gbot`} className="text-sm font-medium">
            Enable Gbot
          </label>
          <p hidden={descriptionsHidden} id={`${id}-gbot-description`} className="text-sm leading-relaxed text-muted-foreground">
            A persistent assistant with its own computer workspace. Turning on opens
            Gbot. Turning off hides Gbot and disables sign-in startup; running work
            continues.
          </p>
        </div>
        <Switch
          id={`${id}-gbot`}
          aria-label="Gbot integration"
          aria-describedby={`${id}-gbot-description`}
          className="mt-0.5"
          checked={gbotEnabled}
          onCheckedChange={enabled => {
            setGbotEnabled(enabled)
            if (enabled) void navigate({ to: route.gbot.index })
          }}
        />
      </div>
      <div className={rowClass}>
        <div className="min-w-0 space-y-1">
          <label htmlFor={`${id}-code`} className="text-sm font-medium">
            Enable OpenCode
          </label>
          <p hidden={descriptionsHidden} id={`${id}-code-description`} className="text-sm leading-relaxed text-muted-foreground">
            A coding assistant in the Code tab. Turning on prepares OpenCode,
            installing it if needed. Turning off stops all running Code workspaces
            and hides Code; saved settings remain.
          </p>
          {codeStopping && <p role="status" className="text-sm text-muted-foreground">
            Stopping all Code workspaces…
          </p>}
          {codeStopError && <p id={`${id}-code-error`} role="alert" className="text-sm text-destructive">
            Could not stop every Code workspace: {codeStopError}. OpenCode is still
            enabled. Try turning it off again.
          </p>}
        </div>
        <Switch
          id={`${id}-code`}
          aria-label="OpenCode integration"
          aria-describedby={`${id}-code-description${codeStopError ? ` ${id}-code-error` : ''}`}
          aria-busy={codeStopping}
          className="mt-0.5"
          checked={codeEnabled}
          disabled={codeStopping}
          onCheckedChange={enabled => void changeCodeEnabled(enabled)}
        />
      </div>
      <div className={rowClass}>
        <div className="min-w-0 space-y-1">
          <label htmlFor={`${id}-hermes`} className="text-sm font-medium">
            Enable Hermes
          </label>
          <p hidden={descriptionsHidden} id={`${id}-hermes-description`} className="text-sm leading-relaxed text-muted-foreground">
            An assistant in GChat’s built-in terminal. Turning on prepares Hermes,
            installing it if needed. Turning off stops its terminal and hides
            Hermes; saved settings remain.
          </p>
          <Link to={route.settings.hermes_agent} className="text-sm text-primary hover:underline">
            Hermes settings
          </Link>
        </div>
        <Switch
          id={`${id}-hermes`}
          aria-label="Hermes integration"
          aria-describedby={`${id}-hermes-description`}
          className="mt-0.5"
          checked={hermesEnabled}
          onCheckedChange={enabled => {
            setHermesEnabled(enabled)
            if (!enabled) void stopTerminal('hermes').catch(() => undefined)
          }}
        />
      </div>
    </section>
  )
}

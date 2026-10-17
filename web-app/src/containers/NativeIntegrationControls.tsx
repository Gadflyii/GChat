import { useId } from 'react'
import { Link, useNavigate } from '@tanstack/react-router'
import { route } from '@/constants/routes'
import { Switch } from '@/components/ui/switch'
import { stopTerminal } from '@/services/terminal/tauri'
import { useCodeTerminalStore } from '@/stores/code-terminal-store'
import { useHermesAgentStore } from '@/stores/hermes-agent-store'
import { useGeneralSetting } from '@/hooks/useGeneralSetting'

export function NativeIntegrationControls() {
  const id = useId()
  const navigate = useNavigate()
  const gbotEnabled = useGeneralSetting(state => state.gbotEnabled)
  const setGbotEnabled = useGeneralSetting(state => state.setGbotEnabled)
  const codeEnabled = useCodeTerminalStore(state => state.enabled)
  const setCodeEnabled = useCodeTerminalStore(state => state.setEnabled)
  const hermesEnabled = useHermesAgentStore(state => state.enabled)
  const setHermesEnabled = useHermesAgentStore(state => state.setEnabled)
  return (
    <section className="space-y-3">
      <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        Built-in tools
      </h2>
      <div className="flex items-start justify-between gap-4 rounded-md border p-3">
        <div className="min-w-0 space-y-1">
          <label htmlFor={`${id}-gbot`} className="text-sm font-medium">
            Enable Gbot
          </label>
          <p id={`${id}-gbot-description`} className="text-sm leading-relaxed text-muted-foreground">
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
      <div className="flex items-start justify-between gap-4 rounded-md border p-3">
        <div className="min-w-0 space-y-1">
          <label htmlFor={`${id}-code`} className="text-sm font-medium">
            Enable OpenCode
          </label>
          <p id={`${id}-code-description`} className="text-sm leading-relaxed text-muted-foreground">
            A coding assistant in the Code tab. Turning on prepares OpenCode,
            installing it if needed. Turning off hides Code; use Stop in Code first
            to end running work.
          </p>
        </div>
        <Switch
          id={`${id}-code`}
          aria-label="OpenCode integration"
          aria-describedby={`${id}-code-description`}
          className="mt-0.5"
          checked={codeEnabled}
          onCheckedChange={enabled => {
            setCodeEnabled(enabled)
            if (!enabled) void stopTerminal('code').catch(() => undefined)
          }}
        />
      </div>
      <div className="flex items-start justify-between gap-4 rounded-md border p-3">
        <div className="min-w-0 space-y-1">
          <label htmlFor={`${id}-hermes`} className="text-sm font-medium">
            Enable Hermes
          </label>
          <p id={`${id}-hermes-description`} className="text-sm leading-relaxed text-muted-foreground">
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

import { Link } from '@tanstack/react-router'
import { route } from '@/constants/routes'
import { Switch } from '@/components/ui/switch'
import { stopTerminal } from '@/services/terminal/tauri'
import { useCodeTerminalStore } from '@/stores/code-terminal-store'
import { useHermesAgentStore } from '@/stores/hermes-agent-store'

export function NativeIntegrationControls() {
  const codeEnabled = useCodeTerminalStore(state => state.enabled)
  const setCodeEnabled = useCodeTerminalStore(state => state.setEnabled)
  const hermesEnabled = useHermesAgentStore(state => state.enabled)
  const setHermesEnabled = useHermesAgentStore(state => state.setEnabled)
  return <section className="space-y-2">
    <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Native Integrations</h2>
    <div className="flex items-center justify-between gap-3 text-sm">
      <span>OpenCode</span>
      <Switch aria-label="OpenCode integration" checked={codeEnabled} onCheckedChange={enabled => {
        setCodeEnabled(enabled)
        if (!enabled) void stopTerminal('code').catch(() => undefined)
      }} />
    </div>
    <div className="flex items-center justify-between gap-3 text-sm">
      <Link to={route.settings.hermes_agent} className="hover:underline">Hermes</Link>
      <Switch aria-label="Hermes integration" checked={hermesEnabled} onCheckedChange={enabled => {
        setHermesEnabled(enabled)
        if (!enabled) void stopTerminal('hermes').catch(() => undefined)
      }} />
    </div>
  </section>
}

import { useEffect } from 'react'

import { useAppState } from '@/hooks/useAppState'
import { useLocalApiServer } from '@/hooks/useLocalApiServer'
import { useProxyConfig } from '@/hooks/useProxyConfig'
import { isAndroid, isIOS, isPlatformTauri } from '@/lib/platform/utils'
import {
  provisionHermes,
  provisionOpenCode,
} from '@/services/terminal/tauri'
import { useCodeTerminalStore } from '@/stores/code-terminal-store'
import { useHermesAgentStore } from '@/stores/hermes-agent-store'
import { useLaunchSettings } from '@/stores/launch-settings-store'

function currentInstallerProxy() {
  const { proxyEnabled, proxyUrl, proxyUsername, proxyPassword, noProxy } =
    useProxyConfig.getState()
  if (!proxyEnabled || !proxyUrl.trim()) return undefined
  return {
    url: proxyUrl.trim(),
    username: proxyUsername.trim() || undefined,
    password: proxyPassword || undefined,
    no_proxy: noProxy.trim() || undefined,
  }
}

/**
 * Install the two built-in terminal integrations independently of opening
 * their tabs. Configuration is refreshed once a model becomes available;
 * installation itself does not wait for a model or a running local server.
 */
export function EmbeddedIntegrationProvisioner() {
  const openCodeEnabled = useCodeTerminalStore((state) => state.enabled)
  const hermesEnabled = useHermesAgentStore((state) => state.enabled)
  const hermesModel = useHermesAgentStore((state) => state.model)
  const activeModel = useAppState((state) => state.activeModels[0])
  const customOpenCodePath = useLaunchSettings(
    (state) => state.customPaths.opencode
  )
  const customHermesPath = useLaunchSettings(
    (state) => state.customPaths.hermes
  )
  const {
    serverHost,
    serverPort,
    apiPrefix,
    apiKey,
    defaultModelLocalApiServer,
  } = useLocalApiServer()

  useEffect(() => {
    if (!isPlatformTauri() || isIOS() || isAndroid()) return

    const connectHost = serverHost === '0.0.0.0' ? '127.0.0.1' : serverHost
    const apiUrl = `http://${connectHost}:${serverPort}${apiPrefix}`
    const defaultModel = activeModel ?? defaultModelLocalApiServer?.model
    const proxy = currentInstallerProxy()

    const provision = async () => {
      // Keep installers sequential: both may bootstrap package-manager state
      // on a clean Windows host, and those system operations must not race.
      if (openCodeEnabled) {
        await provisionOpenCode({
          customPath: customOpenCodePath || undefined,
          apiUrl,
          model: defaultModel,
          apiKey: apiKey || undefined,
          proxy,
        }).catch((error) => {
          console.error('Automatic OpenCode setup failed:', error)
        })
      }

      if (hermesEnabled) {
        await provisionHermes({
          customPath: customHermesPath || undefined,
          apiUrl,
          model: hermesModel ?? defaultModel,
          apiKey: apiKey || undefined,
          contextLength: 65_536,
          proxy,
        }).catch((error) => {
          console.error('Automatic Hermes setup failed:', error)
        })
      }
    }

    void provision()
  }, [
    activeModel,
    apiKey,
    apiPrefix,
    customHermesPath,
    customOpenCodePath,
    defaultModelLocalApiServer?.model,
    hermesEnabled,
    hermesModel,
    openCodeEnabled,
    serverHost,
    serverPort,
  ])

  return null
}

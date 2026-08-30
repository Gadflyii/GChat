import {
  IconAlertTriangle,
  IconLoader2,
  IconRefresh,
  IconSparkles,
  IconSquare,
} from '@tabler/icons-react'
import { getJanDataFolderPath } from '@gchat/core'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from '@tanstack/react-router'

import { Button } from '@/components/ui/button'
import { AgentWorkspaceSelect } from '@/containers/AgentWorkspaceSelect'
import HeaderPage from '@/containers/HeaderPage'
import { route } from '@/constants/routes'
import { useAppState } from '@/hooks/useAppState'
import { useEmbeddedTerminal } from '@/hooks/useEmbeddedTerminal'
import { useLocalApiServer } from '@/hooks/useLocalApiServer'
import { useProxyConfig } from '@/hooks/useProxyConfig'
import { useServiceHub } from '@/hooks/useServiceHub'
import { useTheme } from '@/hooks/useTheme'
import { isAndroid, isIOS, isPlatformTauri } from '@/lib/platform/utils'
import { cn } from '@/lib/utils'
import {
  getTerminalStatus,
  provisionHermes,
  spawnTerminal,
  stopTerminal,
} from '@/services/terminal/tauri'
import { useHermesAgentStore } from '@/stores/hermes-agent-store'
import { useLaunchSettings } from '@/stores/launch-settings-store'
import type {
  HermesReadiness,
  OpenCodeProvisionPhase,
} from '@/types/terminal'

const DEFAULT_AGENT_WORKSPACE_DIR = 'agent-workspace'

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds))
}

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

export function HermesTerminalHost({ visible }: { visible: boolean }) {
  const serviceHub = useServiceHub()
  const isDark = useTheme((state) => state.isDark)
  const activeModel = useAppState((state) => state.activeModels[0])
  const {
    serverHost,
    serverPort,
    apiPrefix,
    apiKey,
    defaultModelLocalApiServer,
  } = useLocalApiServer()
  const enabled = useHermesAgentStore((state) => state.enabled)
  const configuredModel = useHermesAgentStore((state) => state.model)
  const configuredWorkspace = useHermesAgentStore((state) => state.workspace)
  const setConfiguredWorkspace = useHermesAgentStore(
    (state) => state.setWorkspace
  )
  const customHermesPath = useLaunchSettings(
    (state) => state.customPaths.hermes
  )
  const desktopTerminalAvailable =
    isPlatformTauri() && !isIOS() && !isAndroid()
  const {
    containerRef,
    terminalRef,
    statusRef,
    attached,
    status,
    updateStatus,
    error,
    setError,
    replayUnavailable,
    setReplayUnavailable,
  } = useEmbeddedTerminal({
    terminalId: 'hermes',
    visible,
    available: desktopTerminalAvailable,
  })
  const bootstrappedRef = useRef(false)
  const sessionAppearanceRef = useRef<'dark' | 'light' | undefined>(undefined)
  const [defaultWorkspace, setDefaultWorkspace] = useState<string>()
  const [readiness, setReadiness] = useState<HermesReadiness>()
  const [provisionPhase, setProvisionPhase] = useState<OpenCodeProvisionPhase>()
  const [readinessRefresh, setReadinessRefresh] = useState(0)
  const [busy, setBusy] = useState(false)

  const workspace = configuredWorkspace || defaultWorkspace
  const model = configuredModel ?? activeModel ?? defaultModelLocalApiServer?.model

  useEffect(() => {
    let cancelled = false
    const resolveDefaultWorkspace = async () => {
      try {
        const path = await serviceHub
          .path()
          .join(await getJanDataFolderPath(), DEFAULT_AGENT_WORKSPACE_DIR)
        if (!cancelled) setDefaultWorkspace(path)
      } catch (reason) {
        if (!cancelled) setError(String(reason))
      }
    }
    void resolveDefaultWorkspace()
    return () => {
      cancelled = true
    }
  }, [serviceHub, setError])

  useEffect(() => {
    if (!visible || !enabled || !attached || !desktopTerminalAvailable) return
    let cancelled = false
    const connectHost = serverHost === '0.0.0.0' ? '127.0.0.1' : serverHost
    const apiUrl = `http://${connectHost}:${serverPort}${apiPrefix}`

    setReadiness(undefined)
    setProvisionPhase('checking')
    setBusy(true)
    setError(undefined)
    void provisionHermes(
      {
        customPath: customHermesPath || undefined,
        apiUrl,
        model,
        apiKey: apiKey || undefined,
        contextLength: 65_536,
        proxy: currentInstallerProxy(),
      },
      (phase) => {
        if (!cancelled) setProvisionPhase(phase)
      }
    )
      .then((next) => {
        if (!cancelled) setReadiness(next)
      })
      .catch((reason) => {
        if (!cancelled) setError(String(reason))
      })
      .finally(() => {
        if (!cancelled) {
          setBusy(false)
          setProvisionPhase(undefined)
        }
      })
    return () => {
      cancelled = true
    }
  }, [
    activeModel,
    apiKey,
    apiPrefix,
    attached,
    configuredModel,
    customHermesPath,
    defaultModelLocalApiServer?.model,
    desktopTerminalAvailable,
    enabled,
    model,
    readinessRefresh,
    serverHost,
    serverPort,
    setError,
    visible,
  ])

  const startSession = useCallback(async () => {
    if (!workspace) throw new Error('The Hermes workspace is unavailable.')
    const terminal = terminalRef.current
    const next = await spawnTerminal({
      terminalId: 'hermes',
      cwd: workspace,
      rows: Math.max(2, terminal?.rows ?? 24),
      cols: Math.max(2, terminal?.cols ?? 80),
      launch: 'hermes',
      executable: customHermesPath || undefined,
      appearance: isDark ? 'dark' : 'light',
    })
    sessionAppearanceRef.current = isDark ? 'dark' : 'light'
    updateStatus(next)
    if (next.cwd && next.cwd !== workspace) {
      setConfiguredWorkspace(next.cwd)
    }
    setReplayUnavailable(false)
    terminal?.focus()
  }, [
    customHermesPath,
    isDark,
    setConfiguredWorkspace,
    setReplayUnavailable,
    terminalRef,
    updateStatus,
    workspace,
  ])

  useEffect(() => {
    if (
      bootstrappedRef.current ||
      !visible ||
      !enabled ||
      !attached ||
      !readiness?.ready ||
      !workspace
    ) {
      return
    }
    bootstrappedRef.current = true
    if (
      statusRef.current.phase === 'running' ||
      statusRef.current.phase === 'stopping'
    ) {
      return
    }
    setBusy(true)
    setError(undefined)
    void startSession()
      .catch((reason) => {
        bootstrappedRef.current = false
        setError(String(reason))
      })
      .finally(() => setBusy(false))
  }, [
    attached,
    enabled,
    readiness?.ready,
    setError,
    startSession,
    statusRef,
    visible,
    workspace,
  ])

  const stop = useCallback(async () => {
    setBusy(true)
    setError(undefined)
    try {
      updateStatus(await stopTerminal('hermes'))
    } catch (reason) {
      setError(String(reason))
    } finally {
      setBusy(false)
    }
  }, [setError, updateStatus])

  const restart = useCallback(async () => {
    setBusy(true)
    setError(undefined)
    try {
      if (statusRef.current.phase === 'running') {
        await stopTerminal('hermes')
      }
      for (let attempt = 0; attempt < 100; attempt += 1) {
        const current = await getTerminalStatus('hermes')
        updateStatus(current)
        if (current.phase !== 'running' && current.phase !== 'stopping') break
        if (attempt === 99) throw new Error('Hermes did not stop in time.')
        await delay(50)
      }
      bootstrappedRef.current = true
      await startSession()
    } catch (reason) {
      setError(String(reason))
    } finally {
      setBusy(false)
    }
  }, [setError, startSession, statusRef, updateStatus])

  const running = status.phase === 'running' || status.phase === 'stopping'
  const workspaceChanged =
    running && Boolean(workspace) && status.cwd !== workspace
  const appearanceChanged =
    running &&
    sessionAppearanceRef.current !== undefined &&
    sessionAppearanceRef.current !== (isDark ? 'dark' : 'light')
  const setupState = !desktopTerminalAvailable
    ? 'desktop'
    : !enabled
      ? 'disabled'
      : !model
        ? 'model'
        : !readiness
          ? 'checking'
          : readiness.ready
            ? undefined
            : readiness.reason

  return (
    <section
      aria-hidden={!visible}
      className={cn(
        'absolute inset-0 flex min-h-0 flex-col bg-background',
        visible ? 'visible pointer-events-auto' : 'invisible pointer-events-none'
      )}
    >
      <HeaderPage>
        <div className="flex min-w-0 items-center gap-2 pr-3">
          <IconSparkles className="size-4.5 shrink-0 text-primary" />
          <span className="font-medium">Hermes</span>
          <span
            className={cn(
              'size-1.5 shrink-0 rounded-full',
              status.phase === 'running'
                ? 'bg-emerald-500'
                : status.phase === 'stopping'
                  ? 'bg-amber-500'
                  : 'bg-muted-foreground/40'
            )}
            aria-label={`Hermes is ${status.phase}`}
          />
          <span className="truncate text-xs text-muted-foreground">
            {model ?? 'No model configured'}
          </span>
          <div className="ml-auto flex min-w-0 items-center gap-1.5">
            <AgentWorkspaceSelect
              workingDir={workspace}
              onChange={setConfiguredWorkspace}
            />
            {(workspaceChanged || appearanceChanged || status.phase === 'exited') && (
              <Button
                size="sm"
                variant="outline"
                disabled={busy || !readiness?.ready}
                onClick={() => void restart()}
              >
                {busy ? <IconLoader2 className="animate-spin" /> : <IconRefresh />}
                {workspaceChanged
                  ? 'Apply workspace'
                  : appearanceChanged
                    ? 'Apply theme'
                    : 'Restart'}
              </Button>
            )}
            {running && (
              <Button
                size="icon-sm"
                variant="ghost"
                disabled={busy || status.phase === 'stopping'}
                aria-label="Stop Hermes"
                onClick={() => void stop()}
              >
                <IconSquare />
              </Button>
            )}
          </div>
        </div>
      </HeaderPage>

      <div className="relative min-h-0 flex-1 border-t bg-background">
        <div
          ref={containerRef}
          data-testid="hermes-terminal"
          className={cn(
            'absolute inset-0 overflow-hidden px-3 py-2 transition-opacity',
            status.phase === 'idle' && !busy ? 'opacity-0' : 'opacity-100'
          )}
        />

        {replayUnavailable && (
          <div className="absolute inset-x-3 top-3 z-10 flex items-center gap-2 rounded-md border border-amber-500/30 bg-background/95 px-3 py-2 text-xs text-amber-700 shadow-sm backdrop-blur dark:text-amber-300">
            <IconAlertTriangle className="shrink-0" />
            <span>
              The prior terminal screen could not be replayed. The Hermes process
              is still running.
            </span>
          </div>
        )}

        {status.phase === 'idle' && (setupState || busy) && (
          <div className="absolute inset-0 flex items-center justify-center p-6">
            <div className="w-full max-w-md rounded-xl border bg-card p-6 text-center shadow-sm">
              {setupState === 'checking' || busy ? (
                <IconLoader2 className="mx-auto mb-4 size-7 animate-spin text-primary" />
              ) : (
                <IconSparkles className="mx-auto mb-4 size-7 text-primary" />
              )}
              <h1 className="text-base font-semibold">Hermes Agent</h1>
              <p className="mt-2 text-sm text-muted-foreground">
                {setupState === 'desktop'
                  ? 'The embedded Hermes terminal is available in the desktop app.'
                  : setupState === 'disabled'
                    ? 'Enable Hermes and choose its model in Settings.'
                    : setupState === 'model'
                      ? 'Choose a model before launching Hermes.'
                      : setupState === 'not_installed'
                        ? 'Hermes is not installed yet.'
                        : setupState === 'wsl_only'
                          ? 'A native Hermes installation is required for the Windows terminal.'
                          : setupState === 'invalid_configuration' ||
                              setupState === 'missing_configuration'
                            ? 'Hermes needs its managed GChat provider configuration.'
                            : provisionPhase === 'installing'
                              ? 'Installing Hermes…'
                              : provisionPhase === 'configuring'
                                ? 'Connecting Hermes to GChat…'
                                : 'Preparing Hermes…'}
              </p>
              {(setupState === 'disabled' || setupState === 'model') && (
                <Button asChild size="sm" className="mt-4">
                  <Link to={route.settings.hermes_agent}>Open Hermes settings</Link>
                </Button>
              )}
              {error && (
                <p className="mt-3 break-words text-xs text-destructive">{error}</p>
              )}
              {error && enabled && model && (
                <Button
                  size="sm"
                  variant="outline"
                  className="mt-4"
                  onClick={() => setReadinessRefresh((value) => value + 1)}
                >
                  <IconRefresh />
                  Retry
                </Button>
              )}
            </div>
          </div>
        )}
      </div>
    </section>
  )
}

import {
  IconAlertTriangle,
  IconCode,
  IconLayoutSidebarRightCollapse,
  IconLoader2,
  IconRefresh,
  IconSquare,
} from '@tabler/icons-react'
import { getJanDataFolderPath } from '@gchat/core'
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'

import { AgentWorkspaceSelect } from '@/containers/AgentWorkspaceSelect'
import HeaderPage from '@/containers/HeaderPage'
import { Button } from '@/components/ui/button'
import { useAppState } from '@/hooks/useAppState'
import { useHardware } from '@/hooks/useHardware'
import { useLocalApiServer } from '@/hooks/useLocalApiServer'
import { useProxyConfig } from '@/hooks/useProxyConfig'
import { useServiceHub } from '@/hooks/useServiceHub'
import { useEmbeddedTerminal } from '@/hooks/useEmbeddedTerminal'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { evaluateCodeHardware } from '@/lib/codeTerminal'
import { cn } from '@/lib/utils'
import { isAndroid, isIOS, isPlatformTauri } from '@/lib/platform/utils'
import {
  getTerminalStatus,
  provisionOpenCode,
  spawnTerminal,
  stopTerminal,
  writeTerminal,
} from '@/services/terminal/tauri'
import { useCodeTerminalStore } from '@/stores/code-terminal-store'
import { useLaunchSettings } from '@/stores/launch-settings-store'
import type {
  OpenCodeProvisionPhase,
  OpenCodeReadiness,
} from '@/types/terminal'

const DEFAULT_AGENT_WORKSPACE_DIR = 'agent-workspace'
type CodeTerminalHostProps = {
  visible: boolean
}

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

export function CodeTerminalHost({ visible }: CodeTerminalHostProps) {
  const { t } = useTranslation()
  const serviceHub = useServiceHub()
  const hardwareReady = useHardware((state) => state.hardwareReady)
  const hardwareData = useHardware((state) => state.hardwareData)
  const activeModel = useAppState((state) => state.activeModels[0])
  const {
    serverHost,
    serverPort,
    apiPrefix,
    apiKey,
    defaultModelLocalApiServer,
  } = useLocalApiServer()
  const configuredWorkspace = useCodeTerminalStore((state) => state.workspace)
  const enabled = useCodeTerminalStore((state) => state.enabled)
  const setConfiguredWorkspace = useCodeTerminalStore(
    (state) => state.setWorkspace
  )
  const customOpenCodePath = useLaunchSettings(
    (state) => state.customPaths.opencode
  )

  const desktopTerminalAvailable =
    isPlatformTauri() && !isIOS() && !isAndroid()
  const {
    containerRef,
    terminalRef,
    generationRef,
    statusRef,
    attached,
    status,
    updateStatus,
    error,
    setError,
    replayUnavailable,
    setReplayUnavailable,
  } = useEmbeddedTerminal({
    terminalId: 'code',
    visible,
    available: desktopTerminalAvailable,
  })
  const bootstrappedRef = useRef(false)

  const [defaultWorkspace, setDefaultWorkspace] = useState<string>()
  const [readiness, setReadiness] = useState<OpenCodeReadiness>()
  const [provisionPhase, setProvisionPhase] = useState<OpenCodeProvisionPhase>()
  const [readinessRefresh, setReadinessRefresh] = useState(0)
  const [busy, setBusy] = useState(false)

  const workspace = configuredWorkspace || defaultWorkspace
  const hardware = useMemo(
    () => evaluateCodeHardware(hardwareData),
    [hardwareData]
  )

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
    if (
      !enabled ||
      !attached ||
      !hardwareReady ||
      !hardware.supported ||
      !desktopTerminalAvailable
    ) {
      return
    }
    let cancelled = false
    const connectHost = serverHost === '0.0.0.0' ? '127.0.0.1' : serverHost
    const base = `http://${connectHost}:${serverPort}`
    const apiUrl = `${base}${apiPrefix}`
    const model = activeModel ?? defaultModelLocalApiServer?.model

    setReadiness(undefined)
    setProvisionPhase('checking')
    setBusy(true)
    setError(undefined)
    void provisionOpenCode(
      {
        customPath: customOpenCodePath || undefined,
        apiUrl,
        model,
        apiKey: apiKey || undefined,
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
    attached,
    activeModel,
    apiKey,
    apiPrefix,
    customOpenCodePath,
    defaultModelLocalApiServer?.model,
    desktopTerminalAvailable,
    enabled,
    hardware.supported,
    hardwareReady,
    readinessRefresh,
    serverHost,
    serverPort,
    setError,
  ])

  const startSession = useCallback(async () => {
    if (!workspace) throw new Error(t('code:workspaceUnavailable'))
    const terminal = terminalRef.current
    const rows = Math.max(2, terminal?.rows ?? 24)
    const cols = Math.max(2, terminal?.cols ?? 80)
    const next = await spawnTerminal({
      terminalId: 'code',
      cwd: workspace,
      rows,
      cols,
      launch: 'open_code',
      executable: customOpenCodePath || undefined,
    })
    updateStatus(next)
    if (next.cwd && next.cwd !== workspace) {
      setConfiguredWorkspace(next.cwd)
    }
    setReplayUnavailable(false)
    terminal?.focus()
  }, [
    customOpenCodePath,
    setConfiguredWorkspace,
    setReplayUnavailable,
    t,
    terminalRef,
    updateStatus,
    workspace,
  ])

  useEffect(() => {
    if (
      bootstrappedRef.current ||
      !enabled ||
      !attached ||
      !hardwareReady ||
      !hardware.supported ||
      !readiness?.ready ||
      !workspace
    ) {
      return
    }

    bootstrappedRef.current = true
    if (statusRef.current.phase === 'running' || statusRef.current.phase === 'stopping') {
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
    hardware.supported,
    hardwareReady,
    readiness?.ready,
    setError,
    startSession,
    statusRef,
    workspace,
  ])

  const stop = useCallback(async () => {
    setBusy(true)
    setError(undefined)
    try {
      updateStatus(await stopTerminal('code'))
    } catch (reason) {
      setError(String(reason))
    } finally {
      setBusy(false)
    }
  }, [setError, updateStatus])

  const toggleTokenSidebar = useCallback(() => {
    const generation = generationRef.current
    if (generation === 0 || statusRef.current.phase !== 'running') return
    // OpenCode's session.sidebar.toggle action is bound to <leader>b by
    // default; the default leader is Ctrl+X. Send the key chord through the
    // native PTY so the embedded TUI remains the sole owner of sidebar state.
    void writeTerminal('code', generation, Uint8Array.of(0x18, 0x62)).catch((reason) =>
      setError(String(reason))
    )
    terminalRef.current?.focus()
  }, [generationRef, setError, statusRef, terminalRef])

  const restart = useCallback(async () => {
    setBusy(true)
    setError(undefined)
    try {
      if (statusRef.current.phase === 'running') await stopTerminal('code')
      for (let attempt = 0; attempt < 100; attempt += 1) {
        const current = await getTerminalStatus('code')
        updateStatus(current)
        if (current.phase !== 'running' && current.phase !== 'stopping') break
        if (attempt === 99) {
          throw new Error(t('code:stopTimeout'))
        }
        await delay(50)
      }
      bootstrappedRef.current = true
      await startSession()
    } catch (reason) {
      setError(String(reason))
    } finally {
      setBusy(false)
    }
  }, [setError, startSession, statusRef, t, updateStatus])

  const running = status.phase === 'running' || status.phase === 'stopping'
  const workspaceChanged =
    running && Boolean(workspace) && status.cwd !== workspace
  const configuredModel = activeModel ?? defaultModelLocalApiServer?.model
  const setupState = !desktopTerminalAvailable
    ? 'desktop'
    : !enabled
      ? 'disabled'
    : !hardwareReady
      ? 'checking'
      : !hardware.supported
        ? 'hardware'
        : !readiness
          ? 'checking'
          : readiness.ready
            ? undefined
            : !configuredModel
              ? 'model_unavailable'
              : readiness.reason

  return (
    <section
      aria-hidden={!visible}
      className={cn(
        'absolute inset-0 flex min-h-0 flex-col bg-background',
        visible
          ? 'visible pointer-events-auto'
          : 'invisible pointer-events-none'
      )}
    >
      <HeaderPage>
        <div className="flex min-w-0 items-center gap-2 pr-3">
          <IconCode className="size-4.5 shrink-0 text-primary" />
          <span className="font-medium">{t('common:code')}</span>
          <span
            className={cn(
              'size-1.5 shrink-0 rounded-full',
              status.phase === 'running'
                ? 'bg-emerald-500'
                : status.phase === 'stopping'
                  ? 'bg-amber-500'
                  : 'bg-muted-foreground/40'
            )}
            aria-label={t(`code:status.${status.phase}`)}
          />
          <div className="ml-auto flex min-w-0 items-center gap-1.5">
            <AgentWorkspaceSelect
              workingDir={workspace}
              onChange={setConfiguredWorkspace}
            />
            {(workspaceChanged || status.phase === 'exited') && (
              <Button
                size="sm"
                variant="outline"
                disabled={busy || !readiness?.ready}
                onClick={() => void restart()}
              >
                {busy ? (
                  <IconLoader2 className="animate-spin" />
                ) : (
                  <IconRefresh />
                )}
                {workspaceChanged
                  ? t('code:restartWorkspace')
                  : t('code:restart')}
              </Button>
            )}
            {running && (
              <Button
                size="icon-sm"
                variant="ghost"
                disabled={busy || status.phase === 'stopping'}
                aria-label={t('code:toggleTokenSidebar')}
                title={t('code:toggleTokenSidebar')}
                onClick={toggleTokenSidebar}
              >
                <IconLayoutSidebarRightCollapse />
              </Button>
            )}
            {running && (
              <Button
                size="icon-sm"
                variant="ghost"
                disabled={busy || status.phase === 'stopping'}
                aria-label={t('code:stop')}
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
          data-testid="code-terminal"
          className={cn(
            'absolute inset-0 overflow-hidden px-3 py-2 transition-opacity',
            status.phase === 'idle' && !busy ? 'opacity-0' : 'opacity-100'
          )}
        />

        {replayUnavailable && (
          <div className="absolute inset-x-3 top-3 z-10 flex items-center gap-2 rounded-md border border-amber-500/30 bg-background/95 px-3 py-2 text-xs text-amber-700 shadow-sm backdrop-blur dark:text-amber-300">
            <IconAlertTriangle className="shrink-0" />
            <span>{t('code:replayUnavailable')}</span>
          </div>
        )}

        {status.phase === 'idle' && (setupState || busy) && (
          <div className="absolute inset-0 flex items-center justify-center p-6">
            <div className="w-full max-w-md rounded-xl border bg-card p-6 text-center shadow-sm">
              {setupState === 'checking' || busy ? (
                <IconLoader2 className="mx-auto mb-4 size-7 animate-spin text-primary" />
              ) : (
                <IconCode className="mx-auto mb-4 size-7 text-primary" />
              )}
              <h1 className="text-base font-semibold">{t('code:title')}</h1>
              <p className="mt-2 text-sm text-muted-foreground">
                {setupState === 'desktop'
                  ? t('code:desktopOnly')
                  : setupState === 'disabled'
                    ? 'Enable OpenCode integration in Settings.'
                  : setupState === 'checking' || busy
                    ? provisionPhase === 'installing'
                      ? t('code:installing')
                      : provisionPhase === 'configuring'
                        ? t('code:configuring')
                        : t('code:checking')
                    : setupState === 'hardware'
                      ? hardware.supported
                        ? t('code:unsupportedHardware')
                        : hardware.reason
                      : setupState === 'model_unavailable'
                        ? t('code:modelUnavailable')
                        : setupState === 'wsl_only'
                          ? t('code:wslOnly')
                          : setupState === 'invalid_configuration'
                            ? t('code:invalidConfiguration')
                            : setupState === 'missing_configuration'
                              ? t('code:missingConfiguration')
                              : t('code:notInstalled')}
              </p>
              {!busy &&
                setupState !== 'checking' &&
                setupState !== 'hardware' &&
                setupState !== 'desktop' && (
                  <div className="mt-5 flex justify-center">
                    <Button
                      variant="outline"
                      onClick={() => setReadinessRefresh((value) => value + 1)}
                    >
                      <IconRefresh />
                      {t('code:checkAgain')}
                    </Button>
                  </div>
                )}
            </div>
          </div>
        )}

        {error && (
          <div className="absolute inset-x-3 bottom-3 z-10 flex items-center gap-2 rounded-md border border-destructive/30 bg-background/95 px-3 py-2 text-xs text-destructive shadow-sm backdrop-blur">
            <IconAlertTriangle className="shrink-0" />
            <span className="min-w-0 flex-1 truncate">{error}</span>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setError(undefined)
                bootstrappedRef.current = false
                setReadinessRefresh((value) => value + 1)
              }}
            >
              {t('code:retry')}
            </Button>
          </div>
        )}
      </div>
    </section>
  )
}

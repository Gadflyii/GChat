import '@xterm/xterm/css/xterm.css'

import { FitAddon } from '@xterm/addon-fit'
import { Terminal, type ITheme } from '@xterm/xterm'
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
import { useTheme } from '@/hooks/useTheme'
import { useTranslation } from '@/i18n/react-i18next-compat'
import {
  evaluateCodeHardware,
  TerminalFlowController,
} from '@/lib/codeTerminal'
import { cn } from '@/lib/utils'
import { isAndroid, isIOS, isPlatformTauri } from '@/lib/platform/utils'
import {
  attachTerminal,
  base64ToBytes,
  getTerminalStatus,
  provisionOpenCode,
  resizeTerminal,
  setTerminalFlow,
  spawnTerminal,
  stopTerminal,
  terminalBinaryStringToBytes,
  writeTerminal,
} from '@/services/terminal/tauri'
import { useCodeTerminalStore } from '@/stores/code-terminal-store'
import { useLaunchSettings } from '@/stores/launch-settings-store'
import type {
  OpenCodeProvisionPhase,
  OpenCodeReadiness,
  TerminalEvent,
  TerminalStatus,
} from '@/types/terminal'

const DEFAULT_AGENT_WORKSPACE_DIR = 'agent-workspace'
const DEFAULT_STATUS: TerminalStatus = {
  phase: 'idle',
  generation: 0,
  replayComplete: true,
}

const DARK_TERMINAL_THEME: ITheme = {
  background: '#08090b',
  foreground: '#f3f5f7',
  cursor: '#3dd3c8',
  cursorAccent: '#08090b',
  selectionBackground: '#3dd3c84d',
  black: '#08090b',
  red: '#f2777a',
  green: '#76c7a0',
  yellow: '#f2ec5d',
  blue: '#68aee8',
  magenta: '#b69cff',
  cyan: '#3dd3c8',
  white: '#c6cacf',
  brightBlack: '#5a6068',
  brightWhite: '#f3f5f7',
}

const LIGHT_TERMINAL_THEME: ITheme = {
  background: '#fafbfc',
  foreground: '#0a0c0f',
  cursor: '#0b6b6b',
  cursorAccent: '#fafbfc',
  selectionBackground: '#0b6b6b33',
  black: '#0a0c0f',
  red: '#b4232c',
  green: '#147a55',
  yellow: '#716d00',
  blue: '#1769aa',
  magenta: '#7147a8',
  cyan: '#0b6b6b',
  white: '#e3e5e8',
  brightBlack: '#5a6068',
  brightWhite: '#ffffff',
}

type CodeTerminalHostProps = {
  visible: boolean
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds))
}

function terminalCellPixels(
  container: HTMLDivElement | null,
  rows: number,
  cols: number
): { width: number; height: number } {
  return {
    width: Math.max(1, Math.floor((container?.clientWidth ?? 0) / cols)),
    height: Math.max(1, Math.floor((container?.clientHeight ?? 0) / rows)),
  }
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
  const isDark = useTheme((state) => state.isDark)
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
  const setConfiguredWorkspace = useCodeTerminalStore(
    (state) => state.setWorkspace
  )
  const customOpenCodePath = useLaunchSettings(
    (state) => state.customPaths.opencode
  )

  const containerRef = useRef<HTMLDivElement>(null)
  const terminalRef = useRef<Terminal | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const generationRef = useRef(0)
  const sequenceRef = useRef(0)
  const statusRef = useRef<TerminalStatus>(DEFAULT_STATUS)
  const bootstrappedRef = useRef(false)

  const [attached, setAttached] = useState(false)
  const [defaultWorkspace, setDefaultWorkspace] = useState<string>()
  const [status, setStatus] = useState<TerminalStatus>(DEFAULT_STATUS)
  const [readiness, setReadiness] = useState<OpenCodeReadiness>()
  const [provisionPhase, setProvisionPhase] = useState<OpenCodeProvisionPhase>()
  const [readinessRefresh, setReadinessRefresh] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const [replayUnavailable, setReplayUnavailable] = useState(false)

  const desktopTerminalAvailable =
    isPlatformTauri() && !isIOS() && !isAndroid()
  const workspace = configuredWorkspace || defaultWorkspace
  const hardware = useMemo(
    () => evaluateCodeHardware(hardwareData),
    [hardwareData]
  )

  const updateStatus = useCallback((next: TerminalStatus) => {
    statusRef.current = next
    generationRef.current = next.generation
    setStatus(next)
  }, [])

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
  }, [serviceHub])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const terminal = new Terminal({
      allowProposedApi: false,
      convertEol: false,
      cursorBlink: true,
      cursorStyle: 'bar',
      fontFamily: "'Geist Mono', ui-monospace, 'SFMono-Regular', Consolas, monospace",
      fontSize: 13,
      lineHeight: 1.25,
      scrollback: 10_000,
      theme: useTheme.getState().isDark
        ? DARK_TERMINAL_THEME
        : LIGHT_TERMINAL_THEME,
    })
    const fitAddon = new FitAddon()
    terminal.loadAddon(fitAddon)
    terminal.open(container)
    terminalRef.current = terminal
    fitAddonRef.current = fitAddon

    const flow = new TerminalFlowController((paused) => {
      const generation = generationRef.current
      if (generation === 0) return
      void setTerminalFlow(generation, paused).catch(() => undefined)
    })
    const handleEvent = (event: TerminalEvent) => {
      if (generationRef.current !== 0 && event.generation < generationRef.current) {
        return
      }
      if (event.generation !== generationRef.current) {
        generationRef.current = event.generation
        sequenceRef.current = 0
        flow.reset()
      }
      if (event.sequence <= sequenceRef.current) return
      sequenceRef.current = event.sequence

      switch (event.type) {
        case 'started':
          terminal.reset()
          setReplayUnavailable(false)
          updateStatus({
            phase: 'running',
            generation: event.generation,
            cwd: event.cwd,
            launch: event.launch,
            replayComplete: true,
          })
          break
        case 'output': {
          const bytes = base64ToBytes(event.data)
          const drained = flow.enqueue(bytes.byteLength)
          terminal.write(bytes, drained)
          break
        }
        case 'exited':
          flow.reset()
          updateStatus({
            ...statusRef.current,
            phase: 'exited',
            generation: event.generation,
            exitCode: event.exit_code,
            signal: event.signal,
          })
          break
        case 'replay_unavailable':
          terminal.reset()
          setReplayUnavailable(true)
          break
        case 'error':
          setError(event.message)
          break
      }
    }

    let cancelled = false
    if (desktopTerminalAvailable) {
      void attachTerminal(handleEvent)
        .then((next) => {
          if (cancelled) return
          if (next.generation >= generationRef.current) updateStatus(next)
          setAttached(true)
        })
        .catch((reason) => {
          if (!cancelled) setError(String(reason))
        })
    }

    const encoder = new TextEncoder()
    const dataDisposable = terminal.onData((data) => {
      const generation = generationRef.current
      if (generation === 0) return
      void writeTerminal(generation, encoder.encode(data)).catch((reason) =>
        setError(String(reason))
      )
    })
    const binaryDisposable = terminal.onBinary((data) => {
      const generation = generationRef.current
      if (generation === 0) return
      void writeTerminal(
        generation,
        terminalBinaryStringToBytes(data)
      ).catch((reason) => setError(String(reason)))
    })
    const resizeDisposable = terminal.onResize(({ rows, cols }) => {
      const generation = generationRef.current
      if (generation === 0) return
      const pixels = terminalCellPixels(container, rows, cols)
      void resizeTerminal(
        generation,
        Math.max(2, rows),
        Math.max(2, cols),
        pixels.width,
        pixels.height
      ).catch(() => undefined)
    })

    let resizeFrame = 0
    const fit = () => {
      window.cancelAnimationFrame(resizeFrame)
      resizeFrame = window.requestAnimationFrame(() => {
        const dimensions = fitAddon.proposeDimensions()
        if (!dimensions) return
        terminal.resize(
          Math.max(2, dimensions.cols),
          Math.max(2, dimensions.rows)
        )
      })
    }
    const observer =
      typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(fit)
    observer?.observe(container)
    fit()

    return () => {
      cancelled = true
      observer?.disconnect()
      window.cancelAnimationFrame(resizeFrame)
      dataDisposable.dispose()
      binaryDisposable.dispose()
      resizeDisposable.dispose()
      flow.reset()
      terminal.dispose()
      terminalRef.current = null
      fitAddonRef.current = null
      setAttached(false)
    }
  }, [desktopTerminalAvailable, updateStatus])

  useEffect(() => {
    const terminal = terminalRef.current
    if (!terminal) return
    terminal.options.theme = isDark
      ? DARK_TERMINAL_THEME
      : LIGHT_TERMINAL_THEME
  }, [isDark])

  useEffect(() => {
    if (!visible) return
    const frame = window.requestAnimationFrame(() => {
      const terminal = terminalRef.current
      const dimensions = fitAddonRef.current?.proposeDimensions()
      if (terminal && dimensions) {
        terminal.resize(
          Math.max(2, dimensions.cols),
          Math.max(2, dimensions.rows)
        )
      }
      terminal?.focus()
    })
    return () => window.cancelAnimationFrame(frame)
  }, [visible])

  useEffect(() => {
    if (!attached || !hardwareReady || !hardware.supported || !desktopTerminalAvailable) {
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
    hardware.supported,
    hardwareReady,
    readinessRefresh,
    serverHost,
    serverPort,
  ])

  const startSession = useCallback(async () => {
    if (!workspace) throw new Error(t('code:workspaceUnavailable'))
    const terminal = terminalRef.current
    const rows = Math.max(2, terminal?.rows ?? 24)
    const cols = Math.max(2, terminal?.cols ?? 80)
    const next = await spawnTerminal({
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
    t,
    updateStatus,
    workspace,
  ])

  useEffect(() => {
    if (
      bootstrappedRef.current ||
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
    hardware.supported,
    hardwareReady,
    readiness?.ready,
    startSession,
    workspace,
  ])

  const stop = useCallback(async () => {
    setBusy(true)
    setError(undefined)
    try {
      updateStatus(await stopTerminal())
    } catch (reason) {
      setError(String(reason))
    } finally {
      setBusy(false)
    }
  }, [updateStatus])

  const toggleTokenSidebar = useCallback(() => {
    const generation = generationRef.current
    if (generation === 0 || statusRef.current.phase !== 'running') return
    // OpenCode's session.sidebar.toggle action is bound to <leader>b by
    // default; the default leader is Ctrl+X. Send the key chord through the
    // native PTY so the embedded TUI remains the sole owner of sidebar state.
    void writeTerminal(generation, Uint8Array.of(0x18, 0x62)).catch((reason) =>
      setError(String(reason))
    )
    terminalRef.current?.focus()
  }, [])

  const restart = useCallback(async () => {
    setBusy(true)
    setError(undefined)
    try {
      if (statusRef.current.phase === 'running') await stopTerminal()
      for (let attempt = 0; attempt < 100; attempt += 1) {
        const current = await getTerminalStatus()
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
  }, [startSession, t, updateStatus])

  const running = status.phase === 'running' || status.phase === 'stopping'
  const workspaceChanged =
    running && Boolean(workspace) && status.cwd !== workspace
  const configuredModel = activeModel ?? defaultModelLocalApiServer?.model
  const setupState = !desktopTerminalAvailable
    ? 'desktop'
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

import {
  IconAlertTriangle,
  IconCode,
  IconLayoutSidebarRightCollapse,
  IconLoader2,
  IconRefresh,
  IconSquare,
  IconPlus,
} from '@tabler/icons-react'
import { useLocation, useNavigate, useSearch } from '@tanstack/react-router'
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'

import { useThreads } from '@/hooks/useThreads'
import { useConversationPolicy } from '@/hooks/useConversationPolicy'
import { useToolAvailable } from '@/hooks/useToolAvailable'
import { getCodeSessionReference } from '@/lib/sessions'
import { newCodeSession, selectCodeSession, resolveCodeWorkspace, updateCodeBridgePolicy, type CodeSessionEvent } from '@/services/terminal/code-sessions'
import type { TerminalId } from '@/types/terminal'
import { AgentWorkspaceSelect } from '@/containers/AgentWorkspaceSelect'
import { CodeBridgePanel } from '@/containers/CodeBridgePanel'
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
  updateCode,
} from '@/services/terminal/tauri'
import { useCodeTerminalStore } from '@/stores/code-terminal-store'
import { useLaunchSettings } from '@/stores/launch-settings-store'
import type {
  OpenCodeProvisionPhase,
  OpenCodeReadiness,
} from '@/types/terminal'

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

function currentBridgePolicy(threadId?: string) {
  const policy = useConversationPolicy.getState()
  const workspace = policy.getWorkspace(threadId ?? '')
  return {
    origin_session_id: threadId,
    auto_approve: policy.getApprovalMode(threadId ?? '') === 'skip',
    disabled_tools: useToolAvailable.getState().getDisabledToolsForThread(threadId ?? ''),
    external_roots: workspace.externalRoots.map(root => ({ path: root.path, can_edit: root.canEdit })),
  }
}

type WorkspaceHost = { directory: string; terminalId: TerminalId }

export function CodeTerminalHost({ visible }: CodeTerminalHostProps) {
  const navigate = useNavigate()
  const pathname = useLocation({ select: location => location.pathname })
  const search = useSearch({ strict: false }) as { session?: string }
  const serviceHub = useServiceHub()
  const threads = useThreads(state => state.threads)
  const configuredWorkspace = useCodeTerminalStore(state => state.workspace)
  const persistedSelection = useCodeTerminalStore(state => state.selectedThreadId)
  const selectedThreadId = pathname.startsWith('/code') ? search.session ?? persistedSelection : persistedSelection
  useEffect(() => {
    if (visible && search.session) useCodeTerminalStore.getState().setSelectedThreadId(search.session)
  }, [visible, search.session])
  const [defaultWorkspace, setDefaultWorkspace] = useState<string>()
  const [hosts, setHosts] = useState<WorkspaceHost[]>([])
  const reference = getCodeSessionReference(selectedThreadId ? threads[selectedThreadId] : undefined)
  const requestedWorkspace = selectedThreadId && !reference ? undefined : reference?.directory ?? configuredWorkspace ?? defaultWorkspace
  const [resolvedWorkspace, setResolvedWorkspace] = useState<{ requested: string; directory: string }>()
  const [workspaceError, setWorkspaceError] = useState<string>()
  const workspace = resolvedWorkspace && resolvedWorkspace.requested === requestedWorkspace ? resolvedWorkspace.directory : undefined
  useEffect(() => {
    if (!visible || !requestedWorkspace) return
    let cancelled = false
    setWorkspaceError(undefined)
    void resolveCodeWorkspace(requestedWorkspace).then(directory => {
      if (!cancelled) setResolvedWorkspace({ requested: requestedWorkspace, directory })
    }).catch(reason => { if (!cancelled) setWorkspaceError(String(reason)) })
    return () => { cancelled = true }
  }, [visible, requestedWorkspace])
  const activeTerminalId: TerminalId | undefined = workspace ? `code:${workspace}` : undefined
  const activeRef = useRef({ visible, terminalId: activeTerminalId })
  activeRef.current = { visible, terminalId: activeTerminalId }

  useEffect(() => {
    if (!visible || configuredWorkspace || selectedThreadId) return
    let cancelled = false
    void resolveCodeWorkspace().then(path => { if (!cancelled) setDefaultWorkspace(path) })
      .catch(reason => { if (!cancelled) setWorkspaceError(String(reason)) })
    return () => { cancelled = true }
  }, [visible, configuredWorkspace, selectedThreadId])

  useEffect(() => {
    if (!visible || !workspace || !activeTerminalId || (selectedThreadId && !reference)) return
    setHosts(current => current.some(host => host.directory === workspace)
      ? current : [...current, { directory: workspace, terminalId: activeTerminalId }])
  }, [visible, workspace, activeTerminalId, selectedThreadId, reference])

  useEffect(() => {
    let cancelled = false
    let unlisten: (() => void) | undefined
    void serviceHub.events().listen<CodeSessionEvent>('gchat:code-session', ({ payload }) => {
      const state = useThreads.getState()
      if (payload.kind === 'deleted') {
        state.setThreads(Object.values(state.threads).filter(thread => thread.id !== payload.threadId))
        if (useCodeTerminalStore.getState().selectedThreadId === payload.threadId) {
          useCodeTerminalStore.getState().setSelectedThreadId(undefined)
        }
      } else if (payload.thread) {
        const incoming = { ...payload.thread, isFavorite: Boolean(payload.thread.metadata?.is_favorite) }
        const previous = state.threads[incoming.id]
        const row = previous && previous.updated > incoming.updated
          ? { ...previous, metadata: { ...previous.metadata, runtime: 'code', code: incoming.metadata?.code } }
          : incoming
        state.setThreads([...Object.values(state.threads).filter(thread => thread.id !== row.id), row])
        if (payload.kind === 'selected' && activeRef.current.visible && activeRef.current.terminalId === payload.terminalId) {
          useCodeTerminalStore.getState().setSelectedThreadId(row.id)
          void navigate({ to: '/code', search: { session: row.id }, replace: true })
        }
      }
    }).then(dispose => { if (cancelled) dispose(); else unlisten = dispose })
    return () => { cancelled = true; unlisten?.() }
  }, [serviceHub, navigate])

  return <>{visible && workspaceError && <section className="absolute inset-0 flex flex-col gap-3 p-6">
    <p role="alert">{workspaceError}</p>
    <AgentWorkspaceSelect workingDir={requestedWorkspace} onChange={directory => {
      useCodeTerminalStore.getState().setWorkspace(directory)
      useCodeTerminalStore.getState().setSelectedThreadId(undefined)
      void navigate({ to: '/code', search: {}, replace: true })
    }} />
  </section>}{hosts.map(host => <CodeWorkspaceTerminal key={host.terminalId}
    visible={visible && host.terminalId === activeTerminalId}
    workspace={host.directory} terminalId={host.terminalId}
    selectedThreadId={host.terminalId === activeTerminalId ? selectedThreadId : undefined} />)}</>
}

function CodeWorkspaceTerminal({ visible, workspace, terminalId, selectedThreadId }: CodeTerminalHostProps & {
  workspace: string; terminalId: TerminalId; selectedThreadId?: string
}) {
  const { t } = useTranslation()
  const navigate = useNavigate()
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
    terminalId,
    visible,
    available: desktopTerminalAvailable,
  })
  const bootstrappedRef = useRef(false)

  const [readiness, setReadiness] = useState<OpenCodeReadiness>()
  const [provisionPhase, setProvisionPhase] = useState<OpenCodeProvisionPhase>()
  const [readinessRefresh, setReadinessRefresh] = useState(0)
  const [busy, setBusy] = useState(false)

  const hardware = useMemo(
    () => evaluateCodeHardware(hardwareData),
    [hardwareData]
  )


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

  const [updateRequested, setUpdateRequested] = useState(false)
  const [updatePhase, setUpdatePhase] = useState<string>()
  const [updateResult, setUpdateResult] = useState<{ logPath: string }>()
  const [updateError, setUpdateError] = useState<string>()
  const updateMode = Boolean(updatePhase || updateResult || updateError)

  const startSession = useCallback(async () => {
    if (!workspace) throw new Error(t('code:workspaceUnavailable'))
    const terminal = terminalRef.current
    const rows = Math.max(2, terminal?.rows ?? 24)
    const cols = Math.max(2, terminal?.cols ?? 80)
    const resume = getCodeSessionReference(useThreads.getState().threads[selectedThreadId ?? ''])?.session_id
    lastSelectedRef.current = resume
    const next = await spawnTerminal({
      terminalId,
      cwd: workspace,
      rows,
      cols,
      launch: 'open_code',
      codeSessionId: resume,
      bridgePolicy: currentBridgePolicy(selectedThreadId),
      executable: customOpenCodePath || undefined,
    })
    updateStatus(next)
    setUpdateRequested(false)
    setUpdateResult(undefined)
    setUpdateError(undefined)
    if (next.cwd && next.cwd !== workspace) {
      setConfiguredWorkspace(next.cwd)
    }
    setReplayUnavailable(false)
    terminal?.focus()
  }, [
    customOpenCodePath,
    terminalId,
    selectedThreadId,
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
      updateStatus(await stopTerminal(terminalId))
    } catch (reason) {
      setError(String(reason))
    } finally {
      setBusy(false)
    }
  }, [setError, updateStatus, terminalId])

  const toggleTokenSidebar = useCallback(() => {
    const generation = generationRef.current
    if (generation === 0 || statusRef.current.phase !== 'running') return
    // OpenCode's session.sidebar.toggle action is bound to <leader>b by
    // default; the default leader is Ctrl+X. Send the key chord through the
    // native PTY so the embedded TUI remains the sole owner of sidebar state.
    void writeTerminal(terminalId, generation, Uint8Array.of(0x18, 0x62)).catch((reason) =>
      setError(String(reason))
    )
    terminalRef.current?.focus()
  }, [generationRef, setError, statusRef, terminalRef, terminalId])

  const restart = useCallback(async (update = false) => {
    setBusy(true)
    setError(undefined)
    if (update) {
      setUpdateRequested(false)
      setUpdateError(undefined)
      setUpdateResult(undefined)
      setUpdatePhase('Stopping Code')
    }
    try {
      if (statusRef.current.phase === 'running') await stopTerminal(terminalId)
      for (let attempt = 0; attempt < 100; attempt += 1) {
        const current = await getTerminalStatus(terminalId)
        updateStatus(current)
        if (current.phase !== 'running' && current.phase !== 'stopping') break
        if (attempt === 99) {
          throw new Error(t('code:stopTimeout'))
        }
        await delay(50)
      }
      bootstrappedRef.current = true
      if (update) {
        setUpdateResult(await updateCode(customOpenCodePath || undefined, setUpdatePhase))
      } else {
        await startSession()
      }
    } catch (reason) {
      if (update) setUpdateError(String(reason))
      else setError(String(reason))
    } finally {
      setUpdatePhase(undefined)
      setBusy(false)
    }
  }, [customOpenCodePath, setError, startSession, statusRef, t, updateStatus, terminalId])

  const lastSelectedRef = useRef<string | undefined>(undefined)
  const workspaceThreads = useThreads(state => state.threads)
  const selectedCodeSessionId = useThreads(state => getCodeSessionReference(state.threads[selectedThreadId ?? ''])?.session_id)
  const policySettings = useConversationPolicy()
  const toolSettings = useToolAvailable()
  const policy = useMemo(() => ({
    origin_session_id: selectedThreadId,
    auto_approve: policySettings.getApprovalMode(selectedThreadId ?? '') === 'skip',
    disabled_tools: toolSettings.getDisabledToolsForThread(selectedThreadId ?? ''),
    external_roots: policySettings.getWorkspace(selectedThreadId ?? '').externalRoots.map(root => ({ path: root.path, can_edit: root.canEdit })),
  }), [selectedThreadId, policySettings, toolSettings])
  useEffect(() => {
    if (!visible || status.phase !== 'running') return
    if (selectedCodeSessionId && lastSelectedRef.current !== selectedCodeSessionId) {
      lastSelectedRef.current = selectedCodeSessionId
      void updateCodeBridgePolicy(terminalId, policy).then(() => selectCodeSession(terminalId, selectedCodeSessionId)).catch(reason => {
        lastSelectedRef.current = undefined
        setError(String(reason))
      })
    }
  }, [visible, status.phase, selectedCodeSessionId, terminalId, policy, setError])

  // Every saved origin keeps its policy while another session is selected.
  // Hidden workspace terminals continue to own running background work.
  useEffect(() => {
    if (status.phase !== 'running') return
    const rows = Object.values(workspaceThreads).filter(thread => getCodeSessionReference(thread)?.directory === workspace)
    void Promise.all(rows.map(thread => updateCodeBridgePolicy(terminalId, {
      origin_session_id: thread.id,
      auto_approve: policySettings.getApprovalMode(thread.id) === 'skip',
      disabled_tools: toolSettings.getDisabledToolsForThread(thread.id),
      external_roots: policySettings.getWorkspace(thread.id).externalRoots.map(root => ({ path: root.path, can_edit: root.canEdit })),
    }))).catch(reason => setError(String(reason)))
  }, [status.phase, workspaceThreads, workspace, terminalId, policySettings, toolSettings, setError])

  const running = status.phase === 'running' || status.phase === 'stopping'
  const configuredModel = activeModel ?? defaultModelLocalApiServer?.model
  const setupState = updateMode ? undefined : !desktopTerminalAvailable
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
            {running && <Button size="icon-sm" variant="ghost" aria-label="New Code session"
              disabled={busy || status.phase === 'stopping'} onClick={() => {
                setConfiguredWorkspace(workspace)
                useCodeTerminalStore.getState().setSelectedThreadId(undefined)
                void navigate({ to: '/code', search: {}, replace: true })
                lastSelectedRef.current = undefined
                void newCodeSession(terminalId).catch(reason => setError(String(reason)))
              }}><IconPlus /></Button>}
            {desktopTerminalAvailable && <CodeBridgePanel visible={visible} workspace={status.cwd ?? workspace} />}
            {!updateResult && <Button size="sm" variant="outline" disabled={busy || !workspace || !readiness?.installed}
              onClick={() => updateMode ? void restart() : setUpdateRequested(true)}>
              {updateMode ? 'Open Code' : 'Update Code'}
            </Button>}
            <AgentWorkspaceSelect
              workingDir={workspace}
              onChange={directory => {
                useCodeTerminalStore.getState().setSelectedThreadId(undefined)
                setConfiguredWorkspace(directory)
                void navigate({ to: '/code', search: {}, replace: true })
              }}
            />
            {!updateMode && status.phase === 'exited' && (
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
                {t('code:restart')}
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

      {updateRequested && (
        <div className="flex flex-wrap items-center gap-2 border-t bg-muted/40 px-4 py-3 text-sm">
          <span className="flex-1">Updating stops this Code session. Finish active work first. Your settings, history, workspace and GChat theme are kept.</span>
          <Button size="sm" disabled={busy} onClick={() => void restart(true)}>Stop and update</Button>
          <Button size="sm" variant="ghost" onClick={() => setUpdateRequested(false)}>Cancel</Button>
        </div>
      )}

      <div className="relative min-h-0 flex-1 border-t bg-background">
        <div
          ref={containerRef}
          data-testid="code-terminal"
          className={cn(
            'absolute inset-0 overflow-hidden px-3 py-2 transition-opacity',
            updateMode || (status.phase === 'idle' && !busy) ? 'opacity-0 pointer-events-none' : 'opacity-100'
          )}
        />

        {updateMode && (
          <div className="absolute inset-0 z-20 flex items-center justify-center bg-background p-6">
            <div className="w-full max-w-md rounded-xl border bg-card p-6 text-center shadow-sm" role="status" aria-live="polite">
              {updatePhase && <IconLoader2 className="mx-auto mb-4 size-7 animate-spin text-primary" />}
              <h1 className="font-semibold">{updatePhase ? 'Updating Code' : updateError ? 'Update needs attention' : 'Update Successful'}</h1>
              {(updatePhase || updateError) && <p className="mt-2 text-sm text-muted-foreground">{updatePhase || updateError}</p>}
              {updatePhase && <p className="mt-2 text-xs text-muted-foreground">Keep GChat open until the update finishes.</p>}
              {updateResult && <Button className="mt-4" disabled={busy} onClick={() => void restart()}>Open Code</Button>}
              {updateError && <Button className="mt-4" size="sm" disabled={busy} onClick={() => void restart(true)}>Retry update</Button>}
            </div>
          </div>
        )}

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

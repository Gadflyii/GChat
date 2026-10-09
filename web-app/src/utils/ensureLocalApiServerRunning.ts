import { useAppState } from '@/hooks/useAppState'
import { useLocalApiServer } from '@/hooks/useLocalApiServer'
import { SERVER_START_WATCHDOG_MS, withTimeout } from '@/lib/utils'
import type { ServiceHub } from '@/services'

let pendingStart: {
  promise: Promise<boolean>
  callers: Array<() => boolean>
} | undefined

// Sidebar Start and Host readiness share one native facade start.
export function ensureLocalApiServerRunning(
  serviceHub: Pick<ServiceHub, 'app'>,
  shouldStart: () => boolean = () => true
): Promise<boolean> {
  if (!shouldStart() || useAppState.getState().pendingModelStops > 0) return Promise.resolve(false)
  if (pendingStart) {
    pendingStart.callers.push(shouldStart)
    return pendingStart.promise
  }
  const stopSequence = useAppState.getState().modelStopSequence
  const request = { callers: [shouldStart], promise: Promise.resolve(false) }
  const current = () => {
    const state = useAppState.getState()
    return state.pendingModelStops === 0 && state.modelStopSequence === stopSequence &&
      request.callers.some(caller => caller())
  }
  const running = () => withTimeout(serviceHub.app().getServerStatus(),
    SERVER_START_WATCHDOG_MS, 'Timed out checking the Local API Server.')
  const start = async () => {
    try {
      const isRunning = await running()
      if (!current()) return false
      if (!isRunning) {
        const settings = useLocalApiServer.getState()
        useAppState.getState().setServerStatus('pending')
        const call = window.core?.api?.startServer({
          host: settings.serverHost, port: settings.serverPort, prefix: settings.apiPrefix,
          apiKey: settings.apiKey, trustedHosts: settings.trustedHosts,
          isCorsEnabled: settings.corsEnabled, isVerboseEnabled: settings.verboseLogs,
          proxyTimeout: settings.proxyTimeout,
        }) as Promise<number> | undefined
        if (!call) throw new Error('The native server controller is unavailable.')
        const port = await withTimeout(call, SERVER_START_WATCHDOG_MS,
          'Timed out waiting for the Local API Server to start.')
        if (!current()) return false
        if (port && port !== settings.serverPort) settings.setServerPort(port)
      }
      useAppState.getState().setServerStatus('running')
      return true
    } catch (error) {
      if (!current()) return false
      // A different native caller may have started the singleton meanwhile.
      const isRunning = await running().catch(() => false)
      if (!current()) return false
      if (isRunning) {
        useAppState.getState().setServerStatus('running')
        return true
      }
      useAppState.getState().setServerStatus('stopped')
      throw error
    }
  }
  request.promise = start().finally(() => {
    if (pendingStart === request) pendingStart = undefined
  })
  pendingStart = request
  return request.promise
}

// A native start already dispatched cannot be cancelled. Stop follows its
// completion so the singleton is shut down even if it was still starting.
export async function stopLocalApiServer(wasRunning: boolean): Promise<void> {
  const start = pendingStart
  if (!wasRunning && !start) return
  await start?.promise.catch(() => false)
  const stop = window.core?.api?.stopServer()
  if (!stop) throw new Error('The native server controller is unavailable.')
  await withTimeout(stop, SERVER_START_WATCHDOG_MS,
    'Timed out waiting for the Local API Server to stop.')
}

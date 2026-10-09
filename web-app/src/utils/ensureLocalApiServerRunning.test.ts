import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useAppState } from '@/hooks/useAppState'
import { useLocalApiServer } from '@/hooks/useLocalApiServer'
import type { ServiceHub } from '@/services'
import { ensureLocalApiServerRunning, stopLocalApiServer } from './ensureLocalApiServerRunning'
import { runModelStop } from '@/utils/switchModel'

describe('shared native facade start', () => {
  const getServerStatus = vi.fn()
  const startServer = vi.fn()
  const services = { app: () => ({ getServerStatus }) } as unknown as Pick<ServiceHub, 'app'>

  beforeEach(() => {
    vi.resetAllMocks()
    useAppState.setState({ serverStatus: 'stopped', pendingModelStops: 0, intentionallyStoppedModels: new Set() })
    useLocalApiServer.setState({ serverPort: 1337 })
    getServerStatus.mockResolvedValue(false)
    window.core = { api: { startServer } } as typeof window.core
  })

  it('coalesces sidebar and Ready-edge starts and publishes the native assigned port once', async () => {
    let releaseStart: (port: number) => void = () => {}
    startServer.mockImplementation(() => new Promise<number>(resolve => { releaseStart = resolve }))
    const sidebar = ensureLocalApiServerRunning(services)
    const readyEdge = ensureLocalApiServerRunning(services)
    await vi.waitFor(() => expect(startServer).toHaveBeenCalledOnce())
    expect(useAppState.getState().serverStatus).toBe('pending')
    releaseStart(1444)
    await Promise.all([sidebar, readyEdge])
    expect(startServer).toHaveBeenCalledOnce()
    expect(useAppState.getState().serverStatus).toBe('running')
    expect(useLocalApiServer.getState().serverPort).toBe(1444)
  })

  it('accepts a competing native start only after actual status confirms running', async () => {
    const error = new Error('Server is already running')
    startServer.mockRejectedValue(error)
    getServerStatus.mockResolvedValueOnce(false).mockResolvedValue(true)
    await ensureLocalApiServerRunning(services)
    expect(getServerStatus).toHaveBeenCalledTimes(2)
    expect(startServer).toHaveBeenCalledOnce()
    expect(useAppState.getState().serverStatus).toBe('running')
  })

  it('preserves the actual start failure when status stays false, without replaying the mutation', async () => {
    const error = new Error('Port is unavailable')
    startServer.mockRejectedValue(error)
    const first = ensureLocalApiServerRunning(services)
    const second = ensureLocalApiServerRunning(services)
    await expect(first).rejects.toBe(error)
    await expect(second).rejects.toBe(error)
    expect(startServer).toHaveBeenCalledOnce()
    expect(useAppState.getState().serverStatus).toBe('stopped')
  })

  it('does not restart an already running facade', async () => {
    getServerStatus.mockResolvedValue(true)
    await ensureLocalApiServerRunning(services)
    expect(startServer).not.toHaveBeenCalled()
    expect(useAppState.getState().serverStatus).toBe('running')
  })

  it('shuts down an already dispatched native start before Stop completes without publishing stale running state', async () => {
    let releaseStart: (port: number) => void = () => {}
    const stopServer = vi.fn().mockResolvedValue(undefined)
    window.core!.api!.stopServer = stopServer
    startServer.mockImplementation(() => new Promise<number>(resolve => { releaseStart = resolve }))
    const start = ensureLocalApiServerRunning(services)
    await vi.waitFor(() => expect(startServer).toHaveBeenCalledOnce())
    const stop = runModelStop(async () => {
      await stopLocalApiServer(false)
      useAppState.getState().setServerStatus('stopped')
    })
    expect(stopServer).not.toHaveBeenCalled()
    releaseStart(1444)
    expect(await start).toBe(false)
    await stop
    expect(stopServer).toHaveBeenCalledOnce()
    expect(useAppState.getState().serverStatus).toBe('stopped')
    expect(useLocalApiServer.getState().serverPort).toBe(1337)
    startServer.mockResolvedValue(1555)
    expect(await ensureLocalApiServerRunning(services)).toBe(true)
    expect(startServer).toHaveBeenCalledTimes(2)
    expect(useLocalApiServer.getState().serverPort).toBe(1555)
  })
})

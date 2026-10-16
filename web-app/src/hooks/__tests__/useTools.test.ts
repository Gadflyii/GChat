import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { invoke } from '@tauri-apps/api/core'
import { listen as listenNative, type EventCallback } from '@tauri-apps/api/event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SystemEvent } from '@/types/events'
import type { CapabilitiesService, CapabilityCatalog } from '@/services/capabilities/types'
import type { EventsService } from '@/services/events/types'
import type { RAGService } from '@/services/rag/types'
import { resetServiceHubStore, seedServiceHub } from '@/test/service-hub'
import { useAppState } from '@/hooks/useAppState'
import { useToolAvailable } from '@/hooks/useToolAvailable'
import { useTools } from '../useTools'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn() }))

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

const nativeTool = {
  name: 'os_fs_read', identity: 'os.fs.read', description: 'Read a file',
  inputSchema: { type: 'object' }, server: 'gchat-native', origin: 'native' as const,
}
const mcpTool = {
  name: 'mcp_search', identity: 'search', description: 'Search',
  inputSchema: { type: 'object' }, server: 'research', origin: 'mcp' as const,
}
const connectorTool = {
  name: 'workspace_mail_list', identity: 'workspace.mail.list', description: 'List mail',
  inputSchema: { type: 'object' }, server: 'google', origin: 'native' as const,
}

describe('useTools capability catalog', () => {
  const getCatalog = vi.fn<() => Promise<CapabilityCatalog>>()
  const listen = vi.fn()
  const unsubscribe = vi.fn()
  const stopResources = vi.fn()
  let resourcesChanged: EventCallback<unknown>

  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('IS_TAURI', false)
    vi.mocked(invoke).mockReset().mockResolvedValue(false)
    vi.mocked(listenNative).mockReset().mockImplementation(async (_event, callback) => {
      resourcesChanged = callback as EventCallback<unknown>
      return stopResources
    })
    useAppState.setState({
      tools: [], capabilityToolNames: new Set(), ragToolNames: new Set(),
    })
    useToolAvailable.setState({ defaultsInitialized: true })
    listen.mockResolvedValue(unsubscribe)
    getCatalog.mockResolvedValue({ tools: [nativeTool, mcpTool], skills: [], servers: [] })
    seedServiceHub({
      capabilities: { getCatalog } as unknown as CapabilitiesService,
      rag: { getToolNames: vi.fn().mockResolvedValue(['rag_lookup']) } as unknown as RAGService,
      events: { listen } as unknown as EventsService,
    })
  })

  afterEach(() => {
    cleanup()
    resetServiceHubStore()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  function notifyResources() {
    resourcesChanged({ event: 'bundled-resources-update', id: 1, payload: null })
  }

  it('publishes native and MCP tools from one catalog while retaining RAG names', async () => {
    renderHook(() => useTools())

    await waitFor(() => expect(useAppState.getState().tools).toEqual([nativeTool, mcpTool]))
    expect(useAppState.getState().capabilityToolNames).toEqual(
      new Set(['os_fs_read', 'mcp_search'])
    )
    expect(useAppState.getState().ragToolNames).toEqual(new Set(['rag_lookup']))
    expect(getCatalog).toHaveBeenCalledOnce()
    expect(listen).toHaveBeenCalledWith(SystemEvent.MCP_UPDATE, expect.any(Function))
    expect(invoke).not.toHaveBeenCalled()
    expect(listenNative).not.toHaveBeenCalled()
  })

  it('refreshes the shared catalog when an MCP server changes', async () => {
    let onUpdate: (() => void) | undefined
    listen.mockImplementation((_event, callback) => {
      onUpdate = callback
      return Promise.resolve(unsubscribe)
    })
    renderHook(() => useTools())
    await waitFor(() => expect(useAppState.getState().tools).toEqual([nativeTool, mcpTool]))

    getCatalog.mockResolvedValue({ tools: [nativeTool], skills: [], servers: [] })
    onUpdate?.()
    await waitFor(() => expect(useAppState.getState().tools).toEqual([nativeTool]))
    expect(useAppState.getState().capabilityToolNames).toEqual(new Set(['os_fs_read']))
  })

  it('publishes built-in tools while resources are pending and adds connectors on completion', async () => {
    vi.stubGlobal('IS_TAURI', true)
    getCatalog.mockResolvedValue({ tools: [nativeTool], skills: [], servers: [] })
    renderHook(() => useTools())

    await waitFor(() => expect(useAppState.getState().tools).toEqual([nativeTool]))
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('bundled_resources_ready'))
    expect(getCatalog).toHaveBeenCalledOnce()

    getCatalog.mockResolvedValue({ tools: [nativeTool, connectorTool], skills: [], servers: [] })
    vi.mocked(invoke).mockResolvedValue(true)
    act(notifyResources)

    await waitFor(() => expect(useAppState.getState().tools).toEqual([nativeTool, connectorTool]))
    expect(useAppState.getState().capabilityToolNames).toEqual(
      new Set([nativeTool.name, connectorTool.name])
    )
    expect(getCatalog).toHaveBeenCalledTimes(2)
  })

  it('queues a genuinely fresh catalog when resource completion races the initial request', async () => {
    vi.stubGlobal('IS_TAURI', true)
    const initial = deferred<CapabilityCatalog>()
    getCatalog.mockImplementationOnce(() => initial.promise)
    getCatalog.mockResolvedValue({ tools: [nativeTool, connectorTool], skills: [], servers: [] })
    renderHook(() => useTools())
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('bundled_resources_ready'))

    vi.mocked(invoke).mockResolvedValue(true)
    await act(async () => { notifyResources() })
    expect(getCatalog).toHaveBeenCalledOnce()
    await act(async () => {
      initial.resolve({ tools: [nativeTool], skills: [], servers: [] })
      await initial.promise
    })

    await waitFor(() => expect(useAppState.getState().tools).toEqual([nativeTool, connectorTool]))
    expect(getCatalog).toHaveBeenCalledTimes(2)
  })

  it('shares one completion refresh across concurrent tool consumers', async () => {
    vi.stubGlobal('IS_TAURI', true)
    const updates: EventCallback<unknown>[] = []
    vi.mocked(listenNative).mockImplementation(async (_event, callback) => {
      updates.push(callback as EventCallback<unknown>)
      return stopResources
    })
    getCatalog.mockResolvedValue({ tools: [nativeTool], skills: [], servers: [] })
    renderHook(() => useTools())
    renderHook(() => useTools())
    await waitFor(() => expect(invoke).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(useAppState.getState().tools).toEqual([nativeTool]))
    expect(getCatalog).toHaveBeenCalledOnce()

    getCatalog.mockResolvedValue({ tools: [nativeTool, connectorTool], skills: [], servers: [] })
    vi.mocked(invoke).mockResolvedValue(true)
    await act(async () => {
      updates.forEach((notify) => notify({ event: 'bundled-resources-update', id: 1, payload: null }))
    })

    await waitFor(() => expect(useAppState.getState().tools).toEqual([nativeTool, connectorTool]))
    expect(getCatalog).toHaveBeenCalledTimes(2)
    expect(listen).toHaveBeenCalledOnce()
  })

  it('refreshes from retained completion when installation finishes during listener registration', async () => {
    vi.stubGlobal('IS_TAURI', true)
    const registration = deferred<() => void>()
    vi.mocked(listenNative).mockReturnValueOnce(registration.promise)
    getCatalog.mockResolvedValueOnce({ tools: [nativeTool], skills: [], servers: [] })
    getCatalog.mockResolvedValue({ tools: [nativeTool, connectorTool], skills: [], servers: [] })
    renderHook(() => useTools())
    await waitFor(() => expect(useAppState.getState().tools).toEqual([nativeTool]))
    expect(invoke).not.toHaveBeenCalled()

    vi.mocked(invoke).mockResolvedValue(true)
    await act(async () => { registration.resolve(stopResources); await registration.promise })

    await waitFor(() => expect(useAppState.getState().tools).toEqual([nativeTool, connectorTool]))
    expect(getCatalog).toHaveBeenCalledTimes(2)
  })

  it('retains built-in tools and reports the explicit resource failure', async () => {
    vi.stubGlobal('IS_TAURI', true)
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    getCatalog.mockResolvedValue({ tools: [nativeTool], skills: [], servers: [] })
    renderHook(() => useTools())
    await waitFor(() => expect(useAppState.getState().tools).toEqual([nativeTool]))
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('bundled_resources_ready'))

    vi.mocked(invoke).mockRejectedValue('runtime digest mismatch')
    act(notifyResources)

    await waitFor(() => expect(error).toHaveBeenCalledWith(
      'Failed to prepare capability resources:', 'runtime digest mismatch'
    ))
    expect(useAppState.getState().tools).toEqual([nativeTool])
    expect(useAppState.getState().capabilityToolNames).toEqual(new Set([nativeTool.name]))
    expect(getCatalog).toHaveBeenCalledOnce()
  })

  it('detaches MCP and late resource subscriptions without refreshing after unmount', async () => {
    vi.stubGlobal('IS_TAURI', true)
    const registration = deferred<() => void>()
    vi.mocked(listenNative).mockImplementationOnce((_event, callback) => {
      resourcesChanged = callback as EventCallback<unknown>
      return registration.promise
    })
    const { unmount } = renderHook(() => useTools())
    await waitFor(() => expect(useAppState.getState().tools).toEqual([nativeTool, mcpTool]))
    unmount()
    vi.mocked(invoke).mockResolvedValue(true)
    await act(async () => {
      notifyResources()
      registration.resolve(stopResources)
      await registration.promise
    })

    expect(unsubscribe).toHaveBeenCalledOnce()
    expect(stopResources).toHaveBeenCalledOnce()
    expect(invoke).not.toHaveBeenCalled()
    expect(getCatalog).toHaveBeenCalledOnce()
  })
})

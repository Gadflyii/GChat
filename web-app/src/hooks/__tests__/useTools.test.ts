import { cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SystemEvent } from '@/types/events'
import type { CapabilitiesService, CapabilityCatalog } from '@/services/capabilities/types'
import type { EventsService } from '@/services/events/types'
import type { RAGService } from '@/services/rag/types'
import { resetServiceHubStore, seedServiceHub } from '@/test/service-hub'
import { useAppState } from '@/hooks/useAppState'
import { useToolAvailable } from '@/hooks/useToolAvailable'
import { useTools } from '../useTools'

const nativeTool = {
  name: 'os_fs_read', identity: 'os.fs.read', description: 'Read a file',
  inputSchema: { type: 'object' }, server: 'gchat-native', origin: 'native' as const,
}
const mcpTool = {
  name: 'mcp_search', identity: 'search', description: 'Search',
  inputSchema: { type: 'object' }, server: 'research', origin: 'mcp' as const,
}

describe('useTools capability catalog', () => {
  const getCatalog = vi.fn<() => Promise<CapabilityCatalog>>()
  const listen = vi.fn()
  const unsubscribe = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
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
  })

  it('publishes native and MCP tools from one catalog while retaining RAG names', async () => {
    renderHook(() => useTools())

    await waitFor(() => expect(useAppState.getState().tools).toEqual([nativeTool, mcpTool]))
    expect(useAppState.getState().capabilityToolNames).toEqual(
      new Set(['os_fs_read', 'mcp_search'])
    )
    expect(useAppState.getState().ragToolNames).toEqual(new Set(['rag_lookup']))
    expect(getCatalog).toHaveBeenCalledOnce()
    expect(listen).toHaveBeenCalledWith(SystemEvent.MCP_UPDATE, expect.any(Function))
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
})

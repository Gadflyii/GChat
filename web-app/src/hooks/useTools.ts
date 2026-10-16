import { useEffect } from 'react'
import { getServiceHub } from '@/hooks/useServiceHub'
import { SystemEvent } from '@/types/events'
import { useAppState } from './useAppState'
import { useToolAvailable } from './useToolAvailable'
import { useBundledResources } from './useBundledResources'
import { ExtensionManager } from '@/lib/extension'
import { ExtensionTypeEnum, MCPExtension } from '@gchat/core'

type ToolSnapshot = Awaited<ReturnType<typeof fetchToolSnapshot>>

let inFlightSnapshot: Promise<ToolSnapshot> | undefined
let requestedRefreshVersion = 0
let processedRefreshVersion = 0
let refreshLoop: Promise<void> | undefined
let mcpUpdateUnsubscribe: (() => void) | undefined
let mcpUpdateListener: Promise<() => void> | undefined
let resourcesRefreshQueued = false
const refreshSubscribers = new Set<(snapshot: ToolSnapshot) => void>()

async function fetchToolSnapshot() {
  const [response, ragToolNames] = await Promise.all([
    getServiceHub().capabilities().getCatalog(),
    getServiceHub().rag().getToolNames?.() ?? Promise.resolve([]),
  ])
  return { catalog: response, ragToolNames }
}

function getToolSnapshot() {
  if (!inFlightSnapshot) {
    const request = fetchToolSnapshot()
    const trackedRequest = request.finally(() => {
      if (inFlightSnapshot === trackedRequest) {
        inFlightSnapshot = undefined
      }
    })
    inFlightSnapshot = trackedRequest
  }
  return inFlightSnapshot
}

function queueFreshToolSnapshot() {
  requestedRefreshVersion += 1
  ensureRefreshLoop()
}

function ensureRefreshLoop() {
  if (refreshLoop) return

  refreshLoop = (async () => {
    while (processedRefreshVersion < requestedRefreshVersion) {
      const targetVersion = requestedRefreshVersion
      if (inFlightSnapshot) {
        await inFlightSnapshot.catch(() => undefined)
      }
      try {
        const snapshot = await getToolSnapshot()
        refreshSubscribers.forEach((subscriber) => subscriber(snapshot))
      } catch (error) {
        console.error('Failed to fetch capabilities:', error)
      }
      processedRefreshVersion = targetVersion
    }
  })().finally(() => {
    refreshLoop = undefined
    if (processedRefreshVersion < requestedRefreshVersion) {
      ensureRefreshLoop()
    }
  })
}

function subscribeToMcpUpdates(refresh: (snapshot: ToolSnapshot) => void) {
  refreshSubscribers.add(refresh)

  if (!mcpUpdateListener) {
    mcpUpdateListener = getServiceHub()
      .events()
      .listen(SystemEvent.MCP_UPDATE, () => {
        queueFreshToolSnapshot()
      })
      .then((unsubscribe) => {
        mcpUpdateUnsubscribe = unsubscribe
        return unsubscribe
      })
      .catch((error) => {
        mcpUpdateListener = undefined
        console.error('Failed to set up MCP update listener:', error)
        return () => {}
      })
  }

  return () => {
    refreshSubscribers.delete(refresh)
    if (refreshSubscribers.size === 0) {
      resourcesRefreshQueued = false
      if (mcpUpdateUnsubscribe) {
        mcpUpdateUnsubscribe()
        mcpUpdateUnsubscribe = undefined
        mcpUpdateListener = undefined
      } else {
        void mcpUpdateListener?.then((unsubscribe) => {
          if (refreshSubscribers.size === 0) {
            unsubscribe()
            mcpUpdateUnsubscribe = undefined
            mcpUpdateListener = undefined
          }
        })
      }
    }
  }
}

export const useTools = () => {
  const { ready: resourcesReady, error: resourceError } = useBundledResources()
  const updateTools = useAppState((state) => state.updateTools)
  const updateRagToolNames = useAppState((state) => state.updateRagToolNames)
  const updateCapabilityToolNames = useAppState((state) => state.updateCapabilityToolNames)
  const { isDefaultsInitialized, setDefaultDisabledTools, markDefaultsAsInitialized } = useToolAvailable()

  useEffect(() => {
    async function setTools(snapshot: ToolSnapshot) {
      try {
        const mcpExtension = ExtensionManager.getInstance().get<MCPExtension>(
          ExtensionTypeEnum.MCP
        )

        const { catalog, ragToolNames } = snapshot

        updateTools(catalog.tools)

        // Cache tool names for synchronous lookup.
        updateCapabilityToolNames(catalog.tools.map((tool) => tool.name))
        updateRagToolNames(ragToolNames)

        // Apply default exclusions only before preferences are initialized.
        if (!isDefaultsInitialized() && catalog.tools.some((tool) => tool.origin === 'mcp') && mcpExtension?.getDefaultDisabledTools) {
          const defaultDisabled = await mcpExtension.getDefaultDisabledTools()
          if (defaultDisabled.length > 0) {
            setDefaultDisabledTools(defaultDisabled)
            markDefaultsAsInitialized()
          }
        }
      } catch (error) {
        console.error('Failed to fetch capabilities:', error)
      }
    }
    void getToolSnapshot()
      .then(setTools)
      .catch((error) => {
        console.error('Failed to fetch capabilities:', error)
      })
    return subscribeToMcpUpdates((snapshot) => {
      void setTools(snapshot)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!IS_TAURI) return
    if (resourceError) {
      console.error('Failed to prepare capability resources:', resourceError)
    } else if (resourcesReady && !resourcesRefreshQueued) {
      // The first catalog may have omitted pending connectors. Queue a new
      // snapshot even when that initial request has not finished yet.
      resourcesRefreshQueued = true
      queueFreshToolSnapshot()
    }
  }, [resourcesReady, resourceError])
}

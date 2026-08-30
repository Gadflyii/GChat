import { useState } from 'react'
import {
  IconLoader2,
  IconPlayerPlay,
  IconRefresh,
  IconServer,
  IconSquare,
} from '@tabler/icons-react'
import { toast } from 'sonner'

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  SidebarMenuButton,
  SidebarMenuItem,
} from '@/components/ui/sidebar'
import { useAppState } from '@/hooks/useAppState'
import { useLocalApiServer } from '@/hooks/useLocalApiServer'
import { useModelProvider } from '@/hooks/useModelProvider'
import { useServiceHub } from '@/hooks/useServiceHub'
import {
  MODEL_LOAD_WATCHDOG_MS,
  SERVER_START_WATCHDOG_MS,
  withTimeout,
} from '@/lib/utils'
import { syncActiveModelsFromEngines } from '@/utils/activeModelsSync'
import { ensureModelForServer } from '@/utils/ensureModelForServer'
import { restartLocalModel } from '@/utils/restartLocalModel'

export function ServerQuickActions() {
  const serviceHub = useServiceHub()
  const serverStatus = useAppState((state) => state.serverStatus)
  const activeModel = useAppState((state) => state.activeModels[0])
  const [busy, setBusy] = useState(false)

  const start = async () => {
    const settings = useLocalApiServer.getState()
    setBusy(true)
    useAppState.getState().setServerStatus('pending')
    try {
      const result = await withTimeout(
        ensureModelForServer({
          modelsService: serviceHub.models(),
          modelOverride: settings.defaultModelLocalApiServer,
        }),
        MODEL_LOAD_WATCHDOG_MS,
        'Timed out waiting for the model to load.'
      )
      if (result.status === 'no_model_available') {
        throw new Error('No model is available to load.')
      }
      settings.setLastServerModels([
        { model: result.modelId, provider: result.providerName },
      ])
      const models = await serviceHub.models().getActiveModels()
      syncActiveModelsFromEngines(models ?? [])
      const call = window.core?.api?.startServer({
        host: settings.serverHost,
        port: settings.serverPort,
        prefix: settings.apiPrefix,
        apiKey: settings.apiKey,
        trustedHosts: settings.trustedHosts,
        isCorsEnabled: settings.corsEnabled,
        isVerboseEnabled: settings.verboseLogs,
        proxyTimeout: settings.proxyTimeout,
      }) as Promise<number> | undefined
      if (!call) throw new Error('The native server controller is unavailable.')
      const port = await withTimeout(
        call,
        SERVER_START_WATCHDOG_MS,
        'Timed out waiting for the Local API Server to start.'
      )
      if (port && port !== settings.serverPort) settings.setServerPort(port)
      useAppState.getState().setServerStatus('running')
      toast.success('Local API Server started')
    } catch (error) {
      useAppState.getState().setServerStatus('stopped')
      toast.error('Could not start Local API Server', {
        description: String(error),
      })
    } finally {
      setBusy(false)
    }
  }

  const stop = async () => {
    setBusy(true)
    useAppState.getState().setServerStatus('pending')
    try {
      await window.core?.api?.stopServer()
      useAppState.getState().setServerStatus('stopped')
      toast.success('Local API Server stopped')
    } catch (error) {
      useAppState.getState().setServerStatus('running')
      toast.error('Could not stop Local API Server', {
        description: String(error),
      })
    } finally {
      setBusy(false)
    }
  }

  const reload = async () => {
    if (!activeModel) {
      toast.error('No loaded model is available to reload.')
      return
    }
    const provider = useModelProvider
      .getState()
      .providers.find((candidate) =>
        candidate.models?.some((model) => model.id === activeModel)
      )
    if (!provider) {
      toast.error(`Could not find the provider for '${activeModel}'.`)
      return
    }
    setBusy(true)
    try {
      await restartLocalModel(serviceHub, provider.provider, activeModel)
      toast.success('Model reloaded')
    } catch (error) {
      toast.error('Could not reload model', { description: String(error) })
    } finally {
      setBusy(false)
    }
  }

  const running = serverStatus === 'running'

  return (
    <SidebarMenuItem>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <SidebarMenuButton disabled={busy || serverStatus === 'pending'}>
            {busy || serverStatus === 'pending' ? (
              <IconLoader2 className="size-4 animate-spin text-primary" />
            ) : (
              <IconServer className="size-4 text-foreground/70" />
            )}
            <span>{running ? 'Server running' : 'Server stopped'}</span>
            <span
              className={`ml-auto size-1.5 rounded-full ${
                running ? 'bg-emerald-500' : 'bg-muted-foreground/40'
              }`}
            />
          </SidebarMenuButton>
        </DropdownMenuTrigger>
        <DropdownMenuContent side="right" align="end">
          {running ? (
            <>
              <DropdownMenuItem onSelect={() => void reload()}>
                <IconRefresh /> Reload model
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => void stop()}>
                <IconSquare /> Stop server
              </DropdownMenuItem>
            </>
          ) : (
            <DropdownMenuItem onSelect={() => void start()}>
              <IconPlayerPlay /> Start server
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </SidebarMenuItem>
  )
}

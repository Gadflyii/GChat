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
import { isLocalProvider } from '@/utils/registerRemoteProvider'
import { runModelStop } from '@/utils/switchModel'

export function ServerQuickActions() {
  const serviceHub = useServiceHub()
  const serverStatus = useAppState((state) => state.serverStatus)
  const activeModel = useAppState((state) => state.activeModels[0])
  const activeProvider = useModelProvider((state) =>
    state.providers.find((candidate) =>
      candidate.models?.some((model) => model.id === activeModel)
    )
  )
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
      useAppState.getState().setIntentionalModelStop(
        result.providerName,
        result.modelId,
        false
      )
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
    try {
      await runModelStop(async () => {
        // Resolve the target after any earlier model switch has published its
        // final selection. The reservation above already suppresses auto-start.
        const appState = useAppState.getState()
        const apiWasRunning = appState.serverStatus === 'running'
        const loadedModel = appState.activeModels[0]
        const modelState = useModelProvider.getState()
        const provider = loadedModel
          ? modelState.providers.find((candidate) =>
              candidate.models?.some((model) => model.id === loadedModel)
            )
          : undefined
        const selectedModel = modelState.selectedModel?.id
        const selectedProvider = modelState.selectedProvider
        appState.setServerStatus('pending')

        if (apiWasRunning) {
          try {
            const stopServer = window.core?.api?.stopServer()
            if (!stopServer) throw new Error('The native server controller is unavailable.')
            await stopServer
          } catch (error) {
            useAppState.getState().setServerStatus('running')
            toast.error('Could not stop Local API Server', {
              description: String(error),
            })
            return
          }
        }
        useAppState.getState().setServerStatus('stopped')
        if (selectedModel && isLocalProvider(selectedProvider)) {
          useAppState.getState().setIntentionalModelStop(selectedProvider, selectedModel, true)
        }
        if (loadedModel && provider && isLocalProvider(provider.provider)) {
          useAppState.getState().setIntentionalModelStop(provider.provider, loadedModel, true)
        }

        let unloadError: unknown
        let unloadedModel = false
        if (loadedModel && !provider) {
          unloadError = new Error(`Could not find the provider for '${loadedModel}'.`)
        } else if (loadedModel && provider && isLocalProvider(provider.provider)) {
          try {
            const result = await serviceHub.models().stopModel(
              loadedModel,
              provider.provider
            )
            if (!result?.success) {
              throw new Error(
                result?.error || `Could not confirm that '${loadedModel}' unloaded.`
              )
            }
            unloadedModel = true
          } catch (error) {
            unloadError = error
          }
        }

        let refreshError: unknown
        try {
          const models = await serviceHub.models().getActiveModels()
          syncActiveModelsFromEngines(models ?? [])
        } catch (error) {
          refreshError = error
        }

        if (unloadError) {
          toast.error(apiWasRunning
            ? 'Local API Server stopped, but the model could not be unloaded'
            : 'Could not unload model', {
            description: refreshError
              ? `${String(unloadError)} Loaded models could not be refreshed: ${String(refreshError)}`
              : String(unloadError),
          })
        } else if (refreshError) {
          toast.error(apiWasRunning
            ? 'Local API Server stopped, but loaded models could not be refreshed'
            : 'Model stopped, but loaded models could not be refreshed', {
            description: String(refreshError),
          })
        } else {
          toast.success(unloadedModel
            ? apiWasRunning ? 'Local API Server and model stopped' : 'Model stopped'
            : 'Local API Server stopped')
        }
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
      useAppState.getState().setIntentionalModelStop(provider.provider, activeModel, false)
      toast.success('Model reloaded')
    } catch (error) {
      toast.error('Could not reload model', { description: String(error) })
    } finally {
      setBusy(false)
    }
  }

  const running = serverStatus === 'running'
  const modelLoaded = Boolean(
    activeModel && (!activeProvider || isLocalProvider(activeProvider.provider))
  )

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
            <span>{running ? 'Server running' : modelLoaded ? 'Model loaded' : 'Server stopped'}</span>
            <span
              className={`ml-auto size-1.5 rounded-full ${
                running ? 'bg-emerald-500' : 'bg-muted-foreground/40'
              }`}
            />
          </SidebarMenuButton>
        </DropdownMenuTrigger>
        <DropdownMenuContent side="right" align="end">
          {!running && (
            <DropdownMenuItem onSelect={() => void start()}>
              <IconPlayerPlay /> Start server
            </DropdownMenuItem>
          )}
          {(running || modelLoaded) && (
            <>
              <DropdownMenuItem onSelect={() => void reload()}>
                <IconRefresh /> Reload model
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => void stop()}>
                <IconSquare /> {running ? 'Stop server' : 'Stop model'}
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </SidebarMenuItem>
  )
}

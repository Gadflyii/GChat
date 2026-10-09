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
import { ensureLocalApiServerRunning, stopLocalApiServer } from '@/utils/ensureLocalApiServerRunning'
import { restartLocalModel } from '@/utils/restartLocalModel'
import { controlLocalHostModel, isLocallyOwnedModel, localHostModel, readyLocalHostModels } from '@/utils/localHostModel'
import { useEngineHosts } from '@/stores/engine-hosts-store'
import { runModelStop } from '@/utils/switchModel'

export function ServerQuickActions() {
  const serviceHub = useServiceHub()
  const serverStatus = useAppState((state) => state.serverStatus)
  useEngineHosts(state => state.hosts)
  useEngineHosts(state => state.snapshots)
  const trackedModel = useAppState((state) => state.activeModels[0])
  const selectedModel = useModelProvider(state => state.selectedModel?.id)
  const activeModel = trackedModel ?? (selectedModel && readyLocalHostModels().includes(selectedModel) ? selectedModel : undefined)
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
      const modelState = useModelProvider.getState()
      const localDefault = settings.defaultModelLocalApiServer ?? settings.lastServerModels[0]
        ?? (modelState.selectedModel ? { model: modelState.selectedModel.id, provider: modelState.selectedProvider } : undefined)
      const localTarget = localDefault?.provider === 'ginfer-lan' && localHostModel(localDefault.model)
        ? localDefault.model : undefined
      const result = localTarget
        ? await controlLocalHostModel(localTarget, 'start').then(() => ({ modelId: localTarget, providerName: 'ginfer-lan', status: 'loaded' as const }))
        : await withTimeout(ensureModelForServer({
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
      if (!await ensureLocalApiServerRunning(serviceHub)) {
        throw new Error('Local API Server startup was superseded by Stop.')
      }
      useAppState.getState().setIntentionalModelStop(
        result.providerName,
        result.modelId,
        false
      )
      useAppState.getState().setServerStatus('running')
      toast.success('Local API Server started')
    } catch (error) {
      const running = await withTimeout(serviceHub.app().getServerStatus(),
        SERVER_START_WATCHDOG_MS, 'Timed out checking the Local API Server.').catch(() => false)
      useAppState.getState().setServerStatus(running ? 'running' : 'stopped')
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

        try {
          await stopLocalApiServer(apiWasRunning)
        } catch (error) {
          useAppState.getState().setServerStatus('running')
          toast.error('Could not stop Local API Server', {
            description: String(error),
          })
          return
        }
        useAppState.getState().setServerStatus('stopped')
        if (selectedModel && isLocallyOwnedModel(selectedProvider, selectedModel)) {
          useAppState.getState().setIntentionalModelStop(selectedProvider, selectedModel, true)
        }
        const loadedTarget = loadedModel ?? (selectedModel && readyLocalHostModels().includes(selectedModel) ? selectedModel : undefined)
        const loadedProvider = provider?.provider ?? (loadedTarget && localHostModel(loadedTarget) ? 'ginfer-lan' : undefined)
        if (loadedTarget && loadedProvider && isLocallyOwnedModel(loadedProvider, loadedTarget)) {
          useAppState.getState().setIntentionalModelStop(loadedProvider, loadedTarget, true)
        }

        let unloadError: unknown
        let unloadedModel = false
        if (loadedTarget && !loadedProvider) {
          unloadError = new Error(`Could not find the provider for '${loadedTarget}'.`)
        } else if (loadedTarget && isLocallyOwnedModel(loadedProvider, loadedTarget)) {
          try {
            const result = loadedProvider === 'ginfer-lan'
              ? await controlLocalHostModel(loadedTarget, 'stop').then(() => ({ success: true, error: undefined }))
              : await serviceHub.models().stopModel(loadedTarget, loadedProvider)
            if (!result?.success) {
              throw new Error(
                result?.error || `Could not confirm that '${loadedTarget}' unloaded.`
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
    const providerName = provider?.provider ?? (localHostModel(activeModel) ? 'ginfer-lan' : undefined)
    if (!providerName) {
      toast.error(`Could not find the provider for '${activeModel}'.`)
      return
    }
    setBusy(true)
    try {
      if (providerName === 'ginfer-lan' && localHostModel(activeModel)) {
        await controlLocalHostModel(activeModel, 'restart')
        syncActiveModelsFromEngines(await serviceHub.models().getActiveModels())
      } else {
        await restartLocalModel(serviceHub, providerName, activeModel)
      }
      useAppState.getState().setIntentionalModelStop(providerName, activeModel, false)
      toast.success('Model reloaded')
    } catch (error) {
      toast.error('Could not reload model', { description: String(error) })
    } finally {
      setBusy(false)
    }
  }

  const running = serverStatus === 'running'
  const modelLoaded = Boolean(
    activeModel && (!activeProvider || isLocallyOwnedModel(activeProvider.provider, activeModel))
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
              {modelLoaded && <DropdownMenuItem onSelect={() => void reload()}>
                <IconRefresh /> Reload model
              </DropdownMenuItem>}
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

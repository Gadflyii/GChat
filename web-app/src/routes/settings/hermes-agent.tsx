import { createFileRoute } from '@tanstack/react-router'
import { route } from '@/constants/routes'
import HeaderPage from '@/containers/HeaderPage'
import SettingsMenu from '@/containers/SettingsMenu'
import { Card, CardItem } from '@/containers/Card'
import { Button } from '@/components/ui/button'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { useLocalApiServer } from '@/hooks/useLocalApiServer'
import { useHermesAgentModel } from '@/hooks/useHermesAgentModel'
import { useAppState } from '@/hooks/useAppState'
import { useModelProvider } from '@/hooks/useModelProvider'
import { useServiceHub } from '@/hooks/useServiceHub'
import { cn } from '@/lib/utils'
import { useState, useMemo, useRef, useEffect } from 'react'
import { toast } from 'sonner'
import { getModelToStart } from '@/utils/getModelToStart'
import { invoke } from '@tauri-apps/api/core'
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from '@/components/ui/popover'
import { IconChevronDown, IconX, IconCopy, IconCheck } from '@tabler/icons-react'
import ProvidersAvatar from '@/containers/ProvidersAvatar'
import Capabilities from '@/containers/Capabilities'
import { getModelDisplayName, isLocalProvider } from '@/lib/utils'
import { syncActiveModelsFromEngines } from '@/utils/activeModelsSync'
import { stopTerminal } from '@/services/terminal/tauri'
import { listAgentModelInstances } from '@/services/agent/definitions'
import type { AgentModelInstance } from '@/types/agent'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const Route = createFileRoute(route.settings.hermes_agent as any)({
  component: HermesAgentIntegration,
})

type HermesModel = ModelProvider['models'][number] & {
  providerName: string
  isLocal: boolean
  ready?: boolean
}

const MIN_HERMES_CTX = 65_536

function HermesAgentIntegration() {
  const { t } = useTranslation()
  const serviceHub = useServiceHub()
  const {
    corsEnabled,
    verboseLogs,
    serverHost,
    serverPort,
    setServerPort,
    apiPrefix,
    apiKey,
    trustedHosts,
    proxyTimeout,
    setLastServerModels,
  } = useLocalApiServer()

  const { serverStatus, setServerStatus } = useAppState()
  const { providers, selectedModel, selectedProvider, getProviderByName } =
    useModelProvider()

  const { config, setModel, setEnabled, clearModel } = useHermesAgentModel()

  const [isModelLoading, setIsModelLoading] = useState(false)
  const [configuredValues, setConfiguredValues] = useState<{
    model: string
    apiUrl: string
    contextLength: number
  } | null>(null)

  const [readyInstances, setReadyInstances] = useState<AgentModelInstance[]>([])
  const savingRef = useRef(false)

  useEffect(() => {
    let active = true
    void listAgentModelInstances()
      .then((instances) => { if (active) setReadyInstances(instances) })
      .catch((reason) => {
        if (active) toast.error(`Could not refresh Ready models: ${String(reason)}`)
      })
    return () => { active = false }
  }, [])

  const availableModels = useMemo<HermesModel[]>(() => {
    const readyModels = readyInstances.map((instance) => {
      const projected = providers.flatMap((p) => p.models)
        .find((model) => model.id === instance.id)
      return {
        ...projected,
        id: instance.id,
        displayName: projected?.displayName ||
          `${instance.modelId} — ${instance.hostName || 'GInfer Host'}`,
        providerName: 'ginfer-lan',
        isLocal: false,
        ready: true,
      }
    })
    return [...readyModels, ...providers
      .filter((p) => p.active && p.provider !== 'ginfer-lan')
      .flatMap((p) => p.models
        .filter(() => isLocalProvider(p.provider) || !!p.api_key?.length)
        .map((m) => ({
          ...m,
          providerName: p.provider,
          isLocal: !!isLocalProvider(p.provider),
        })))]
  }, [providers, readyInstances])

  useEffect(() => {
    if (!config.model && availableModels.length > 0) {
      setModel(availableModels[0].id)
    }
  }, [config.model, availableModels, setModel])

  const getModelCtxLen = (modelId: string): number => {
    for (const p of providers) {
      const m = p.models.find((m) => m.id === modelId)
      const value = Number(m?.settings?.ctx_len?.controller_props?.value)
      if (value > 0) return value
    }
    return MIN_HERMES_CTX
  }

  const handleSaveEnable = async () => {
    if (savingRef.current) return
    savingRef.current = true
    setIsModelLoading(true)
    try {
      let instances = await listAgentModelInstances()
      setReadyInstances(instances)
      const loadedModels = (await serviceHub.models().getActiveModels()) || []
      const modelId = config.model || loadedModels[0] ||
        getModelToStart({ selectedModel, selectedProvider, getProviderByName })?.model
      if (!modelId) {
        toast.error('Choose a model, then select Save connection again.')
        return
      }

      // Resolve only exact identities and confirmed aliases. A different Ready
      // model must never stand in for an imported file selected by the user.
      const resolveReady = (catalog: AgentModelInstance[]) => {
        const exact = catalog.find((instance) => instance.id === modelId)
        if (exact) return exact
        const matches = catalog.filter((instance) =>
          instance.modelId === modelId || instance.aliases?.includes(modelId))
        if (matches.length > 1) {
          throw new Error('This model matches multiple Ready instances. Choose one exact instance in the Model menu, then save again.')
        }
        return matches[0]
      }
      let instance = resolveReady(instances)
      if (!instance && modelId.startsWith('ginfer/')) {
        throw new Error('The selected Host model is no longer Ready. Start it in GInfer Hosts, then select Save connection again.')
      }
      if (!instance && !loadedModels.includes(modelId)) {
        const provider = providers.find((p) => p.active &&
          p.models.some((m) => m.id === modelId))
        if (!provider) {
          throw new Error('This model is no longer available. Choose a model, then save again.')
        }
        await serviceHub.models().startModel(provider, modelId, true)
        instances = await listAgentModelInstances()
        setReadyInstances(instances)
        instance = resolveReady(instances)
        const activeModels = (await serviceHub.models().getActiveModels()) || []
        syncActiveModelsFromEngines(activeModels)
      }
      const provider = providers.find((p) => p.models.some((m) => m.id === modelId))
      if (!instance && provider && isLocalProvider(provider.provider)) {
        throw new Error('This model is not Ready. Start it in GInfer Hosts, then choose its Ready instance here.')
      }
      if (instance && (!instance.maxContext || instance.maxContext < MIN_HERMES_CTX)) {
        throw new Error('Hermes Agent needs at least 65,536 conversation tokens. In GInfer Hosts, stop this model, choose model settings with at least 65,536 tokens, check and start it, then save this connection again.')
      }
      const modelToUse = instance?.id || modelId
      const effectiveCtx = instance?.maxContext || Math.max(getModelCtxLen(modelId), MIN_HERMES_CTX)

      let actualPort = serverPort
      if (serverStatus === 'stopped') {
        toast.info('Preparing the Hermes Agent connection…', {
          description: 'Starting the local connection.',
        })
        try {
          actualPort = await window.core?.api?.startServer({
            host: serverHost,
            port: serverPort,
            prefix: apiPrefix,
            apiKey,
            trustedHosts,
            isCorsEnabled: corsEnabled,
            isVerboseEnabled: verboseLogs,
            proxyTimeout,
          }) || serverPort
        } catch (startErr) {
          const message = startErr instanceof Error ? startErr.message : String(startErr)
          if (!message.includes('already running')) throw startErr
        }
        if (actualPort !== serverPort) setServerPort(actualPort)
        setServerStatus('running')
        setLastServerModels([{ model: modelToUse, provider: instance ? 'ginfer-lan' : provider?.provider || '' }])
      }
      const hermesHost = serverHost === '0.0.0.0' ? '127.0.0.1' : serverHost
      const fullApiUrl = `http://${hermesHost}:${actualPort}${apiPrefix}`
      await invoke('configure_hermes_agent', {
        apiUrl: fullApiUrl,
        model: modelToUse,
        apiKey: apiKey || undefined,
        contextLength: effectiveCtx,
      })
      setModel(modelToUse)
      setConfiguredValues({ model: modelToUse, apiUrl: fullApiUrl, contextLength: effectiveCtx })
      setEnabled(true)
      toast.success(
        'Connection saved. Open a terminal and run `hermes` to use GChat.',
        { duration: 8000 }
      )
    } catch (error) {
      console.error('Failed to configure Hermes Agent:', error)
      toast.error('Could not save the Hermes Agent connection', {
        description: error instanceof Error ? error.message : String(error),
      })
    } finally {
      savingRef.current = false
      setIsModelLoading(false)
    }
  }

  return (
    <div className="flex flex-col h-svh w-full">
      <HeaderPage>
        <div className="flex items-center gap-2 w-full">
          <span className="font-medium text-base font-studio">
            {t('common:settings')}
          </span>
        </div>
      </HeaderPage>
      <div className="flex h-[calc(100%-60px)]">
        <SettingsMenu />
        <div className="p-4 pt-0 w-full overflow-y-auto">
          <div className="flex flex-col justify-between gap-4 gap-y-3 w-full">
            <Card
              header={
                <div className="mb-3 flex w-full items-center gap-3">
                  <svg
                    width="20"
                    height="20"
                    viewBox="0 0 24 24"
                    fill="none"
                    xmlns="http://www.w3.org/2000/svg"
                    className="shrink-0"
                  >
                    <path
                      d="M12 2C12 2 9 6 9 9C9 10.1 9.4 11.1 10 11.8L7 20H9L10.5 16H13.5L15 20H17L14 11.8C14.6 11.1 15 10.1 15 9C15 6 12 2 12 2Z"
                      fill="currentColor"
                      className="text-emerald-500"
                    />
                    <path
                      d="M8 9C6.5 9 5 10 5 12L7 11M16 9C17.5 9 19 10 19 12L17 11"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      className="text-emerald-500"
                    />
                  </svg>
                  <h2 className="text-foreground font-studio font-medium text-base">
                    Hermes Agent integration
                  </h2>
                </div>
              }
            >
              <p className="mb-4 text-sm text-muted-foreground">
                Connect the separately installed Hermes Agent app to a model in
                GChat. Choose a model and select Save connection, then open a
                terminal and run <code>hermes</code>.
              </p>
              <CardItem
                title="Model"
                description="Choose the model Hermes Agent will use to answer requests."
                actions={
                  <ModelSelector
                    providers={providers}
                    availableModels={availableModels}
                    disabled={isModelLoading}
                    selectedModel={config.model}
                    onSelect={(model) => setModel(model)}
                    placeholder="Choose a model"
                  />
                }
              />

              <div className="flex mt-2 justify-end gap-2 border-t pt-4">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={isModelLoading}
                  onClick={async () => {
                    await stopTerminal('hermes').catch(() => undefined)
                    clearModel()
                    setConfiguredValues(null)
                    try {
                      await invoke('clear_hermes_agent_config')
                      toast.success('Hermes Agent settings cleared')
                    } catch (e) {
                      toast.error(`Could not clear the Hermes Agent connection: ${e}`)
                    }
                  }}
                >
                  Clear connection
                </Button>

                <Button
                  size="sm"
                  onClick={handleSaveEnable}
                  disabled={isModelLoading}
                >
                  {isModelLoading ? 'Saving connection…' : 'Save connection'}
                </Button>
              </div>
            </Card>

            {configuredValues && (
              <ManualConfigPanel
                model={configuredValues.model}
                apiUrl={configuredValues.apiUrl}
                contextLength={configuredValues.contextLength}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function CopyableField({
  label,
  value,
}: {
  label: string
  value: string
}) {
  const [copied, setCopied] = useState(false)

  const copy = () => {
    navigator.clipboard.writeText(value)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div className="flex items-center justify-between gap-2 py-1.5">
      <span className="text-xs text-muted-foreground shrink-0">{label}</span>
      <div className="flex items-center gap-1.5 min-w-0">
        <code className="text-xs font-mono bg-secondary/50 px-2 py-0.5 rounded truncate">
          {value}
        </code>
        <button
          type="button"
          aria-label={`Copy ${label}`}
          onClick={copy}
          className="shrink-0 p-0.5 rounded hover:bg-secondary/60 text-muted-foreground"
        >
          {copied ? (
            <IconCheck size={13} className="text-emerald-500" />
          ) : (
            <IconCopy size={13} />
          )}
        </button>
      </div>
    </div>
  )
}

function ManualConfigPanel({
  model,
  apiUrl,
  contextLength,
}: {
  model: string
  apiUrl: string
  contextLength: number
}) {
  const yamlSnippet = [
    'model:',
    `  default: "${model}"`,
    '  provider: "custom"',
    `  base_url: "${apiUrl}"`,
    '',
    'custom_providers:',
    '- name: gchat',
    `  base_url: ${apiUrl}`,
    `  model: ${model}`,
    '  models:',
    `    ${model}:`,
    `      context_length: ${contextLength}`,
  ].join('\n')

  const [yamlCopied, setYamlCopied] = useState(false)

  const copyYaml = () => {
    navigator.clipboard.writeText(yamlSnippet)
    setYamlCopied(true)
    setTimeout(() => setYamlCopied(false), 1500)
  }

  return (
    <Card
      header={
        <div className="mb-2 flex items-center gap-2">
          <h2 className="text-foreground font-studio font-medium text-sm">
            Connection details (advanced)
          </h2>
          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600">
            Saved
          </span>
        </div>
      }
    >
      <p className="text-xs text-muted-foreground mb-3">
        GChat saved these settings in{' '}
        <code className="bg-secondary/50 px-1 rounded">~/.hermes/config.yaml</code>.
        You only need the details below if you are setting up Hermes Agent by
        hand.
      </p>

      <div className="divide-y divide-border/50">
        <CopyableField label="model.default" value={model} />
        <CopyableField label="model.provider" value="custom" />
        <CopyableField label="model.base_url" value={apiUrl} />
        <CopyableField
          label="context_length"
          value={String(contextLength)}
        />
      </div>

      <div className="mt-3">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-xs text-muted-foreground">
            Manual settings (config.yaml)
          </span>
          <button
            type="button"
            onClick={copyYaml}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            {yamlCopied ? (
              <>
                <IconCheck size={13} className="text-emerald-500" />
                <span className="text-emerald-500">Copied</span>
              </>
            ) : (
              <>
                <IconCopy size={13} />
                <span>Copy settings</span>
              </>
            )}
          </button>
        </div>
        <pre className="text-xs font-mono bg-secondary/30 rounded-md p-3 overflow-x-auto whitespace-pre">
          {yamlSnippet}
        </pre>
      </div>
    </Card>
  )
}

function ModelSelector({
  providers,
  availableModels,
  disabled,
  selectedModel,
  onSelect,
  placeholder = 'Choose a model',
}: {
  providers: ModelProvider[]
  availableModels: HermesModel[]
  disabled: boolean
  selectedModel: string | null
  onSelect: (modelId: string) => void
  placeholder?: string
}) {
  const [open, setOpen] = useState(false)
  const [searchValue, setSearchValue] = useState('')
  const searchInputRef = useRef<HTMLInputElement>(null)

  const filteredModels = useMemo(() => {
    if (!searchValue.trim()) return availableModels
    const search = searchValue.toLowerCase()
    return availableModels.filter(
      (m) =>
        m.id.toLowerCase().includes(search) ||
        (m.displayName?.toLowerCase() ?? '').includes(search) ||
        m.providerName.toLowerCase().includes(search)
    )
  }, [availableModels, searchValue])

  const groupedModels = useMemo(() => {
    const groups: Record<string, typeof filteredModels> = {}
    filteredModels.forEach((model) => {
      if (!groups[model.providerName]) {
        groups[model.providerName] = []
      }
      groups[model.providerName].push(model)
    })
    return groups
  }, [filteredModels])

  const currentModel = availableModels.find((m) => m.id === selectedModel)

  const handleSelect = (model: (typeof filteredModels)[0]) => {
    onSelect(model.id)
    setOpen(false)
    setSearchValue('')
  }

  const handleOpenChange = (isOpen: boolean) => {
    setOpen(isOpen)
    if (!isOpen) {
      setSearchValue('')
    } else {
      setTimeout(() => searchInputRef.current?.focus(), 100)
    }
  }

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="max-w-[280px]" disabled={disabled}>
          <span className="flex items-center gap-2 truncate leading-normal">
            {selectedModel && currentModel ? (
              <>
                <span
                  className={cn(
                    'text-[10px] px-1.5 py-0.5 rounded-full shrink-0',
                    currentModel.isLocal
                      ? 'bg-emerald-500/10 text-emerald-600'
                      : 'bg-blue-500/10 text-blue-600'
                  )}
                >
                  {currentModel.ready ? 'Ready' : currentModel.isLocal ? 'Local' : 'Remote'}
                </span>
                <span>{getModelDisplayName(currentModel)}</span>
              </>
            ) : (
              placeholder
            )}
          </span>
          <IconChevronDown className="size-4 shrink-0 text-muted-foreground" />
        </Button>
      </PopoverTrigger>

      <PopoverContent
        className="w-[280px] p-0 bg-background/95 border"
        align="end"
        sideOffset={8}
      >
        <div className="flex flex-col size-full">
          <div className="relative p-2 border-b">
            <input
              ref={searchInputRef}
              value={searchValue}
              onChange={(e) => setSearchValue(e.target.value)}
              placeholder="Find a model by name"
              aria-label="Find a model by name"
              className="text-sm font-normal outline-0 w-full"
            />
            {searchValue.length > 0 && (
              <div className="absolute right-2 top-0 bottom-0 flex items-center justify-center">
                <IconX
                  size={16}
                  className="text-muted-foreground cursor-pointer"
                  onClick={() => setSearchValue('')}
                />
              </div>
            )}
          </div>

          <div className="max-h-[300px] overflow-y-auto">
            {Object.keys(groupedModels).length === 0 ? (
              <div className="py-3 px-4 text-sm text-muted-foreground">
                {searchValue ? (
                  <>No model matches &quot;{searchValue}&quot;. Try another name.</>
                ) : (
                  <>
                    No models are available. Add a model in Model Providers,
                    then return here.
                  </>
                )}
              </div>
            ) : (
              <div className="py-1">
                {Object.entries(groupedModels).map(([providerKey, models]) => {
                  const providerInfo = providers.find(
                    (p) => p.provider === providerKey
                  )
                  return (
                    <div
                      key={providerKey}
                      className="bg-secondary/30 rounded-sm my-1.5 mx-1.5 first:mt-1 py-1"
                    >
                      <div className="flex items-center gap-1.5 px-2 py-1">
                        {providerInfo && <ProvidersAvatar provider={providerInfo} />}
                        <span className="capitalize text-sm font-medium text-muted-foreground">
                          {providerKey === 'ginfer-lan' ? 'GInfer Hosts' : providerKey}
                        </span>
                      </div>

                      {models.map((model) => {
                        const isSelected = selectedModel === model.id
                        const capabilities = model.capabilities || []

                        return (
                          <div
                            key={model.id}
                            title={model.id}
                            onClick={() => handleSelect(model)}
                            className={cn(
                              'mx-1 mb-1 px-2 py-1.5 rounded-sm cursor-pointer flex items-center gap-2 transition-all duration-200',
                              'hover:bg-secondary/40',
                              isSelected &&
                                'bg-secondary/60 hover:bg-secondary/60'
                            )}
                          >
                            <div className="flex items-center gap-2 flex-1 min-w-0">
                              <span
                                className="text-sm truncate"
                                title={model.id}
                              >
                                {getModelDisplayName(model)}
                              </span>
                              <div className="flex-1"></div>
                              {capabilities.length > 0 && (
                                <div className="shrink-0 -mr-1.5">
                                  <Capabilities capabilities={capabilities} />
                                </div>
                              )}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}

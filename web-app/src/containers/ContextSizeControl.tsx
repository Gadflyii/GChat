import { useEffect, useMemo, useState } from 'react'
import debounce from 'lodash.debounce'
import {
  EngineManager,
  type AIEngine,
  type ThreadMessage,
} from '@gchat/core'
import {
  IconArrowDown,
  IconArrowUp,
} from '@tabler/icons-react'

import { Button } from '@/components/ui/button'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { Progress } from '@/components/ui/progress'
import { Slider } from '@/components/ui/slider'
import { useModelProvider } from '@/hooks/useModelProvider'
import { useServiceHub } from '@/hooks/useServiceHub'
import { useTokensCount } from '@/hooks/useTokensCount'
import { cn, LOCAL_LLAMACPP_PROVIDER } from '@/lib/utils'
import { restartLocalModel } from '@/utils/restartLocalModel'

const LOCAL_CONTEXT_PROVIDERS = new Set([LOCAL_LLAMACPP_PROVIDER])
const FALLBACK_MAX_CONTEXT = 8 * 1024

interface ContextSizeControlProps {
  messages?: ThreadMessage[]
  additionalTokens?: number
  uploadedFiles?: Array<{
    name: string
    type: string
    size: number
    base64: string
    dataUrl: string
  }>
}

type NumericControllerProps = ControllerProps & {
  min?: number
  max?: number
  step?: number
}

function formatTokenCount(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`
  return value.toString()
}

function formatContextSize(value: number): string {
  if (value >= 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)}M`
  if (value >= 1024) return `${(value / 1024).toFixed(1)}K`
  return value.toString()
}

type LatestTokenUsage = {
  inputTokens: number
  outputTokens: number
  totalTokens: number
}

function getLatestTokenUsage(messages: ThreadMessage[]): LatestTokenUsage {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message.role !== 'assistant') continue

    const metadata = message.metadata as Record<string, unknown> | undefined
    const usage = metadata?.usage as
      | {
          inputTokens?: unknown
          outputTokens?: unknown
          totalTokens?: unknown
        }
      | undefined
    const tokenSpeed = metadata?.tokenSpeed as
      | { tokenCount?: unknown }
      | undefined
    const outputValue = usage?.outputTokens ?? tokenSpeed?.tokenCount
    const outputTokens =
      typeof outputValue === 'number' && Number.isFinite(outputValue)
        ? Math.max(0, outputValue)
        : 0
    const totalTokens =
      typeof usage?.totalTokens === 'number' &&
      Number.isFinite(usage.totalTokens)
        ? Math.max(0, usage.totalTokens)
        : 0
    const inputTokens =
      typeof usage?.inputTokens === 'number' &&
      Number.isFinite(usage.inputTokens)
        ? Math.max(0, usage.inputTokens)
        : Math.max(0, totalTokens - outputTokens)

    return {
      inputTokens,
      outputTokens,
      totalTokens: Math.max(totalTokens, inputTokens + outputTokens),
    }
  }
  return { inputTokens: 0, outputTokens: 0, totalTokens: 0 }
}

export function ContextSizeControl({
  messages = [],
  additionalTokens = 0,
  uploadedFiles = [],
}: ContextSizeControlProps) {
  const selectedProvider = useModelProvider((state) => state.selectedProvider)
  const selectedModel = useModelProvider((state) => state.selectedModel)
  const updateProvider = useModelProvider((state) => state.updateProvider)
  const getProviderByName = useModelProvider(
    (state) => state.getProviderByName
  )
  const serviceHub = useServiceHub()
  const tokenData = useTokensCount(messages, uploadedFiles)
  const latestUsage = getLatestTokenUsage(messages)
  const measuredTokens = tokenData.tokenCount + additionalTokens
  const totalTokens =
    measuredTokens > 0
      ? measuredTokens
      : latestUsage.totalTokens + additionalTokens
  const completionTokens = Math.min(
    totalTokens,
    latestUsage.outputTokens
  )
  const promptTokens = Math.max(0, totalTokens - completionTokens)
  const percentage = tokenData.maxTokens
    ? (totalTokens / tokenData.maxTokens) * 100
    : 0
  const isOverLimit = percentage > 100
  const progressTone =
    percentage >= 90
      ? 'bg-destructive'
      : percentage >= 70
        ? 'bg-orange-500'
        : 'bg-emerald-500'
  const contextValue = Number(
    selectedModel?.settings?.ctx_len?.controller_props?.value
  )
  const selectedContextProps = selectedModel?.settings?.ctx_len
    ?.controller_props as NumericControllerProps | undefined
  const configuredMax = Number(
    selectedContextProps?.max
  )
  const fallbackMaxContext =
    configuredMax > 0 ? configuredMax : FALLBACK_MAX_CONTEXT
  const configuredMin = Math.max(
    1,
    Number(selectedContextProps?.min) || 1024
  )
  const configuredContext =
    Number.isFinite(contextValue) && contextValue >= configuredMin
      ? Math.min(contextValue, fallbackMaxContext)
      : fallbackMaxContext
  const [maxContext, setMaxContext] = useState(fallbackMaxContext)
  const [draftContext, setDraftContext] = useState(configuredContext)
  const [loadedContext, setLoadedContext] = useState<number | undefined>()
  const [isActive, setIsActive] = useState(false)
  const [isRestarting, setIsRestarting] = useState(false)

  const restartModel = useMemo(
    () =>
      debounce(
        async (modelId: string, providerName: string, context: number) => {
          setIsRestarting(true)
          try {
            await restartLocalModel(serviceHub, providerName, modelId)
            setLoadedContext(context)
          } catch (error) {
            console.error(
              'Failed to restart model after context size change:',
              error
            )
          } finally {
            setIsRestarting(false)
          }
        },
        500
      ),
    [serviceHub]
  )

  useEffect(() => () => restartModel.cancel(), [restartModel])

  useEffect(() => {
    const currentValue = Number(
      selectedModel?.settings?.ctx_len?.controller_props?.value
    )
    const hasConfiguredContext =
      Number.isFinite(currentValue) && currentValue >= configuredMin
    setDraftContext(
      hasConfiguredContext
        ? Math.min(currentValue, fallbackMaxContext)
        : fallbackMaxContext
    )
    setMaxContext(fallbackMaxContext)
    setLoadedContext(undefined)
    setIsActive(false)

    if (!selectedProvider || !selectedModel) return

    let cancelled = false
    const resolveMaxContext = async () => {
      let resolvedMax = fallbackMaxContext
      try {
        const engine = EngineManager.instance().get(selectedProvider) as
          | (AIEngine & {
              getMaxCtxTrain?: (id: string) => Promise<number | undefined>
              getLoadedContext?: (id: string) => Promise<number | undefined>
            })
          | undefined
        if (engine && typeof engine.getMaxCtxTrain === 'function') {
          const modelMax = await engine.getMaxCtxTrain(selectedModel.id)
          if (typeof modelMax === 'number' && modelMax > 0) {
            resolvedMax = modelMax
          }
        }
        const activeModels = await serviceHub
          .models()
          .getActiveModels(selectedProvider)
        const active = activeModels.includes(selectedModel.id)
        if (!cancelled && active) setIsActive(true)
        if (
          active &&
          engine &&
          typeof engine.getLoadedContext === 'function'
        ) {
          const actual = await engine.getLoadedContext(selectedModel.id)
          if (!cancelled) setLoadedContext(actual)
        }
      } catch (error) {
        console.warn(
          `Failed to resolve maximum context for ${selectedProvider}/${selectedModel?.id}:`,
          error
        )
      }
      if (!cancelled) {
        if (resolvedMax !== fallbackMaxContext) {
          setMaxContext(resolvedMax)
        }
        if (!hasConfiguredContext) {
          setDraftContext(resolvedMax)
        }
      }
    }

    void resolveMaxContext()
    return () => {
      cancelled = true
    }
  }, [
    configuredMax,
    configuredMin,
    fallbackMaxContext,
    selectedModel,
    selectedProvider,
    serviceHub,
  ])

  if (
    !selectedProvider ||
    !LOCAL_CONTEXT_PROVIDERS.has(selectedProvider) ||
    !selectedModel
  ) {
    return null
  }

  const provider = getProviderByName(selectedProvider)
  const contextSetting = selectedModel.settings?.ctx_len as
    | ProviderSetting
    | undefined

  if (!provider || !contextSetting) return null

  const contextControllerProps =
    contextSetting.controller_props as NumericControllerProps
  const sliderMin = configuredMin
  const sliderMax = Math.max(sliderMin, maxContext || 0)
  const sliderStep = Math.max(1, Number(contextControllerProps.step) || 1024)

  const handleContextChange = (value: string | boolean | number) => {
    const modelIndex = provider.models.findIndex(
      (model) => model.id === selectedModel.id
    )
    if (modelIndex === -1) return

    const numericValue = Number(value)
    if (!Number.isFinite(numericValue)) return
    const clampedValue = Math.min(Math.max(numericValue, sliderMin), sliderMax)
    setDraftContext(clampedValue)

    const updatedModels = [...provider.models]
    updatedModels[modelIndex] = {
      ...selectedModel,
      settings: {
        ...selectedModel.settings,
        ctx_len: {
          ...contextSetting,
          controller_props: {
            ...contextSetting.controller_props,
            value: clampedValue,
          },
        },
      },
    } as Model

    updateProvider(provider.provider, { models: updatedModels })

    serviceHub
      .models()
      .getActiveModels(provider.provider)
      .then((activeModels) => {
        const active = activeModels.includes(selectedModel.id)
        setIsActive(active)
        if (active) {
          restartModel(selectedModel.id, provider.provider, clampedValue)
        }
      })
      .catch((error) => {
        console.error('Failed to check active models:', error)
      })
  }

  const percentageLabel = `${percentage.toFixed(1)}%`

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-7 gap-2 px-2 font-mono text-xs"
          aria-label={`Context usage: ${percentageLabel}`}
        >
          <span className={cn(isOverLimit && 'text-destructive')}>
            {percentageLabel}
          </span>
          <span className="relative size-4 shrink-0">
            <svg className="size-4 -rotate-90" viewBox="0 0 16 16">
              <circle
                cx="8"
                cy="8"
                r="6"
                stroke="currentColor"
                strokeWidth="1.5"
                fill="none"
                className="text-muted-foreground"
              />
              <circle
                cx="8"
                cy="8"
                r="6"
                stroke="currentColor"
                strokeWidth="1.5"
                fill="none"
                strokeDasharray={`${2 * Math.PI * 6}`}
                strokeDashoffset={`${2 * Math.PI * 6 * (1 - Math.min(percentage, 100) / 100)}`}
                className={cn(
                  'transition-all duration-500 ease-out',
                  isOverLimit ? 'stroke-destructive' : 'stroke-primary'
                )}
                style={{ transformOrigin: 'center' }}
              />
            </svg>
          </span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 space-y-3 p-3">
        <div>
          <div className="mb-2 flex items-center justify-between">
            <span
              className={cn(
                'text-lg font-semibold tabular-nums',
                isOverLimit ? 'text-destructive' : 'text-primary'
              )}
            >
              {percentageLabel}
            </span>
            <span className="font-mono text-sm text-muted-foreground">
              {formatTokenCount(totalTokens)} /{' '}
              {formatTokenCount(tokenData.maxTokens || 0)}
            </span>
          </div>
          <Progress
            aria-label="Context usage"
            value={Math.min(percentage, 100)}
            className="h-1.5 bg-muted"
            indicatorClassName={progressTone}
          />
        </div>
        <div className="space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="flex items-center gap-1.5 text-muted-foreground">
              <IconArrowUp className="size-3.5" stroke={1.75} />
              <span>Input</span>
            </span>
            <span className="font-mono text-foreground">
              {formatTokenCount(promptTokens)}
            </span>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="flex items-center gap-1.5 text-muted-foreground">
              <IconArrowDown className="size-3.5" stroke={1.75} />
              <span>Output</span>
            </span>
            <span className="font-mono text-foreground">
              {formatTokenCount(completionTokens)}
            </span>
          </div>
        </div>
        <div className="space-y-3 border-t border-border pt-3">
          <div>
            <div className="flex items-center justify-between gap-3">
              <div className="text-xs font-medium">{contextSetting.title}</div>
              <div className="font-mono text-xs tabular-nums">
                {formatContextSize(draftContext)}
              </div>
            </div>
            {contextSetting.description && (
              <div className="text-xs text-muted-foreground">
                {contextSetting.description}
              </div>
            )}
            <div className="mt-1 text-[11px] text-muted-foreground">
              {isRestarting
                ? 'Reloading GInfer…'
                : isActive && loadedContext
                  ? `Loaded at ${formatContextSize(loadedContext)}`
                  : 'Applies when the model starts'}
            </div>
          </div>
          <Slider
            aria-label={contextSetting.title}
            className="w-full"
            value={[Math.min(Math.max(draftContext, sliderMin), sliderMax)]}
            min={sliderMin}
            max={sliderMax}
            step={sliderStep}
            disabled={isRestarting}
            onValueChange={([value]) => setDraftContext(value)}
            onValueCommit={([value]) => handleContextChange(value)}
          />
          <div className="flex justify-between font-mono text-[10px] text-muted-foreground">
            <span>{formatContextSize(sliderMin)}</span>
            <span>{formatContextSize(sliderMax)}</span>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}

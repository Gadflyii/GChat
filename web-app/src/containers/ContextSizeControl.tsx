import { useEffect, useState } from 'react'
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
import { useModelProvider } from '@/hooks/useModelProvider'
import { useTokensCount } from '@/hooks/useTokensCount'
import { useContextUsage, type RequestContextUsage } from '@/hooks/useContextUsage'
import { cn, LOCAL_GINFER_PROVIDER } from '@/lib/utils'

const LOCAL_CONTEXT_PROVIDERS = new Set([LOCAL_GINFER_PROVIDER])
const FALLBACK_MAX_CONTEXT = 8 * 1024

interface ContextSizeControlProps {
  threadId?: string
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

function getLatestTokenUsage(messages: ThreadMessage[], modelId?: string): LatestTokenUsage {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message.role !== 'assistant') continue

    const metadata = message.metadata as Record<string, unknown> | undefined
    if (metadata?.modelId && metadata.modelId !== modelId) continue
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
  threadId,
  messages = [],
  additionalTokens = 0,
  uploadedFiles = [],
}: ContextSizeControlProps) {
  const selectedProvider = useModelProvider((state) => state.selectedProvider)
  const selectedModel = useModelProvider((state) => state.selectedModel)
  const tokenData = useTokensCount(messages, uploadedFiles)
  const latestUsage = getLatestTokenUsage(messages, selectedModel?.id)
  const liveUsage = useContextUsage((state) =>
    threadId ? state.requests[threadId] : undefined
  )
  const lastAssistant = [...messages].reverse().find((message) => message.role === 'assistant')
  const savedUsage = lastAssistant?.metadata?.contextUsage as RequestContextUsage | undefined
  const candidate = liveUsage ?? savedUsage
  const requestUsage = candidate?.modelId === selectedModel?.id ? candidate : undefined
  const hasReportedUsage = latestUsage.totalTokens > 0
  const totalTokens = requestUsage
    ? requestUsage.inputTokens + requestUsage.outputTokens
    : Math.max(tokenData.tokenCount, latestUsage.totalTokens) + additionalTokens
  const completionTokens = Math.min(totalTokens, requestUsage?.outputTokens ?? latestUsage.outputTokens)
  const promptTokens = Math.max(0, totalTokens - completionTokens)
  const [loadedContext, setLoadedContext] = useState<number>()
  useEffect(() => {
    setLoadedContext(undefined)
    if (selectedProvider !== LOCAL_GINFER_PROVIDER || !selectedModel) return
    let cancelled = false
    const engine = EngineManager.instance().get(selectedProvider) as
      | (AIEngine & { getLoadedContext?: (id: string) => Promise<number | undefined> })
      | undefined
    void engine?.getLoadedContext?.(selectedModel.id).then((value) => {
      if (!cancelled) setLoadedContext(value)
    }).catch(() => { /* No running instance; show the selected profile capacity. */ })
    return () => { cancelled = true }
  }, [selectedModel, selectedProvider])
  const capacity = requestUsage?.contextTokens ?? loadedContext ?? tokenData.maxTokens
  const percentage = capacity ? (totalTokens / capacity) * 100 : 0
  const isOverLimit = percentage > 100
  const progressTone =
    percentage >= 90
      ? 'bg-destructive'
      : percentage >= 70
        ? 'bg-orange-500'
        : 'bg-emerald-500'
  if (
    !selectedProvider ||
    !LOCAL_CONTEXT_PROVIDERS.has(selectedProvider) ||
    !selectedModel
  ) {
    return null
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
              {formatTokenCount(capacity || 0)}
            </span>
          </div>
          <Progress
            aria-label="Context usage"
            value={Math.min(percentage, 100)}
            className="h-1.5 bg-muted"
            indicatorClassName={progressTone}
          />
        </div>
        <p className="text-xs text-muted-foreground">
          {requestUsage || hasReportedUsage
            ? 'Latest request · includes instructions and tools. Draft edits apply on send.'
            : 'Draft text estimate · instructions and tools are counted on send.'}
        </p>
        <div className="space-y-2">
          {requestUsage && (
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>Reserved for response</span>
              <span>{formatTokenCount(requestUsage.reservedOutputTokens)}</span>
            </div>
          )}
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
        <div className="space-y-1 border-t border-border pt-3 text-xs text-muted-foreground">
          <p>Profile context: {formatContextSize(capacity || FALLBACK_MAX_CONTEXT)}</p>
          <p>Change capacity with the model profile selector or GInfer Hosts. Chat compacts within the running profile and does not restart it.</p>
        </div>
      </PopoverContent>
    </Popover>
  )
}

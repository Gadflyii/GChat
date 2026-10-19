import { useShallow } from 'zustand/react/shallow'
import { CheckIcon, CircleSlashIcon, TriangleAlertIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { SectileActivityIndicator } from '@/components/ai-elements/sectile-activity-indicator'
import { useAgentRun } from '@/hooks/useAgentRun'
import { presentGenericTool } from '@/lib/tools/presenters/generic'
import type { TraceBlock } from '@/lib/tools/types'
import {
  isActiveSubAgentPhase,
  liveSubAgentPhase,
  SUBAGENT_PHASE_LABELS,
  type SubAgentBrief,
  type SubAgentPhase,
  type SubAgentResult,
} from '@/lib/sub-agents'
import type { AgentRunState } from '@/types/agent'
import { RenderMarkdown } from './RenderMarkdown'

type SubAgentsBlock = Extract<TraceBlock, { kind: 'subagents' }>

const PROGRESS_LINES = 3

export function SubAgentCards({
  block,
  requestActive,
  onStop,
}: {
  block: SubAgentsBlock
  requestActive: boolean
  onStop?: (runId: string) => void
}) {
  const live = useAgentRun(
    useShallow((state) =>
      Object.values(state.runs).filter(
        (run) => run.subAgent?.dispatchId === block.dispatchId
      )
    )
  )
  const count = block.briefs.length
  return (
    <section
      aria-label={count === 1 ? 'Sub-agent' : `${count} sub-agents`}
      className="not-prose mb-3 space-y-2"
    >
      <p className="text-xs font-medium text-muted-foreground">
        {count === 1 ? '1 sub-agent' : `${count} sub-agents`}
      </p>
      {block.briefs.map((brief, index) => (
        <SubAgentCard
          key={`${block.dispatchId}-${index}`}
          brief={brief}
          saved={block.results[index]}
          live={live.find((run) => run.subAgent?.index === index)}
          dispatchPending={
            block.state === 'input-streaming' ||
            (block.state === 'input-available' && requestActive)
          }
          onStop={onStop}
        />
      ))}
      {block.errorText && block.results.length === 0 && (
        <div
          role="alert"
          className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
        >
          {block.errorText}
        </div>
      )}
    </section>
  )
}

function cardPhase(
  saved: SubAgentResult | undefined,
  live: AgentRunState | undefined,
  dispatchPending: boolean
): SubAgentPhase {
  if (saved) return saved.status
  if (live) return liveSubAgentPhase(live)
  return dispatchPending ? 'starting' : 'not_finished'
}

function SubAgentCard({
  brief,
  saved,
  live,
  dispatchPending,
  onStop,
}: {
  brief: SubAgentBrief
  saved?: SubAgentResult
  live?: AgentRunState
  dispatchPending: boolean
  onStop?: (runId: string) => void
}) {
  const phase = cardPhase(saved, live, dispatchPending)
  const active = isActiveSubAgentPhase(phase)
  const runId = saved?.runId ?? live?.runId
  const steps = (live?.trace.tools ?? []).filter(
    (tool) => tool.call.tool !== 'reply' && tool.call.tool !== 'finish'
  )
  const progress = steps.slice(-PROGRESS_LINES).map((tool) =>
    presentGenericTool({
      toolName: tool.call.tool,
      input: tool.call.args,
      state: tool.outcome
        ? tool.outcome.status === 'ok'
          ? 'output-available'
          : 'output-error'
        : 'input-available',
    })
  )
  const result = saved?.result ?? (active ? undefined : live?.trace.assistantText)
  const error =
    saved?.error ?? (phase === 'failed' ? live?.trace.error?.message : undefined)
  const label = SUBAGENT_PHASE_LABELS[phase]

  return (
    <article
      aria-label={`${brief.title}: ${label}`}
      className="rounded-xl border border-border/70 bg-card/40 p-3 text-sm"
    >
      <div className="flex items-start gap-2">
        <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center text-muted-foreground">
          {active ? (
            <SectileActivityIndicator active />
          ) : phase === 'done' ? (
            <CheckIcon className="size-4 text-primary" aria-hidden="true" />
          ) : phase === 'stopped' ? (
            <CircleSlashIcon className="size-4" aria-hidden="true" />
          ) : (
            <TriangleAlertIcon className="size-4 text-destructive" aria-hidden="true" />
          )}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <span className="font-medium text-foreground">{brief.title}</span>
            <span role="status" className="text-xs text-muted-foreground">
              {label}
              {steps.length > 0 && active
                ? ` · step ${steps.length}`
                : ''}
            </span>
          </div>
          {brief.task && (
            <p
              className="mt-1 line-clamp-2 text-xs text-muted-foreground"
              title={brief.task}
            >
              {brief.task}
            </p>
          )}
        </div>
        {active && runId && onStop && (
          <Button
            variant="ghost"
            size="sm"
            className="shrink-0"
            aria-label={`Stop ${brief.title}`}
            onClick={() => onStop(runId)}
          >
            Stop
          </Button>
        )}
      </div>
      {active && progress.length > 0 && (
        <ul aria-label="Recent steps" className="mt-2 space-y-0.5 pl-6 text-xs text-muted-foreground">
          {progress.map((step, index) => (
            <li key={index} className="truncate">
              {step.title}
              {step.subtitle ? ` · ${step.subtitle}` : ''}
            </li>
          ))}
        </ul>
      )}
      {error && (
        <div
          role="alert"
          className="mt-2 rounded-lg border border-destructive/30 bg-destructive/10 p-2 text-xs text-destructive"
        >
          {error}
        </div>
      )}
      {result && (
        <div className="mt-2 max-h-72 overflow-auto rounded-lg border border-border/60 bg-background/60 p-2 text-sm">
          <p className="mb-1 text-xs font-medium text-muted-foreground">
            {phase === 'done' ? 'Result' : 'Partial result'}
          </p>
          <RenderMarkdown content={result} />
        </div>
      )}
    </article>
  )
}

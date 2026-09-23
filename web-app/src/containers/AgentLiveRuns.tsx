import { useState } from 'react'
import type { AgentModelInstance } from '@/types/agent'
import { useStudioCatalog } from '@/hooks/useStudioCatalog'
import { StatusLabel } from './StatusLabel'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog'
import { useStudioRuns } from '@/stores/studio-run-store'
import { useOpenCodeBridgeRuns } from '@/stores/opencode-bridge-runs'
import { BridgeRun } from './CodeBridgePanel'
import { studioCommand } from '@/services/agent/studio'
import {
  cancelAgentTurn,
  resolveAgentApproval,
  resolveAgentFolderAccess,
} from '@/services/agent/tauri'

export function AgentLiveRuns() {
  const runIds = useStudioRuns((s) => Object.keys(s.runs).join(','))
  const bridgeRuns = useOpenCodeBridgeRuns((s) => s.runs).filter((run) => run.status === 'queued' || run.status === 'running')
  const refreshBridgeRuns = useOpenCodeBridgeRuns((s) => s.refresh)
  const deleting = useStudioRuns((s) => s.deleting)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const { catalog, error, refresh } = useStudioCatalog()
  if (!runIds && bridgeRuns.length === 0) return null
  return (
    <section
      className="space-y-4 border-b p-6"
      aria-label="Live Agent Studio runs"
    >
      <div className="flex items-center gap-3">
        <h2 className="font-studio text-lg font-semibold">Live runs</h2>
        {runIds && <Button variant="outline" size="sm" disabled={deleting} onClick={() => setConfirmDelete(true)}>
          Delete all
        </Button>}
      </div>
      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete run history?</DialogTitle>
            <DialogDescription>
              Delete all saved run history and generated run outputs. Active runs,
              agent definitions, and your working directories will be kept. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2">
            <Button variant="outline" disabled={deleting} onClick={() => setConfirmDelete(false)}>Cancel</Button>
            <Button variant="destructive" disabled={deleting} onClick={() => {
              void useStudioRuns.getState().deleteHistory().then(() => setConfirmDelete(false)).catch((e) => toast.error(String(e)))
            }}>{deleting ? 'Deleting…' : 'Delete history'}</Button>
          </div>
        </DialogContent>
      </Dialog>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          Engine capacity is unavailable; showing last-known labels.{' '}
          <Button variant="outline" onClick={() => void refresh()}>
            Retry
          </Button>
        </p>
      )}
      {runIds.split(',').filter(Boolean).map((id) => (
        <LiveRun key={id} id={id} instances={catalog.instances} />
      ))}
      {bridgeRuns.map((run) => (
        <BridgeRun key={run.runId} run={run} onChanged={refreshBridgeRuns} />
      ))}
    </section>
  )
}

function LiveRun({
  id,
  instances,
}: {
  id: string
  instances: AgentModelInstance[]
}) {
  const run = useStudioRuns((s) => s.runs[id])
  const deleting = useStudioRuns((s) => s.deleting)
  const [selected, setSelected] = useState<string>()
  const [pending, setPending] = useState<string[]>([])
  if (!run) return null

  const running = !['finished', 'cancelled', 'failed', 'incomplete'].includes(
    run.state.status
  )
  const stages = run.state.trace.stages
  const detail = stages.find((s) => `${id}:${s.id}` === selected)
  return (
    <article key={id} className="rounded-lg border bg-card p-4 space-y-3">
      <div className="flex justify-between gap-3">
        <div>
          <h3 className="font-medium">{run.name}</h3>
          <p className="text-sm text-muted-foreground">
            {run.state.status === 'incomplete'
              ? 'Limit reached — partial results preserved'
              : run.state.status}{' '}
            · {stages.filter((s) => s.status === 'queued').length} queued ·{' '}
            {stages.filter((s) => s.status === 'running').length} running
          </p>
        </div>
        <div className="flex items-start gap-2">
          {running && (
            <Button
              variant="outline"
              onClick={() =>
                void cancelAgentTurn(id).catch((e) => toast.error(String(e)))
              }
            >
              Stop run
            </Button>
          )}
          <Button
            variant="outline"
            disabled={!run.settled || deleting}
            aria-label={`Delete run ${run.name}`}
            title={!run.settled
              ? 'Stop the run and wait for it to finish before deleting'
              : 'Delete run history and generated outputs'}
            onClick={() => void useStudioRuns.getState().deleteHistory(id)
              .catch((e) => toast.error(String(e)))}
          >
            Delete
          </Button>
        </div>
      </div>
      {run.approvals.map((approval) => {
        const approvalId =
          approval.type === 'approval_requested'
            ? approval.approval_id
            : approval.access_id
        const answer = async (allow: boolean) => {
          setPending((s) => [...s, approvalId])
          try {
            if (approval.type === 'approval_requested')
              await resolveAgentApproval({
                approval_id: approvalId,
                decision: allow ? 'allow_once' : 'deny',
              })
            else
              await resolveAgentFolderAccess({
                run_id: id,
                access_id: approvalId,
                allow,
              })
            useStudioRuns.getState().resolve(id, approvalId)
          } catch (e) {
            toast.error(String(e))
          } finally {
            setPending((s) => s.filter((v) => v !== approvalId))
          }
        }
        return (
          <div
            key={approvalId}
            className="rounded border border-primary/40 p-3 space-y-2"
          >
            <p className="font-medium">Approval needed · {approval.tool}</p>
            <p className="text-sm">{approval.reason}</p>
            <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words text-xs">
              {JSON.stringify(
                approval.type === 'approval_requested'
                  ? approval.preview
                  : approval.path,
                null,
                2
              )}
            </pre>
            <div className="flex gap-2">
              <Button
                disabled={pending.includes(approvalId)}
                onClick={() => void answer(true)}
              >
                Allow once
              </Button>
              <Button
                variant="outline"
                disabled={pending.includes(approvalId)}
                onClick={() => void answer(false)}
              >
                Deny
              </Button>
            </div>
          </div>
        )
      })}
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="text-muted-foreground">
            <tr>
              <th className="p-2">Worker</th>
              <th className="p-2">Host / Model</th>
              <th className="p-2">Activity</th>
              <th className="p-2">Tokens/sec</th>
              <th className="p-2">Context</th>
            </tr>
          </thead>
          <tbody>
            {stages.map((stage) => {
              const instance = instances.find(
                (i) => i.id === stage.modelInstanceId
              )
              const metric = stage.inference
              return (
                <tr key={stage.id} className="border-t">
                  <td className="p-2">
                    <Button
                      variant="ghost"
                      onClick={() => setSelected(`${id}:${stage.id}`)}
                    >
                      {stage.name}
                    </Button>
                  </td>
                  <td className="p-2">
                    {instance
                      ? `${instance.hostName ?? 'Host'} / ${instance.modelId}`
                      : stage.modelInstanceId || 'Waiting for assignment'}
                  </td>
                  <td className="p-2">
                    <StatusLabel status={stage.status} />
                    {stage.activity && stage.status === 'running'
                      ? ` · ${stage.activity.replaceAll('_', ' ')}`
                      : ''}
                  </td>
                  <td className="p-2 font-mono tabular-nums">
                    {metric && metric.generationMs > 0
                      ? (
                          (metric.generatedTokens * 1000) /
                          metric.generationMs
                        ).toFixed(1)
                      : '—'}
                  </td>
                  <td className="p-2">
                    {stage.context ? (
                      <div className="space-y-1 text-xs">
                        <div>{stage.context.input_tokens.toLocaleString()} / {stage.context.context_tokens.toLocaleString()} tokens</div>
                        <progress className="h-1.5 w-full accent-primary" aria-label={`${stage.name} context usage`}
                          value={stage.context.input_tokens} max={stage.context.context_tokens} />
                        <div className="text-muted-foreground">
                          {stage.context.reserved_tokens.toLocaleString()} reserved · {stage.context.compactions} compactions
                        </div>
                        <div>{stage.context.status === 'compacting' ? 'Compacting…' : stage.context.status === 'blocked' ? 'Context blocked' : stage.context.status === 'nothing_to_compact' ? 'Nothing to compact yet' : ''}</div>
                        {stage.status === 'running' && <Button size="sm" variant="outline"
                          disabled={stage.context.status === 'compacting' || pending.includes(stage.context.context_id)}
                          onClick={() => {
                            const id = stage.context!.context_id
                            setPending((s) => [...s, id])
                            void studioCommand('compact_worker', { id })
                              .then(() => toast.info('Compaction requested for the next safe tool-step boundary.'))
                              .catch((e) => toast.error(String(e)))
                              .finally(() => setPending((s) => s.filter((v) => v !== id)))
                          }}>Compact</Button>}
                      </div>
                    ) : '—'}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted-foreground">
        Tokens/sec is this worker’s measured generation rate, updated after
        inference steps—not host aggregate throughput. Tool execution and queue
        time are excluded.
      </p>
      {detail && (
        <div className="rounded border p-3 space-y-2">
          <h4 className="font-medium">{detail.name}</h4>
          <p className="whitespace-pre-wrap text-sm">{detail.summary}</p>
          {detail.context?.archive_path && <p className="break-all text-xs text-muted-foreground">Full transcript and tool outputs: {detail.context.archive_path}</p>}
          <WorkerDetails events={detail.events ?? []} />
        </div>
      )}
      {!!run.state.trace.error && (
        <p role="alert" className="text-destructive">
          {run.state.trace.error.message}
        </p>
      )}
      {!!run.state.trace.assistantText && (
        <div className="whitespace-pre-wrap rounded bg-muted/30 p-3 text-sm">
          {run.state.trace.assistantText}
        </div>
      )}
    </article>
  )
}

function WorkerDetails({ events }: { events: unknown[] }) {
  const [open, setOpen] = useState(false)
  return (
    <details onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary className="cursor-pointer text-sm">
        Worker activity and tool results
      </summary>
      {open && (
        <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words text-xs">
          {JSON.stringify(events, null, 2)}
        </pre>
      )}
    </details>
  )
}

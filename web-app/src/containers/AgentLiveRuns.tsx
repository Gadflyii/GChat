import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { useStudioRuns } from '@/stores/studio-run-store'
import {
  cancelAgentTurn,
  resolveAgentApproval,
  resolveAgentFolderAccess,
} from '@/services/agent/tauri'
import { studioCommand, type StudioCatalog } from '@/services/agent/studio'

export function AgentLiveRuns() {
  const runs = useStudioRuns((s) => s.runs)
  const [selected, setSelected] = useState<string>()
  const [catalog, setCatalog] = useState<StudioCatalog>({
    pools: [],
    instances: [],
    usage: {},
  })
  const [pending, setPending] = useState<string[]>([])
  useEffect(() => {
    const refresh = () =>
      studioCommand<StudioCatalog>('capacity')
        .then(setCatalog)
        .catch(() => {})
    void refresh()
    const timer = setInterval(() => void refresh(), 5000)
    return () => clearInterval(timer)
  }, [])
  if (!Object.keys(runs).length) return null
  return (
    <section
      className="space-y-4 border-b p-6"
      aria-label="Live Agent Studio runs"
    >
      <h2 className="font-studio text-lg font-semibold">Live runs</h2>
      {Object.entries(runs).map(([id, run]) => {
        const running = ![
          'finished',
          'cancelled',
          'failed',
          'incomplete',
        ].includes(run.state.status)
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
                  · {stages.filter((s) => s.status === 'queued').length} queued
                  · {stages.filter((s) => s.status === 'running').length}{' '}
                  running
                </p>
              </div>
              {running && (
                <Button
                  variant="outline"
                  onClick={() =>
                    void cancelAgentTurn(id).catch((e) =>
                      toast.error(String(e))
                    )
                  }
                >
                  Stop run
                </Button>
              )}
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
                  <p className="font-medium">
                    Approval needed · {approval.tool}
                  </p>
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
                  </tr>
                </thead>
                <tbody>
                  {stages.map((stage) => {
                    const instance = catalog.instances.find(
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
                          {stage.status}
                          {stage.activity && stage.status === 'running'
                            ? ` · ${stage.activity.replaceAll('_', ' ')}`
                            : ''}
                        </td>
                        <td className="p-2">
                          {metric && metric.generationMs > 0
                            ? (
                                (metric.generatedTokens * 1000) /
                                metric.generationMs
                              ).toFixed(1)
                            : '—'}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-muted-foreground">
              Tokens/sec is this worker’s measured generation rate, updated
              after inference steps—not host aggregate throughput. Tool
              execution and queue time are excluded.
            </p>
            {detail && (
              <div className="rounded border p-3 space-y-2">
                <h4 className="font-medium">{detail.name}</h4>
                <p className="whitespace-pre-wrap text-sm">{detail.summary}</p>
                <details>
                  <summary className="cursor-pointer text-sm">
                    Worker activity and tool results
                  </summary>
                  <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words text-xs">
                    {JSON.stringify(detail.events ?? [], null, 2)}
                  </pre>
                </details>
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
      })}
    </section>
  )
}

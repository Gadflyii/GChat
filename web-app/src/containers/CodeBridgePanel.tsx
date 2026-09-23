import { IconChevronDown, IconPlugConnected, IconX } from '@tabler/icons-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import {
  cancelOpenCodeBridgeRun,
  getOpenCodeBridgeStatus,
  listOpenCodeBridgeRuns,
  type OpenCodeBridgeApproval,
  type OpenCodeBridgeRun,
  type OpenCodeBridgeStatus,
} from '@/services/agent/opencode-bridge'
import {
  resolveAgentApproval,
  resolveAgentFolderAccess,
} from '@/services/agent/tauri'
import { cn } from '@/lib/utils'

const POLL_MS = 3000

function isActive(run: OpenCodeBridgeRun): boolean {
  return run.status === 'queued' || run.status === 'running'
}

function projectName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path
}

function ApprovalActions({
  approval,
  onResolved,
}: {
  approval: OpenCodeBridgeApproval
  onResolved: () => Promise<void>
}) {
  const [resolving, setResolving] = useState(false)

  const resolve = async (allow: boolean) => {
    setResolving(true)
    try {
      if (approval.type === 'approval_requested') {
        await resolveAgentApproval({
          approval_id: approval.approvalId,
          decision: allow ? 'allow_once' : 'deny',
        })
      } else {
        await resolveAgentFolderAccess({
          run_id: approval.runId,
          access_id: approval.approvalId,
          allow,
        })
      }
      await onResolved()
    } catch (error) {
      toast.error(String(error))
    } finally {
      setResolving(false)
    }
  }

  return (
    <div className="space-y-2 rounded-md border border-amber-500/40 bg-amber-500/5 p-2 text-xs">
      <p className="font-medium">Approval needed · {approval.tool}</p>
      <p className="whitespace-pre-wrap break-words text-muted-foreground">{approval.reason}</p>
      {approval.type === 'folder_access_requested' && approval.path && (
        <p className="break-all font-mono">{approval.path}</p>
      )}
      {approval.type === 'approval_requested' && approval.preview != null && (
        <pre className="max-h-28 overflow-auto whitespace-pre-wrap break-all rounded bg-background p-2">
          {JSON.stringify(approval.preview, null, 2)}
        </pre>
      )}
      <div className="flex gap-2">
        <Button size="sm" disabled={resolving} onClick={() => void resolve(true)}>
          Allow once
        </Button>
        <Button size="sm" variant="outline" disabled={resolving} onClick={() => void resolve(false)}>
          Deny
        </Button>
      </div>
    </div>
  )
}

export function BridgeRun({
  run,
  onChanged,
}: {
  run: OpenCodeBridgeRun
  onChanged: () => Promise<void>
}) {
  const [cancelling, setCancelling] = useState(false)
  const cancel = async () => {
    setCancelling(true)
    try {
      await cancelOpenCodeBridgeRun(run.runId)
      await onChanged()
    } catch (error) {
      toast.error(String(error))
    } finally {
      setCancelling(false)
    }
  }

  return (
    <article className="space-y-2 rounded-md border bg-card p-3 text-xs">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="truncate text-sm font-medium" title={run.definitionName}>
            {run.definitionName}
          </h3>
          <p className="capitalize text-muted-foreground">{run.status}</p>
          {run.workspace && (
            <p className="truncate text-muted-foreground" title={run.workspace}>
              Project: {projectName(run.workspace)}
            </p>
          )}
        </div>
        {isActive(run) && (
          <Button size="sm" variant="outline" disabled={cancelling} onClick={() => void cancel()}>
            Cancel
          </Button>
        )}
      </div>
      {(run.stage || run.cycle != null) && (
        <p className="text-muted-foreground">
          {run.stage}
          {run.stage && run.cycle != null ? ' · ' : ''}
          {run.cycle != null ? `Cycle ${run.cycle}${run.maxCycles != null ? ` of ${run.maxCycles}` : ''}` : ''}
        </p>
      )}
      {run.summary && <p className="whitespace-pre-wrap break-words">{run.summary}</p>}
      {run.approvals?.map((approval) => (
        <ApprovalActions key={approval.approvalId} approval={approval} onResolved={onChanged} />
      ))}
      {run.result && (
        <details>
          <summary className="cursor-pointer font-medium">Result</summary>
          <p className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-words">{run.result}</p>
        </details>
      )}
      {Boolean(run.artifacts?.length) && (
        <details>
          <summary className="cursor-pointer font-medium">Files ({run.artifacts?.length})</summary>
          <ul className="mt-2 space-y-1">
            {run.artifacts?.map((artifact) => (
              <li className="break-all font-mono" key={artifact}>{artifact}</li>
            ))}
          </ul>
        </details>
      )}
    </article>
  )
}

export function CodeBridgePanel({ visible, workspace }: { visible: boolean; workspace?: string }) {
  const [open, setOpen] = useState(false)
  const [status, setStatus] = useState<OpenCodeBridgeStatus>()
  const [runs, setRuns] = useState<OpenCodeBridgeRun[]>([])
  const [error, setError] = useState<string>()
  const refreshSequence = useRef(0)

  const refresh = useCallback(async () => {
    const sequence = ++refreshSequence.current
    try {
      const [nextStatus, nextRuns] = await Promise.all([
        getOpenCodeBridgeStatus(),
        listOpenCodeBridgeRuns(workspace),
      ])
      if (sequence !== refreshSequence.current) return
      setStatus(nextStatus)
      setRuns(nextRuns)
      setError(undefined)
    } catch (reason) {
      if (sequence !== refreshSequence.current) return
      setStatus(undefined)
      setError(String(reason))
    }
  }, [workspace])

  useEffect(() => {
    if (!visible) return
    let stopped = false
    let timeout: number | undefined
    const poll = async () => {
      await refresh()
      if (!stopped) timeout = window.setTimeout(() => void poll(), POLL_MS)
    }
    void poll()
    return () => {
      stopped = true
      refreshSequence.current += 1
      if (timeout !== undefined) window.clearTimeout(timeout)
    }
  }, [refresh, visible])

  const connected = status?.connected === true
  const activeCount = runs.filter(isActive).length
  const pendingCount = runs.reduce((count, run) => count + (run.approvals?.length ?? 0), 0)

  return (
    <>
      <Button
        size="sm"
        variant="ghost"
        aria-label="GChat tools"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        className="gap-1.5"
      >
        <IconPlugConnected className={cn('size-4', connected ? 'text-emerald-500' : 'text-muted-foreground')} />
        <span className="hidden lg:inline">GChat tools: {connected ? 'Connected' : error ? 'Unavailable' : status ? 'Disconnected' : 'Connecting'}</span>
        {activeCount > 0 && <span className="rounded-full bg-primary/10 px-1.5 text-xs">{activeCount}</span>}
        {pendingCount > 0 && <span className="rounded-full bg-amber-500/20 px-1.5 text-xs">{pendingCount} approval{pendingCount === 1 ? '' : 's'}</span>}
        <IconChevronDown className="size-3" />
      </Button>
      {open && (
        <aside
          aria-label="GChat tools and delegated runs"
          className="absolute right-3 top-14 z-30 flex max-h-[min(70vh,42rem)] w-[min(24rem,calc(100vw-1rem))] flex-col rounded-lg border bg-background shadow-xl"
        >
          <div className="flex items-start justify-between gap-3 border-b p-3">
            <div>
              <h2 className="font-medium">GChat tools</h2>
              <p className="text-xs text-muted-foreground">
                {connected
                  ? `${status?.skillCount ?? 0} skills · ${status?.agentCount ?? 0} agents available in OpenCode`
                  : status?.detail || error || (status ? 'OpenCode is disconnected from GChat.' : 'Connecting to GChat…')}
              </p>
            </div>
            <Button size="icon-sm" variant="ghost" aria-label="Close GChat tools" onClick={() => setOpen(false)}>
              <IconX />
            </Button>
          </div>
          <div className="min-h-0 space-y-2 overflow-y-auto p-3">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Delegated runs</p>
            {runs.length === 0 && (
              <p className="text-sm text-muted-foreground">Ask OpenCode to use a GChat skill or agent. Runs will appear here and in Agent Studio.</p>
            )}
            {runs.map((run) => <BridgeRun key={run.runId} run={run} onChanged={refresh} />)}
          </div>
        </aside>
      )}
    </>
  )
}

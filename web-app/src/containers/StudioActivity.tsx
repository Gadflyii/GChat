import { useEffect, useState } from 'react'
import { useStudioRuns } from '@/stores/studio-run-store'
import { useOpenCodeBridgeRuns } from '@/stores/opencode-bridge-runs'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { AgentLiveRuns } from './AgentLiveRuns'

export function StudioActivity() {
  const [open, setOpen] = useState(false)
  const bridgeRuns = useOpenCodeBridgeRuns((s) => s.runs)
  const refreshBridgeRuns = useOpenCodeBridgeRuns((s) => s.refresh)
  useEffect(() => {
    let stopped = false
    let timeout: number | undefined
    const poll = async () => {
      try {
        await refreshBridgeRuns()
      } catch {
        // The Code bridge is optional while OpenCode is unavailable.
      }
      if (!stopped) timeout = window.setTimeout(() => void poll(), 3000)
    }
    void poll()
    return () => {
      stopped = true
      if (timeout !== undefined) window.clearTimeout(timeout)
    }
  }, [refreshBridgeRuns])
  const summary = useStudioRuns((s) => {
    let active = 0,
      approvals = 0,
      queued = 0
    for (const run of Object.values(s.runs)) {
      if (run.state.finishedAtMs === undefined) active++
      approvals += run.approvals.length
      queued += run.state.trace.stages.filter(
        (stage) => stage.status === 'queued'
      ).length
    }
    return `${active}:${approvals}:${queued}`
  })
  const [studioActive, studioApprovals, studioQueued] = summary.split(':').map(Number)
  const activeBridgeRuns = bridgeRuns.filter((run) => run.status === 'queued' || run.status === 'running')
  const active = studioActive + activeBridgeRuns.length
  const approvals = studioApprovals + activeBridgeRuns.reduce((count, run) => count + (run.approvals?.length ?? 0), 0)
  const queued = studioQueued + activeBridgeRuns.filter((run) => run.status === 'queued').length
  if (!active && !approvals && !open) return null
  return (
    <>
      <Button
        className="fixed bottom-4 right-4 z-40 shadow-sm"
        onClick={() => setOpen(true)}
        aria-label={`Agent activity: ${active} active runs, ${approvals} approvals needed, ${queued} queued workers`}
      >
        <span aria-live="polite">
          {approvals
            ? `${approvals} approvals needed`
            : `${active} active runs`}
        </span>
        {queued > 0 && <span>· {queued} queued</span>}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-4xl">
          <DialogHeader>
            <DialogTitle>Agent activity</DialogTitle>
            <DialogDescription>
              Review approvals, monitor workers, or stop a run without leaving
              your current page.
            </DialogDescription>
          </DialogHeader>
          <AgentLiveRuns />
        </DialogContent>
      </Dialog>
    </>
  )
}

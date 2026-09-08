import { useState } from 'react'
import { useStudioRuns } from '@/stores/studio-run-store'
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
  const [active, approvals, queued] = summary.split(':').map(Number)
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

import { create } from 'zustand'

import { listOpenCodeBridgeRuns, type OpenCodeBridgeRun } from '@/services/agent/opencode-bridge'
import { useStudioRuns } from '@/stores/studio-run-store'

function active(run: OpenCodeBridgeRun): boolean {
  return run.status === 'queued' || run.status === 'running'
}

let refreshQueue: Promise<void> = Promise.resolve()

export const useOpenCodeBridgeRuns = create<{
  runs: OpenCodeBridgeRun[]
  refresh: () => Promise<void>
}>((set, get) => ({
  runs: [],
  refresh: () => {
    const request = refreshQueue.then(async () => {
      const next = await listOpenCodeBridgeRuns()
      const previous = get().runs
      const previousById = new Map(previous.map((run) => [run.runId, run]))
      const completed = previous.some((run) => active(run) && !next.some((candidate) =>
        candidate.runId === run.runId && active(candidate)
      )) || next.some((run) => {
        const seen = previousById.get(run.runId)
        return !active(run) && (!seen || active(seen))
      })
      set({ runs: next })
      if (completed) {
        useStudioRuns.setState((state) => ({ historyRevision: state.historyRevision + 1 }))
      }
    })
    refreshQueue = request.catch(() => undefined)
    return request
  },
}))

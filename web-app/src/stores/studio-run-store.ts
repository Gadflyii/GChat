import { create } from 'zustand'
import { createAgentRunState, reduceAgentRunState } from '@/hooks/useAgentRun'
import { runAgentTurn } from '@/services/agent/tauri'
import type { AgentEvent, AgentRunState, AgentTurnRequest } from '@/types/agent'

type Approval = Extract<
  AgentEvent,
  { type: 'approval_requested' | 'folder_access_requested' }
>
export type StudioRun = {
  name: string
  request: AgentTurnRequest
  state: AgentRunState
  approvals: Approval[]
}
export const useStudioRuns = create<{
  runs: Record<string, StudioRun>
  start: (name: string, request: AgentTurnRequest) => void
  resolve: (id: string, approvalId: string) => void
}>((set) => ({
  runs: {},
  resolve: (id, approvalId) =>
    set((s) => ({
      runs: {
        ...s.runs,
        [id]: {
          ...s.runs[id],
          approvals: s.runs[id].approvals.filter(
            (a) =>
              (a.type === 'approval_requested'
                ? a.approval_id
                : a.access_id) !== approvalId
          ),
        },
      },
    })),
  start: (name, request) => {
    set((s) => {
      const runs = { ...s.runs }
      const completed = Object.keys(runs).filter(
        (id) => runs[id].state.finishedAtMs !== undefined
      )
      for (const id of completed.slice(0, Math.max(0, completed.length - 9)))
        delete runs[id]
      return {
        runs: {
          ...runs,
          [request.run_id]: {
            name,
            request,
            state: {
              ...createAgentRunState(),
              status: 'running',
              runId: request.run_id,
              startedAtMs: Date.now(),
            },
            approvals: [],
          },
        },
      }
    })
    let queue: AgentEvent[] = []
    let timer: ReturnType<typeof setTimeout> | undefined
    const flush = () => {
      if (timer) clearTimeout(timer)
      timer = undefined
      const events = queue
      queue = []
      if (!events.length) return
      set((s) => {
        let run = s.runs[request.run_id]
        if (!run) return s
        for (const event of events)
          run = {
            ...run,
            state: reduceAgentRunState(run.state, event),
            approvals:
              event.type === 'approval_requested' ||
              event.type === 'folder_access_requested'
                ? [...run.approvals, event]
                : event.type === 'turn_finished'
                  ? []
                  : run.approvals,
          }
        return { runs: { ...s.runs, [request.run_id]: run } }
      })
    }
    const event = (event: AgentEvent) => {
      queue.push(event)
      if (
        event.type === 'approval_requested' ||
        event.type === 'folder_access_requested' ||
        event.type === 'turn_finished' ||
        queue.length >= 128
      )
        flush()
      else timer ??= setTimeout(flush, 40)
    }
    void runAgentTurn(request, event)
      .catch((error) => {
        event({
          type: 'step_error',
          message: String(error),
          category: 'execution',
        })
        event({ type: 'turn_finished', reason: 'failed', step_count: 0 })
      })
      .finally(flush)
  },
}))

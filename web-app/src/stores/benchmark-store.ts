import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import { localStorageKey } from '@/constants/localStorage'
import type { BenchmarkResult } from '@/services/benchmark/tauri'

const MAX_SAVED_RUNS = 20

type BenchmarkState = {
  runs: BenchmarkResult[]
  selectedRunId: string | null
  addRun: (run: BenchmarkResult) => void
  selectRun: (runId: string | null) => void
  deleteRun: (runId: string) => void
  clearRuns: () => void
}

export const useBenchmarkStore = create<BenchmarkState>()(
  persist(
    (set) => ({
      runs: [],
      selectedRunId: null,
      addRun: (run) =>
        set((state) => ({
          runs: [run, ...state.runs.filter((item) => item.run_id !== run.run_id)].slice(
            0,
            MAX_SAVED_RUNS
          ),
          selectedRunId: run.run_id,
        })),
      selectRun: (selectedRunId) => set({ selectedRunId }),
      deleteRun: (runId) =>
        set((state) => {
          const runs = state.runs.filter((run) => run.run_id !== runId)
          return {
            runs,
            selectedRunId:
              state.selectedRunId === runId
                ? (runs[0]?.run_id ?? null)
                : state.selectedRunId,
          }
        }),
      clearRuns: () => set({ runs: [], selectedRunId: null }),
    }),
    {
      name: localStorageKey.benchmarkRuns,
      storage: createJSONStorage(() => localStorage),
      partialize: ({ runs, selectedRunId }) => ({ runs, selectedRunId }),
    }
  )
)

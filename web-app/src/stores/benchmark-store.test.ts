import { afterEach, expect, it } from 'vitest'
import { localStorageKey } from '@/constants/localStorage'
import { useBenchmarkStore } from './benchmark-store'

afterEach(() => {
  useBenchmarkStore.getState().clearRuns()
  localStorage.removeItem(localStorageKey.benchmarkRuns)
})

it('discards old benchmark records instead of converting their scoring', async () => {
  localStorage.setItem(localStorageKey.benchmarkRuns, JSON.stringify({
    version: 0, state: { runs: [{ run_id: 'old-score' }], selectedRunId: 'old-score' },
  }))
  await useBenchmarkStore.persist.rehydrate()
  expect(useBenchmarkStore.getState().runs).toEqual([])
  expect(useBenchmarkStore.getState().selectedRunId).toBeNull()
  const stored = JSON.parse(localStorage.getItem(localStorageKey.benchmarkRuns)!)
  expect(stored.version).toBe(1)
  expect(stored.state.runs).toEqual([])
})

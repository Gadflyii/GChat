import { beforeEach, expect, it, vi } from 'vitest'

import { listOpenCodeBridgeRuns } from '@/services/agent/opencode-bridge'
import { useOpenCodeBridgeRuns } from './opencode-bridge-runs'
import { useStudioRuns } from './studio-run-store'

vi.mock('@/services/agent/opencode-bridge', () => ({
  listOpenCodeBridgeRuns: vi.fn(),
}))

beforeEach(() => {
  useOpenCodeBridgeRuns.setState({ runs: [] })
  useStudioRuns.setState({ historyRevision: 0 })
  vi.mocked(listOpenCodeBridgeRuns).mockReset()
})

it('refreshes Agent Studio history after a delegated run finishes', async () => {
  vi.mocked(listOpenCodeBridgeRuns)
    .mockResolvedValueOnce([{ runId: 'run', definitionName: 'Review', status: 'running' }])
    .mockResolvedValueOnce([{ runId: 'run', definitionName: 'Review', status: 'finished', result: 'Done' }])

  await useOpenCodeBridgeRuns.getState().refresh()
  expect(useStudioRuns.getState().historyRevision).toBe(0)

  await useOpenCodeBridgeRuns.getState().refresh()
  expect(useStudioRuns.getState().historyRevision).toBe(1)
  expect(useOpenCodeBridgeRuns.getState().runs[0].result).toBe('Done')
})

it('refreshes history when a short run finishes between polls', async () => {
  vi.mocked(listOpenCodeBridgeRuns).mockResolvedValue([
    { runId: 'quick-run', definitionName: 'Review', status: 'finished', result: 'Done' },
  ])

  await useOpenCodeBridgeRuns.getState().refresh()
  expect(useStudioRuns.getState().historyRevision).toBe(1)

  await useOpenCodeBridgeRuns.getState().refresh()
  expect(useStudioRuns.getState().historyRevision).toBe(1)
})

it('serializes a manual refresh behind an in-flight poll', async () => {
  let resolveFirst!: (runs: []) => void
  vi.mocked(listOpenCodeBridgeRuns)
    .mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve }))
    .mockResolvedValueOnce([{ runId: 'new', definitionName: 'Review', status: 'finished' }])

  const poll = useOpenCodeBridgeRuns.getState().refresh()
  const manual = useOpenCodeBridgeRuns.getState().refresh()
  await Promise.resolve()
  expect(listOpenCodeBridgeRuns).toHaveBeenCalledTimes(1)

  resolveFirst([])
  await Promise.all([poll, manual])
  expect(listOpenCodeBridgeRuns).toHaveBeenCalledTimes(2)
  expect(useOpenCodeBridgeRuns.getState().runs[0].runId).toBe('new')
})

import { expect, it } from 'vitest'
import { continuationTask } from './agent-continuation'
import type { AgentRunRecord } from '@/types/agent'

it('carries the prior goal and findings as bounded evidence, not an execution replay', () => {
  const run: AgentRunRecord = {
    schemaVersion: 3,
    id: 'record',
    runId: 'run',
    sessionId: 'session',
    definitionId: 'definition',
    definitionName: 'Review',
    userMessage: 'Review the application',
    kind: 'standard',
    status: 'incomplete',
    startedAtMs: 0,
    finishedAtMs: 1,
    totalSteps: 12,
    finalReply: 'The source scan is complete; tests remain.',
    defaultModelInstanceId: 'model',
    stages: [],
  }
  const task = continuationTask(run)
  expect(task).toContain('Review the application')
  expect(task).toContain('tests remain')
  expect(task).toContain('This is a new run, not a replay')
  expect(task).toContain(
    'Verify existing files and completed work before acting'
  )
  expect(
    continuationTask({ ...run, finalReply: 'x'.repeat(50_000) }).length
  ).toBeLessThan(5000)
})

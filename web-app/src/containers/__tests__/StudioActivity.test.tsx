import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import { StudioActivity } from '../StudioActivity'
import { useStudioRuns } from '@/stores/studio-run-store'
import { createAgentRunState } from '@/hooks/useAgentRun'
import { useOpenCodeBridgeRuns } from '@/stores/opencode-bridge-runs'

vi.mock('@/hooks/useStudioCatalog', () => ({
  useStudioCatalog: () => ({ catalog: { instances: [] }, refresh: vi.fn() }),
}))

beforeEach(() => {
  useOpenCodeBridgeRuns.setState({ runs: [], refresh: vi.fn().mockResolvedValue(undefined) })
})
it('exposes pending Studio approvals outside the Runs page', () => {
  useStudioRuns.setState({
    runs: {
      run: {
        name: 'Background team',
        request: {
          run_id: 'run',
          session_id: 'run',
          model_id: 'model',
          user_message: 'Work',
          auto_approve: false,
        },
        state: { ...createAgentRunState(), status: 'running' },
        approvals: [
          {
            type: 'approval_requested',
            run_id: 'run',
            approval_id: 'approval',
            tool: 'memory.save',
            reason: 'Remember a fact',
            preview: {},
            affected_resources: [],
            can_remember: false,
          },
        ],
      },
    },
  })
  render(<StudioActivity />)
  fireEvent.click(screen.getByRole('button', { name: /1 approvals needed/ }))
  expect(screen.getByRole('dialog')).toHaveTextContent('Remember a fact')
})

it('counts delegated OpenCode runs and approvals in the shared activity control', () => {
  useStudioRuns.setState({ runs: {} })
  useOpenCodeBridgeRuns.setState({
    runs: [{
      runId: 'bridge-run',
      definitionName: 'Review agent',
      status: 'running',
      workspace: 'C:\\Projects\\gchat',
      approvals: [{
        type: 'folder_access_requested',
        runId: 'bridge-run',
        approvalId: 'access',
        tool: 'fileWrite',
        reason: 'Edit project',
        path: '/project',
      }],
    }],
    refresh: vi.fn().mockResolvedValue(undefined),
  })
  render(<StudioActivity />)

  fireEvent.click(screen.getByRole('button', { name: 'Agent activity: 1 active runs, 1 approvals needed, 0 queued workers' }))
  expect(screen.getByRole('dialog')).toHaveTextContent('Review agent')
  expect(screen.getByRole('dialog')).toHaveTextContent('Project: gchat')
  expect(screen.getByRole('dialog')).toHaveTextContent('Edit project')
})

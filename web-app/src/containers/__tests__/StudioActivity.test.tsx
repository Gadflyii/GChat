import { fireEvent, render, screen } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { StudioActivity } from '../StudioActivity'
import { useStudioRuns } from '@/stores/studio-run-store'
import { createAgentRunState } from '@/hooks/useAgentRun'

vi.mock('../AgentLiveRuns', () => ({
  AgentLiveRuns: () => <div>Approve workers here</div>,
}))
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
  expect(screen.getByRole('dialog')).toHaveTextContent('Approve workers here')
})

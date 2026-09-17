import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import AgentApprovalDialog from '@/containers/dialogs/AgentApprovalDialog'
import { useAgentRun } from '@/hooks/useAgentRun'

const { resolveAgentApproval } = vi.hoisted(() => ({
  resolveAgentApproval: vi.fn(),
}))

vi.mock('@/services/agent/tauri', () => ({
  resolveAgentApproval,
  isStaleAgentApprovalError: (error: unknown) =>
    String(error).includes('approval is not pending'),
}))

function openApproval(canRemember = true): void {
  useAgentRun.getState().startRun('thread-1', 'run-1')
  useAgentRun.getState().applyEvent('thread-1', {
    type: 'approval_requested',
    run_id: 'run-1',
    approval_id: 'approval-1',
    tool: 'os.fs.write',
    reason: 'Write a file',
    preview: { path: '/workspace/a.txt' },
    affected_resources: [
      { kind: 'path', value: '/workspace/a.txt', operation: 'write' },
    ],
    can_remember: canRemember,
  })
}

describe('AgentApprovalDialog', () => {
  beforeEach(() => {
    useAgentRun.getState().clearAll()
    resolveAgentApproval.mockReset()
    resolveAgentApproval.mockResolvedValue(undefined)
    openApproval()
  })

  it('renders approval controls without warning icon styling', () => {
    const { container } = render(<AgentApprovalDialog />)

    expect(container.querySelector('.text-amber-500')).toBeNull()
    expect(
      screen.getByRole('button', { name: /approveOnce/i })
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /deny/i })).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /alwaysAllow/i })
    ).toBeInTheDocument()
  })

  it('previews an agent definition and requires an explicit creation decision', async () => {
    useAgentRun.getState().applyEvent('thread-1', {
      type: 'approval_requested', run_id: 'run-1', approval_id: 'builder-save', tool: 'studio.manage', reason: 'Save definition',
      preview: { action: 'save_definition', args: { name: 'Model inventory', kind: 'standard', defaultGoal: 'List local models and total size', instructions: 'Use registered model inventory', outputContract: 'A table with sizes' } },
      affected_resources: [], can_remember: false,
    })
    render(<AgentApprovalDialog />)
    expect(screen.getByText('Model inventory')).toBeInTheDocument()
    expect(screen.getByText('List local models and total size')).toBeInTheDocument()
    expect(resolveAgentApproval).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Create agent' }))
    await waitFor(() => expect(resolveAgentApproval).toHaveBeenCalledWith({ approval_id: 'builder-save', decision: 'allow_once' }))
  })

  it('approves once and guards against a double click', async () => {
    let finish: (() => void) | undefined
    resolveAgentApproval.mockReturnValue(
      new Promise<void>((resolve) => {
        finish = resolve
      })
    )
    const user = userEvent.setup()
    render(<AgentApprovalDialog />)
    const approve = screen.getByRole('button', { name: /approveOnce/i })

    await user.dblClick(approve)

    expect(resolveAgentApproval).toHaveBeenCalledTimes(1)
    expect(resolveAgentApproval).toHaveBeenCalledWith({
      approval_id: 'approval-1',
      decision: 'allow_once',
    })
    expect(approve).toBeDisabled()
    finish?.()
    await waitFor(() =>
      expect(
        useAgentRun.getState().getRun('thread-1').pendingApproval
      ).toBeUndefined()
    )
  })

  it('denies when the dialog is closed', async () => {
    render(<AgentApprovalDialog />)

    fireEvent.keyDown(document, { key: 'Escape' })

    await waitFor(() =>
      expect(resolveAgentApproval).toHaveBeenCalledWith({
        approval_id: 'approval-1',
        decision: 'deny',
      })
    )
  })

  it('always allows a rememberable action', async () => {
    const user = userEvent.setup()
    render(<AgentApprovalDialog />)

    await user.click(screen.getByRole('button', { name: /alwaysAllow/i }))

    expect(resolveAgentApproval).toHaveBeenCalledWith({
      approval_id: 'approval-1',
      decision: 'always_allow',
    })
  })

  it('hides always allow for an action that cannot be remembered', () => {
    useAgentRun.getState().clearAll()
    openApproval(false)

    render(<AgentApprovalDialog />)

    expect(
      screen.queryByRole('button', { name: /alwaysAllow/i })
    ).not.toBeInTheDocument()
  })

  it('treats a stale approval resolution as a benign race', async () => {
    resolveAgentApproval.mockRejectedValue(
      new Error('approval is not pending: approval-1')
    )
    const user = userEvent.setup()
    render(<AgentApprovalDialog />)

    await user.click(screen.getByRole('button', { name: /deny/i }))

    await waitFor(() =>
      expect(
        useAgentRun.getState().getRun('thread-1').pendingApproval
      ).toBeUndefined()
    )
  })

  it('does not clear a newer approval when an older resolution finishes', async () => {
    let finish: (() => void) | undefined
    resolveAgentApproval.mockReturnValue(
      new Promise<void>((resolve) => {
        finish = resolve
      })
    )
    const user = userEvent.setup()
    render(<AgentApprovalDialog />)

    await user.click(screen.getByRole('button', { name: /approveOnce/i }))
    await act(async () => {
      useAgentRun.getState().applyEvent('thread-1', {
        type: 'approval_requested',
        run_id: 'run-1',
        approval_id: 'approval-2',
        tool: 'os.fs.write',
        reason: 'Write another file',
        preview: { path: '/workspace/b.txt' },
        affected_resources: [
          { kind: 'path', value: '/workspace/b.txt', operation: 'write' },
        ],
        can_remember: true,
      })
      finish?.()
    })

    await waitFor(() =>
      expect(
        useAgentRun.getState().getRun('thread-1').pendingApproval?.approval_id
      ).toBe('approval-2')
    )
  })
})

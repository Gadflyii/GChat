import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'

import { CodeBridgePanel } from '../CodeBridgePanel'

const mocks = vi.hoisted(() => ({
  status: vi.fn(),
  runs: vi.fn(),
  cancel: vi.fn(),
  approval: vi.fn(),
  folder: vi.fn(),
}))

vi.mock('@/services/agent/opencode-bridge', () => ({
  getOpenCodeBridgeStatus: mocks.status,
  listOpenCodeBridgeRuns: mocks.runs,
  cancelOpenCodeBridgeRun: mocks.cancel,
}))

vi.mock('@/services/agent/tauri', () => ({
  resolveAgentApproval: mocks.approval,
  resolveAgentFolderAccess: mocks.folder,
}))

beforeEach(() => {
  vi.clearAllMocks()
  mocks.status.mockResolvedValue({ connected: true, skillCount: 3, agentCount: 5 })
  mocks.runs.mockResolvedValue([])
  mocks.cancel.mockResolvedValue(undefined)
  mocks.approval.mockResolvedValue(undefined)
  mocks.folder.mockResolvedValue(undefined)
})

it('shows the bridge status and workspace runs without hiding Code', async () => {
  mocks.runs.mockResolvedValue([{
    runId: 'run-1',
    definitionName: 'Review agent',
    status: 'running',
    stage: 'Evaluator',
    cycle: 2,
    maxCycles: 8,
    summary: 'Checking the patch',
  }])
  render(<CodeBridgePanel visible workspace="/project" />)

  expect(await screen.findByText('GChat tools: Connected')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'GChat tools' }))

  expect(screen.getByText('3 skills · 5 agents available in OpenCode')).toBeInTheDocument()
  expect(screen.getByText('Review agent')).toBeInTheDocument()
  expect(screen.getByText('Evaluator · Cycle 2 of 8')).toBeInTheDocument()
  expect(mocks.runs).toHaveBeenCalledWith('/project')
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
  await waitFor(() => expect(mocks.cancel).toHaveBeenCalledWith('run-1'))
})

it('surfaces delegated tool and folder approvals for a human decision', async () => {
  mocks.runs.mockResolvedValue([{
    runId: 'run-2',
    definitionName: 'Fix agent',
    status: 'running',
    approvals: [
      { type: 'approval_requested', runId: 'run-2', approvalId: 'a1', tool: 'shell', reason: 'Run tests', preview: { command: 'make test' } },
      { type: 'folder_access_requested', runId: 'run-2', approvalId: 'a2', tool: 'fileWrite', reason: 'Edit source', path: '/project/src' },
    ],
  }])
  render(<CodeBridgePanel visible workspace="/project" />)

  fireEvent.click(await screen.findByRole('button', { name: 'GChat tools' }))
  expect(await screen.findByText('Run tests')).toBeInTheDocument()
  expect(screen.getByText('/project/src')).toBeInTheDocument()
  fireEvent.click(screen.getAllByRole('button', { name: 'Allow once' })[0])
  await waitFor(() => expect(mocks.approval).toHaveBeenCalledWith({ approval_id: 'a1', decision: 'allow_once' }))
  fireEvent.click(screen.getAllByRole('button', { name: 'Deny' })[1])
  await waitFor(() => expect(mocks.folder).toHaveBeenCalledWith({ run_id: 'run-2', access_id: 'a2', allow: false }))
})

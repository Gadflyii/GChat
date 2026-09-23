import { invoke } from '@tauri-apps/api/core'

export type OpenCodeBridgeStatus = {
  connected: boolean
  skillCount: number
  agentCount: number
  detail?: string
}

export type OpenCodeBridgeApproval = {
  type: 'approval_requested' | 'folder_access_requested'
  runId: string
  approvalId: string
  tool: string
  reason: string
  preview?: unknown
  canRemember?: boolean
  path?: string
}

export type OpenCodeBridgeRun = {
  runId: string
  definitionName: string
  status: 'queued' | 'running' | 'finished' | 'incomplete' | 'cancelled' | 'failed'
  stage?: string
  cycle?: number
  maxCycles?: number
  summary?: string
  result?: string
  artifacts?: string[]
  approvals?: OpenCodeBridgeApproval[]
  workspace?: string
}

export function getOpenCodeBridgeStatus(): Promise<OpenCodeBridgeStatus> {
  return invoke<OpenCodeBridgeStatus>('opencode_bridge_status')
}

export function listOpenCodeBridgeRuns(workspace?: string): Promise<OpenCodeBridgeRun[]> {
  return invoke<OpenCodeBridgeRun[]>('opencode_bridge_list_runs', { workspace })
}

export function cancelOpenCodeBridgeRun(runId: string): Promise<void> {
  return invoke<void>('opencode_bridge_cancel_run', { runId })
}

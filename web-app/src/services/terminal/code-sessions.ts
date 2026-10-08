import { invoke } from '@tauri-apps/api/core'
import type { TerminalId } from '@/types/terminal'
import type { CodeBridgePolicy } from '@/types/terminal'

export type CodeSessionEvent = {
  kind: 'selected' | 'updated' | 'deleted'
  terminalId: TerminalId
  thread?: Thread
  threadId?: string
}

export function resolveCodeWorkspace(cwd?: string): Promise<string> {
  return invoke('code_workspace_resolve', { cwd })
}

export function selectCodeSession(terminalId: TerminalId, sessionId: string): Promise<void> {
  return invoke('code_session_select', { terminalId, sessionId })
}

export function newCodeSession(terminalId: TerminalId): Promise<void> {
  return invoke('code_session_new', { terminalId })
}

export function updateCodeBridgePolicy(terminalId: TerminalId, policy: CodeBridgePolicy): Promise<void> {
  return invoke('terminal_update_bridge_policy', { terminalId, policy })
}

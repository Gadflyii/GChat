import { invoke } from '@tauri-apps/api/core'
import type { ConnectorAccount } from './workspace-connectors'

export type BotConnectors = {
  account_ids: string[]
  accounts: Omit<ConnectorAccount, 'subject'>[]
}

export type Identity = { workspace_id: string; session_id: string }
export type ViewTicket = {
  lease_id: string
  ws_url: string
  media_session_id: string
  interactive: boolean
}
export type Workspace = {
  id: string
  name: string
  bot_pc?: { kind: string; hypervisor?: string }
  connection?: {
    kind: string
    endpoint?: { hostname: string; port: number; user: string }
    pinned_host_key?: { algorithm: string; public_key: string }
  }
}
export type SetupIssue = {
  code: string
  message: string
  next_action: string
}
export type KvmSetupRecord = {
  id: string
  name: string
  stage: string
  issue: SetupIssue | null
}
export type Control = {
  identity: Identity
  owner: string | null
  state: string
}
export type BotState = {
  workspaces: Workspace[]
  live_sessions: Identity[]
  controls: Control[]
  assignments: SavedAssignment[]
}
export type PairedTarget = {
  host_id: string
  instance_id: string
  session_id: string
}
export type ModelConnection =
  | { kind: 'endpoint'; api_base: string }
  | { kind: 'paired_host'; target: PairedTarget }
export type PairedModel = {
  target: PairedTarget
  host_name: string
  model: string
  context_tokens: number
}
export const emptyPairedConnection: ModelConnection = {
  kind: 'paired_host',
  target: { host_id: '', instance_id: '', session_id: '' },
}
export function validBrainConnection(connection: ModelConnection) {
  return connection.kind === 'endpoint'
    ? Boolean(connection.api_base.trim())
    : Object.values(connection.target).every(Boolean)
}
export type Assignment = {
  connection: ModelConnection
  model: string
  context_tokens: number
  api_key?: string
}
export type SavedAssignment = Omit<Assignment, 'api_key'> & {
  workspace_id: string
  credential_ref: string | null
}
export type Task = {
  id: string
  identity: Identity
  state: string
  messages: { role: string; content: unknown }[]
  help_requests: HelpRequest[]
}
export type HelpRequest = {
  id: string
  question: string
  status: 'pending' | 'completed' | 'declined' | 'cancelled'
  response: string | null
}
export type Approval = {
  id: string
  task_id: string
  request: { operation: unknown }
}

export function gbot<T>(path: string, body?: unknown): Promise<T> {
  return invoke<T>('gbot_command', { path: `/v1/${path}`, body })
}

export function quitGbotService(): Promise<void> {
  return invoke('gbot_service_quit')
}

export function startGbotService(): Promise<void> {
  return invoke('gbot_service_start')
}

export function messageText(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content))
    return content
      .map((part) =>
        part && typeof part === 'object' && 'text' in part
          ? String(part.text)
          : ''
      )
      .filter(Boolean)
      .join('\n')
  return ''
}

export type LanPreparation = {
  command: string | null
  installed: boolean
  issue: string | null
}

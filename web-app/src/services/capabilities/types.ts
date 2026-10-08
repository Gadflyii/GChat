import type { AgentAttachment, AgentEvent, AgentTurnFinishReason } from '@/types/agent'
import type { AgentSkill } from '@/services/agent/skills'
import type { MCPServerStatus } from '@/services/mcp/types'

export type CapabilityTool = {
  name: string
  identity: string
  description: string
  inputSchema: Record<string, unknown>
  server: string
  origin: 'native' | 'mcp'
}

export type CapabilityCatalog = {
  tools: CapabilityTool[]
  skills: AgentSkill[]
  servers: MCPServerStatus[]
}

export type CapabilityExecuteRequest = {
  run_id: string
  session_id: string
  model_id?: string
  tool_name: string
  arguments: Record<string, unknown>
  working_dir?: string
  external_roots: Array<{ path: string; can_edit: boolean }>
  auto_approve: boolean
  selected_skill?: string
  disabled_tools?: string[]
  attachments?: AgentAttachment[]
}

export type CapabilityExecuteResult = {
  content: unknown
  error?: string
  run?: {
    runId: string
    status: 'finished' | 'incomplete' | 'failed' | 'cancelled'
    reason: AgentTurnFinishReason
    result?: string | null
    stepCount: number
  }
}

export interface CapabilitiesService {
  getCatalog(): Promise<CapabilityCatalog>
  execute(
    request: CapabilityExecuteRequest,
    onEvent: (event: AgentEvent) => void
  ): Promise<CapabilityExecuteResult>
  cancel(runId: string): Promise<void>
}

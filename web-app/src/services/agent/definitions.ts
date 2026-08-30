import { invoke } from '@tauri-apps/api/core'
import type {
  AgentDefinition,
  AgentModelInstance,
  AgentRunRecord,
  AgentTemplate,
} from '@/types/agent'

export function listAgentDefinitions(): Promise<AgentDefinition[]> {
  return invoke<AgentDefinition[]>('agent_list_definitions')
}

export function listAgentModelInstances(): Promise<AgentModelInstance[]> {
  return invoke<AgentModelInstance[]>('agent_list_model_instances')
}

export function newAgentDefinition(): Promise<AgentDefinition> {
  return invoke<AgentDefinition>('agent_new_definition')
}

export function getAgentDefinition(id: string): Promise<AgentDefinition> {
  return invoke<AgentDefinition>('agent_get_definition', { id })
}

export function saveAgentDefinition(
  definition: AgentDefinition
): Promise<AgentDefinition> {
  return invoke<AgentDefinition>('agent_save_definition', { definition })
}

export function deleteAgentDefinition(id: string): Promise<void> {
  return invoke<void>('agent_delete_definition', { id })
}

export function listAgentTemplates(): Promise<AgentTemplate[]> {
  return invoke<AgentTemplate[]>('agent_list_templates')
}

export function listAgentRuns(): Promise<AgentRunRecord[]> {
  return invoke<AgentRunRecord[]>('agent_list_runs')
}

export function deleteAgentRun(id: string): Promise<void> {
  return invoke<void>('agent_delete_run', { id })
}

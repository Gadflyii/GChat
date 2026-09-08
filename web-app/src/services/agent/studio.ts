import { invoke } from '@tauri-apps/api/core'
import type {
  AgentDefinition,
  AgentModelInstance,
  AgentRoleAssignment,
  AgentWorkerPool,
} from '@/types/agent'

export type StudioCatalog = {
  pools: AgentWorkerPool[]
  instances: AgentModelInstance[]
  usage: Record<string, number>
}
export const studioCommand = <T>(action: string, args: unknown = {}) =>
  invoke<T>('agent_studio', { action, args })

export function placementRoles(
  definition: AgentDefinition
): Array<{ id: string; name: string; defaultInstance: string | null }> {
  const base = definition.modelInstanceId
  switch (definition.kind) {
    case 'standard':
      return [{ id: 'agent', name: definition.name, defaultInstance: base }]
    case 'goal_loop':
      return [
        { id: 'executor', name: 'Executor', defaultInstance: base },
        {
          id: 'evaluator',
          name: 'Evaluator',
          defaultInstance: definition.evaluatorModelInstanceId ?? base,
        },
      ]
    case 'coordinator':
      return [
        { id: 'coordinator', name: 'Coordinator', defaultInstance: base },
        {
          id: 'synthesizer',
          name: 'Synthesizer',
          defaultInstance: definition.synthesisModelInstanceId ?? base,
        },
        ...definition.workers.map((worker) => ({
          id: `worker:${worker.id}`,
          name: worker.name,
          defaultInstance: worker.modelInstanceId ?? base,
        })),
      ]
    case 'workflow':
      return definition.nodes.map((node) => ({
        id: `workflow:${node.id}`,
        name: node.name,
        defaultInstance: node.modelInstanceId ?? base,
      }))
  }
}

export function defaultAssignments(
  definition: AgentDefinition
): Record<string, AgentRoleAssignment> {
  return Object.fromEntries(
    placementRoles(definition).map((role) => [
      role.id,
      definition.roleAssignments?.[role.id] ?? {
        target: role.defaultInstance
          ? { kind: 'instance', id: role.defaultInstance }
          : { kind: 'current' },
        vision: false,
        minimumContext: 0,
      },
    ])
  )
}

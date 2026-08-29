export function readAgentSkillName(
  metadata: Record<string, unknown>
): string | undefined {
  const value = metadata.agent_skill_name
  return typeof value === 'string' && value ? value : undefined
}

export function readAgentDefinitionId(
  metadata: Record<string, unknown>
): string | undefined {
  const value = metadata.agent_definition_id
  return typeof value === 'string' && value.trim() ? value : undefined
}

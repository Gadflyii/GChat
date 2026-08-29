import { describe, expect, it } from 'vitest'
import {
  readAgentDefinitionId,
  readAgentSkillName,
} from './agent-skill-selection'

describe('readAgentSkillName', () => {
  it('restores a selected skill from user-message metadata', () => {
    expect(readAgentSkillName({ agent_skill_name: 'pdf' })).toBe('pdf')
  })

  it('ignores absent or invalid metadata values', () => {
    expect(readAgentSkillName({})).toBeUndefined()
    expect(readAgentSkillName({ agent_skill_name: '' })).toBeUndefined()
    expect(readAgentSkillName({ agent_skill_name: 42 })).toBeUndefined()
  })
})

describe('readAgentDefinitionId', () => {
  it('returns only non-empty string identifiers', () => {
    expect(readAgentDefinitionId({ agent_definition_id: 'research-team' })).toBe(
      'research-team'
    )
    expect(readAgentDefinitionId({ agent_definition_id: '' })).toBeUndefined()
    expect(readAgentDefinitionId({ agent_definition_id: 42 })).toBeUndefined()
  })
})

import { invoke } from '@tauri-apps/api/core'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { listAgentModelInstances, newAgentDefinition } from './definitions'

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}))

describe('Agent definition service', () => {
  beforeEach(() => vi.clearAllMocks())

  it('requests an editable draft from the internal Agent authority', async () => {
    vi.mocked(invoke).mockResolvedValue({ name: 'Untitled Agent' })

    await expect(newAgentDefinition()).resolves.toEqual({
      name: 'Untitled Agent',
    })
    expect(invoke).toHaveBeenCalledWith('agent_new_definition')
  })

  it('lists the loaded model instances available to Agent Studio', async () => {
    vi.mocked(invoke).mockResolvedValue([
      { id: 'qwen', modelId: 'qwen', port: 8123 },
    ])

    await expect(listAgentModelInstances()).resolves.toHaveLength(1)
    expect(invoke).toHaveBeenCalledWith('agent_list_model_instances')
  })
})

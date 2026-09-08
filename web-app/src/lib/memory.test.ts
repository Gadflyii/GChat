import { beforeEach, expect, it, vi } from 'vitest'
import { invoke, isTauri } from '@tauri-apps/api/core'
import { chatMemoryContext, supportsGChatMemory } from './memory'

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
  isTauri: vi.fn(() => true),
}))
beforeEach(() => vi.clearAllMocks())

it('shares memory with local and paired GInfer, not unrelated providers', () => {
  expect(supportsGChatMemory('ginfer')).toBe(true)
  expect(supportsGChatMemory('ginfer-lan')).toBe(true)
  expect(supportsGChatMemory('openai')).toBe(false)
})

it('recalls personal facts from the latest user turn without assigning a workspace', async () => {
  vi.mocked(invoke).mockResolvedValue({ prompt: 'Saved personal facts' })
  const prompt = await chatMemoryContext([
    { id: '1', role: 'user', parts: [{ type: 'text', text: 'Old topic' }] },
    {
      id: '2',
      role: 'user',
      parts: [{ type: 'text', text: 'Build the project' }],
    },
  ])
  expect(prompt).toBe('Saved personal facts')
  expect(invoke).toHaveBeenCalledWith('memory_library', {
    action: 'context',
    args: { query: 'Build the project' },
  })
})

it('does not invent desktop memory in the browser', async () => {
  vi.mocked(isTauri).mockReturnValue(false)
  expect(await chatMemoryContext([])).toBe('')
  expect(invoke).not.toHaveBeenCalled()
})

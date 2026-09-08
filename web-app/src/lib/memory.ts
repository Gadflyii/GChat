import { invoke, isTauri } from '@tauri-apps/api/core'
import type { UIMessage } from '@ai-sdk/react'
import { useMemoryContext } from '@/stores/memory-context-store'

export type SavedMemory = {
  id: string
  title: string
  content: string
  workspace: string | null
  pinned: boolean
  enabled: boolean
  revision: number
  createdAt: number
  updatedAt: number
  source: string
  origin?: string | null
}

export const memoryCommand = <T>(action: string, args: unknown = {}) =>
  invoke<T>('memory_library', { action, args })

export const supportsGChatMemory = (provider: string) =>
  provider === 'ginfer' || provider === 'ginfer-lan'

export async function chatMemoryContext(
  messages: UIMessage[],
  threadId?: string
): Promise<string> {
  if (!isTauri()) return ''
  const latest = messages.findLast((m) => m.role === 'user')
  const query =
    latest?.parts
      .filter((p) => p.type === 'text')
      .map((p) => p.text)
      .join(' ') ?? ''
  const result = await memoryCommand<{
    prompt: string
    memories?: SavedMemory[]
  }>('context', { query })
  if (threadId)
    useMemoryContext.getState().record(threadId, result.memories ?? [])
  return result.prompt
}

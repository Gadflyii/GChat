import { invoke, isTauri } from '@tauri-apps/api/core'
import type { UIMessage } from '@ai-sdk/react'

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
}

export const memoryCommand = <T>(action: string, args: unknown = {}) =>
  invoke<T>('memory_library', { action, args })

export async function chatMemoryContext(
  messages: UIMessage[]
): Promise<string> {
  if (!isTauri()) return ''
  const latest = messages.findLast((m) => m.role === 'user')
  const query =
    latest?.parts
      .filter((p) => p.type === 'text')
      .map((p) => p.text)
      .join(' ') ?? ''
  const result = await memoryCommand<{ prompt: string }>('context', { query })
  return result.prompt
}

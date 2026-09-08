import { create } from 'zustand'
import type { SavedMemory } from '@/lib/memory'

export const useMemoryContext = create<{
  threads: Record<string, SavedMemory[]>
  record: (threadId: string, memories: SavedMemory[]) => void
}>((set) => ({
  threads: {},
  record: (threadId, memories) =>
    set((s) => ({
      threads: Object.fromEntries(
        [
          ...Object.entries(s.threads).filter(([id]) => id !== threadId),
          [threadId, memories],
        ].slice(-64)
      ),
    })),
}))

import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import { localStorageKey } from '@/constants/localStorage'

type CodeTerminalState = {
  enabled: boolean
  workspace?: string
  selectedThreadId?: string
  setSelectedThreadId: (threadId?: string) => void
  setEnabled: (enabled: boolean) => void
  setWorkspace: (workspace: string) => void
}

export const useCodeTerminalStore = create<CodeTerminalState>()(
  persist(
    (set) => ({
      enabled: true,
      workspace: undefined,
      selectedThreadId: undefined,
      setSelectedThreadId: (selectedThreadId) => set({ selectedThreadId }),
      setEnabled: (enabled) => set({ enabled }),
      setWorkspace: (workspace) => set({ workspace: workspace.trim() }),
    }),
    {
      name: localStorageKey.codeTerminal,
      storage: createJSONStorage(() => localStorage),
      partialize: ({ enabled, workspace, selectedThreadId }) => ({ enabled, workspace, selectedThreadId }),
    }
  )
)

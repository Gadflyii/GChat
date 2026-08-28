import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import { localStorageKey } from '@/constants/localStorage'

type CodeTerminalState = {
  workspace?: string
  setWorkspace: (workspace: string) => void
}

export const useCodeTerminalStore = create<CodeTerminalState>()(
  persist(
    (set) => ({
      workspace: undefined,
      setWorkspace: (workspace) => set({ workspace: workspace.trim() }),
    }),
    {
      name: localStorageKey.codeTerminal,
      storage: createJSONStorage(() => localStorage),
      partialize: ({ workspace }) => ({ workspace }),
    }
  )
)

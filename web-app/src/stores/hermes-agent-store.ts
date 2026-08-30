import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'

import { localStorageKey } from '@/constants/localStorage'

const LEGACY_STORAGE_KEY = 'hermes-agent-model'

function legacyModel(): string | null {
  if (typeof window === 'undefined') return null
  try {
    const value = JSON.parse(localStorage.getItem(LEGACY_STORAGE_KEY) ?? 'null')
    return typeof value?.model === 'string' ? value.model : null
  } catch {
    return null
  }
}

type HermesAgentState = {
  model: string | null
  enabled: boolean
  workspace?: string
  setModel: (model: string | null) => void
  setEnabled: (enabled: boolean) => void
  setWorkspace: (workspace: string) => void
  clearIntegration: () => void
}

export const useHermesAgentStore = create<HermesAgentState>()(
  persist(
    (set) => ({
      model: legacyModel(),
      enabled: false,
      workspace: undefined,
      setModel: (model) => set({ model }),
      setEnabled: (enabled) => set({ enabled }),
      setWorkspace: (workspace) => set({ workspace: workspace.trim() }),
      clearIntegration: () => set({ model: null, enabled: false }),
    }),
    {
      name: localStorageKey.hermesAgent,
      storage: createJSONStorage(() => localStorage),
      partialize: ({ model, enabled, workspace }) => ({
        model,
        enabled,
        workspace,
      }),
    }
  )
)

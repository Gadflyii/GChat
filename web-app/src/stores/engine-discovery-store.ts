import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import { localStorageKey } from '@/constants/localStorage'

type DiscoveryPreferences = {
  enabled: boolean
  ignored: Record<string, string>
  notified: string[]
  setEnabled: (enabled: boolean) => void
  ignore: (id: string, name: string) => void
  restore: (id: string) => void
  markNotified: (id: string) => void
}

// Preferences only: trust and credentials remain in the native registry/vault.
export const useEngineDiscovery = create<DiscoveryPreferences>()(persist((set) => ({
  enabled: true, ignored: {}, notified: [],
  setEnabled: (enabled) => set({ enabled }),
  ignore: (id, name) => set((state) => ({ ignored: { ...state.ignored, [id]: name } })),
  restore: (id) => set((state) => {
    const ignored = { ...state.ignored }; delete ignored[id]
    return { ignored }
  }),
  markNotified: (id) => set((state) => ({ notified: [...new Set([...state.notified, id])] })),
}), {
  name: localStorageKey.engineDiscovery,
  storage: createJSONStorage(() => localStorage),
  partialize: ({ enabled, ignored, notified }) => ({ enabled, ignored, notified }),
}))

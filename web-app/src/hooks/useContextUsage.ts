import { create } from 'zustand'
import type { GInferContextUsage } from '@/lib/smart-context'

export interface RequestContextUsage extends GInferContextUsage {
  modelId: string
  outputTokens: number
}

export const useContextUsage = create<{
  requests: Record<string, RequestContextUsage>
  record: (threadId: string, usage: RequestContextUsage) => void
}>((set) => ({
  requests: {},
  record: (threadId, usage) => set((state) => ({
    requests: { ...state.requests, [threadId]: usage },
  })),
}))

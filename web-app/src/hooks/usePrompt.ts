import { create } from 'zustand'
import { TEMPORARY_CHAT_ID } from '@/constants/chat'

type PromptStoreState = {
  prompt: string
  activeThreadId: string
  drafts: Record<string, string>
  setActiveThread: (threadId: string) => void
  setPrompt: (value: string) => void
  resetPrompt: (threadId?: string) => void
}

export const usePrompt = create<PromptStoreState>((set) => ({
  prompt: '',
  activeThreadId: TEMPORARY_CHAT_ID,
  drafts: {},
  setActiveThread: (threadId) => set((state) => {
    if (threadId === state.activeThreadId) return state
    return {
      activeThreadId: threadId,
      prompt: state.drafts[threadId] ?? '',
      drafts: { ...state.drafts, [state.activeThreadId]: state.prompt },
    }
  }),
  setPrompt: (value) => set((state) => ({
    prompt: value,
    drafts: { ...state.drafts, [state.activeThreadId]: value },
  })),
  resetPrompt: (threadId) => set((state) => {
    const key = threadId ?? state.activeThreadId
    return {
      ...(key === state.activeThreadId ? { prompt: '' } : {}),
      drafts: { ...state.drafts, [key]: '' },
    }
  }),
}))

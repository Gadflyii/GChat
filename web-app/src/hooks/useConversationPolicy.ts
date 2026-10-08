import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { localStorageKey } from '@/constants/localStorage'

export type ConversationApprovalMode = 'manual' | 'skip'
export type ConversationWorkspaceRoot = {
  rootId: string
  path: string
  name: string
  canEdit: boolean
}
export type ConversationWorkspace = {
  primaryRoot?: ConversationWorkspaceRoot
  externalRoots: ConversationWorkspaceRoot[]
}

type ConversationPolicyState = {
  /** Historical provenance only; never selects a view or execution route. */
  legacyAgentThreads: Record<string, boolean>
  activeDefinitions: Record<string, string>
  setActiveDefinition: (threadId: string, definition?: string) => void
  activeSkills: Record<string, string>
  setActiveSkill: (threadId: string, skill?: string) => void
  approvalModes: Record<string, ConversationApprovalMode>
  defaultApprovalMode: ConversationApprovalMode
  workspaces: Record<string, ConversationWorkspace>

  getApprovalMode: (threadId: string) => ConversationApprovalMode
  getWorkingDir: (threadId: string) => string | undefined
  getWorkspace: (threadId: string) => ConversationWorkspace
  setPrimaryRoot: (threadId: string, root: ConversationWorkspaceRoot) => void
  addExternalRoot: (threadId: string, root: ConversationWorkspaceRoot) => void
  setExternalRootPermission: (
    threadId: string,
    rootId: string,
    canEdit: boolean
  ) => void
  removeExternalRoot: (threadId: string, rootId: string) => void
  setApprovalMode: (threadId: string, mode: ConversationApprovalMode) => void
  setDefaultApprovalMode: (mode: ConversationApprovalMode) => void
  setWorkingDir: (threadId: string, workingDir: string) => void
  transferPolicy: (fromThreadId: string, toThreadId: string) => void
  removeThread: (threadId: string) => void
  /** Clear conversation permissions and selections. */
  clearAll: () => void
}

export const useConversationPolicy = create<ConversationPolicyState>()(
  persist(
    (set, get) => ({
      legacyAgentThreads: {},
      activeDefinitions: {},
      setActiveDefinition: (threadId, definition) => set((state) => {
        const activeDefinitions = { ...state.activeDefinitions }
        if (definition && definition !== 'general') activeDefinitions[threadId] = definition
        else delete activeDefinitions[threadId]
        return { activeDefinitions }
      }),
      activeSkills: {},
      setActiveSkill: (threadId, skill) => set((state) => {
        const activeSkills = { ...state.activeSkills }
        if (skill) activeSkills[threadId] = skill
        else delete activeSkills[threadId]
        return { activeSkills }
      }),
      approvalModes: {},
      defaultApprovalMode: 'manual',
      workspaces: {},

      getApprovalMode: (threadId) => {
        return get().approvalModes[threadId] ?? get().defaultApprovalMode
      },

      getWorkingDir: (threadId) => {
        return get().workspaces[threadId]?.primaryRoot?.path
      },

      getWorkspace: (threadId) => {
        return get().workspaces[threadId] ?? { externalRoots: [] }
      },

      setPrimaryRoot: (threadId, root) => {
        set((state) => ({
          workspaces: {
            ...state.workspaces,
            [threadId]: {
              ...(state.workspaces[threadId] ?? { externalRoots: [] }),
              primaryRoot: root,
              externalRoots: (
                state.workspaces[threadId]?.externalRoots ?? []
              ).filter((item) => item.rootId !== root.rootId),
            },
          },
        }))
      },

      addExternalRoot: (threadId, root) => {
        set((state) => {
          const workspace = state.workspaces[threadId] ?? { externalRoots: [] }
          if (
            workspace.primaryRoot?.rootId === root.rootId ||
            workspace.externalRoots.some((item) => item.rootId === root.rootId)
          ) {
            return state
          }
          return {
            workspaces: {
              ...state.workspaces,
              [threadId]: {
                ...workspace,
                externalRoots: [...workspace.externalRoots, root],
              },
            },
          }
        })
      },

      setExternalRootPermission: (threadId, rootId, canEdit) => {
        set((state) => {
          const workspace = state.workspaces[threadId]
          if (!workspace) return state
          return {
            workspaces: {
              ...state.workspaces,
              [threadId]: {
                ...workspace,
                externalRoots: workspace.externalRoots.map((root) =>
                  root.rootId === rootId ? { ...root, canEdit } : root
                ),
              },
            },
          }
        })
      },

      removeExternalRoot: (threadId, rootId) => {
        set((state) => {
          const workspace = state.workspaces[threadId]
          if (!workspace) return state
          return {
            workspaces: {
              ...state.workspaces,
              [threadId]: {
                ...workspace,
                externalRoots: workspace.externalRoots.filter(
                  (root) => root.rootId !== rootId
                ),
              },
            },
          }
        })
      },

      setApprovalMode: (threadId, mode) => {
        set((state) => ({
          approvalModes: {
            ...state.approvalModes,
            [threadId]: mode,
          },
        }))
      },

      setDefaultApprovalMode: (mode) => set({ defaultApprovalMode: mode }),

      setWorkingDir: (threadId, workingDir) => {
        set((state) => ({
          workspaces: {
            ...state.workspaces,
            [threadId]: {
              ...(state.workspaces[threadId] ?? { externalRoots: [] }),
              primaryRoot: {
                rootId: `legacy:${workingDir}`,
                path: workingDir,
                name:
                  workingDir.split(/[\\/]/).filter(Boolean).at(-1) ??
                  workingDir,
                canEdit: true,
              },
            },
          },
        }))
      },

      transferPolicy: (fromThreadId, toThreadId) => {
        set((state) => {
          const approvalMode = state.approvalModes[fromThreadId]
          const workspace = state.workspaces[fromThreadId]
          const activeDefinitions = { ...state.activeDefinitions }
          const definition = activeDefinitions[fromThreadId]
          delete activeDefinitions[fromThreadId]
          delete activeDefinitions[toThreadId]
          if (definition) activeDefinitions[toThreadId] = definition
          const activeSkills = { ...state.activeSkills }
          const skill = activeSkills[fromThreadId]
          delete activeSkills[fromThreadId]
          delete activeSkills[toThreadId]
          if (skill) activeSkills[toThreadId] = skill
          const remainingApprovalModes = { ...state.approvalModes }
          const remainingWorkspaces = { ...state.workspaces }
          delete remainingApprovalModes[fromThreadId]
          delete remainingApprovalModes[toThreadId]
          delete remainingWorkspaces[fromThreadId]
          delete remainingWorkspaces[toThreadId]

          return {
            activeSkills,
            activeDefinitions,
            approvalModes: approvalMode !== undefined
              ? { ...remainingApprovalModes, [toThreadId]: approvalMode }
              : remainingApprovalModes,
            workspaces:
              workspace
                ? { ...remainingWorkspaces, [toThreadId]: workspace }
                : remainingWorkspaces,
          }
        })
      },

      removeThread: (threadId) => {
        set((state) => {
          const legacyAgentThreads = { ...state.legacyAgentThreads }
          const activeDefinitions = { ...state.activeDefinitions }
          delete activeDefinitions[threadId]
          const activeSkills = { ...state.activeSkills }
          delete activeSkills[threadId]
          const approvalModes = { ...state.approvalModes }
          const workspaces = { ...state.workspaces }
          delete legacyAgentThreads[threadId]
          delete approvalModes[threadId]
          delete workspaces[threadId]
          return { legacyAgentThreads, activeDefinitions, approvalModes, workspaces, activeSkills }
        })
      },

      clearAll: () => {
        set({
          activeSkills: {},
          legacyAgentThreads: {},
          activeDefinitions: {},
          approvalModes: {},
          workspaces: {},
        })
      },
    }),
    {
      name: localStorageKey.conversationPolicy,
      storage: createJSONStorage(() => localStorage),
      version: 3,
      migrate: (persistedState: unknown, version) => {
        const state = (persistedState ?? {}) as Record<string, unknown>
        let workspaces = state.workspaces as
          | Record<string, ConversationWorkspace>
          | undefined
        if (version < 1 && state.workingDirs) {
          const workingDirs = state.workingDirs as Record<string, string>
          workspaces = Object.fromEntries(
            Object.entries(workingDirs).map(([threadId, path]) => [
              threadId,
              {
                primaryRoot: {
                  rootId: `legacy:${path}`,
                  path,
                  name: path.split(/[\\/]/).filter(Boolean).at(-1) ?? path,
                  canEdit: true,
                },
                externalRoots: [],
              },
            ])
          )
        }
        return {
          legacyAgentThreads: state.legacyAgentThreads ?? state.agentThreads ?? {},
          activeSkills: state.activeSkills ?? {},
          activeDefinitions: state.activeDefinitions ?? {},
          approvalModes: state.approvalModes ?? {},
          defaultApprovalMode: state.defaultApprovalMode ?? 'manual',
          workspaces: Object.fromEntries(
            Object.entries(workspaces ?? {}).map(([threadId, workspace]) => [
              threadId,
              {
                ...workspace,
                primaryRoot: workspace.primaryRoot
                  ? { ...workspace.primaryRoot, canEdit: workspace.primaryRoot.canEdit !== false }
                  : undefined,
                externalRoots: workspace.externalRoots.map((root) => ({
                  ...root,
                  canEdit: root.canEdit !== false,
                })),
              },
            ])
          ),
        }
      },
    }
  )
)

import { beforeEach, describe, expect, it } from 'vitest'
import { TEMPORARY_CHAT_ID } from '@/constants/chat'
import { localStorageKey } from '@/constants/localStorage'
import { useConversationPolicy } from '@/hooks/useConversationPolicy'

describe('useConversationPolicy', () => {
  beforeEach(() => {
    useConversationPolicy.getState().clearAll()
    useConversationPolicy.getState().setDefaultApprovalMode('manual')
  })

  it('shares the default approval mode across ordinary Chat and Agent threads while preserving overrides', async () => {
    useConversationPolicy.getState().setDefaultApprovalMode('skip')
    expect(useConversationPolicy.getState().getApprovalMode('chat-thread')).toBe('skip')
    expect(useConversationPolicy.getState().getApprovalMode('agent-thread')).toBe('skip')

    useConversationPolicy.getState().setApprovalMode('chat-thread', 'manual')
    expect(useConversationPolicy.getState().getApprovalMode('chat-thread')).toBe('manual')
    expect(useConversationPolicy.getState().getApprovalMode('agent-thread')).toBe('skip')

    await useConversationPolicy.persist.rehydrate()
    expect(useConversationPolicy.getState().defaultApprovalMode).toBe('skip')
    expect(useConversationPolicy.getState().getApprovalMode('chat-thread')).toBe('manual')
  })

  it('keeps a main-chat skill and workspace through creation, reopening, and exit', async () => {
    useConversationPolicy.getState().setActiveSkill(TEMPORARY_CHAT_ID, 'agent-builder')
    useConversationPolicy.getState().setApprovalMode(TEMPORARY_CHAT_ID, 'skip')
    useConversationPolicy.getState().setWorkingDir(TEMPORARY_CHAT_ID, '/workspace')
    useConversationPolicy.getState().transferPolicy(TEMPORARY_CHAT_ID, 'skill-thread')

    expect(useConversationPolicy.getState().activeSkills['skill-thread']).toBe('agent-builder')
    expect(useConversationPolicy.getState().getApprovalMode('skill-thread')).toBe('skip')
    expect(useConversationPolicy.getState().getWorkingDir('skill-thread')).toBe('/workspace')
    expect(useConversationPolicy.getState().activeSkills[TEMPORARY_CHAT_ID]).toBeUndefined()
    expect(useConversationPolicy.getState().approvalModes[TEMPORARY_CHAT_ID]).toBeUndefined()
    await useConversationPolicy.persist.rehydrate()
    expect(useConversationPolicy.getState().activeSkills['skill-thread']).toBe('agent-builder')
    expect(useConversationPolicy.getState().getApprovalMode('skill-thread')).toBe('skip')
    expect(useConversationPolicy.getState().getWorkingDir('skill-thread')).toBe('/workspace')

    useConversationPolicy.getState().setActiveSkill('skill-thread')
  })

  it('transfers an explicit manual choice for a Chat skill without enabling Agent view', () => {
    useConversationPolicy.getState().setActiveSkill(TEMPORARY_CHAT_ID, 'agent-builder')
    useConversationPolicy.getState().setApprovalMode(TEMPORARY_CHAT_ID, 'manual')
    useConversationPolicy.getState().setApprovalMode('skill-thread', 'skip')

    useConversationPolicy.getState().transferPolicy(TEMPORARY_CHAT_ID, 'skill-thread')

    expect(useConversationPolicy.getState().approvalModes['skill-thread']).toBe('manual')
  })

  it('keeps ordinary Chat approval and connected folders when creating its thread', () => {
    useConversationPolicy.getState().setDefaultApprovalMode('manual')
    useConversationPolicy.getState().setApprovalMode(TEMPORARY_CHAT_ID, 'skip')
    useConversationPolicy.getState().setWorkingDir(TEMPORARY_CHAT_ID, '/workspace')
    useConversationPolicy.getState().addExternalRoot(TEMPORARY_CHAT_ID, {
      rootId: 'notes', path: '/notes', name: 'notes', canEdit: false,
    })

    useConversationPolicy.getState().transferPolicy(TEMPORARY_CHAT_ID, 'chat-thread')

    expect(useConversationPolicy.getState().approvalModes['chat-thread']).toBe('skip')
    expect(useConversationPolicy.getState().getWorkspace('chat-thread')).toEqual({
      primaryRoot: {
        rootId: 'legacy:/workspace', path: '/workspace', name: 'workspace', canEdit: true,
      },
      externalRoots: [{ rootId: 'notes', path: '/notes', name: 'notes', canEdit: false }],
    })
  })

  it('moves primary and external roots from Home to the created thread', () => {
    useConversationPolicy.getState().setPrimaryRoot(TEMPORARY_CHAT_ID, {
      rootId: 'primary',
      path: '/workspace',
      name: 'workspace',
      canEdit: true,
    })
    useConversationPolicy.getState().addExternalRoot(TEMPORARY_CHAT_ID, {
      rootId: 'desktop',
      path: '/Desktop',
      name: 'Desktop',
      canEdit: true,
    })

    useConversationPolicy.getState().transferPolicy(TEMPORARY_CHAT_ID, 'thread-1')

    expect(useConversationPolicy.getState().getWorkspace('thread-1')).toEqual({
      primaryRoot: {
        rootId: 'primary',
        path: '/workspace',
        name: 'workspace',
        canEdit: true,
      },
      externalRoots: [
        {
          rootId: 'desktop',
          path: '/Desktop',
          name: 'Desktop',
          canEdit: true,
        },
      ],
    })
    expect(useConversationPolicy.getState().getWorkspace(TEMPORARY_CHAT_ID)).toEqual({
      externalRoots: [],
    })
  })

  it('deduplicates external roots and excludes the primary root', () => {
    const root = {
      rootId: 'shared',
      path: '/shared',
      name: 'shared',
      canEdit: true as const,
    }
    useConversationPolicy.getState().addExternalRoot('thread-1', root)
    useConversationPolicy.getState().addExternalRoot('thread-1', root)

    expect(
      useConversationPolicy.getState().getWorkspace('thread-1').externalRoots
    ).toEqual([root])

    useConversationPolicy.getState().setPrimaryRoot('thread-1', root)
    expect(
      useConversationPolicy.getState().getWorkspace('thread-1').externalRoots
    ).toEqual([])
  })

  it('changes external root permission and removes the root', () => {
    const root = {
      rootId: 'downloads',
      path: '/Downloads',
      name: 'Downloads',
      canEdit: true,
    }
    useConversationPolicy.getState().addExternalRoot('thread-1', root)

    useConversationPolicy
      .getState()
      .setExternalRootPermission('thread-1', root.rootId, false)

    expect(
      useConversationPolicy.getState().getWorkspace('thread-1').externalRoots
    ).toEqual([{ ...root, canEdit: false }])

    useConversationPolicy.getState().removeExternalRoot('thread-1', root.rootId)

    expect(
      useConversationPolicy.getState().getWorkspace('thread-1').externalRoots
    ).toEqual([])
  })

  it('preserves real v2 history provenance, selected skills, approval overrides and explicit folder denials across restart', async () => {
    const workspace = { primaryRoot: { rootId: 'p', path: 'C:\\Workspace', name: 'Workspace', canEdit: true }, externalRoots: [{ rootId: 'desktop', path: 'C:\\Users\\Ron\\Desktop', name: 'Desktop', canEdit: false }] }
    localStorage.setItem(localStorageKey.conversationPolicy, JSON.stringify({ version: 2, state: {
      agentThreads: { 'saved-agent': true }, sidebarMode: 'agent',
      activeSkills: { 'saved-agent': 'agent-builder' }, defaultApprovalMode: 'skip',
      approvalModes: { 'saved-agent': 'manual' }, workspaces: { 'saved-agent': workspace },
    } }))
    await useConversationPolicy.persist.rehydrate()
    expect(useConversationPolicy.getState().legacyAgentThreads).toEqual({ 'saved-agent': true })
    expect(useConversationPolicy.getState().getWorkspace('saved-agent')).toEqual(workspace)
    expect(useConversationPolicy.getState().getApprovalMode('saved-agent')).toBe('manual')
    expect(useConversationPolicy.getState().getApprovalMode('ordinary-chat')).toBe('skip')
    expect(useConversationPolicy.getState().activeSkills['saved-agent']).toBe('agent-builder')
    const persisted = JSON.parse(localStorage.getItem(localStorageKey.conversationPolicy)!)
    expect(persisted.version).toBe(3)
    expect(persisted.state.sidebarMode).toBeUndefined()
    expect(persisted.state.agentThreads).toBeUndefined()
    useConversationPolicy.getState().setActiveDefinition('saved-agent', 'researcher')
    await useConversationPolicy.persist.rehydrate()
    expect(useConversationPolicy.getState().activeDefinitions['saved-agent']).toBe('researcher')
  })

  it('migrates external roots to editable by default', async () => {
    localStorage.setItem(
      localStorageKey.conversationPolicy,
      JSON.stringify({
        state: {
          agentThreads: { 'thread-1': true },
          approvalModes: {},
          workspaces: {
            'thread-1': {
              externalRoots: [
                {
                  rootId: 'downloads',
                  path: '/Downloads',
                  name: 'Downloads',
                },
              ],
            },
          },
          sidebarMode: 'agent',
        },
        version: 1,
      })
    )

    await useConversationPolicy.persist.rehydrate()

    expect(
      useConversationPolicy.getState().getWorkspace('thread-1').externalRoots
    ).toEqual([
      {
        rootId: 'downloads',
        path: '/Downloads',
        name: 'Downloads',
        canEdit: true,
      },
    ])
  })

  it('migrates persisted working directories into primary roots', async () => {
    localStorage.setItem(
      localStorageKey.conversationPolicy,
      JSON.stringify({
        state: {
          agentThreads: { 'thread-1': true },
          approvalModes: {},
          workingDirs: { 'thread-1': '/legacy/workspace' },
          sidebarMode: 'agent',
        },
        version: 0,
      })
    )

    await useConversationPolicy.persist.rehydrate()

    expect(useConversationPolicy.getState().getWorkspace('thread-1')).toEqual({
      primaryRoot: {
        rootId: 'legacy:/legacy/workspace',
        path: '/legacy/workspace',
        name: 'workspace',
        canEdit: true,
      },
      externalRoots: [],
    })
  })
})

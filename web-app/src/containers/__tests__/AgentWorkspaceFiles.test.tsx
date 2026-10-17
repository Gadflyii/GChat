import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AgentWorkspaceFiles } from '../AgentWorkspaceFiles'
import type { ConversationWorkspace } from '@/hooks/useConversationPolicy'
import type { AgentWorkspaceEntry } from '@/types/agent'
import { useWorkspacePreviewStore } from '@/stores/workspace-preview-store'

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  resolve: vi.fn(),
  reveal: vi.fn(),
}))

vi.mock('@/services/agent/tauri', () => ({
  listAgentWorkspace: mocks.list,
  resolveAgentWorkspacePath: mocks.resolve,
}))
vi.mock('@/hooks/useServiceHub', () => ({
  useServiceHub: () => ({ opener: () => ({ revealItemInDir: mocks.reveal }) }),
}))
vi.mock('@/i18n/react-i18next-compat', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((done, fail) => {
    resolve = done
    reject = fail
  })
  return { promise, resolve, reject }
}

function workspace(path: string): ConversationWorkspace {
  return {
    primaryRoot: { rootId: 'primary', path, name: 'Project', canEdit: true },
    externalRoots: [],
  }
}

function entry(path: string, kind: 'file' | 'directory' = 'file'): AgentWorkspaceEntry {
  return { name: path.split('/').at(-1)!, path, kind }
}

function files(workspace: ConversationWorkspace) {
  return (
    <AgentWorkspaceFiles
      threadId="thread"
      workspace={workspace}
      refreshKey={0}
      isGenerating={false}
      onClose={() => undefined}
      onAddExternal={() => undefined}
    />
  )
}

async function complete(
  request: ReturnType<typeof deferred<AgentWorkspaceEntry[]>>,
  entries: AgentWorkspaceEntry[]
) {
  await act(async () => {
    request.resolve(entries)
    await request.promise
  })
}

afterEach(cleanup)
beforeEach(() => {
  vi.resetAllMocks()
  useWorkspacePreviewStore.getState().reset()
})

describe('Agent workspace directory request lifetime', () => {
  it('keeps refreshed files and their preview path when the initial read finishes later', async () => {
    const initial = deferred<AgentWorkspaceEntry[]>()
    const refreshed = deferred<AgentWorkspaceEntry[]>()
    mocks.list
      .mockReturnValueOnce(initial.promise)
      .mockReturnValueOnce(refreshed.promise)
    render(files(workspace('/workspace/original')))

    fireEvent.click(screen.getByRole('button', { name: 'common:refresh' }))
    expect(screen.getByRole('button', { name: 'common:refresh' })).toBeDisabled()
    await complete(refreshed, [entry('fresh.txt')])
    expect(screen.getByRole('button', { name: 'common:refresh' })).toBeEnabled()
    fireEvent.click(screen.getByRole('button', { name: 'Expand Project' }))
    expect(screen.getByRole('button', { name: 'fresh.txt' })).toBeVisible()

    await complete(initial, [entry('stale.txt')])
    expect(screen.getByRole('button', { name: 'fresh.txt' })).toBeVisible()
    expect(screen.queryByRole('button', { name: 'stale.txt' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Collapse Project' })).toBeVisible()

    fireEvent.click(screen.getByRole('button', { name: 'fresh.txt' }))
    expect(useWorkspacePreviewStore.getState().tabs).toEqual([
      {
        id: 'file:primary:fresh.txt',
        kind: 'file',
        rootId: 'primary',
        rootPath: '/workspace/original',
        relativePath: 'fresh.txt',
        name: 'fresh.txt',
      },
    ])
  })

  it('ignores an obsolete error while current read errors remain visible and retryable', async () => {
    const initial = deferred<AgentWorkspaceEntry[]>()
    const refreshed = deferred<AgentWorkspaceEntry[]>()
    mocks.list
      .mockReturnValueOnce(initial.promise)
      .mockReturnValueOnce(refreshed.promise)
      .mockRejectedValueOnce(new Error('Current directory denied'))
      .mockResolvedValueOnce([entry('recovered.txt')])
    render(files(workspace('/workspace/original')))
    fireEvent.click(screen.getByRole('button', { name: 'common:refresh' }))
    await complete(refreshed, [entry('current.txt')])
    fireEvent.click(screen.getByRole('button', { name: 'Expand Project' }))

    await act(async () => {
      initial.reject(new Error('Obsolete directory denied'))
      await initial.promise.catch(() => undefined)
    })
    expect(screen.getByRole('button', { name: 'current.txt' })).toBeVisible()
    expect(screen.queryByText('Could not load this directory.')).not.toBeInTheDocument()

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'common:refresh' }))
    })
    expect(screen.getByText('Could not load this directory.')).toHaveAttribute(
      'title',
      'Error: Current directory denied'
    )
    expect(screen.queryByRole('button', { name: 'current.txt' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'common:refresh' })).toBeEnabled()

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'common:refresh' }))
    })
    expect(screen.getByRole('button', { name: 'recovered.txt' })).toBeVisible()
    expect(screen.queryByText('Could not load this directory.')).not.toBeInTheDocument()
  })

  it('keeps the new root files when a previous path with the same root ID finishes later', async () => {
    const oldRoot = deferred<AgentWorkspaceEntry[]>()
    const newRoot = deferred<AgentWorkspaceEntry[]>()
    mocks.list
      .mockReturnValueOnce(oldRoot.promise)
      .mockReturnValueOnce(newRoot.promise)
    const view = render(files(workspace('/workspace/old')))
    view.rerender(files(workspace('/workspace/new')))

    await complete(newRoot, [entry('current.txt')])
    expect(screen.getByRole('button', { name: 'current.txt' })).toBeVisible()
    await complete(oldRoot, [entry('obsolete.txt')])
    expect(screen.getByRole('button', { name: 'current.txt' })).toBeVisible()
    expect(screen.queryByRole('button', { name: 'obsolete.txt' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'current.txt' }))
    expect(useWorkspacePreviewStore.getState().tabs).toEqual([
      expect.objectContaining({
        kind: 'file',
        rootId: 'primary',
        rootPath: '/workspace/new',
        relativePath: 'current.txt',
      }),
    ])
  })

  it('does not expand a new workspace with an old pending child read', async () => {
    const oldChild = deferred<AgentWorkspaceEntry[]>()
    const newChild = deferred<AgentWorkspaceEntry[]>()
    mocks.list
      .mockResolvedValueOnce([entry('docs', 'directory')])
      .mockReturnValueOnce(oldChild.promise)
      .mockResolvedValueOnce([entry('docs', 'directory')])
      .mockReturnValueOnce(newChild.promise)
    const view = render(files(workspace('/workspace/old')))
    fireEvent.click(await screen.findByRole('button', { name: 'docs' }))

    view.rerender(files(workspace('/workspace/new')))
    expect(await screen.findByRole('button', { name: 'docs' })).toBeVisible()
    await complete(oldChild, [entry('docs/old.txt')])
    expect(screen.queryByRole('button', { name: 'old.txt' })).not.toBeInTheDocument()
    expect(screen.queryByText('Loading…')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'docs' }))
    expect(mocks.list).toHaveBeenLastCalledWith({
      rootId: 'primary',
      rootPath: '/workspace/new',
      relativePath: 'docs',
    })
    await complete(newChild, [entry('docs/new.txt')])
    expect(screen.getByRole('button', { name: 'new.txt' })).toBeVisible()
    expect(screen.queryByRole('button', { name: 'old.txt' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'new.txt' }))
    expect(useWorkspacePreviewStore.getState().tabs).toEqual([
      expect.objectContaining({
        kind: 'file',
        rootPath: '/workspace/new',
        relativePath: 'docs/new.txt',
      }),
    ])
  })
})

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react'
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

describe('Agent workspace empty folder feedback', () => {
  it('automatically opens empty project and external roots with their own labels and paths', async () => {
    const roots = workspace('/workspace/project')
    roots.externalRoots = [
      {
        rootId: 'reference',
        path: '/reference/manuals',
        name: 'Manuals',
        canEdit: false,
      },
    ]
    mocks.list.mockResolvedValue([])
    render(files(roots))

    expect(await screen.findAllByRole('status')).toHaveLength(2)
    const project = screen.getByRole('button', { name: 'Collapse Project' })
    const external = screen.getByRole('button', { name: 'Collapse Manuals' })
    expect(project).toHaveAttribute('title', '/workspace/project')
    expect(external).toHaveAttribute('title', '/reference/manuals')
    expect(project).toHaveAttribute('aria-expanded', 'true')
    expect(external).toHaveAttribute('aria-expanded', 'true')
    expect(
      within(project.closest('section')!).getByRole('status')
    ).toHaveTextContent('This folder is empty.')
    expect(
      within(external.closest('section')!).getByRole('status')
    ).toHaveTextContent('This folder is empty.')
    expect(external).toHaveTextContent('agentWorkspace.viewOnly')
    expect(mocks.list).toHaveBeenNthCalledWith(1, {
      rootId: 'primary',
      rootPath: '/workspace/project',
      relativePath: undefined,
    })
    expect(mocks.list).toHaveBeenNthCalledWith(2, {
      rootId: 'reference',
      rootPath: '/reference/manuals',
      relativePath: undefined,
    })
  })

  it('opens an empty nested folder and reuses its result after collapsing and reopening', async () => {
    const child = deferred<AgentWorkspaceEntry[]>()
    mocks.list
      .mockResolvedValueOnce([entry('docs', 'directory')])
      .mockReturnValueOnce(child.promise)
    render(files(workspace('/workspace/project')))

    fireEvent.click(await screen.findByRole('button', { name: 'docs' }))
    expect(mocks.list).toHaveBeenLastCalledWith({
      rootId: 'primary',
      rootPath: '/workspace/project',
      relativePath: 'docs',
    })
    await complete(child, [])
    expect(screen.getByRole('status')).toHaveTextContent('This folder is empty.')
    expect(screen.getByRole('button', { name: 'docs' })).toHaveAttribute(
      'aria-expanded',
      'true'
    )

    fireEvent.click(screen.getByRole('button', { name: 'docs' }))
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'docs' })).toHaveAttribute(
      'aria-expanded',
      'false'
    )
    fireEvent.click(screen.getByRole('button', { name: 'docs' }))
    expect(screen.getByRole('status')).toHaveTextContent('This folder is empty.')
    expect(screen.getByRole('button', { name: 'docs' })).toHaveAttribute(
      'aria-expanded',
      'true'
    )
    expect(screen.getByRole('button', { name: 'Collapse Project' })).toBeVisible()
    expect(mocks.list).toHaveBeenCalledTimes(2)
  })

  it('replaces previously listed files with an empty folder message after refresh', async () => {
    const refreshed = deferred<AgentWorkspaceEntry[]>()
    mocks.list
      .mockResolvedValueOnce([entry('removed.txt')])
      .mockReturnValueOnce(refreshed.promise)
    render(files(workspace('/workspace/project')))
    expect(await screen.findByRole('button', { name: 'removed.txt' })).toBeVisible()

    fireEvent.click(screen.getByRole('button', { name: 'common:refresh' }))
    await complete(refreshed, [])

    expect(screen.getByRole('status')).toHaveTextContent('This folder is empty.')
    expect(
      screen.queryByRole('button', { name: 'removed.txt' })
    ).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Collapse Project' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'common:refresh' })).toBeEnabled()
    expect(mocks.list).toHaveBeenLastCalledWith({
      rootId: 'primary',
      rootPath: '/workspace/project',
      relativePath: undefined,
    })
  })

  it('shows loading instead of a cached empty result while the folder refresh is pending', async () => {
    const refreshed = deferred<AgentWorkspaceEntry[]>()
    mocks.list
      .mockResolvedValueOnce([])
      .mockReturnValueOnce(refreshed.promise)
    render(files(workspace('/workspace/project')))
    expect(await screen.findByRole('status')).toHaveTextContent(
      'This folder is empty.'
    )

    fireEvent.click(screen.getByRole('button', { name: 'common:refresh' }))
    expect(screen.getByText('Loading…')).toBeVisible()
    expect(screen.queryByText('This folder is empty.')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'common:refresh' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Collapse Project' })).toBeVisible()

    await complete(refreshed, [])
    expect(screen.queryByText('Loading…')).not.toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('This folder is empty.')
    expect(screen.getByRole('button', { name: 'common:refresh' })).toBeEnabled()
  })
})

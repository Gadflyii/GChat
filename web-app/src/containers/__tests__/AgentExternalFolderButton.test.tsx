import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AgentExternalFolderButton } from '../AgentExternalFolderButton'
import { useConversationPolicy } from '@/hooks/useConversationPolicy'

const mocks = vi.hoisted(() => ({
  open: vi.fn(),
  resolve: vi.fn(),
  error: vi.fn(),
}))

vi.mock('@/hooks/useServiceHub', () => ({
  useServiceHub: () => ({ dialog: () => ({ open: mocks.open }) }),
}))
vi.mock('@/services/agent/tauri', () => ({
  resolveConversationWorkspaceRoot: mocks.resolve,
}))
vi.mock('@/i18n/react-i18next-compat', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))
vi.mock('sonner', () => ({ toast: { error: mocks.error } }))

const workspaceKey = 'conversation'
const existingRoot = {
  rootId: 'existing',
  path: '/existing',
  name: 'Existing folder',
  canEdit: false,
}
const initialWorkspaces = {
  [workspaceKey]: { externalRoots: [existingRoot] },
  other: { externalRoots: [] },
}
const resolvedRoot = {
  rootId: 'resolved-external',
  path: '/actual/external-folder',
  name: 'External folder',
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

function expectFolderAdded() {
  expect(useConversationPolicy.getState().workspaces).toEqual({
    ...initialWorkspaces,
    [workspaceKey]: {
      externalRoots: [existingRoot, { ...resolvedRoot, canEdit: true }],
    },
  })
}

afterEach(cleanup)
beforeEach(() => {
  vi.resetAllMocks()
  useConversationPolicy.setState({ workspaces: initialWorkspaces })
})

describe('Agent external folder button', () => {
  it('stays busy through picking and resolving, prevents duplicate clicks, and adds the resolved root once', async () => {
    const picker = deferred<string | null>()
    const resolution = deferred<typeof resolvedRoot>()
    mocks.open.mockReturnValueOnce(picker.promise)
    mocks.resolve.mockReturnValueOnce(resolution.promise)
    const onAdded = vi.fn()
    render(
      <AgentExternalFolderButton workspaceKey={workspaceKey} onAdded={onAdded} />
    )
    const button = screen.getByRole('button', {
      name: 'agentWorkspace.addFolder',
    })
    expect(button).toBeEnabled()

    fireEvent.click(button)
    expect(button).toBeDisabled()
    expect(button).toHaveAttribute('aria-busy', 'true')
    fireEvent.click(button)
    expect(mocks.open).toHaveBeenCalledOnce()
    expect(useConversationPolicy.getState().workspaces).toEqual(initialWorkspaces)

    await act(async () => {
      picker.resolve('/selected-link')
      await picker.promise
    })
    expect(mocks.resolve).toHaveBeenCalledWith('/selected-link')
    expect(button).toBeDisabled()
    expect(button).toHaveAttribute('aria-busy', 'true')
    fireEvent.click(button)
    expect(mocks.open).toHaveBeenCalledOnce()
    expect(mocks.resolve).toHaveBeenCalledOnce()
    expect(useConversationPolicy.getState().workspaces).toEqual(initialWorkspaces)
    expect(onAdded).not.toHaveBeenCalled()

    await act(async () => {
      resolution.resolve(resolvedRoot)
      await resolution.promise
    })
    expectFolderAdded()
    expect(button).toBeEnabled()
    expect(button).not.toHaveAttribute('aria-busy', 'true')
    expect(onAdded).toHaveBeenCalledOnce()
    expect(mocks.error).not.toHaveBeenCalled()
  })

  it('leaves existing folders unchanged when the picker is cancelled', async () => {
    mocks.open.mockResolvedValueOnce(null)
    const onAdded = vi.fn()
    render(
      <AgentExternalFolderButton workspaceKey={workspaceKey} onAdded={onAdded} />
    )
    const button = screen.getByRole('button', {
      name: 'agentWorkspace.addFolder',
    })

    await act(async () => {
      fireEvent.click(button)
    })

    expect(useConversationPolicy.getState().workspaces).toEqual(initialWorkspaces)
    expect(button).toBeEnabled()
    expect(button).not.toHaveAttribute('aria-busy', 'true')
    expect(mocks.resolve).not.toHaveBeenCalled()
    expect(mocks.error).not.toHaveBeenCalled()
    expect(onAdded).not.toHaveBeenCalled()
  })

  it('reports picker failures without changing folders and allows retry', async () => {
    mocks.open
      .mockRejectedValueOnce(new Error('Picker permission denied'))
      .mockResolvedValueOnce('/selected-link')
    mocks.resolve.mockResolvedValueOnce(resolvedRoot)
    const onAdded = vi.fn()
    render(
      <AgentExternalFolderButton workspaceKey={workspaceKey} onAdded={onAdded} />
    )
    const button = screen.getByRole('button', {
      name: 'agentWorkspace.addFolder',
    })

    await act(async () => {
      fireEvent.click(button)
    })

    expect(mocks.error).toHaveBeenCalledWith('agentWorkspace.addFolderFailed', {
      description: expect.stringContaining('Picker permission denied'),
    })
    expect(useConversationPolicy.getState().workspaces).toEqual(initialWorkspaces)
    expect(button).toBeEnabled()
    expect(button).not.toHaveAttribute('aria-busy', 'true')
    expect(mocks.resolve).not.toHaveBeenCalled()
    expect(onAdded).not.toHaveBeenCalled()

    await act(async () => {
      fireEvent.click(button)
    })

    expectFolderAdded()
    expect(button).toBeEnabled()
    expect(onAdded).toHaveBeenCalledOnce()
    expect(mocks.error).toHaveBeenCalledOnce()
  })

  it('reports resolution failures without adding the picked path and allows retry', async () => {
    mocks.open.mockResolvedValue('/selected-link')
    mocks.resolve
      .mockRejectedValueOnce('The folder is unavailable')
      .mockResolvedValueOnce(resolvedRoot)
    const onAdded = vi.fn()
    render(
      <AgentExternalFolderButton workspaceKey={workspaceKey} onAdded={onAdded} />
    )
    const button = screen.getByRole('button', {
      name: 'agentWorkspace.addFolder',
    })

    await act(async () => {
      fireEvent.click(button)
    })

    expect(mocks.error).toHaveBeenCalledWith('agentWorkspace.addFolderFailed', {
      description: 'The folder is unavailable',
    })
    expect(useConversationPolicy.getState().workspaces).toEqual(initialWorkspaces)
    expect(button).toBeEnabled()
    expect(button).not.toHaveAttribute('aria-busy', 'true')
    expect(onAdded).not.toHaveBeenCalled()

    await act(async () => {
      fireEvent.click(button)
    })

    expectFolderAdded()
    expect(button).toBeEnabled()
    expect(onAdded).toHaveBeenCalledOnce()
    expect(mocks.error).toHaveBeenCalledOnce()
  })
})

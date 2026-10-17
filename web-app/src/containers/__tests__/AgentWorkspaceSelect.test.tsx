import { useState } from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AgentWorkspaceSelect } from '../AgentWorkspaceSelect'

const mocks = vi.hoisted(() => ({
  dataFolder: vi.fn(),
  join: vi.fn(),
  open: vi.fn(),
  error: vi.fn(),
}))

vi.mock('@gchat/core', () => ({
  getJanDataFolderPath: mocks.dataFolder,
}))
vi.mock('@/hooks/useServiceHub', () => ({
  useServiceHub: () => ({
    path: () => ({ join: mocks.join }),
    dialog: () => ({ open: mocks.open }),
  }),
}))
vi.mock('@/i18n/react-i18next-compat', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))
vi.mock('sonner', () => ({ toast: { error: mocks.error } }))

function WorkspaceSelection({ initialPath }: { initialPath?: string }) {
  const [workingDir, setWorkingDir] = useState(initialPath)
  return (
    <>
      <AgentWorkspaceSelect workingDir={workingDir} onChange={setWorkingDir} />
      <output aria-label="Selected workspace">
        {workingDir ?? 'Default workspace'}
      </output>
    </>
  )
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

afterEach(cleanup)
beforeEach(() => {
  vi.resetAllMocks()
  mocks.dataFolder.mockResolvedValue('/data')
  mocks.join.mockResolvedValue('/data/agent-workspace')
  mocks.open.mockResolvedValue(null)
})

describe('Agent workspace chooser', () => {
  it('stays busy through default-path resolution and picking, prevents duplicates, and displays the chosen workspace', async () => {
    const dataFolder = deferred<string>()
    const joinedPath = deferred<string>()
    const selection = deferred<string | null>()
    mocks.dataFolder.mockReturnValueOnce(dataFolder.promise)
    mocks.join.mockReturnValueOnce(joinedPath.promise)
    mocks.open.mockReturnValueOnce(selection.promise)
    render(<WorkspaceSelection />)
    const button = screen.getByRole('button', {
      name: 'agentWorkspace.choose',
    })
    const selected = screen.getByLabelText('Selected workspace')
    expect(button).toBeEnabled()

    fireEvent.click(button)
    expect(button).toBeDisabled()
    expect(button).toHaveAttribute('aria-busy', 'true')
    fireEvent.click(button)
    expect(mocks.dataFolder).toHaveBeenCalledOnce()
    expect(mocks.open).not.toHaveBeenCalled()
    expect(selected).toHaveTextContent('Default workspace')

    await act(async () => {
      dataFolder.resolve('/data')
      await dataFolder.promise
    })
    expect(mocks.join).toHaveBeenCalledWith('/data', 'agent-workspace')
    expect(button).toBeDisabled()
    expect(button).toHaveAttribute('aria-busy', 'true')
    fireEvent.click(button)
    expect(mocks.dataFolder).toHaveBeenCalledOnce()
    expect(mocks.join).toHaveBeenCalledOnce()
    expect(mocks.open).not.toHaveBeenCalled()

    await act(async () => {
      joinedPath.resolve('/data/agent-workspace')
      await joinedPath.promise
    })
    expect(mocks.open).toHaveBeenCalledWith({
      multiple: false,
      directory: true,
      defaultPath: '/data/agent-workspace',
    })
    expect(button).toBeDisabled()
    expect(button).toHaveAttribute('aria-busy', 'true')
    fireEvent.click(button)
    expect(mocks.open).toHaveBeenCalledOnce()
    expect(selected).toHaveTextContent('Default workspace')

    await act(async () => {
      selection.resolve('/projects/chosen')
      await selection.promise
    })
    expect(selected).toHaveTextContent('/projects/chosen')
    expect(button).toHaveAccessibleName('agentWorkspace.change')
    expect(button).toHaveTextContent('chosen')
    expect(button).toHaveAttribute('title', '/projects/chosen')
    expect(button).toBeEnabled()
    expect(button).not.toHaveAttribute('aria-busy', 'true')
    expect(mocks.error).not.toHaveBeenCalled()
  })

  it('silently preserves the current workspace when the picker is cancelled', async () => {
    render(<WorkspaceSelection initialPath="/existing/project" />)
    const button = screen.getByRole('button', {
      name: 'agentWorkspace.change',
    })

    await act(async () => {
      fireEvent.click(button)
    })

    expect(screen.getByLabelText('Selected workspace')).toHaveTextContent(
      '/existing/project'
    )
    expect(button).toHaveAttribute('title', '/existing/project')
    expect(button).toBeEnabled()
    expect(button).not.toHaveAttribute('aria-busy', 'true')
    expect(mocks.open).toHaveBeenCalledWith({
      multiple: false,
      directory: true,
      defaultPath: '/existing/project',
    })
    expect(mocks.dataFolder).not.toHaveBeenCalled()
    expect(mocks.join).not.toHaveBeenCalled()
    expect(mocks.error).not.toHaveBeenCalled()
  })

  it('reports picker failure, preserves the selected workspace, and allows retry', async () => {
    mocks.open
      .mockRejectedValueOnce(new Error('Picker permission denied'))
      .mockResolvedValueOnce('/replacement/project')
    render(<WorkspaceSelection initialPath="/existing/project" />)
    const button = screen.getByRole('button', {
      name: 'agentWorkspace.change',
    })

    await act(async () => {
      fireEvent.click(button)
    })

    expect(mocks.error).toHaveBeenCalledWith('agentWorkspace.chooseFailed', {
      description: expect.stringContaining('Picker permission denied'),
    })
    expect(screen.getByLabelText('Selected workspace')).toHaveTextContent(
      '/existing/project'
    )
    expect(button).toBeEnabled()
    expect(button).not.toHaveAttribute('aria-busy', 'true')

    await act(async () => {
      fireEvent.click(button)
    })

    expect(screen.getByLabelText('Selected workspace')).toHaveTextContent(
      '/replacement/project'
    )
    expect(button).toHaveAttribute('title', '/replacement/project')
    expect(button).toBeEnabled()
    expect(mocks.error).toHaveBeenCalledOnce()
  })

  it.each(['data folder', 'path join'] as const)(
    'reports %s failure without opening the picker and allows retry',
    async (failure) => {
      const reason = 'Default workspace path is unavailable'
      const transport = failure === 'data folder' ? mocks.dataFolder : mocks.join
      transport.mockRejectedValueOnce(reason)
      mocks.open.mockResolvedValue('/projects/chosen')
      render(<WorkspaceSelection />)
      const button = screen.getByRole('button', {
        name: 'agentWorkspace.choose',
      })

      await act(async () => {
        fireEvent.click(button)
      })

      expect(mocks.error).toHaveBeenCalledWith('agentWorkspace.chooseFailed', {
        description: reason,
      })
      expect(mocks.open).not.toHaveBeenCalled()
      expect(screen.getByLabelText('Selected workspace')).toHaveTextContent(
        'Default workspace'
      )
      expect(button).toBeEnabled()
      expect(button).not.toHaveAttribute('aria-busy', 'true')

      await act(async () => {
        fireEvent.click(button)
      })

      expect(screen.getByLabelText('Selected workspace')).toHaveTextContent(
        '/projects/chosen'
      )
      expect(button).toHaveAccessibleName('agentWorkspace.change')
      expect(button).toBeEnabled()
      expect(mocks.error).toHaveBeenCalledOnce()
    }
  )
})

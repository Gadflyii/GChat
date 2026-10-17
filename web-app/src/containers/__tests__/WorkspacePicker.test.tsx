import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WorkspacePicker } from '../WorkspacePicker'
import { invoke } from '@tauri-apps/api/core'

const mocks = vi.hoisted(() => ({ resolve: vi.fn() }))

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))
vi.mock('@/services/agent/tauri', () => ({
  resolveConversationWorkspaceRoot: mocks.resolve,
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

async function complete<T>(request: ReturnType<typeof deferred<T>>, value: T) {
  await act(async () => {
    request.resolve(value)
    await request.promise
  })
}

const recentKey = 'gchat-recent-workspaces'

afterEach(cleanup)
beforeEach(() => {
  vi.resetAllMocks()
  localStorage.clear()
  mocks.resolve.mockImplementation(async (path?: string) => ({
    path: path ?? '/default-workspace',
  }))
})

it('shows the resolved default and allows opening it without typing a path', async () => {
  vi.mocked(invoke).mockResolvedValue(undefined)
  render(<WorkspacePicker value="" onChange={vi.fn()} />)
  expect(await screen.findByText('/default-workspace')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Open folder' }))
  expect(invoke).toHaveBeenCalledWith('open_file_explorer', {
    path: '/default-workspace',
  })
})

describe('Workspace folder Browse', () => {
  it('opens one native picker for rapid clicks and keeps Browse pending through canonical folder resolution', async () => {
    const dialog = deferred<string | null>()
    const folder = deferred<{ path: string }>()
    const onChange = vi.fn()
    vi.mocked(invoke).mockReturnValue(dialog.promise)
    mocks.resolve.mockImplementation(async (path?: string) =>
      path === '/selected/../project'
        ? folder.promise
        : { path: path ?? '/default-workspace' }
    )
    render(<WorkspacePicker value="/current" onChange={onChange} />)

    const browse = screen.getByRole('button', { name: 'Browse' })
    act(() => {
      browse.click()
      browse.click()
    })
    expect(invoke).toHaveBeenCalledTimes(1)
    expect(invoke).toHaveBeenCalledWith('open_dialog', {
      options: { directory: true, multiple: false },
    })
    expect(screen.getByRole('button', { name: 'Choosing folder…' })).toBeDisabled()
    expect(onChange).not.toHaveBeenCalled()

    await complete(dialog, '/selected/../project')
    expect(mocks.resolve).toHaveBeenCalledWith('/selected/../project')
    expect(screen.getByRole('button', { name: 'Choosing folder…' })).toBeDisabled()
    expect(onChange).not.toHaveBeenCalled()

    await complete(folder, { path: '/canonical/project' })
    expect(onChange).toHaveBeenCalledExactlyOnceWith('/canonical/project')
    expect(screen.getByRole('button', { name: 'Browse' })).toBeEnabled()
    expect(JSON.parse(localStorage.getItem(recentKey)!)).toEqual([
      '/canonical/project',
    ])
  })

  it('silently preserves the current folder and recents when the native picker is cancelled', async () => {
    const dialog = deferred<string | null>()
    const onChange = vi.fn()
    localStorage.setItem(recentKey, JSON.stringify(['/remembered']))
    vi.mocked(invoke).mockReturnValue(dialog.promise)
    render(<WorkspacePicker value="/current" onChange={onChange} />)

    fireEvent.click(screen.getByRole('button', { name: 'Browse' }))
    await complete(dialog, null)

    expect(screen.getByLabelText('Workspace')).toHaveValue('/current')
    expect(onChange).not.toHaveBeenCalled()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Browse' })).toBeEnabled()
    expect(JSON.parse(localStorage.getItem(recentKey)!)).toEqual(['/remembered'])
  })

  it('reports a native picker failure and clears it when Browse retries successfully', async () => {
    const failedDialog = deferred<string | null>()
    const retryDialog = deferred<string | null>()
    const onChange = vi.fn()
    vi.mocked(invoke)
      .mockReturnValueOnce(failedDialog.promise)
      .mockReturnValueOnce(retryDialog.promise)
    mocks.resolve.mockImplementation(async (path?: string) => ({
      path: path === '/chosen' ? '/canonical/chosen' : path,
    }))
    render(<WorkspacePicker value="/current" onChange={onChange} />)

    fireEvent.click(screen.getByRole('button', { name: 'Browse' }))
    await act(async () => {
      failedDialog.reject(new Error('Folder picker permission denied'))
      await failedDialog.promise.catch(() => undefined)
    })
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Folder picker permission denied'
    )
    expect(onChange).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Browse' })).toBeEnabled()

    fireEvent.click(screen.getByRole('button', { name: 'Browse' }))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Choosing folder…' })).toBeDisabled()
    await complete(retryDialog, '/chosen')

    expect(onChange).toHaveBeenCalledExactlyOnceWith('/canonical/chosen')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Browse' })).toBeEnabled()
    expect(invoke).toHaveBeenCalledTimes(2)
  })

  it.each(['native picker', 'folder resolution'] as const)(
    'does not replace a changed value or add obsolete recents after a pending %s',
    async (stage) => {
      const dialog = deferred<string | null>()
      const folder = deferred<{ path: string }>()
      const onChange = vi.fn()
      localStorage.setItem(recentKey, JSON.stringify(['/remembered']))
      vi.mocked(invoke).mockReturnValue(dialog.promise)
      mocks.resolve.mockImplementation(async (path?: string) =>
        path === '/obsolete-choice'
          ? folder.promise
          : { path: path ?? '/default-workspace' }
      )
      const view = render(
        <WorkspacePicker value="/workspace/old" onChange={onChange} />
      )
      fireEvent.click(screen.getByRole('button', { name: 'Browse' }))
      if (stage === 'folder resolution') {
        await complete(dialog, '/obsolete-choice')
        expect(mocks.resolve).toHaveBeenCalledWith('/obsolete-choice')
      }

      view.rerender(
        <WorkspacePicker value="/workspace/new" onChange={onChange} />
      )
      expect(await screen.findByText('/workspace/new')).toBeVisible()
      await act(async () => {
        dialog.resolve('/obsolete-choice')
        folder.resolve({ path: '/canonical/obsolete' })
        await Promise.all([dialog.promise, folder.promise])
      })

      expect(onChange).not.toHaveBeenCalled()
      expect(screen.getByLabelText('Workspace')).toHaveValue('/workspace/new')
      expect(screen.getByText('/workspace/new')).toBeVisible()
      expect(screen.queryByText('/canonical/obsolete')).not.toBeInTheDocument()
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
      expect(JSON.parse(localStorage.getItem(recentKey)!)).toEqual(['/remembered'])
    }
  )

  it.each(['native picker', 'folder resolution'] as const)(
    'ignores a pending %s after the picker unmounts',
    async (stage) => {
      const dialog = deferred<string | null>()
      const folder = deferred<{ path: string }>()
      const onChange = vi.fn()
      localStorage.setItem(recentKey, JSON.stringify(['/remembered']))
      vi.mocked(invoke).mockReturnValue(dialog.promise)
      mocks.resolve.mockImplementation(async (path?: string) =>
        path === '/obsolete-choice'
          ? folder.promise
          : { path: path ?? '/default-workspace' }
      )
      const view = render(
        <WorkspacePicker value="/workspace/current" onChange={onChange} />
      )
      fireEvent.click(screen.getByRole('button', { name: 'Browse' }))
      if (stage === 'folder resolution') {
        await complete(dialog, '/obsolete-choice')
        expect(mocks.resolve).toHaveBeenCalledWith('/obsolete-choice')
      }

      view.unmount()
      await act(async () => {
        dialog.resolve('/obsolete-choice')
        folder.resolve({ path: '/canonical/obsolete' })
        await Promise.all([dialog.promise, folder.promise])
      })

      expect(onChange).not.toHaveBeenCalled()
      expect(JSON.parse(localStorage.getItem(recentKey)!)).toEqual(['/remembered'])
    }
  )
})

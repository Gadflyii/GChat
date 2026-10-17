import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WorkspacePicker } from '../WorkspacePicker'
import { invoke } from '@tauri-apps/api/core'

const mocks = vi.hoisted(() => ({ resolve: vi.fn(), memory: vi.fn() }))

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))
vi.mock('@/services/agent/tauri', () => ({
  resolveConversationWorkspaceRoot: mocks.resolve,
}))
vi.mock('@/lib/memory', () => ({ memoryCommand: mocks.memory }))

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

describe('Workspace AGENTS.md instructions', () => {
  it('reads once for rapid clicks and shows the returned instructions after the pending state', async () => {
    const instructions = deferred<{ text: string }>()
    mocks.memory.mockReturnValue(instructions.promise)
    render(<WorkspacePicker value="/workspace/current" onChange={vi.fn()} />)

    const viewInstructions = await screen.findByRole('button', {
      name: 'View AGENTS.md',
    })
    act(() => {
      viewInstructions.click()
      viewInstructions.click()
    })
    expect(mocks.memory).toHaveBeenCalledExactlyOnceWith('instructions', {
      workspace: '/workspace/current',
    })
    expect(
      screen.getByRole('button', { name: 'Reading AGENTS.md…' })
    ).toBeDisabled()

    await complete(instructions, { text: 'Run the project checks before saving.' })
    expect(screen.getByText('Run the project checks before saving.')).toBeVisible()
    expect(screen.getByRole('button', { name: 'View AGENTS.md' })).toBeEnabled()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('explains that instructions are optional when the selected folder has no AGENTS.md', async () => {
    const instructions = deferred<{ text: string }>()
    mocks.memory.mockReturnValue(instructions.promise)
    render(<WorkspacePicker value="/workspace/current" onChange={vi.fn()} />)

    fireEvent.click(await screen.findByRole('button', { name: 'View AGENTS.md' }))
    await complete(instructions, { text: '' })

    expect(
      screen.getByText('No AGENTS.md file; workspace instructions are optional.')
    ).toBeVisible()
    expect(screen.getByRole('button', { name: 'View AGENTS.md' })).toBeEnabled()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('keeps a failed read retryable and clears its error while reading again', async () => {
    const failed = deferred<{ text: string }>()
    const retry = deferred<{ text: string }>()
    mocks.memory
      .mockReturnValueOnce(failed.promise)
      .mockReturnValueOnce(retry.promise)
    render(<WorkspacePicker value="/workspace/current" onChange={vi.fn()} />)

    fireEvent.click(await screen.findByRole('button', { name: 'View AGENTS.md' }))
    await act(async () => {
      failed.reject(new Error('Instructions file access denied'))
      await failed.promise.catch(() => undefined)
    })
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Instructions file access denied'
    )
    expect(screen.getByRole('button', { name: 'View AGENTS.md' })).toBeEnabled()

    fireEvent.click(screen.getByRole('button', { name: 'View AGENTS.md' }))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Reading AGENTS.md…' })
    ).toBeDisabled()
    await complete(retry, { text: 'Recovered workspace instructions.' })

    expect(screen.getByText('Recovered workspace instructions.')).toBeVisible()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'View AGENTS.md' })).toBeEnabled()
    expect(mocks.memory).toHaveBeenCalledTimes(2)
    expect(mocks.memory).toHaveBeenLastCalledWith('instructions', {
      workspace: '/workspace/current',
    })
  })

  it.each(['success', 'rejection'] as const)(
    'ignores an obsolete instructions %s after the workspace changes and keeps the new instructions',
    async (outcome) => {
      const oldInstructions = deferred<{ text: string }>()
      const currentInstructions = deferred<{ text: string }>()
      mocks.memory
        .mockReturnValueOnce(oldInstructions.promise)
        .mockReturnValueOnce(currentInstructions.promise)
      const view = render(
        <WorkspacePicker value="/workspace/old" onChange={vi.fn()} />
      )
      fireEvent.click(await screen.findByRole('button', { name: 'View AGENTS.md' }))

      view.rerender(
        <WorkspacePicker value="/workspace/new" onChange={vi.fn()} />
      )
      fireEvent.click(await screen.findByRole('button', { name: 'View AGENTS.md' }))
      expect(mocks.memory).toHaveBeenLastCalledWith('instructions', {
        workspace: '/workspace/new',
      })
      await complete(currentInstructions, {
      text: 'Instructions for the new workspace.',
    })

      if (outcome === 'success') {
        await complete(oldInstructions, { text: 'Obsolete workspace instructions.' })
      } else {
        await act(async () => {
          oldInstructions.reject(new Error('Obsolete instructions denied'))
          await oldInstructions.promise.catch(() => undefined)
        })
      }

      expect(screen.getByText('Instructions for the new workspace.')).toBeVisible()
      expect(
      screen.queryByText('Obsolete workspace instructions.')
    ).not.toBeInTheDocument()
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'View AGENTS.md' })).toBeEnabled()
      expect(mocks.memory).toHaveBeenCalledTimes(2)
    }
  )

  it('does not publish pending instructions after the picker unmounts', async () => {
    const instructions = deferred<{ text: string }>()
    mocks.memory.mockReturnValue(instructions.promise)
    const view = render(
      <WorkspacePicker value="/workspace/current" onChange={vi.fn()} />
    )
    fireEvent.click(await screen.findByRole('button', { name: 'View AGENTS.md' }))
    expect(
      screen.getByRole('button', { name: 'Reading AGENTS.md…' })
    ).toBeDisabled()

    view.unmount()
    await complete(instructions, { text: 'Instructions from the closed picker.' })

    expect(
      screen.queryByText('Instructions from the closed picker.')
    ).not.toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(mocks.memory).toHaveBeenCalledTimes(1)
  })
})

describe('Opening the workspace folder', () => {
  it('opens the resolved folder once for rapid clicks and stays busy until the explorer responds', async () => {
    const explorer = deferred<void>()
    vi.mocked(invoke).mockReturnValue(explorer.promise)
    mocks.resolve.mockResolvedValue({ path: '/canonical/project' })
    render(<WorkspacePicker value="/typed/../project" onChange={vi.fn()} />)

    const open = await screen.findByRole('button', { name: 'Open folder' })
    act(() => {
      open.click()
      open.click()
    })

    expect(invoke).toHaveBeenCalledExactlyOnceWith('open_file_explorer', {
      path: '/canonical/project',
    })
    const pending = screen.getByRole('button', { name: 'Opening folder…' })
    expect(pending).toBeDisabled()
    expect(pending).toHaveAttribute('aria-busy', 'true')

    await complete(explorer, undefined)
    expect(screen.getByRole('button', { name: 'Open folder' })).toBeEnabled()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('explains explorer failures and retries the same selected folder without retaining the error', async () => {
    const failed = deferred<void>()
    const retry = deferred<void>()
    vi.mocked(invoke)
      .mockReturnValueOnce(failed.promise)
      .mockReturnValueOnce(retry.promise)
    render(<WorkspacePicker value="/workspace/current" onChange={vi.fn()} />)

    fireEvent.click(await screen.findByRole('button', { name: 'Open folder' }))
    await act(async () => {
      failed.reject(new Error('Explorer unavailable'))
      await failed.promise.catch(() => undefined)
    })

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Could not open the folder. Try Open folder again. Error: Explorer unavailable'
    )
    expect(screen.getByRole('button', { name: 'Open folder' })).toBeEnabled()
    fireEvent.click(screen.getByRole('button', { name: 'Open folder' }))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Opening folder…' })).toBeDisabled()
    expect(invoke).toHaveBeenCalledTimes(2)
    expect(invoke).toHaveBeenNthCalledWith(1, 'open_file_explorer', {
      path: '/workspace/current',
    })
    expect(invoke).toHaveBeenNthCalledWith(2, 'open_file_explorer', {
      path: '/workspace/current',
    })

    await complete(retry, undefined)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Open folder' })).toBeEnabled()
  })

  it.each(['success', 'rejection'] as const)(
    'ignores an old explorer %s after changing workspaces without clearing the newer pending open',
    async (outcome) => {
      const oldExplorer = deferred<void>()
      const currentExplorer = deferred<void>()
      vi.mocked(invoke)
        .mockReturnValueOnce(oldExplorer.promise)
        .mockReturnValueOnce(currentExplorer.promise)
      const view = render(
        <WorkspacePicker value="/workspace/old" onChange={vi.fn()} />
      )
      fireEvent.click(await screen.findByRole('button', { name: 'Open folder' }))

      view.rerender(
        <WorkspacePicker value="/workspace/new" onChange={vi.fn()} />
      )
      fireEvent.click(await screen.findByRole('button', { name: 'Open folder' }))
      expect(invoke).toHaveBeenNthCalledWith(1, 'open_file_explorer', {
        path: '/workspace/old',
      })
      expect(invoke).toHaveBeenNthCalledWith(2, 'open_file_explorer', {
        path: '/workspace/new',
      })

      if (outcome === 'success') {
        await complete(oldExplorer, undefined)
      } else {
        await act(async () => {
          oldExplorer.reject(new Error('Obsolete explorer failure'))
          await oldExplorer.promise.catch(() => undefined)
        })
      }

      const pending = screen.getByRole('button', { name: 'Opening folder…' })
      expect(pending).toBeDisabled()
      expect(pending).toHaveAttribute('aria-busy', 'true')
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
      expect(screen.getByText('/workspace/new')).toBeVisible()
      fireEvent.click(pending)
      expect(invoke).toHaveBeenCalledTimes(2)

      await complete(currentExplorer, undefined)
      expect(screen.getByRole('button', { name: 'Open folder' })).toBeEnabled()
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    }
  )

  it.each(['success', 'rejection'] as const)(
    'safely settles an explorer %s after the picker unmounts',
    async (outcome) => {
      const explorer = deferred<void>()
      const onChange = vi.fn()
      vi.mocked(invoke).mockReturnValue(explorer.promise)
      const view = render(
        <WorkspacePicker value="/workspace/current" onChange={onChange} />
      )
      fireEvent.click(await screen.findByRole('button', { name: 'Open folder' }))
      view.unmount()

      if (outcome === 'success') {
        await complete(explorer, undefined)
      } else {
        await act(async () => {
          explorer.reject(new Error('Closed picker explorer failure'))
          await explorer.promise.catch(() => undefined)
        })
      }

      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
      expect(onChange).not.toHaveBeenCalled()
      expect(invoke).toHaveBeenCalledExactlyOnceWith('open_file_explorer', {
        path: '/workspace/current',
      })
    }
  )
})

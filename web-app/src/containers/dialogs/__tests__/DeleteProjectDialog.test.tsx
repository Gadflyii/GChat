import { useState } from 'react'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DeleteProjectDialog } from '../DeleteProjectDialog'

const mocks = vi.hoisted(() => ({
  deleteFolderWithThreads: vi.fn(),
  onOpenChange: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
}))

vi.mock('@/i18n/react-i18next-compat', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))
vi.mock('@/hooks/useThreads', () => ({
  useThreads: (selector: (state: { threads: Record<string, never> }) => unknown) =>
    selector({ threads: {} }),
}))
vi.mock('@/hooks/useThreadManagement', () => ({
  useThreadManagement: () => ({
    deleteFolderWithThreads: mocks.deleteFolderWithThreads,
  }),
}))
vi.mock('sonner', () => ({
  toast: { success: mocks.success, error: mocks.error },
}))

const deleteLabel = 'projects.deleteProjectDialog.ariaLabel'
const errorMessage = 'projects.deleteProjectDialog.error'

function ProjectDeletion() {
  const [open, setOpen] = useState(true)
  return (
    <DeleteProjectDialog
      open={open}
      onOpenChange={(nextOpen) => {
        mocks.onOpenChange(nextOpen)
        setOpen(nextOpen)
      }}
      projectId="project-1"
      projectName="Research"
    />
  )
}

function deferred() {
  let resolve!: () => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<void>((done, fail) => {
    resolve = done
    reject = fail
  })
  return { promise, resolve, reject }
}

beforeEach(() => {
  vi.resetAllMocks()
  mocks.deleteFolderWithThreads.mockResolvedValue(undefined)
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('DeleteProjectDialog single submission', () => {
  it('focuses Cancel and lets Enter cancel without deleting the project', async () => {
    const user = userEvent.setup()
    render(<ProjectDeletion />)

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'cancel' })).toHaveFocus()
    )
    await user.keyboard('{Enter}')

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(mocks.onOpenChange).toHaveBeenCalledExactlyOnceWith(false)
    expect(mocks.deleteFolderWithThreads).not.toHaveBeenCalled()
    expect(mocks.success).not.toHaveBeenCalled()
  })

  it.each(['click', 'Enter'] as const)(
    'deletes once through native %s activation and closes only after success',
    async (activation) => {
      const deletion = deferred()
      mocks.deleteFolderWithThreads.mockReturnValue(deletion.promise)
      const user = userEvent.setup()
      render(<ProjectDeletion />)
      const remove = screen.getByRole('button', { name: deleteLabel })

      if (activation === 'click') {
        await user.click(remove)
      } else {
        remove.focus()
        await user.keyboard('{Enter}')
      }

      expect(mocks.deleteFolderWithThreads).toHaveBeenCalledExactlyOnceWith(
        'project-1'
      )
      expect(screen.getByRole('dialog')).toBeInTheDocument()
      expect(mocks.onOpenChange).not.toHaveBeenCalled()
      expect(mocks.success).not.toHaveBeenCalled()

      await act(async () => {
        deletion.resolve()
        await deletion.promise
      })

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      expect(mocks.deleteFolderWithThreads).toHaveBeenCalledOnce()
      expect(mocks.onOpenChange).toHaveBeenCalledExactlyOnceWith(false)
      expect(mocks.success).toHaveBeenCalledExactlyOnceWith(
        'projects.deleteProjectDialog.successWithName'
      )
      expect(mocks.error).not.toHaveBeenCalled()
    }
  )

  it('guards two native clicks in the same event turn', async () => {
    const deletion = deferred()
    mocks.deleteFolderWithThreads.mockReturnValue(deletion.promise)
    render(<ProjectDeletion />)
    const remove = screen.getByRole('button', { name: deleteLabel })

    act(() => {
      remove.click()
      remove.click()
    })

    expect(mocks.deleteFolderWithThreads).toHaveBeenCalledExactlyOnceWith(
      'project-1'
    )
    expect(remove).toBeDisabled()

    await act(async () => {
      deletion.resolve()
      await deletion.promise
    })

    expect(mocks.onOpenChange).toHaveBeenCalledExactlyOnceWith(false)
    expect(mocks.success).toHaveBeenCalledOnce()
  })

  it('shows pending state and blocks repeated activation and dismissal until deletion settles', async () => {
    const deletion = deferred()
    mocks.deleteFolderWithThreads.mockReturnValue(deletion.promise)
    const user = userEvent.setup()
    render(<ProjectDeletion />)
    const remove = screen.getByRole('button', { name: deleteLabel })
    await user.click(remove)

    expect(remove).toBeDisabled()
    expect(remove).toHaveAttribute('aria-busy', 'true')
    expect(remove).toHaveTextContent('loading')
    expect(screen.getByRole('button', { name: 'cancel' })).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'Close' })).not.toBeInTheDocument()

    await user.dblClick(remove)
    await user.keyboard('{Enter} {Escape}')
    await user.click(screen.getByRole('button', { name: 'cancel' }))

    expect(mocks.deleteFolderWithThreads).toHaveBeenCalledExactlyOnceWith(
      'project-1'
    )
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(mocks.onOpenChange).not.toHaveBeenCalled()

    await act(async () => {
      deletion.resolve()
      await deletion.promise
    })

    expect(mocks.onOpenChange).toHaveBeenCalledExactlyOnceWith(false)
    expect(mocks.success).toHaveBeenCalledOnce()
  })

  it('keeps a failed deletion open with an error and permits one successful retry', async () => {
    const first = deferred()
    const retry = deferred()
    mocks.deleteFolderWithThreads
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(retry.promise)
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const user = userEvent.setup()
    render(<ProjectDeletion />)
    await user.click(screen.getByRole('button', { name: deleteLabel }))

    await act(async () => {
      first.reject(new Error('Deletion failed'))
      await first.promise.catch(() => undefined)
    })

    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent(errorMessage)
    expect(screen.getByRole('button', { name: deleteLabel })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'cancel' })).toBeEnabled()
    expect(mocks.error).toHaveBeenCalledExactlyOnceWith(errorMessage)
    expect(mocks.onOpenChange).not.toHaveBeenCalled()
    expect(mocks.success).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: deleteLabel }))
    expect(mocks.deleteFolderWithThreads).toHaveBeenCalledTimes(2)
    expect(mocks.deleteFolderWithThreads).toHaveBeenNthCalledWith(2, 'project-1')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: deleteLabel })).toBeDisabled()

    await act(async () => {
      retry.resolve()
      await retry.promise
    })

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(mocks.deleteFolderWithThreads).toHaveBeenCalledTimes(2)
    expect(mocks.onOpenChange).toHaveBeenCalledExactlyOnceWith(false)
    expect(mocks.success).toHaveBeenCalledOnce()
    expect(mocks.error).toHaveBeenCalledOnce()
  })
})

import { useState } from 'react'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DeleteThreadDialog } from '../DeleteThreadDialog'

const mocks = vi.hoisted(() => ({
  onDelete: vi.fn(),
  onOpenChange: vi.fn(),
  onDropdownClose: vi.fn(),
  navigate: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
}))

vi.mock('@/i18n/react-i18next-compat', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => mocks.navigate,
}))
vi.mock('sonner', () => ({
  toast: { success: mocks.success, error: mocks.error },
}))

const thread: Thread = { id: 'thread-1', title: 'Research', updated: 0 }
const deleteLabel = 'common:delete Research'

function ThreadDeletion({
  variant = 'project',
}: {
  variant?: 'default' | 'project'
}) {
  const [open, setOpen] = useState(true)
  return (
    <DeleteThreadDialog
      open={open}
      onOpenChange={(nextOpen) => {
        mocks.onOpenChange(nextOpen)
        setOpen(nextOpen)
      }}
      thread={thread}
      onDelete={mocks.onDelete}
      onDropdownClose={mocks.onDropdownClose}
      variant={variant}
      withoutTrigger
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
  mocks.onDelete.mockResolvedValue(undefined)
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('DeleteThreadDialog single submission', () => {
  it('focuses Cancel and lets Enter cancel without deleting the thread', async () => {
    const user = userEvent.setup()
    render(<ThreadDeletion />)

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'common:cancel' })).toHaveFocus()
    )
    await user.keyboard('{Enter}')

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(mocks.onOpenChange).toHaveBeenCalledExactlyOnceWith(false)
    expect(mocks.onDropdownClose).toHaveBeenCalledOnce()
    expect(mocks.onDelete).not.toHaveBeenCalled()
    expect(mocks.success).not.toHaveBeenCalled()
    expect(mocks.navigate).not.toHaveBeenCalled()
  })

  it.each(['click', 'Enter'] as const)(
    'deletes once through native %s activation and closes only after success',
    async (activation) => {
      const deletion = deferred()
      mocks.onDelete.mockReturnValue(deletion.promise)
      const user = userEvent.setup()
      render(<ThreadDeletion />)
      const remove = screen.getByRole('button', { name: deleteLabel })

      if (activation === 'click') {
        await user.click(remove)
      } else {
        remove.focus()
        await user.keyboard('{Enter}')
      }

      expect(mocks.onDelete).toHaveBeenCalledExactlyOnceWith(thread.id)
      expect(screen.getByRole('dialog')).toBeInTheDocument()
      expect(mocks.onOpenChange).not.toHaveBeenCalled()
      expect(mocks.onDropdownClose).not.toHaveBeenCalled()
      expect(mocks.success).not.toHaveBeenCalled()

      await act(async () => {
        deletion.resolve()
        await deletion.promise
      })

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      expect(mocks.onDelete).toHaveBeenCalledOnce()
      expect(mocks.onOpenChange).toHaveBeenCalledExactlyOnceWith(false)
      expect(mocks.onDropdownClose).toHaveBeenCalledOnce()
      expect(mocks.success).toHaveBeenCalledExactlyOnceWith(
        'common:toast.deleteThread.title',
        {
          id: 'delete-thread',
          description: 'common:toast.deleteThread.description',
        }
      )
      expect(mocks.error).not.toHaveBeenCalled()
    }
  )

  it('guards two native clicks in the same event turn', async () => {
    const deletion = deferred()
    mocks.onDelete.mockReturnValue(deletion.promise)
    render(<ThreadDeletion />)
    const remove = screen.getByRole('button', { name: deleteLabel })

    act(() => {
      remove.click()
      remove.click()
    })

    expect(mocks.onDelete).toHaveBeenCalledExactlyOnceWith(thread.id)
    expect(remove).toBeDisabled()

    await act(async () => {
      deletion.resolve()
      await deletion.promise
    })

    expect(mocks.onOpenChange).toHaveBeenCalledExactlyOnceWith(false)
    expect(mocks.onDropdownClose).toHaveBeenCalledOnce()
    expect(mocks.success).toHaveBeenCalledOnce()
  })

  it('shows pending state and blocks repeated activation and dismissal', async () => {
    const deletion = deferred()
    mocks.onDelete.mockReturnValue(deletion.promise)
    const user = userEvent.setup()
    render(<ThreadDeletion />)
    const remove = screen.getByRole('button', { name: deleteLabel })
    await user.click(remove)

    expect(remove).toBeDisabled()
    expect(remove).toHaveAttribute('aria-busy', 'true')
    expect(remove).toHaveTextContent('common:loading')
    expect(screen.getByRole('dialog')).toHaveAttribute('aria-busy', 'true')
    expect(screen.getByRole('button', { name: 'common:cancel' })).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'Close' })).not.toBeInTheDocument()

    await user.dblClick(remove)
    await user.keyboard('{Enter} {Escape}')
    await user.click(screen.getByRole('button', { name: 'common:cancel' }))

    expect(mocks.onDelete).toHaveBeenCalledExactlyOnceWith(thread.id)
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(mocks.onOpenChange).not.toHaveBeenCalled()
    expect(mocks.onDropdownClose).not.toHaveBeenCalled()
    expect(mocks.navigate).not.toHaveBeenCalled()

    await act(async () => {
      deletion.resolve()
      await deletion.promise
    })

    expect(mocks.onOpenChange).toHaveBeenCalledExactlyOnceWith(false)
    expect(mocks.onDropdownClose).toHaveBeenCalledOnce()
  })

  it('keeps a failed deletion open with an error and permits one successful retry', async () => {
    const first = deferred()
    const retry = deferred()
    mocks.onDelete
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(retry.promise)
    const user = userEvent.setup()
    render(<ThreadDeletion />)
    await user.click(screen.getByRole('button', { name: deleteLabel }))

    await act(async () => {
      first.reject(new Error('Deletion failed'))
      await first.promise.catch(() => undefined)
    })

    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('Error: Deletion failed')
    expect(screen.getByRole('button', { name: deleteLabel })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'common:cancel' })).toBeEnabled()
    expect(mocks.error).toHaveBeenCalledExactlyOnceWith('Error: Deletion failed')
    expect(mocks.onOpenChange).not.toHaveBeenCalled()
    expect(mocks.onDropdownClose).not.toHaveBeenCalled()
    expect(mocks.success).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: deleteLabel }))
    expect(mocks.onDelete).toHaveBeenCalledTimes(2)
    expect(mocks.onDelete).toHaveBeenNthCalledWith(2, thread.id)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: deleteLabel })).toBeDisabled()

    await act(async () => {
      retry.resolve()
      await retry.promise
    })

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(mocks.onDelete).toHaveBeenCalledTimes(2)
    expect(mocks.onOpenChange).toHaveBeenCalledExactlyOnceWith(false)
    expect(mocks.onDropdownClose).toHaveBeenCalledOnce()
    expect(mocks.success).toHaveBeenCalledOnce()
    expect(mocks.error).toHaveBeenCalledOnce()
  })

  it.each(['default', 'project'] as const)(
    'closes the successful %s deletion and navigates home only for default deletion',
    async (variant) => {
      const deletion = deferred()
      mocks.onDelete.mockReturnValue(deletion.promise)
      const user = userEvent.setup()
      render(<ThreadDeletion variant={variant} />)
      await user.click(screen.getByRole('button', { name: deleteLabel }))
      vi.useFakeTimers()

      await act(async () => {
        deletion.resolve()
        await deletion.promise
      })

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      expect(mocks.onOpenChange).toHaveBeenCalledExactlyOnceWith(false)
      expect(mocks.onDropdownClose).toHaveBeenCalledOnce()
      expect(mocks.success).toHaveBeenCalledOnce()
      expect(mocks.navigate).not.toHaveBeenCalled()

      await act(async () => {
        await vi.runOnlyPendingTimersAsync()
      })

      if (variant === 'default') {
        expect(mocks.navigate).toHaveBeenCalledExactlyOnceWith({ to: '/' })
      } else {
        expect(mocks.navigate).not.toHaveBeenCalled()
      }
    }
  )
})

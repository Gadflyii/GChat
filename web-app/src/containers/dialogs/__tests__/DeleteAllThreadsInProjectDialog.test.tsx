import { useState } from 'react'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { DeleteAllThreadsInProjectDialog } from '../DeleteAllThreadsInProjectDialog'

const mocks = vi.hoisted(() => ({
  deleteAll: vi.fn(),
  closeDropdown: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
}))

vi.mock('@/i18n/react-i18next-compat', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))
vi.mock('sonner', () => ({
  toast: { success: mocks.success, error: mocks.error },
}))

const deleteLabel = 'common:deleteAll'
const cancelLabel = 'common:cancel'

function ProjectThreadDeletion() {
  const [dropdownOpen, setDropdownOpen] = useState(false)
  return (
    <DropdownMenu open={dropdownOpen} onOpenChange={setDropdownOpen}>
      <DropdownMenuTrigger>Project conversations</DropdownMenuTrigger>
      <DropdownMenuContent>
        <DeleteAllThreadsInProjectDialog
          projectName="Research"
          threadCount={3}
          onDeleteAll={mocks.deleteAll}
          onDropdownClose={() => {
            mocks.closeDropdown()
            setDropdownOpen(false)
          }}
        />
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

async function openConfirmation(user: ReturnType<typeof userEvent.setup>) {
  render(<ProjectThreadDeletion />)
  await user.click(screen.getByRole('button', { name: 'Project conversations' }))
  await user.click(await screen.findByRole('menuitem', { name: deleteLabel }))
  await screen.findByRole('dialog')
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
  mocks.deleteAll.mockResolvedValue(undefined)
})

describe('DeleteAllThreadsInProjectDialog single submission', () => {
  it('focuses Cancel and lets Enter cancel without deleting conversations', async () => {
    const user = userEvent.setup()
    await openConfirmation(user)

    await waitFor(() =>
      expect(screen.getByRole('button', { name: cancelLabel })).toHaveFocus()
    )
    await user.keyboard('{Enter}')

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(mocks.closeDropdown).toHaveBeenCalledOnce()
    expect(mocks.deleteAll).not.toHaveBeenCalled()
    expect(mocks.success).not.toHaveBeenCalled()
    expect(mocks.error).not.toHaveBeenCalled()
  })

  it.each(['click', 'Enter'] as const)(
    'deletes once through native %s activation and closes only after success',
    async (activation) => {
      const deletion = deferred()
      mocks.deleteAll.mockReturnValue(deletion.promise)
      const user = userEvent.setup()
      await openConfirmation(user)
      const remove = screen.getByRole('button', { name: deleteLabel })

      if (activation === 'click') {
        await user.click(remove)
      } else {
        remove.focus()
        await user.keyboard('{Enter}')
      }

      expect(mocks.deleteAll).toHaveBeenCalledExactlyOnceWith()
      expect(screen.getByRole('dialog')).toBeInTheDocument()
      expect(mocks.closeDropdown).not.toHaveBeenCalled()
      expect(mocks.success).not.toHaveBeenCalled()

      await act(async () => {
        deletion.resolve()
        await deletion.promise
      })

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      expect(screen.queryByRole('menu')).not.toBeInTheDocument()
      expect(mocks.deleteAll).toHaveBeenCalledOnce()
      expect(mocks.closeDropdown).toHaveBeenCalledOnce()
      expect(mocks.success).toHaveBeenCalledExactlyOnceWith(
        'common:toast.deleteAllThreads.title',
        {
          id: 'delete-all-threads-in-project',
          description: 'common:toast.deleteAllThreads.description',
        }
      )
      expect(mocks.error).not.toHaveBeenCalled()
    }
  )

  it('guards two native clicks in the same event turn', async () => {
    const deletion = deferred()
    mocks.deleteAll.mockReturnValue(deletion.promise)
    const user = userEvent.setup()
    await openConfirmation(user)
    const remove = screen.getByRole('button', { name: deleteLabel })

    act(() => {
      remove.click()
      remove.click()
    })

    expect(mocks.deleteAll).toHaveBeenCalledExactlyOnceWith()
    expect(remove).toBeDisabled()
    expect(mocks.closeDropdown).not.toHaveBeenCalled()

    await act(async () => {
      deletion.resolve()
      await deletion.promise
    })

    expect(mocks.closeDropdown).toHaveBeenCalledOnce()
    expect(mocks.success).toHaveBeenCalledOnce()
  })

  it('blocks dismissal and repeated actions while deletion is pending', async () => {
    const deletion = deferred()
    mocks.deleteAll.mockReturnValue(deletion.promise)
    const user = userEvent.setup()
    await openConfirmation(user)
    const remove = screen.getByRole('button', { name: deleteLabel })
    await user.click(remove)

    expect(screen.getByRole('dialog')).toHaveAttribute('aria-busy', 'true')
    expect(remove).toBeDisabled()
    expect(remove).toHaveAttribute('aria-busy', 'true')
    expect(remove).toHaveTextContent('common:loading')
    expect(screen.getByRole('button', { name: cancelLabel })).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'Close' })).not.toBeInTheDocument()

    await user.dblClick(remove)
    await user.keyboard('{Enter} {Escape}')
    await user.click(screen.getByRole('button', { name: cancelLabel }))

    expect(mocks.deleteAll).toHaveBeenCalledExactlyOnceWith()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(mocks.closeDropdown).not.toHaveBeenCalled()
    expect(mocks.success).not.toHaveBeenCalled()

    await act(async () => {
      deletion.resolve()
      await deletion.promise
    })

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(mocks.closeDropdown).toHaveBeenCalledOnce()
    expect(mocks.success).toHaveBeenCalledOnce()
  })

  it('keeps rejection visible and permits one successful retry', async () => {
    const first = deferred()
    const retry = deferred()
    const error = new Error('Project conversations are busy')
    mocks.deleteAll
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(retry.promise)
    const user = userEvent.setup()
    await openConfirmation(user)
    await user.click(screen.getByRole('button', { name: deleteLabel }))

    await act(async () => {
      first.reject(error)
      await first.promise.catch(() => undefined)
    })

    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent(String(error))
    expect(screen.getByRole('button', { name: deleteLabel })).toBeEnabled()
    expect(screen.getByRole('button', { name: cancelLabel })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument()
    expect(mocks.error).toHaveBeenCalledExactlyOnceWith(String(error))
    expect(mocks.closeDropdown).not.toHaveBeenCalled()
    expect(mocks.success).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: deleteLabel }))
    expect(mocks.deleteAll).toHaveBeenCalledTimes(2)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: deleteLabel })).toBeDisabled()
    expect(mocks.closeDropdown).not.toHaveBeenCalled()

    await act(async () => {
      retry.resolve()
      await retry.promise
    })

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(mocks.deleteAll).toHaveBeenCalledTimes(2)
    expect(mocks.closeDropdown).toHaveBeenCalledOnce()
    expect(mocks.success).toHaveBeenCalledOnce()
    expect(mocks.error).toHaveBeenCalledOnce()
  })
})

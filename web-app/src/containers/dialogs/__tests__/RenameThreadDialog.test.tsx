import { useState } from 'react'
import { act, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { RenameThreadDialog } from '../RenameThreadDialog'

const mocks = vi.hoisted(() => ({
  rename: vi.fn(),
  onOpenChange: vi.fn(),
  onDropdownClose: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
  t: (key: string) => key,
}))

vi.mock('@/i18n/react-i18next-compat', () => ({
  useTranslation: () => ({ t: mocks.t }),
}))
vi.mock('sonner', () => ({
  toast: { success: mocks.success, error: mocks.error },
}))

function ThreadRename() {
  const [open, setOpen] = useState(true)
  return (
    <RenameThreadDialog
      thread={{ id: 'thread-1', title: 'Research' } as Thread}
      plainTitleForRename="Research"
      onRename={mocks.rename}
      open={open}
      onOpenChange={(nextOpen) => {
        mocks.onOpenChange(nextOpen)
        setOpen(nextOpen)
      }}
      onDropdownClose={mocks.onDropdownClose}
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
})

describe('RenameThreadDialog submission', () => {
  it.each(['Research', '  Research  ', '   '])(
    'keeps the dialog open when Enter or form submission receives %j',
    async (title) => {
      const user = userEvent.setup()
      render(<ThreadRename />)
      const input = screen.getByRole('textbox', { name: 'common:threadTitle' })
      await user.click(input)
      fireEvent.change(input, { target: { value: title } })
      await user.keyboard('{Enter}')
      fireEvent.submit(input.closest('form')!)

      expect(screen.getByRole('dialog')).toBeInTheDocument()
      expect(input).toHaveValue(title)
      expect(screen.getByRole('button', { name: 'common:rename' })).toBeDisabled()
      expect(mocks.rename).not.toHaveBeenCalled()
      expect(mocks.onOpenChange).not.toHaveBeenCalled()
      expect(mocks.onDropdownClose).not.toHaveBeenCalled()
      expect(mocks.success).not.toHaveBeenCalled()
    }
  )

  it.each(['click', 'Enter'] as const)(
    'renames the same thread with a trimmed title through %s and closes after success',
    async (activation) => {
      const rename = deferred()
      mocks.rename.mockReturnValue(rename.promise)
      const user = userEvent.setup()
      render(<ThreadRename />)
      const input = screen.getByRole('textbox', { name: 'common:threadTitle' })
      await user.click(input)
      fireEvent.change(input, { target: { value: '  Revised title  ' } })
      const button = screen.getByRole('button', { name: 'common:rename' })

      if (activation === 'click') {
        await user.click(button)
      } else {
        await user.keyboard('{Enter}')
      }

      expect(screen.getByRole('dialog')).toBeInTheDocument()
      expect(input).toHaveValue('  Revised title  ')
      expect(input).toBeDisabled()
      expect(button).toBeDisabled()
      expect(button).toHaveAttribute('aria-busy', 'true')
      expect(mocks.rename).toHaveBeenCalledExactlyOnceWith(
        'thread-1',
        'Revised title'
      )
      expect(mocks.onOpenChange).not.toHaveBeenCalled()
      expect(mocks.success).not.toHaveBeenCalled()

      await act(async () => {
        rename.resolve()
        await rename.promise
      })

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      expect(mocks.onOpenChange).toHaveBeenCalledExactlyOnceWith(false)
      expect(mocks.onDropdownClose).toHaveBeenCalledOnce()
      expect(mocks.success).toHaveBeenCalledExactlyOnceWith(
        'common:toast.renameThread.title',
        {
          id: 'rename-thread',
          description: 'common:toast.renameThread.description',
        }
      )
      expect(mocks.error).not.toHaveBeenCalled()
    }
  )

  it('guards repeated submission before rendering and blocks dismissal while pending', async () => {
    const rename = deferred()
    mocks.rename.mockReturnValue(rename.promise)
    const user = userEvent.setup()
    render(<ThreadRename />)
    const input = screen.getByRole('textbox', { name: 'common:threadTitle' })
    await user.click(input)
    fireEvent.change(input, { target: { value: 'Revised title' } })
    const button = screen.getByRole('button', { name: 'common:rename' })

    act(() => {
      button.click()
      button.click()
      fireEvent.submit(input.closest('form')!)
    })
    await user.keyboard('{Enter}{Escape}')
    await user.click(screen.getByRole('button', { name: 'common:cancel' }))

    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(button).toBeDisabled()
    expect(screen.getByRole('button', { name: 'common:cancel' })).toBeDisabled()
    expect(mocks.rename).toHaveBeenCalledExactlyOnceWith(
      'thread-1',
      'Revised title'
    )
    expect(mocks.onOpenChange).not.toHaveBeenCalled()

    await act(async () => {
      rename.resolve()
      await rename.promise
    })

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(mocks.onOpenChange).toHaveBeenCalledExactlyOnceWith(false)
    expect(mocks.success).toHaveBeenCalledOnce()
  })

  it('retains the draft after failure, shows an error and allows a successful retry', async () => {
    const rename = deferred()
    mocks.rename.mockReturnValueOnce(rename.promise)
    const user = userEvent.setup()
    render(<ThreadRename />)
    const input = screen.getByRole('textbox', { name: 'common:threadTitle' })
    await user.click(input)
    fireEvent.change(input, { target: { value: 'Revised title' } })
    await user.keyboard('{Enter}')

    await act(async () => {
      rename.reject(new Error('Rename failed'))
      await rename.promise.catch(() => undefined)
    })

    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(input).toHaveValue('Revised title')
    expect(input).toBeEnabled()
    expect(screen.getByRole('alert')).toHaveTextContent('Rename failed')
    expect(screen.getByRole('button', { name: 'common:rename' })).toBeEnabled()
    expect(mocks.error).toHaveBeenCalledExactlyOnceWith('Error: Rename failed')
    expect(mocks.onOpenChange).not.toHaveBeenCalled()
    expect(mocks.success).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'common:rename' }))

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(mocks.rename).toHaveBeenCalledTimes(2)
    expect(mocks.rename).toHaveBeenNthCalledWith(2, 'thread-1', 'Revised title')
    expect(mocks.success).toHaveBeenCalledOnce()
  })

  it('keeps a synchronous callback failure visible without losing the draft', async () => {
    mocks.rename.mockImplementation(() => {
      throw new Error('Rename unavailable')
    })
    const user = userEvent.setup()
    render(<ThreadRename />)
    const input = screen.getByRole('textbox', { name: 'common:threadTitle' })
    await user.click(input)
    fireEvent.change(input, { target: { value: 'Revised title' } })
    await user.keyboard('{Enter}')

    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(input).toHaveValue('Revised title')
    expect(screen.getByRole('alert')).toHaveTextContent('Rename unavailable')
    expect(screen.getByRole('button', { name: 'common:rename' })).toBeEnabled()
    expect(mocks.success).not.toHaveBeenCalled()
  })

  it('lets Cancel close the draft without renaming', async () => {
    const user = userEvent.setup()
    render(<ThreadRename />)
    const input = screen.getByRole('textbox', { name: 'common:threadTitle' })
    await user.click(input)
    fireEvent.change(input, { target: { value: 'Revised title' } })
    await user.click(screen.getByRole('button', { name: 'common:cancel' }))

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(mocks.rename).not.toHaveBeenCalled()
    expect(mocks.onOpenChange).toHaveBeenCalledExactlyOnceWith(false)
    expect(mocks.onDropdownClose).toHaveBeenCalledOnce()
    expect(mocks.success).not.toHaveBeenCalled()
  })
})

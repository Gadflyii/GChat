import { useState } from 'react'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TranslationContext } from '@/i18n/context'
import i18n from '@/i18n/setup'
import { DeleteAssistantDialog } from '../DeleteAssistantDialog'

function renderDeletion(onConfirm: () => void | Promise<void>) {
  const onOpenChange = vi.fn()
  function AssistantDeletion() {
    const [open, setOpen] = useState(true)
    return (
      <TranslationContext.Provider value={{ t: i18n.t, i18n }}>
        <DeleteAssistantDialog
          open={open}
          onOpenChange={(nextOpen) => {
            onOpenChange(nextOpen)
            setOpen(nextOpen)
          }}
          onConfirm={async () => {
            await onConfirm()
            // The settings caller owns closing after successful persistence.
            setOpen(false)
          }}
        />
      </TranslationContext.Provider>
    )
  }
  render(<AssistantDeletion />)
  return { onOpenChange }
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

beforeEach(async () => {
  await i18n.changeLanguage('en')
})

describe('DeleteAssistantDialog single submission', () => {
  it('focuses Cancel and lets Enter close without deleting the assistant', async () => {
    const onConfirm = vi.fn()
    const user = userEvent.setup()
    const { onOpenChange } = renderDeletion(onConfirm)

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus()
    )
    await user.keyboard('{Enter}')

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(onConfirm).not.toHaveBeenCalled()
    expect(onOpenChange).toHaveBeenCalledExactlyOnceWith(false)
  })

  it.each(['click', 'Enter', 'Space'] as const)(
    'submits once through native %s activation and waits for the caller to close',
    async (activation) => {
      const deletion = deferred()
      const onConfirm = vi.fn().mockReturnValue(deletion.promise)
      const user = userEvent.setup()
      const { onOpenChange } = renderDeletion(onConfirm)
      const dialog = screen.getByRole('dialog', { name: 'Delete Assistant' })
      const remove = within(dialog).getByRole('button', { name: 'Delete' })

      if (activation === 'click') {
        await user.click(remove)
      } else {
        remove.focus()
        await user.keyboard(activation === 'Enter' ? '{Enter}' : ' ')
      }

      expect(onConfirm).toHaveBeenCalledExactlyOnceWith()
      expect(dialog).toBeInTheDocument()
      expect(onOpenChange).not.toHaveBeenCalled()

      await act(async () => {
        deletion.resolve()
        await deletion.promise
      })

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      expect(onConfirm).toHaveBeenCalledOnce()
      expect(onOpenChange).not.toHaveBeenCalled()
    }
  )

  it('guards repeated native clicks in the same event turn', async () => {
    const deletion = deferred()
    const onConfirm = vi.fn().mockReturnValue(deletion.promise)
    renderDeletion(onConfirm)
    const remove = screen.getByRole('button', { name: 'Delete' })

    act(() => {
      remove.click()
      remove.click()
      remove.click()
    })

    expect(onConfirm).toHaveBeenCalledExactlyOnceWith()
    expect(remove).toBeDisabled()

    await act(async () => {
      deletion.resolve()
      await deletion.promise
    })

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(onConfirm).toHaveBeenCalledOnce()
  })

  it('shows pending state and blocks repeated activation and dismissal', async () => {
    const deletion = deferred()
    const onConfirm = vi.fn().mockReturnValue(deletion.promise)
    const user = userEvent.setup()
    const { onOpenChange } = renderDeletion(onConfirm)
    const dialog = screen.getByRole('dialog')
    const remove = within(dialog).getByRole('button', { name: 'Delete' })
    const cancel = within(dialog).getByRole('button', { name: 'Cancel' })
    await user.click(remove)

    expect(dialog).toHaveAttribute('aria-busy', 'true')
    expect(remove).toBeDisabled()
    expect(remove).toHaveAttribute('aria-busy', 'true')
    expect(remove).toHaveTextContent('Loading...')
    expect(cancel).toBeDisabled()
    expect(within(dialog).queryByRole('button', { name: 'Close' })).not.toBeInTheDocument()

    await user.dblClick(remove)
    await user.keyboard('{Enter} {Escape}')
    await user.click(cancel)

    expect(onConfirm).toHaveBeenCalledExactlyOnceWith()
    expect(dialog).toBeInTheDocument()
    expect(onOpenChange).not.toHaveBeenCalled()

    await act(async () => {
      deletion.resolve()
      await deletion.promise
    })

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(onConfirm).toHaveBeenCalledOnce()
  })

  it('keeps a failed deletion visible and allows a successful retry', async () => {
    const first = deferred()
    const retry = deferred()
    const onConfirm = vi
      .fn()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(retry.promise)
    const user = userEvent.setup()
    const { onOpenChange } = renderDeletion(onConfirm)
    const dialog = screen.getByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }))

    await act(async () => {
      first.reject(new Error('Assistant could not be deleted'))
      await first.promise.catch(() => undefined)
    })

    expect(dialog).toBeInTheDocument()
    expect(within(dialog).getByRole('alert')).toHaveTextContent(
      'Error: Assistant could not be deleted'
    )
    expect(within(dialog).getByRole('button', { name: 'Delete' })).toBeEnabled()
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toBeEnabled()
    expect(onOpenChange).not.toHaveBeenCalled()

    await user.click(within(dialog).getByRole('button', { name: 'Delete' }))

    expect(onConfirm).toHaveBeenCalledTimes(2)
    expect(within(dialog).queryByRole('alert')).not.toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Delete' })).toBeDisabled()

    await act(async () => {
      retry.resolve()
      await retry.promise
    })

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(onConfirm).toHaveBeenCalledTimes(2)
    expect(onOpenChange).not.toHaveBeenCalled()
  })
})

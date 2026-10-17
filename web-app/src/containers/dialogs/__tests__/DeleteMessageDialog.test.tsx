import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TranslationContext } from '@/i18n/context'
import i18n from '@/i18n/setup'
import { DeleteMessageDialog } from '../DeleteMessageDialog'

const deleteLabel = 'Delete Message'

function renderDeletion(onDelete: () => void | Promise<void>) {
  return render(
    <TranslationContext.Provider value={{ t: i18n.t, i18n }}>
      <DeleteMessageDialog onDelete={onDelete} />
    </TranslationContext.Provider>
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

beforeEach(async () => {
  await i18n.changeLanguage('en')
})

describe('DeleteMessageDialog single submission', () => {
  it.each(['click', 'Enter', 'Space'] as const)(
    'opens safely through the accessible trigger with %s and lets Enter on Cancel close it',
    async (activation) => {
      const onDelete = vi.fn()
      const user = userEvent.setup()
      renderDeletion(onDelete)
      const trigger = screen.getByRole('button', { name: deleteLabel })

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      if (activation === 'click') {
        await user.click(trigger)
      } else {
        trigger.focus()
        await user.keyboard(activation === 'Enter' ? '{Enter}' : ' ')
      }

      const dialog = screen.getByRole('dialog', { name: deleteLabel })
      await waitFor(() =>
        expect(within(dialog).getByRole('button', { name: 'Cancel' })).toHaveFocus()
      )
      expect(onDelete).not.toHaveBeenCalled()

      await user.keyboard('{Enter}')

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      expect(onDelete).not.toHaveBeenCalled()
    }
  )

  it.each(['click', 'Enter'] as const)(
    'deletes once through native %s activation and closes only after success',
    async (activation) => {
      const deletion = deferred()
      const onDelete = vi.fn().mockReturnValue(deletion.promise)
      const user = userEvent.setup()
      renderDeletion(onDelete)
      await user.click(screen.getByRole('button', { name: deleteLabel }))
      const dialog = screen.getByRole('dialog')
      const remove = within(dialog).getByRole('button', { name: deleteLabel })

      if (activation === 'click') {
        await user.click(remove)
      } else {
        remove.focus()
        await user.keyboard('{Enter}')
      }

      expect(onDelete).toHaveBeenCalledExactlyOnceWith()
      expect(dialog).toBeInTheDocument()

      await act(async () => {
        deletion.resolve()
        await deletion.promise
      })

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      expect(onDelete).toHaveBeenCalledOnce()
    }
  )

  it('guards repeated native clicks in the same event turn', async () => {
    const deletion = deferred()
    const onDelete = vi.fn().mockReturnValue(deletion.promise)
    const user = userEvent.setup()
    renderDeletion(onDelete)
    await user.click(screen.getByRole('button', { name: deleteLabel }))
    const remove = within(screen.getByRole('dialog')).getByRole('button', {
      name: deleteLabel,
    })

    act(() => {
      remove.click()
      remove.click()
      remove.click()
    })

    expect(onDelete).toHaveBeenCalledExactlyOnceWith()
    expect(remove).toBeDisabled()

    await act(async () => {
      deletion.resolve()
      await deletion.promise
    })

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(onDelete).toHaveBeenCalledOnce()
  })

  it('shows pending state and blocks repeated activation and dismissal', async () => {
    const deletion = deferred()
    const onDelete = vi.fn().mockReturnValue(deletion.promise)
    const user = userEvent.setup()
    renderDeletion(onDelete)
    await user.click(screen.getByRole('button', { name: deleteLabel }))
    const dialog = screen.getByRole('dialog')
    const remove = within(dialog).getByRole('button', { name: deleteLabel })
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

    expect(onDelete).toHaveBeenCalledExactlyOnceWith()
    expect(dialog).toBeInTheDocument()

    await act(async () => {
      deletion.resolve()
      await deletion.promise
    })

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(onDelete).toHaveBeenCalledOnce()
  })

  it('keeps a rejected deletion visible and allows a successful retry', async () => {
    const first = deferred()
    const retry = deferred()
    const onDelete = vi
      .fn()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(retry.promise)
    const user = userEvent.setup()
    renderDeletion(onDelete)
    await user.click(screen.getByRole('button', { name: deleteLabel }))
    const dialog = screen.getByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: deleteLabel }))

    await act(async () => {
      first.reject(new Error('Deletion failed'))
      await first.promise.catch(() => undefined)
    })

    expect(dialog).toBeInTheDocument()
    expect(within(dialog).getByRole('alert')).toHaveTextContent(
      'Error: Deletion failed'
    )
    expect(within(dialog).getByRole('button', { name: deleteLabel })).toBeEnabled()
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toBeEnabled()
    expect(onDelete).toHaveBeenCalledOnce()

    await user.click(within(dialog).getByRole('button', { name: deleteLabel }))

    expect(onDelete).toHaveBeenCalledTimes(2)
    expect(within(dialog).queryByRole('alert')).not.toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: deleteLabel })).toBeDisabled()

    await act(async () => {
      retry.resolve()
      await retry.promise
    })

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(onDelete).toHaveBeenCalledTimes(2)
  })

  it('closes after a synchronous deletion callback succeeds', async () => {
    const onDelete = vi.fn(() => undefined)
    const user = userEvent.setup()
    renderDeletion(onDelete)
    await user.click(screen.getByRole('button', { name: deleteLabel }))
    await user.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: deleteLabel })
    )

    expect(onDelete).toHaveBeenCalledExactlyOnceWith()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})

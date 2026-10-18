import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { confirmAction } from '@/lib/confirm'
import { ConfirmDialogHost } from '../ConfirmDialogHost'

describe('ConfirmDialogHost', () => {
  it('asks in the app dialog with Cancel focused, so Enter never confirms by accident', async () => {
    const user = userEvent.setup()
    render(<ConfirmDialogHost />)
    let answer: Promise<boolean>
    act(() => { answer = confirmAction({ title: 'Forget Lab?', message: 'This removes its saved connection.', confirmLabel: 'Forget', destructive: true }) })
    expect(await screen.findByRole('dialog', { name: 'Forget Lab?' })).toHaveTextContent('This removes its saved connection.')
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus()
    await user.keyboard('{Enter}')
    await expect(answer!).resolves.toBe(false)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('returns focus to Cancel when a newer request replaces a focused destructive confirmation', async () => {
    const user = userEvent.setup()
    render(<ConfirmDialogHost />)
    let first: Promise<boolean>
    let second: Promise<boolean>
    act(() => { first = confirmAction({ title: 'Delete first item?', message: 'The first item will be removed.', destructive: true }) })
    await screen.findByRole('dialog', { name: 'Delete first item?' })
    await user.tab()
    expect(screen.getByRole('button', { name: 'Confirm' })).toHaveFocus()

    act(() => { second = confirmAction({ title: 'Delete second item?', message: 'The second item will be removed.', destructive: true }) })
    await expect(first!).resolves.toBe(false)
    await screen.findByRole('dialog', { name: 'Delete second item?' })
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus()
    await user.keyboard('{Enter}')
    await expect(second!).resolves.toBe(false)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('resolves true only from the confirm button and false on Escape or a newer request', async () => {
    const user = userEvent.setup()
    render(<ConfirmDialogHost />)
    let first: Promise<boolean>
    let second: Promise<boolean>
    act(() => { first = confirmAction({ message: 'One?' }) })
    await screen.findByRole('dialog')
    act(() => { second = confirmAction({ message: 'Two?', confirmLabel: 'Do it' }) })
    await expect(first!).resolves.toBe(false)
    await user.click(await screen.findByRole('button', { name: 'Do it' }))
    await expect(second!).resolves.toBe(true)
    let third: Promise<boolean>
    act(() => { third = confirmAction({ message: 'Three?' }) })
    await screen.findByRole('dialog')
    await user.keyboard('{Escape}')
    await expect(third!).resolves.toBe(false)
  })
})

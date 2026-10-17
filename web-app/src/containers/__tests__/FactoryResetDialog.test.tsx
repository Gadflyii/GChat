import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { FactoryResetDialog } from '@/containers/dialogs/FactoryResetDialog'

vi.mock('@/i18n/react-i18next-compat', () => ({
  useTranslation: () => ({
    t: (key: string) =>
      ({
        'settings:general.factoryResetTitle': 'Reset GChat?',
        'settings:general.factoryResetDesc': 'Reset GChat to factory settings.',
        'settings:general.cancel': 'Cancel',
        'settings:general.reset': 'Reset',
      } as Record<string, string>)[key] ?? key,
  }),
}))

function renderDialog() {
  const onReset = vi.fn()
  const user = userEvent.setup()
  render(
    <FactoryResetDialog onReset={onReset}>
      <button type="button">Reset GChat</button>
    </FactoryResetDialog>
  )
  return { onReset, user, trigger: screen.getByRole('button', { name: 'Reset GChat' }) }
}

describe('factory reset confirmation', () => {
  it('focuses Cancel when opened and leaves reset untouched', async () => {
    const { onReset, user, trigger } = renderDialog()

    await user.click(trigger)

    expect(screen.getByRole('dialog', { name: 'Reset GChat?' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus()
    expect(onReset).not.toHaveBeenCalled()
  })

  it('cancels on the default Enter action and focuses Cancel again when reopened', async () => {
    const { onReset, user, trigger } = renderDialog()
    await user.tab()
    expect(trigger).toHaveFocus()

    await user.keyboard('{Enter}')
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus()
    await user.keyboard('{Enter}')

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(onReset).not.toHaveBeenCalled()
    await waitFor(() => expect(trigger).toHaveFocus())

    await user.keyboard('{Enter}')

    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus()
    expect(onReset).not.toHaveBeenCalled()
  })

  it.each([
    { name: 'Enter', key: '{Enter}' },
    { name: 'Space', key: ' ' },
  ])('resets exactly once when Reset is explicitly activated with $name', async ({ key }) => {
    const { onReset, user, trigger } = renderDialog()
    await user.click(trigger)
    await user.tab()
    expect(screen.getByRole('button', { name: 'Reset', exact: true })).toHaveFocus()

    await user.keyboard(key)

    expect(onReset).toHaveBeenCalledExactlyOnceWith()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    await waitFor(() => expect(trigger).toHaveFocus())
  })

  it('resets exactly once when Reset is clicked', async () => {
    const { onReset, user, trigger } = renderDialog()
    await user.click(trigger)

    await user.click(screen.getByRole('button', { name: 'Reset', exact: true }))

    expect(onReset).toHaveBeenCalledExactlyOnceWith()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    await waitFor(() => expect(trigger).toHaveFocus())
  })

  it.each(['Cancel', 'Close', 'Escape'])('dismisses with %s without resetting', async (action) => {
    const { onReset, user, trigger } = renderDialog()
    await user.click(trigger)

    if (action === 'Escape') {
      await user.keyboard('{Escape}')
    } else {
      await user.click(screen.getByRole('button', { name: action, exact: true }))
    }

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(onReset).not.toHaveBeenCalled()
    await waitFor(() => expect(trigger).toHaveFocus())
  })
})

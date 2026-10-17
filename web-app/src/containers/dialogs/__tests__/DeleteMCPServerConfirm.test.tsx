import { useState } from 'react'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import DeleteMCPServerConfirm from '../DeleteMCPServerConfirm'

const mocks = vi.hoisted(() => ({
  onConfirm: vi.fn(),
  onOpenChange: vi.fn(),
}))

vi.mock('@/i18n/react-i18next-compat', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

const removeLabel = 'mcp-servers:deleteServer.delete'
const cancelLabel = 'common:cancel'

function ConnectionRemoval() {
  const [open, setOpen] = useState(true)
  return (
    <DeleteMCPServerConfirm
      open={open}
      onOpenChange={(nextOpen) => {
        mocks.onOpenChange(nextOpen)
        setOpen(nextOpen)
      }}
      serverName="Local files"
      onConfirm={mocks.onConfirm}
    />
  )
}

function deferred() {
  let resolve!: (result?: boolean) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<boolean | void>((done, fail) => {
    resolve = done
    reject = fail
  })
  return { promise, resolve, reject }
}

beforeEach(() => {
  vi.resetAllMocks()
  mocks.onConfirm.mockResolvedValue(true)
})

describe('MCP connection removal confirmation', () => {
  it('focuses Cancel so pressing Enter does not remove a connection', async () => {
    const user = userEvent.setup()
    render(<ConnectionRemoval />)
    await waitFor(() =>
      expect(screen.getByRole('button', { name: cancelLabel })).toHaveFocus()
    )

    await user.keyboard('{Enter}')

    expect(mocks.onConfirm).not.toHaveBeenCalled()
    expect(mocks.onOpenChange).toHaveBeenCalledExactlyOnceWith(false)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it.each(['click', 'Enter'] as const)(
    'requires explicit %s activation and waits for successful removal before closing',
    async (activation) => {
      const removal = deferred()
      mocks.onConfirm.mockReturnValue(removal.promise)
      const user = userEvent.setup()
      render(<ConnectionRemoval />)
      const remove = screen.getByRole('button', { name: removeLabel })

      if (activation === 'click') {
        await user.click(remove)
      } else {
        remove.focus()
        await user.keyboard('{Enter}')
      }

      expect(mocks.onConfirm).toHaveBeenCalledOnce()
      expect(screen.getByRole('dialog')).toBeInTheDocument()
      expect(mocks.onOpenChange).not.toHaveBeenCalled()

      await act(async () => {
        removal.resolve(true)
        await removal.promise
      })

      expect(mocks.onConfirm).toHaveBeenCalledOnce()
      expect(mocks.onOpenChange).toHaveBeenCalledExactlyOnceWith(false)
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    }
  )

  it('submits once when two native clicks arrive in the same event turn', async () => {
    const removal = deferred()
    mocks.onConfirm.mockReturnValue(removal.promise)
    render(<ConnectionRemoval />)
    const remove = screen.getByRole('button', { name: removeLabel })

    act(() => {
      remove.click()
      remove.click()
    })

    expect(mocks.onConfirm).toHaveBeenCalledOnce()
    expect(remove).toBeDisabled()
    await act(async () => {
      removal.resolve()
      await removal.promise
    })
    expect(mocks.onOpenChange).toHaveBeenCalledExactlyOnceWith(false)
  })

  it('shows pending feedback and prevents repeated submission or dismissal', async () => {
    const removal = deferred()
    mocks.onConfirm.mockReturnValue(removal.promise)
    const user = userEvent.setup()
    render(<ConnectionRemoval />)
    const remove = screen.getByRole('button', { name: removeLabel })
    await user.click(remove)

    expect(remove).toBeDisabled()
    expect(remove).toHaveAttribute('aria-busy', 'true')
    expect(remove).toHaveTextContent('common:loading')
    expect(screen.getByRole('dialog')).toHaveAttribute('aria-busy', 'true')
    expect(screen.getByRole('button', { name: cancelLabel })).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'Close' })).not.toBeInTheDocument()

    await user.dblClick(remove)
    await user.keyboard('{Enter} {Escape}')
    await user.click(screen.getByRole('button', { name: cancelLabel }))

    expect(mocks.onConfirm).toHaveBeenCalledOnce()
    expect(mocks.onOpenChange).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog')).toBeInTheDocument()

    await act(async () => {
      removal.resolve(true)
      await removal.promise
    })
    expect(mocks.onOpenChange).toHaveBeenCalledExactlyOnceWith(false)
  })

  it.each(['reported', 'rejected'] as const)(
    'keeps a %s failure open and allows a successful retry',
    async (failure) => {
      const removal = deferred()
      const retry = deferred()
      mocks.onConfirm
        .mockReturnValueOnce(removal.promise)
        .mockReturnValueOnce(retry.promise)
      const user = userEvent.setup()
      render(<ConnectionRemoval />)
      await user.click(screen.getByRole('button', { name: removeLabel }))

      await act(async () => {
        if (failure === 'reported') removal.resolve(false)
        else removal.reject(new Error('Connection could not be saved'))
        await removal.promise.catch(() => undefined)
      })

      expect(screen.getByRole('alert')).toHaveTextContent(
        'mcp-servers:deleteServer.error'
      )
      expect(screen.getByRole('button', { name: removeLabel })).toBeEnabled()
      expect(screen.getByRole('button', { name: cancelLabel })).toBeEnabled()
      expect(mocks.onOpenChange).not.toHaveBeenCalled()

      await user.click(screen.getByRole('button', { name: removeLabel }))
      expect(mocks.onConfirm).toHaveBeenCalledTimes(2)
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
      await act(async () => {
        retry.resolve(true)
        await retry.promise
      })

      expect(mocks.onConfirm).toHaveBeenCalledTimes(2)
      expect(mocks.onOpenChange).toHaveBeenCalledExactlyOnceWith(false)
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    }
  )
})

import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { toast } from 'sonner'
import { CopyButton } from '../CopyButton'

vi.mock('sonner', () => ({ toast: { error: vi.fn() } }))

const originalClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard')

function setClipboard(
  clipboard: { writeText: (text: string) => Promise<void> } | undefined
) {
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: clipboard,
  })
}

function deferredCopy() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

describe('CopyButton', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
  })

  afterEach(() => {
    cleanup()
    vi.clearAllTimers()
    vi.useRealTimers()
    if (originalClipboard) {
      Object.defineProperty(navigator, 'clipboard', originalClipboard)
    } else {
      Reflect.deleteProperty(navigator, 'clipboard')
    }
  })

  it('names the real button and waits for the clipboard before announcing success', async () => {
    const copy = deferredCopy()
    const writeText = vi.fn(() => copy.promise)
    setClipboard({ writeText })
    render(<CopyButton text="The complete answer" />)
    const button = screen.getByRole('button', { name: 'Copy' })

    act(() => {
      button.click()
      button.click()
    })
    expect(writeText).toHaveBeenCalledExactlyOnceWith('The complete answer')
    expect(button).toHaveAccessibleName('Copying…')
    expect(screen.queryByText('Copied')).not.toBeInTheDocument()

    act(() => {
      button.click()
      vi.advanceTimersByTime(2000)
    })
    expect(writeText).toHaveBeenCalledTimes(1)
    expect(button).toHaveAccessibleName('Copying…')
    expect(screen.queryByText('Copied')).not.toBeInTheDocument()

    await act(async () => {
      copy.resolve()
      await copy.promise
    })
    expect(button).toHaveAccessibleName('Copied')
    expect(screen.getByRole('status')).toHaveTextContent('Copied')
    expect(screen.getByRole('status')).toHaveAttribute('aria-live', 'polite')
    expect(toast.error).not.toHaveBeenCalled()

    act(() => vi.advanceTimersByTime(1999))
    expect(button).toHaveAccessibleName('Copied')
    act(() => vi.advanceTimersByTime(1))
    expect(button).toHaveAccessibleName('Copy')
    expect(screen.queryByText('Copied')).not.toBeInTheDocument()

    act(() => button.click())
    expect(writeText).toHaveBeenCalledTimes(2)
    await act(async () => {
      await copy.promise
    })
  })

  it.each(['rejected', 'thrown', 'unavailable'] as const)(
    'reports an %s clipboard failure without success and allows retry',
    async (failure) => {
      const writeText = vi.fn((): Promise<void> => {
        if (failure === 'thrown') throw new Error('Clipboard denied')
        return Promise.reject(new Error('Clipboard denied'))
      })
      setClipboard(failure === 'unavailable' ? undefined : { writeText })
      render(<CopyButton text="Retry this answer" />)
      const button = screen.getByRole('button', { name: 'Copy' })

      await act(async () => button.click())
      expect(toast.error).toHaveBeenCalledExactlyOnceWith(
        'Could not copy. Try again.'
      )
      expect(button).toHaveAccessibleName('Copy')
      expect(button).not.toBeDisabled()
      expect(screen.queryByText('Copied')).not.toBeInTheDocument()
      act(() => vi.advanceTimersByTime(2000))
      expect(screen.queryByText('Copied')).not.toBeInTheDocument()

      const retry = deferredCopy()
      const retryWrite = vi.fn(() => retry.promise)
      setClipboard({ writeText: retryWrite })
      act(() => button.click())
      expect(retryWrite).toHaveBeenCalledExactlyOnceWith('Retry this answer')
      expect(button).toHaveAccessibleName('Copying…')
      expect(screen.queryByText('Copied')).not.toBeInTheDocument()
      await act(async () => {
        retry.resolve()
        await retry.promise
      })
      expect(button).toHaveAccessibleName('Copied')
      expect(screen.getByRole('status')).toHaveTextContent('Copied')
      expect(toast.error).toHaveBeenCalledTimes(1)
    }
  )
})

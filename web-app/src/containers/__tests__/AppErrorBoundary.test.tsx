import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { AppErrorBoundary } from '../AppErrorBoundary'

vi.mock('../GlobalError', () => ({
  default: ({ error }: { error: Error }) => <div role="alert">{error.message}</div>,
}))

describe('AppErrorBoundary', () => {
  it('keeps healthy content visible and shows a local fallback after a render failure', () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    function Content({ fail }: { fail: boolean }) {
      if (fail) throw new Error('Render failed')
      return <div>Chat ready</div>
    }
    const view = render(<AppErrorBoundary><Content fail={false} /></AppErrorBoundary>)
    expect(screen.getByText('Chat ready')).toBeInTheDocument()
    view.rerender(<AppErrorBoundary><Content fail /></AppErrorBoundary>)
    expect(screen.getByRole('alert')).toHaveTextContent('Render failed')
    expect(log).toHaveBeenCalled()
    log.mockRestore()
  })
})

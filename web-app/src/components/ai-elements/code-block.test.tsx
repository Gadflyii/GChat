import { act, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { CodeBlock } from './code-block'

const pending = vi.hoisted(() => new Map<string, Array<(value: string) => void>>())
vi.mock('@/lib/codeHighlighter', () => ({
  codeToHtml: (code: string) => new Promise<string>(resolve => {
    pending.set(code, [...(pending.get(code) ?? []), resolve])
  }),
}))

describe('deferred code highlighting', () => {
  it('shows source immediately and ignores an older highlight after code changes', async () => {
    const { rerender } = render(<CodeBlock code="first" language="json" />)
    expect(screen.getAllByText('first')).toHaveLength(2)
    await waitFor(() => expect(pending.get('first')).toHaveLength(2))
    rerender(<CodeBlock code="second" language="json" />)
    expect(screen.getAllByText('second')).toHaveLength(2)
    await waitFor(() => expect(pending.get('second')).toHaveLength(2))
    await act(async () => {
      pending.get('second')!.forEach(resolve => resolve('<pre><code>new result</code></pre>'))
    })
    expect(screen.getAllByText('new result')).toHaveLength(2)
    await act(async () => {
      pending.get('first')!.forEach(resolve => resolve('<pre><code>old result</code></pre>'))
    })
    expect(screen.queryByText('old result')).toBeNull()
    expect(screen.getAllByText('new result')).toHaveLength(2)
  })
})

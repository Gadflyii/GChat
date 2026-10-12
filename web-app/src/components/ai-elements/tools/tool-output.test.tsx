import { render, screen, waitFor } from '@testing-library/react'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { ToolOutput } from './tool'

// Text-block rendering uses the highlighter boundary without fetching Vite assets.
vi.mock('@/components/ai-elements/code-block', () => ({
  CodeBlock: ({ code }: { code: string }) => (
    <pre>
      <code data-test-highlight="ready">{code}</code>
    </pre>
  ),
  highlightCode: async (source: string) => {
    const content = document.createElement('code')
    content.dataset.testHighlight = 'ready'
    content.textContent = source
    const html = `<pre>${content.outerHTML}</pre>`
    return [html, html]
  },
}))

describe('ToolOutput', () => {
  beforeAll(() => {
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      }
    )
  })

  afterAll(() => {
    vi.unstubAllGlobals()
  })

  it('renders multiline result fields as real text blocks', async () => {
    const { container } = render(
      <ToolOutput
        output={{
          status: 'ok',
          summary: 'dir\tqwe\nfile\t.DS_Store\nfile\tplanets.md',
        }}
        resolver={(value) => Promise.resolve(value)}
      />
    )

    expect(screen.getByText('summary')).toBeInTheDocument()
    expect(container.textContent).toContain(
      'dir\tqwe\nfile\t.DS_Store\nfile\tplanets.md'
    )
    expect(container.textContent).not.toContain('\\n')
    await waitFor(() => {
      const highlighted = [
        ...container.querySelectorAll('pre code[data-test-highlight="ready"]'),
      ]
      expect(
        highlighted.some((code) =>
          code.textContent === 'dir\tqwe\nfile\t.DS_Store\nfile\tplanets.md'
        )
      ).toBe(true)
    })
  })
})

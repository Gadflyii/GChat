import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@i18n/react-i18next-compat', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))
vi.mock('@/i18n/react-i18next-compat', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))
vi.mock('@gchat/core', () => ({ fs: { writeFileSync: vi.fn() } }))
vi.mock('@/hooks/useServiceHub', () => ({
  getServiceHub: () => ({ dialog: () => ({ save: vi.fn() }) }),
}))
vi.mock('@/lib/platform/utils', () => ({ isPlatformTauri: () => false }))
vi.mock('@/components/ai-elements/code-block', () => ({
  CodeBlock: ({ code }: { code: string }) => <pre>{code}</pre>,
}))

import { ArtifactPanel } from '../ArtifactPanel'
import { RenderMarkdown } from '../RenderMarkdown'
import { useArtifactStore } from '@/stores/artifact-store'

const PARTIAL = '```html\n<!doctype html><html><body><h1>hi'
const SETTLED =
  '```html\n<!doctype html><html><body><h1>hi</h1></body></html>\n```'

function Harness({
  content,
  streaming,
}: {
  content: string
  streaming: boolean
}) {
  return (
    <>
      <RenderMarkdown
        content={content}
        isStreaming={streaming}
        enableHtmlPreview
      />
      <ArtifactPanel />
    </>
  )
}

const trigger = () =>
  document.querySelector<HTMLButtonElement>('[data-artifact-trigger="html"]')
const previewPane = () =>
  document.querySelector<HTMLElement>('[data-artifact-pane="preview"]')

// The panel schedules its slide-in over rAF + a timeout; drain both so the
// resulting state updates stay inside act().
const settlePanelAnimation = () =>
  act(() => {
    vi.advanceTimersByTime(500)
  })

// jsdom has no blob URLs; the web preview path needs them to reach the iframe.
let blobUrlSeq = 0

describe('ArtifactPanel', () => {
  beforeEach(() => {
    blobUrlSeq = 0
    URL.createObjectURL = vi.fn(() => `blob:artifact-${++blobUrlSeq}`)
    URL.revokeObjectURL = vi.fn()
    vi.useFakeTimers()
    act(() => useArtifactStore.getState().close())
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('hands the open panel back to the preview once generation settles', () => {
    const { rerender } = render(<Harness content={PARTIAL} streaming />)

    act(() => {
      fireEvent.click(trigger()!)
    })
    settlePanelAnimation()
    expect(useArtifactStore.getState().streaming).toBe(true)

    // The `code` renderer must survive streaming→done: a remount would give the
    // trigger a fresh useId, orphaning the panel it already bound to.
    act(() => {
      rerender(<Harness content={SETTLED} streaming={false} />)
    })
    settlePanelAnimation()

    expect(useArtifactStore.getState().streaming).toBe(false)
    expect(previewPane()?.className).not.toContain('hidden')
    expect(document.body.textContent).not.toContain(
      'workspacePreview.generating'
    )
    expect(previewPane()?.querySelector('iframe')?.getAttribute('src')).toMatch(
      /^blob:/
    )
  })

  it('auto-opens the panel when a generation settles', () => {
    const { rerender } = render(<Harness content={PARTIAL} streaming />)
    expect(useArtifactStore.getState().isOpen).toBe(false)

    act(() => {
      rerender(<Harness content={SETTLED} streaming={false} />)
    })
    settlePanelAnimation()

    expect(useArtifactStore.getState().isOpen).toBe(true)
    expect(useArtifactStore.getState().streaming).toBe(false)
  })

  it('leaves historical artifacts closed', () => {
    render(<Harness content={SETTLED} streaming={false} />)
    settlePanelAnimation()
    expect(useArtifactStore.getState().isOpen).toBe(false)
  })

  it('returns keyboard focus to the message opener when closing the standalone panel', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    render(<Harness content={SETTLED} streaming={false} />)
    const opener = trigger()!
    await user.click(opener)
    settlePanelAnimation()
    const close = screen.getByRole('button', { name: 'Close' })
    close.focus()
    await user.keyboard('{Enter}')
    settlePanelAnimation()

    expect(useArtifactStore.getState().isOpen).toBe(false)
    expect(opener).toHaveFocus()
  })

  it('re-clamps an oversized panel when the window narrows, never widening it', () => {
    const original = window.innerWidth
    const setWindowWidth = (px: number) => {
      Object.defineProperty(window, 'innerWidth', {
        configurable: true,
        writable: true,
        value: px,
      })
      act(() => {
        window.dispatchEvent(new Event('resize'))
      })
    }
    try {
      Object.defineProperty(window, 'innerWidth', {
        configurable: true,
        writable: true,
        value: 1400,
      })
      render(<Harness content={SETTLED} streaming={false} />)
      act(() => {
        fireEvent.click(trigger()!)
      })
      settlePanelAnimation()
      const panel = () =>
        document.querySelector<HTMLElement>('div.border-l.shrink-0')!
      const wide = parseInt(panel().style.width, 10)
      expect(wide).toBe(630)

      setWindowWidth(900)
      const narrowed = parseInt(panel().style.width, 10)
      expect(narrowed).toBeLessThan(wide)
      // Chat keeps at least MIN_CHAT_WIDTH (panel minimum + 100) of room.
      expect(900 - narrowed).toBeGreaterThanOrEqual(480)

      // Widening the window again does not widen the panel past that choice.
      setWindowWidth(1400)
      expect(parseInt(panel().style.width, 10)).toBe(narrowed)
    } finally {
      Object.defineProperty(window, 'innerWidth', {
        configurable: true,
        writable: true,
        value: original,
      })
    }
  })
})

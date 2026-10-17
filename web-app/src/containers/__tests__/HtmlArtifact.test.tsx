import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const native = vi.hoisted(() => ({ invoke: vi.fn(), tauri: false }))

vi.mock('@/i18n/react-i18next-compat', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

vi.mock('@tauri-apps/api/core', () => ({ invoke: native.invoke }))

vi.mock('@gchat/core', () => ({ fs: { writeFileSync: vi.fn() } }))

vi.mock('@/hooks/useServiceHub', () => ({
  getServiceHub: () => ({ dialog: () => ({ save: vi.fn() }) }),
}))

vi.mock('@/lib/platform/utils', () => ({
  isPlatformTauri: () => native.tauri,
}))

vi.mock('@/components/ai-elements/code-block', () => ({
  CodeBlock: ({ code }: { code: string }) => <pre>{code}</pre>,
}))

import { HtmlArtifact } from '../HtmlArtifact'

// jsdom publishes the initial about:blank iframe load asynchronously.
async function renderArtifact(code: string, streaming = false) {
  const view = render(<HtmlArtifact code={code} streaming={streaming} />)
  await act(async () => {
    await new Promise<void>((resolve) => {
      view.container.querySelector('iframe')!.addEventListener(
        'load',
        () => resolve(),
        { once: true }
      )
    })
  })
  return view
}

const SCROLL_HEIGHT = 1200

const codePane = () =>
  document.querySelector<HTMLElement>('[data-artifact-pane="code"]')!
const previewPane = () =>
  document.querySelector<HTMLElement>('[data-artifact-pane="preview"]')!

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((done, fail) => {
    resolve = done
    reject = fail
  })
  return { promise, resolve, reject }
}

async function rejectRegistration(
  request: ReturnType<typeof deferred<void>>,
  message: string
) {
  await act(async () => {
    request.reject(new Error(message))
    await request.promise.catch(() => undefined)
  })
}

describe('HtmlArtifact', () => {
  let scrollTops: number[]

  beforeEach(() => {
    native.tauri = false
    native.invoke.mockReset().mockResolvedValue(undefined)
    scrollTops = []
    Object.defineProperty(HTMLElement.prototype, 'scrollTop', {
      configurable: true,
      get: () => 0,
      set(value: number) {
        scrollTops.push(value)
      },
    })
    Object.defineProperty(HTMLElement.prototype, 'scrollHeight', {
      configurable: true,
      get: () => SCROLL_HEIGHT,
    })
  })

  afterEach(() => {
    delete (HTMLElement.prototype as unknown as Record<string, unknown>)
      .scrollTop
    delete (HTMLElement.prototype as unknown as Record<string, unknown>)
      .scrollHeight
  })

  it('shows the streaming code instead of an unrenderable preview', async () => {
    await renderArtifact('<div>partial', true)

    expect(codePane().className).not.toContain('hidden')
    expect(previewPane().className).toContain('hidden')
    expect(codePane().textContent).toContain('workspacePreview.generating')
    expect(document.querySelector('iframe')).not.toHaveAttribute('src')
  })

  it('follows the tail of the code while it streams in', async () => {
    const { rerender } = await renderArtifact('<div>', true)
    scrollTops.length = 0

    rerender(<HtmlArtifact code="<div>more markup" streaming />)

    expect(scrollTops).toContain(SCROLL_HEIGHT)
  })

  it('stops following once the reader scrolls away from the tail', async () => {
    Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
      configurable: true,
      get: () => 400,
    })
    const { rerender } = await renderArtifact('<div>', true)

    // scrollTop reads as 0, so the gap to the tail is larger than the threshold.
    codePane()
      .querySelector('.overflow-y-auto')!
      .dispatchEvent(new Event('scroll'))
    scrollTops.length = 0
    rerender(<HtmlArtifact code="<div>more markup" streaming />)

    expect(scrollTops).toHaveLength(0)
    delete (HTMLElement.prototype as unknown as Record<string, unknown>)
      .clientHeight
  })

  it('hands the viewer back to the preview once generation settles', async () => {
    const { rerender } = await renderArtifact('<div>done</div>', true)

    rerender(<HtmlArtifact code="<div>done</div>" />)

    expect(previewPane().className).not.toContain('hidden')
    expect(codePane().className).toContain('hidden')
    expect(codePane().textContent).not.toContain('workspacePreview.generating')
  })

  it('keeps the preview visible for a settled artifact', async () => {
    await renderArtifact('<div>done</div>')

    expect(previewPane().className).not.toContain('hidden')
    expect(codePane().className).toContain('hidden')
  })

  it('keeps the source available when native preview registration fails and retries the same document', async () => {
    native.tauri = true
    const registration = deferred<void>()
    const retry = deferred<void>()
    native.invoke
      .mockReturnValueOnce(registration.promise)
      .mockReturnValueOnce(retry.promise)
    const code = '<main>My recovered preview</main>'
    render(<HtmlArtifact code={code} />)
    expect(native.invoke).toHaveBeenCalledOnce()
    const registeredDocument = native.invoke.mock.calls[0][1]
    expect(native.invoke).toHaveBeenCalledWith('set_artifact_html', {
      id: expect.any(String),
      html: expect.stringContaining(code),
    })

    await rejectRegistration(
      registration,
      'The native preview service is unavailable'
    )
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Could not load the preview.'
    )
    fireEvent.click(screen.getByRole('button', { name: 'Code', exact: true }))
    expect(codePane()).toBeVisible()
    expect(codePane()).toHaveTextContent(code)
    fireEvent.click(screen.getByRole('button', { name: 'Preview', exact: true }))
    fireEvent.click(screen.getByRole('button', { name: 'Retry preview' }))

    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(native.invoke).toHaveBeenCalledTimes(2)
    expect(native.invoke).toHaveBeenNthCalledWith(
      2,
      'set_artifact_html',
      registeredDocument
    )
    await act(async () => {
      retry.resolve(undefined)
      await retry.promise
    })

    const iframe = screen.getByTitle('HTML preview')
    expect(iframe.getAttribute('src')).toContain(registeredDocument.id)
    fireEvent.load(iframe)
    expect(previewPane()).toBeVisible()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Retry preview' })
    ).not.toBeInTheDocument()
  })

  it('ignores a previous document registration failure after the source changes', async () => {
    native.tauri = true
    const previous = deferred<void>()
    native.invoke
      .mockReturnValueOnce(previous.promise)
      .mockResolvedValueOnce(undefined)
    const { rerender } = render(<HtmlArtifact code="<p>Previous document</p>" />)
    expect(native.invoke).toHaveBeenCalledOnce()

    rerender(<HtmlArtifact code="<p>Current document</p>" />)
    await waitFor(() =>
      expect(screen.getByTitle('HTML preview')).toHaveAttribute('src')
    )
    const currentUrl = screen.getByTitle('HTML preview').getAttribute('src')
    fireEvent.load(screen.getByTitle('HTML preview'))
    await rejectRegistration(previous, 'Previous registration failed late')

    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByTitle('HTML preview')).toHaveAttribute('src', currentUrl)
    expect(native.invoke).toHaveBeenCalledTimes(2)
    fireEvent.click(screen.getByRole('button', { name: 'Code', exact: true }))
    expect(codePane()).toBeVisible()
    expect(codePane()).toHaveTextContent('<p>Current document</p>')
    expect(codePane()).not.toHaveTextContent('Previous document')
  })

  it('clears the native document on unmount and ignores its late registration failure', async () => {
    native.tauri = true
    const registration = deferred<void>()
    native.invoke.mockReturnValueOnce(registration.promise)
    const { unmount } = render(<HtmlArtifact code="<p>Closed document</p>" />)
    const { id } = native.invoke.mock.calls[0][1]

    unmount()
    expect(native.invoke).toHaveBeenNthCalledWith(2, 'clear_artifact_html', { id })
    await rejectRegistration(registration, 'The preview was closed')

    expect(native.invoke).toHaveBeenCalledTimes(2)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.queryByTitle('HTML preview')).not.toBeInTheDocument()
  })
})

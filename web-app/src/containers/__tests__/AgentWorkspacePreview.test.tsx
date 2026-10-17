import type { ReactNode } from 'react'
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AgentWorkspacePreview } from '../AgentWorkspacePreview'
import { useWorkspacePreviewStore } from '@/stores/workspace-preview-store'
import { useArtifactStore } from '@/stores/artifact-store'
import type {
  AgentWorkspaceFile,
  AgentWorkspaceRequest,
  AgentWorkspaceText,
} from '@/types/agent'

const native = vi.hoisted(() => ({ stat: vi.fn(), read: vi.fn() }))

vi.mock('@/services/agent/tauri', () => ({
  statAgentWorkspaceFile: native.stat,
  readAgentWorkspaceText: native.read,
}))
vi.mock('@tauri-apps/api/core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tauri-apps/api/core')>()),
  convertFileSrc: (path: string) => `asset://localhost${path}`,
}))
vi.mock('@/i18n/react-i18next-compat', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))
vi.mock('motion/react', () => ({
  AnimatePresence: ({ children }: { children: ReactNode }) => <>{children}</>,
  motion: {
    div: ({
      children,
      className,
    }: {
      children: ReactNode
      className?: string
    }) => <div className={className}>{children}</div>,
  },
}))
vi.mock('@/containers/HtmlArtifact', () => ({
  HtmlArtifact: ({ code }: { code: string }) => <pre>{code}</pre>,
}))

const firstFile = {
  rootId: 'project',
  rootPath: '/workspace/project',
  relativePath: 'notes/first.txt',
}
const secondFile = { ...firstFile, relativePath: 'notes/second.txt' }
const imageFile = { ...firstFile, relativePath: 'images/picture.png' }

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((done, fail) => {
    resolve = done
    reject = fail
  })
  return { promise, resolve, reject }
}

function file(relativePath: string): AgentWorkspaceFile {
  return {
    path: relativePath,
    absolutePath: `/workspace/project/${relativePath}`,
    size: 128,
    extension: 'txt',
  }
}

function text(
  content: string,
  relativePath = firstFile.relativePath
): AgentWorkspaceText {
  return { path: relativePath, content, truncated: false }
}

async function complete<T>(request: ReturnType<typeof deferred<T>>, value: T) {
  await act(async () => {
    request.resolve(value)
    await request.promise
  })
}

async function fail<T>(request: ReturnType<typeof deferred<T>>, message: string) {
  await act(async () => {
    request.reject(new Error(message))
    await request.promise.catch(() => undefined)
  })
}

function renderPreview() {
  useWorkspacePreviewStore.getState().openFile(firstFile)
  render(<AgentWorkspacePreview />)
}

afterEach(cleanup)
beforeEach(() => {
  vi.resetAllMocks()
  useWorkspacePreviewStore.getState().reset()
  useArtifactStore.getState().close()
  native.stat.mockImplementation((request: AgentWorkspaceRequest) =>
    Promise.resolve(file(request.relativePath!))
  )
})

describe('Agent workspace file preview recovery', () => {
  it('recovers an image decode failure by retrying the same file without losing open tabs', async () => {
    const retry = deferred<AgentWorkspaceFile>()
    const image = { ...file(imageFile.relativePath), extension: 'png' }
    native.stat
      .mockResolvedValueOnce(image)
      .mockReturnValueOnce(retry.promise)
    useWorkspacePreviewStore.getState().openFile(firstFile)
    useWorkspacePreviewStore.getState().openFile(imageFile)
    render(<AgentWorkspacePreview />)

    const initialImage = await screen.findByRole('img', { name: 'picture.png' })
    expect(initialImage).toHaveAttribute(
      'src',
      `asset://localhost${image.absolutePath}`
    )
    fireEvent.error(initialImage)
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Could not preview this file.'
    )
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'first.txt' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'picture.png' })).toBeVisible()

    fireEvent.click(screen.getByRole('button', { name: 'Retry preview' }))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('Loading preview…')
    expect(native.stat).toHaveBeenNthCalledWith(1, imageFile)
    expect(native.stat).toHaveBeenNthCalledWith(2, imageFile)

    await complete(retry, image)
    const recoveredImage = await screen.findByRole('img', {
      name: 'picture.png',
    })
    fireEvent.load(recoveredImage)
    expect(recoveredImage).toHaveAttribute(
      'src',
      `asset://localhost${image.absolutePath}`
    )
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'first.txt' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'picture.png' })).toBeVisible()
    expect(native.read).not.toHaveBeenCalled()
  })

  it.each(['success', 'failure'] as const)(
    'does not restore a closed image preview after its retry %s',
    async (outcome) => {
      const retry = deferred<AgentWorkspaceFile>()
      const image = { ...file(imageFile.relativePath), extension: 'png' }
      native.stat
        .mockResolvedValueOnce(image)
        .mockReturnValueOnce(retry.promise)
      useWorkspacePreviewStore.getState().openFile(imageFile)
      render(<AgentWorkspacePreview />)

      fireEvent.error(await screen.findByRole('img', { name: 'picture.png' }))
      fireEvent.click(screen.getByRole('button', { name: 'Retry preview' }))
      expect(screen.getByRole('status')).toHaveTextContent('Loading preview…')
      expect(native.stat).toHaveBeenNthCalledWith(2, imageFile)
      fireEvent.click(screen.getByRole('button', { name: 'Close picture.png' }))

      if (outcome === 'success') {
        await complete(retry, image)
      } else {
        await fail(retry, 'The closed image is no longer available')
      }

      expect(screen.queryByRole('img')).not.toBeInTheDocument()
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
      expect(screen.queryByRole('status')).not.toBeInTheDocument()
      expect(
        screen.queryByRole('button', { name: 'picture.png' })
      ).not.toBeInTheDocument()
      expect(useWorkspacePreviewStore.getState().tabs).toEqual([])
      expect(native.read).not.toHaveBeenCalled()
    }
  )

  it('retries a failed file stat for the exact selected file and announces loading', async () => {
    const initial = deferred<AgentWorkspaceFile>()
    const retry = deferred<AgentWorkspaceFile>()
    native.stat
      .mockReturnValueOnce(initial.promise)
      .mockReturnValueOnce(retry.promise)
    native.read.mockResolvedValueOnce(
      text('Recovered after the file became available.')
    )
    renderPreview()

    await fail(initial, 'The file is unavailable')
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Could not preview this file.'
    )
    expect(native.read).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Retry preview' }))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('Loading preview…')
    expect(native.stat).toHaveBeenNthCalledWith(1, firstFile)
    expect(native.stat).toHaveBeenNthCalledWith(2, firstFile)

    await complete(retry, file(firstFile.relativePath))
    expect(
      await screen.findByText('Recovered after the file became available.')
    ).toBeVisible()
    expect(native.read).toHaveBeenCalledExactlyOnceWith(firstFile)
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Retry preview' })
    ).not.toBeInTheDocument()
  })

  it('keeps a failed read retryable through another failure and then displays recovered text', async () => {
    const initial = deferred<AgentWorkspaceText>()
    const retry = deferred<AgentWorkspaceText>()
    const recovery = deferred<AgentWorkspaceText>()
    native.read
      .mockReturnValueOnce(initial.promise)
      .mockReturnValueOnce(retry.promise)
      .mockReturnValueOnce(recovery.promise)
    renderPreview()
    await waitFor(() => expect(native.read).toHaveBeenCalledTimes(1))

    await fail(initial, 'Initial read denied')
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Could not preview this file.'
    )
    fireEvent.click(screen.getByRole('button', { name: 'Retry preview' }))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('Loading preview…')
    await waitFor(() => expect(native.read).toHaveBeenCalledTimes(2))

    await fail(retry, 'Read still denied')
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Could not preview this file.'
    )
    expect(screen.getByRole('alert')).toHaveTextContent('Read still denied')
    fireEvent.click(screen.getByRole('button', { name: 'Retry preview' }))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('Loading preview…')
    await waitFor(() => expect(native.read).toHaveBeenCalledTimes(3))

    await complete(recovery, text('Recovered on the next retry.'))
    expect(screen.getByText('Recovered on the next retry.')).toBeVisible()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    for (const request of [1, 2, 3]) {
      expect(native.stat).toHaveBeenNthCalledWith(request, firstFile)
      expect(native.read).toHaveBeenNthCalledWith(request, firstFile)
    }
  })

  it.each(['success', 'failure'] as const)(
    'ignores a retry %s after another file is selected',
    async (outcome) => {
      const retry = deferred<AgentWorkspaceText>()
      native.read
        .mockRejectedValueOnce(new Error('Initial file read failed'))
        .mockReturnValueOnce(retry.promise)
        .mockResolvedValueOnce(
          text('The second file stays selected.', secondFile.relativePath)
        )
      renderPreview()
      fireEvent.click(await screen.findByRole('button', { name: 'Retry preview' }))
      await waitFor(() => expect(native.read).toHaveBeenCalledTimes(2))

      act(() => useWorkspacePreviewStore.getState().openFile(secondFile))
      expect(
        await screen.findByText('The second file stays selected.')
      ).toBeVisible()
      expect(native.read).toHaveBeenNthCalledWith(2, firstFile)
      expect(native.read).toHaveBeenNthCalledWith(3, secondFile)

      if (outcome === 'success') {
        await complete(retry, text('Obsolete first file content.'))
      } else {
        await fail(retry, 'Obsolete first file failure')
      }

      expect(screen.getByText('The second file stays selected.')).toBeVisible()
      expect(screen.getByRole('button', { name: 'second.txt' })).toBeVisible()
      expect(
        screen.queryByText('Obsolete first file content.')
      ).not.toBeInTheDocument()
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
      expect(screen.queryByRole('status')).not.toBeInTheDocument()
      expect(native.read).toHaveBeenCalledTimes(3)
    }
  )

  it.each(['success', 'failure'] as const)(
    'does not reopen a closed preview after a retry %s',
    async (outcome) => {
      const retry = deferred<AgentWorkspaceText>()
      native.read
        .mockRejectedValueOnce(new Error('Initial file read failed'))
        .mockReturnValueOnce(retry.promise)
      renderPreview()
      fireEvent.click(await screen.findByRole('button', { name: 'Retry preview' }))
      await waitFor(() => expect(native.read).toHaveBeenCalledTimes(2))

      fireEvent.click(screen.getByRole('button', { name: 'Close first.txt' }))
      expect(
        screen.queryByRole('button', { name: 'first.txt' })
      ).not.toBeInTheDocument()
      expect(screen.queryByRole('status')).not.toBeInTheDocument()

      if (outcome === 'success') {
        await complete(retry, text('Obsolete closed preview content.'))
      } else {
        await fail(retry, 'Obsolete closed preview failure')
      }

      expect(
        screen.queryByText('Obsolete closed preview content.')
      ).not.toBeInTheDocument()
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
      expect(screen.queryByRole('status')).not.toBeInTheDocument()
      expect(
        screen.queryByRole('button', { name: 'Retry preview' })
      ).not.toBeInTheDocument()
      expect(useWorkspacePreviewStore.getState().tabs).toEqual([])
      expect(native.read).toHaveBeenCalledTimes(2)
    }
  )
})

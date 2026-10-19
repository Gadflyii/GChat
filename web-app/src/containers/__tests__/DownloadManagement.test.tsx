import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DownloadProgressProps } from '@/hooks/useDownloadStore'
import { DownloadManagement } from '../DownloadManegement'

vi.mock('@/i18n/react-i18next-compat', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => vi.fn() }))
vi.mock('@/hooks/useServiceHub', () => ({ useServiceHub: () => ({}) }))
const stable = vi.hoisted(() => {
  const noop = () => {}
  return {
    updater: { updateState: { isDownloading: false, downloadProgress: 0, downloadedBytes: 0, totalBytes: 0 } },
    store: {
      downloads: {} as Record<string, DownloadProgressProps>, localDownloadingModels: new Set<string>(), pausedDownloads: new Set<string>(), resumeParams: {},
      updateProgress: noop, removeDownload: noop, removeLocalDownloadingModel: noop,
      markResumableDownload: noop, clearResumableDownload: noop, markPausedDownload: noop,
      clearPausedDownload: noop, clearResumeParams: noop, clearDownloadOrigin: noop,
    },
  }
})
vi.mock('@/hooks/useAppUpdater', () => ({ useAppUpdater: () => stable.updater }))
vi.mock('@/hooks/useDownloadStore', () => ({ useDownloadStore: () => stable.store }))
vi.mock('@/stores/local-model-downloads-store', () => ({
  useLocalModelDownloads: (selector: (state: { jobs: unknown[] }) => unknown) => selector({ jobs: [] }),
}))
vi.mock('@gchat/core', () => ({
  DownloadEvent: {}, AppEvent: {}, events: { on: vi.fn(), off: vi.fn(), emit: vi.fn() },
}))

describe('DownloadManagement', () => {
  beforeEach(() => {
    stable.store.downloads = {}
    stable.store.localDownloadingModels = new Set()
    stable.store.pausedDownloads = new Set()
    stable.updater.updateState = { isDownloading: false, downloadProgress: 0, downloadedBytes: 0, totalBytes: 0 }
  })

  it('gives the icon-only downloads button a name', () => {
    render(<DownloadManagement />)
    const button = screen.getByRole('button', { name: 'common:downloads' })
    expect(button).toHaveAttribute('title', 'common:downloads')
  })

  it('names app-update progress and announces milestones without byte-counter chatter', () => {
    stable.updater.updateState = { isDownloading: true, downloadProgress: 0.51, downloadedBytes: 51, totalBytes: 100 }
    const { rerender } = render(<DownloadManagement />)
    const status = screen.getByRole('status', { name: 'App update download status' })
    expect(status).toHaveAttribute('aria-live', 'polite')
    expect(status).toHaveTextContent('App update: Downloading, 50%')
    expect(screen.getByRole('progressbar', { name: 'App update download' })).toHaveAttribute('aria-valuenow', '51')

    stable.updater.updateState = { ...stable.updater.updateState, downloadProgress: 0.59, downloadedBytes: 59 }
    rerender(<DownloadManagement />)
    expect(status).toHaveTextContent('App update: Downloading, 50%')
    expect(screen.getByRole('progressbar', { name: 'App update download' })).toHaveAttribute('aria-valuenow', '59')

    stable.updater.updateState = { ...stable.updater.updateState, downloadProgress: 0.6, downloadedBytes: 60 }
    rerender(<DownloadManagement />)
    expect(status).toHaveTextContent('App update: Downloading, 60%')
  })

  it('names each legacy control and keeps a logical keyboard path back to the trigger', async () => {
    const user = userEvent.setup()
    const { rerender } = render(<DownloadManagement />)
    const trigger = screen.getByRole('button', { name: 'common:downloads' })
    trigger.focus()
    await user.keyboard('{Enter}')
    await waitFor(() => expect(screen.getByRole('button', { name: 'common:close common:downloads' })).toHaveFocus())
    stable.store.downloads = {
      first: { id: 'first', name: 'First model', progress: 0.5, current: 50, total: 100 },
      second: { id: 'second', name: 'Second model', progress: 0.25, current: 25, total: 100 },
    }
    stable.store.pausedDownloads = new Set(['Second model'])
    rerender(<DownloadManagement />)
    expect(screen.getByRole('dialog', { name: 'common:downloads' })).toBeInTheDocument()

    expect(screen.getByRole('progressbar', { name: 'First model download' })).toHaveAttribute('aria-valuenow', '50')
    expect(screen.getByRole('progressbar', { name: 'Second model download' })).toHaveAttribute('aria-valuenow', '25')
    expect(screen.getByRole('status', { name: 'Second model download status' })).toHaveTextContent('Second model: Download paused')
    for (const name of [
      'common:pauseDownload First model',
      'common:cancelDownload First model',
      'common:resumeDownload Second model',
      'common:cancelDownload Second model',
    ]) {
      await user.tab()
      expect(screen.getByRole('button', { name })).toHaveFocus()
    }
    await user.keyboard('{Escape}')
    await waitFor(() => expect(trigger).toHaveFocus())
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('announces preparation and progress milestones while keeping unknown totals indeterminate', () => {
    stable.store.localDownloadingModels = new Set(['Starting model'])
    const { rerender } = render(<DownloadManagement />)
    const status = screen.getByRole('status', { name: 'Starting model download status' })
    expect(status).toHaveTextContent('Starting model: Preparing download')
    expect(screen.getByRole('progressbar', { name: 'Starting model download' })).not.toHaveAttribute('aria-valuenow')

    stable.store.downloads = { 'Starting model': { id: 'Starting model', name: 'Starting model', progress: 0.51, current: 51, total: 100 } }
    rerender(<DownloadManagement />)
    expect(status).toHaveTextContent('Starting model: Downloading, 50%')
    stable.store.downloads = { 'Starting model': { ...stable.store.downloads['Starting model'], progress: 0.59, current: 59 } }
    rerender(<DownloadManagement />)
    expect(status).toHaveTextContent('Starting model: Downloading, 50%')
    expect(screen.getByRole('progressbar', { name: 'Starting model download' })).toHaveAttribute('aria-valuenow', '59')
    stable.store.downloads = { 'Starting model': { ...stable.store.downloads['Starting model'], progress: 0.6, current: 60 } }
    rerender(<DownloadManagement />)
    expect(status).toHaveTextContent('Starting model: Downloading, 60%')
  })
})

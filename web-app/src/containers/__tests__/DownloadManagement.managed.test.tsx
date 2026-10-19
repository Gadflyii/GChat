import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DownloadManagement } from '../DownloadManegement'

vi.mock('@/i18n/react-i18next-compat', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))
const navigate = vi.hoisted(() => vi.fn())
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => navigate }))
vi.mock('@/hooks/useServiceHub', () => ({ useServiceHub: () => ({}) }))
const stable = vi.hoisted(() => {
  const noop = () => {}
  return {
    updater: { updateState: { isDownloading: false, downloadProgress: 0, downloadedBytes: 0, totalBytes: 0 } },
    store: {
      downloads: {}, localDownloadingModels: new Set(), pausedDownloads: new Set(), resumeParams: {},
      updateProgress: noop, removeDownload: noop, removeLocalDownloadingModel: noop,
      markResumableDownload: noop, clearResumableDownload: noop, markPausedDownload: noop,
      clearPausedDownload: noop, clearResumeParams: noop, clearDownloadOrigin: noop,
    },
  }
})
vi.mock('@/hooks/useAppUpdater', () => ({ useAppUpdater: () => stable.updater }))
vi.mock('@/hooks/useDownloadStore', () => ({ useDownloadStore: () => stable.store }))
const jobs = vi.hoisted(() => ({ list: [] as unknown[] }))
vi.mock('@/stores/local-model-downloads-store', () => ({
  useLocalModelDownloads: (selector: (s: { jobs: unknown[] }) => unknown) => selector({ jobs: jobs.list }),
}))
vi.mock('@gchat/core', () => ({
  DownloadEvent: {}, AppEvent: {}, events: { on: vi.fn(), off: vi.fn(), emit: vi.fn() },
}))

describe('DownloadManagement managed downloads', () => {
  beforeEach(() => {
    navigate.mockClear()
    jobs.list = []
  })
  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })
  it('lists a model download managed by the local Host, not only legacy downloads', async () => {
    jobs.list = [{
      id: 'job', status: 'downloading', received: 5 * 1024 ** 3, bytes_per_second: 1, error: null, path: null,
      release: { name: 'Qwen 27B 2-bit mix', bytes: 10 * 1024 ** 3 },
    }]
    render(<DownloadManagement />)
    expect(await screen.findByText('Qwen 27B 2-bit mix')).toBeInTheDocument()
    expect(screen.getByText('50%')).toBeInTheDocument()
    expect(screen.getByRole('progressbar', { name: 'Qwen 27B 2-bit mix download' })).toHaveAttribute('aria-valuenow', '50')
    expect(screen.queryByText(/will appear here/)).not.toBeInTheDocument()
  })

  it.each([
    ['queued', 'Waiting to download'],
    ['downloading', 'Downloading model'],
    ['pausing', 'Saving progress before pausing'],
    ['paused', 'Paused; resume to continue'],
    ['verifying', 'Checking the downloaded file'],
    ['failed', 'Download stopped'],
  ])('shows the %s state instead of implying every transfer is downloading', async (status, label) => {
    jobs.list = [{
      id: 'job', status, received: 5 * 1024 ** 3, bytes_per_second: 0, error: null, path: null,
      release: { name: 'Qwen 27B 2-bit mix', bytes: 10 * 1024 ** 3 },
    }]
    render(<DownloadManagement />)
    expect(await screen.findByRole('status', { name: 'Qwen 27B 2-bit mix download status' })).toHaveTextContent(label)
    expect(screen.getByText('common:downloads')).toBeInTheDocument()
    expect(screen.queryByText('downloading')).not.toBeInTheDocument()
    expect(screen.getByText('50%')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Manage Qwen 27B 2-bit mix download' })).toBeEnabled()
  })

  it('updates each transfer status when Host polling changes a job without changing progress', async () => {
    const release = { name: 'Qwen 27B 2-bit mix', bytes: 10 * 1024 ** 3 }
    const job = { id: 'job', status: 'downloading', received: 5 * 1024 ** 3, bytes_per_second: 1, error: null, path: null, release }
    jobs.list = [job, {
      ...job, id: 'other-job', status: 'queued', release: { ...release, name: 'Muse Glimmer 2-bit mix' },
    }]
    const { rerender } = render(<DownloadManagement />)
    const statusName = 'Qwen 27B 2-bit mix download status'
    expect(await screen.findByRole('status', { name: statusName })).toHaveTextContent('Downloading model')

    jobs.list = [{ ...job, status: 'paused', bytes_per_second: 0 }, jobs.list[1]]
    rerender(<DownloadManagement />)
    expect(screen.getByRole('status', { name: statusName })).toHaveTextContent('Paused; resume to continue')
    expect(screen.getByRole('status', { name: 'Muse Glimmer 2-bit mix download status' })).toHaveTextContent('Waiting to download')

    jobs.list = [{ ...job, status: 'failed', bytes_per_second: 0, error: 'connection closed' }, jobs.list[1]]
    rerender(<DownloadManagement />)
    expect(screen.getByRole('status', { name: statusName })).toHaveTextContent('Download stopped')
    expect(screen.queryByText('Downloading model')).not.toBeInTheDocument()
  })

  it('opens Models directly on Downloads when Manage is selected', async () => {
    jobs.list = [{
      id: 'paused-job', status: 'paused', received: 1024, bytes_per_second: 0, error: null, path: null,
      release: { name: 'Paused model', bytes: 4096 },
    }]
    render(<DownloadManagement />)
    fireEvent.click(await screen.findByRole('button', { name: 'Manage Paused model download' }))
    expect(navigate).toHaveBeenCalledExactlyOnceWith({
      to: '/hub/', search: { tab: 'Downloads' },
    })
    expect(screen.queryByText('Paused model')).not.toBeInTheDocument()
  })

  it('announces progress milestones and completion after the visible transfer is removed', async () => {
    const job = {
      id: 'job', status: 'downloading', received: 51, bytes_per_second: 1, error: null, path: null,
      release: { name: 'Qwen 27B 2-bit mix', bytes: 100 },
    }
    jobs.list = [job]
    const { rerender } = render(<DownloadManagement />)
    const status = screen.getByRole('status', { name: 'Qwen 27B 2-bit mix download status' })
    expect(status).toHaveAttribute('aria-live', 'polite')
    expect(status).toHaveAttribute('aria-atomic', 'true')
    expect(status).toHaveTextContent('Qwen 27B 2-bit mix: Downloading model, 50%')

    jobs.list = [{ ...job, received: 59, bytes_per_second: 200 }]
    rerender(<DownloadManagement />)
    expect(status).toHaveTextContent('Qwen 27B 2-bit mix: Downloading model, 50%')
    expect(screen.getByRole('progressbar', { name: 'Qwen 27B 2-bit mix download' })).toHaveAttribute('aria-valuenow', '59')

    jobs.list = [{ ...job, received: 60 }]
    rerender(<DownloadManagement />)
    expect(status).toHaveTextContent('Qwen 27B 2-bit mix: Downloading model, 60%')

    jobs.list = [{ ...job, status: 'installed', received: 100 }]
    rerender(<DownloadManagement />)
    expect(status).toHaveTextContent('Qwen 27B 2-bit mix: Download complete')
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it.each(['Escape', 'Close'] as const)('opens by keyboard in logical order and returns focus after %s', async (dismissal) => {
    const user = userEvent.setup()
    const view = () => <><DownloadManagement /><button>Next control</button></>
    const { rerender } = render(view())
    const trigger = screen.getByRole('button', { name: 'common:downloads' })
    trigger.focus()
    await user.keyboard('{Enter}')
    const close = await screen.findByRole('button', { name: 'common:close common:downloads' })
    await waitFor(() => expect(close).toHaveFocus())
    expect(screen.getByRole('dialog', { name: 'common:downloads' })).toBeInTheDocument()

    jobs.list = ['First model', 'Second model'].map((name) => ({
      id: name, status: 'paused', received: 50, bytes_per_second: 0, error: null, path: null,
      release: { name, bytes: 100 },
    }))
    rerender(view())
    expect(close).toHaveFocus()
    await user.tab()
    expect(screen.getByRole('button', { name: 'Manage First model download' })).toHaveFocus()
    await user.tab()
    expect(screen.getByRole('button', { name: 'Manage Second model download' })).toHaveFocus()
    await user.tab({ shift: true })
    expect(screen.getByRole('button', { name: 'Manage First model download' })).toHaveFocus()

    if (dismissal === 'Escape') {
      await user.keyboard('{Escape}')
    } else {
      await user.tab({ shift: true })
      expect(close).toHaveFocus()
      await user.keyboard('{Enter}')
    }
    await waitFor(() => expect(trigger).toHaveFocus())
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    await user.tab()
    expect(screen.getByRole('button', { name: 'Next control' })).toHaveFocus()
  })

  it.each(['auto-hide', 'Escape'] as const)('never steals focus when a background popover opens and closes through %s', (dismissal) => {
    vi.useFakeTimers()
    const view = () => <><button>Keep working</button><DownloadManagement /></>
    const { rerender } = render(view())
    const outside = screen.getByRole('button', { name: 'Keep working' })
    outside.focus()
    jobs.list = [{
      id: 'job', status: 'downloading', received: 50, bytes_per_second: 1, error: null, path: null,
      release: { name: 'Qwen 27B 2-bit mix', bytes: 100 },
    }]
    rerender(view())
    expect(screen.getByRole('dialog', { name: 'common:downloads' })).toBeInTheDocument()
    expect(outside).toHaveFocus()

    if (dismissal === 'Escape') fireEvent.keyDown(outside, { key: 'Escape' })
    act(() => vi.advanceTimersByTime(4000))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(outside).toHaveFocus()
  })

  it('does not reuse focus from an earlier keyboard session when a download reopens the popover', async () => {
    const user = userEvent.setup()
    const { rerender } = render(<DownloadManagement />)
    const trigger = screen.getByRole('button', { name: 'common:downloads' })
    trigger.focus()
    await user.keyboard('{Enter}')
    const close = await screen.findByRole('button', { name: 'common:close common:downloads' })
    await waitFor(() => expect(close).toHaveFocus())
    await user.keyboard('{Escape}')
    await waitFor(() => expect(trigger).toHaveFocus())
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    trigger.blur()
    expect(document.body).toHaveFocus()
    vi.useFakeTimers()
    jobs.list = [{
      id: 'new-job', status: 'downloading', received: 50, bytes_per_second: 1, error: null, path: null,
      release: { name: 'New model', bytes: 100 },
    }]
    rerender(<DownloadManagement />)
    expect(screen.getByRole('dialog', { name: 'common:downloads' })).toBeInTheDocument()
    expect(document.body).toHaveFocus()

    act(() => vi.advanceTimersByTime(4000))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(document.body).toHaveFocus()
  })

  it('keeps keyboard-used UI open past auto-hide and returns focus safely when its transfer completes', () => {
    vi.useFakeTimers()
    const job = {
      id: 'job', status: 'downloading', received: 50, bytes_per_second: 1, error: null, path: null,
      release: { name: 'Qwen 27B 2-bit mix', bytes: 100 },
    }
    jobs.list = [job]
    const { rerender } = render(<DownloadManagement />)
    const manage = screen.getByRole('button', { name: 'Manage Qwen 27B 2-bit mix download' })
    act(() => manage.focus())
    act(() => vi.advanceTimersByTime(4000))
    expect(manage).toHaveFocus()
    expect(screen.getByRole('dialog', { name: 'common:downloads' })).toBeInTheDocument()

    jobs.list = [{ ...job, status: 'installed', received: 100 }]
    rerender(<DownloadManagement />)
    expect(screen.getByRole('button', { name: 'common:close common:downloads' })).toHaveFocus()
    expect(screen.getByRole('dialog', { name: 'common:downloads' })).toBeInTheDocument()
    expect(screen.getByRole('status', { name: 'Qwen 27B 2-bit mix download status' })).toHaveTextContent('Download complete')
  })
})

import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
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
  beforeEach(() => { navigate.mockClear() })
  it('lists a model download managed by the local Host, not only legacy downloads', async () => {
    jobs.list = [{
      id: 'job', status: 'downloading', received: 5 * 1024 ** 3, bytes_per_second: 1, error: null, path: null,
      release: { name: 'Qwen 27B 2-bit mix', bytes: 10 * 1024 ** 3 },
    }]
    render(<DownloadManagement />)
    expect(await screen.findByText('Qwen 27B 2-bit mix')).toBeInTheDocument()
    expect(screen.getByText('50%')).toBeInTheDocument()
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
    expect(screen.getByRole('button', { name: 'Manage' })).toBeEnabled()
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
    fireEvent.click(await screen.findByRole('button', { name: 'Manage' }))
    expect(navigate).toHaveBeenCalledExactlyOnceWith({
      to: '/hub/', search: { tab: 'Downloads' },
    })
    expect(screen.queryByText('Paused model')).not.toBeInTheDocument()
  })
})

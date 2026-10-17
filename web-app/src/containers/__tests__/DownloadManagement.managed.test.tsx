import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
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
})

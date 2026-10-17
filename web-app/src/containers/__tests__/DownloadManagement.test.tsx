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
vi.mock('@gchat/core', () => ({
  DownloadEvent: {}, AppEvent: {}, events: { on: vi.fn(), off: vi.fn(), emit: vi.fn() },
}))

describe('DownloadManagement', () => {
  it('gives the icon-only downloads button a name', () => {
    render(<DownloadManagement />)
    const button = screen.getByRole('button', { name: 'common:downloads' })
    expect(button).toHaveAttribute('title', 'common:downloads')
  })
})

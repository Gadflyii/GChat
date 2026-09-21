import { act, render } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { listen } from '@tauri-apps/api/event'
import { ThemeProvider } from '../ThemeProvider'
import { useTheme } from '@/hooks/useTheme'

vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn() }))
vi.mock('@/lib/platform/utils', () => ({ isPlatformTauri: () => true }))
vi.mock('@/hooks/useTheme', () => ({
  useTheme: vi.fn(),
  checkOSDarkMode: () => false,
}))

describe('ThemeProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(useTheme).mockReturnValue({
      activeTheme: 'dark',
      isDark: true,
      setIsDark: vi.fn(),
      setTheme: vi.fn(),
    })
    vi.mocked(listen).mockResolvedValue(vi.fn())
  })

  it('applies the selected light and dark styles', () => {
    const { rerender } = render(<ThemeProvider />)
    expect(document.documentElement).toHaveClass('dark')
    vi.mocked(useTheme).mockReturnValue({
      ...useTheme(),
      activeTheme: 'light',
      isDark: false,
    })
    rerender(<ThemeProvider />)
    expect(document.documentElement).not.toHaveClass('dark')
  })

  it('follows the OS in automatic mode', () => {
    const setIsDark = vi.fn()
    const setTheme = vi.fn()
    vi.mocked(useTheme).mockReturnValue({
      activeTheme: 'auto',
      isDark: true,
      setIsDark,
      setTheme,
    })
    render(<ThemeProvider />)
    expect(setIsDark).toHaveBeenCalledWith(false)
    expect(setTheme).toHaveBeenCalledWith('auto')
  })

  it('detaches a listener that finishes registering after unmount', async () => {
    let finish!: (unlisten: () => void) => void
    vi.mocked(listen).mockReturnValue(
      new Promise((resolve) => {
        finish = resolve
      })
    )
    const detach = vi.fn()
    const { unmount } = render(<ThemeProvider />)
    unmount()
    await act(async () => {
      finish(detach)
    })
    expect(detach).toHaveBeenCalledTimes(1)
  })

  it('detaches a registered listener when the selected theme changes', async () => {
    const detach = vi.fn()
    vi.mocked(listen).mockResolvedValue(detach)
    const { rerender } = render(<ThemeProvider />)
    await act(async () => {})
    vi.mocked(useTheme).mockReturnValue({
      ...useTheme(),
      activeTheme: 'light',
      isDark: false,
    })
    rerender(<ThemeProvider />)
    expect(detach).toHaveBeenCalledTimes(1)
  })
})

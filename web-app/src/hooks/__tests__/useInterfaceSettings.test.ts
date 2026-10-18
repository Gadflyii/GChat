import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useInterfaceSettings } from '../useInterfaceSettings'
import { useTheme } from '../useTheme'
import { seedServiceHub } from '@/test/service-hub'
import type { ThemeService } from '@/services/theme/types'

const setNativeTheme = vi.fn().mockResolvedValue(undefined)

// Mock constants
vi.mock('@/constants/localStorage', () => ({
  localStorageKey: {
    settingInterface: 'setting-appearance',
    theme: 'theme',
  },
}))

// Mock zustand persist
vi.mock('zustand/middleware', () => ({
  persist: (fn: any) => fn,
  createJSONStorage: () => ({
    getItem: vi.fn(),
    setItem: vi.fn(),
    removeItem: vi.fn(),
  }),
}))

// Mock global constants
Object.defineProperty(global, 'IS_WINDOWS', { value: false, writable: true })
Object.defineProperty(global, 'IS_LINUX', { value: false, writable: true })
Object.defineProperty(global, 'IS_MACOS', { value: false, writable: true })
Object.defineProperty(global, 'IS_TAURI', { value: false, writable: true })
Object.defineProperty(global, 'IS_WEB_APP', { value: false, writable: true })

describe('useInterfaceSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setNativeTheme.mockResolvedValue(undefined)
    seedServiceHub({
      theme: { setTheme: setNativeTheme } as unknown as ThemeService,
    })
    useTheme.setState({ activeTheme: 'dark', isDark: true })
    useInterfaceSettings.setState({ fontSize: '16px', accentColor: 'primary' })
  })

  it('should initialize with default values', () => {
    const { result } = renderHook(() => useInterfaceSettings())

    expect(result.current.fontSize).toBe('16px')
    expect(result.current.accentColor).toBe('primary')
    expect(typeof result.current.setFontSize).toBe('function')
    expect(typeof result.current.setAccentColor).toBe('function')
    expect(typeof result.current.resetInterface).toBe('function')
  })

  it('should update font size', () => {
    const { result } = renderHook(() => useInterfaceSettings())

    act(() => {
      result.current.setFontSize('18px')
    })

    expect(result.current.fontSize).toBe('18px')
  })

  describe('accent color', () => {
    it('should update accent color', () => {
      const { result } = renderHook(() => useInterfaceSettings())

      act(() => {
        result.current.setAccentColor('primary')
      })

      expect(result.current.accentColor).toBe('primary')
    })

    it('should not update for invalid accent color', async () => {
      const { result } = renderHook(() => useInterfaceSettings())

      // First reset to default state
      await act(async () => {
        await result.current.resetInterface()
      })

      const currentColor = result.current.accentColor

      act(() => {
        result.current.setAccentColor('invalid' as any)
      })

      // Should remain unchanged
      expect(result.current.accentColor).toBe(currentColor)
    })
  })

  it('restores the default theme and font through the native theme service', async () => {
    const { result } = renderHook(() => useInterfaceSettings())

    await act(async () => {
      await useTheme.getState().setTheme('light')
    })

    // Change some values first
    act(() => {
      result.current.setFontSize('18px')
      result.current.setAccentColor('primary')
    })

    // Reset
    await act(async () => {
      await result.current.resetInterface()
    })

    expect(result.current.fontSize).toBe('16px')
    expect(result.current.accentColor).toBe('primary')
    expect(useTheme.getState().activeTheme).toBe('dark')
    expect(useTheme.getState().isDark).toBe(true)
    expect(setNativeTheme).toHaveBeenLastCalledWith('dark')
  })

  it('preserves the chosen settings when resetting the native theme fails', async () => {
    await useTheme.getState().setTheme('light')
    useInterfaceSettings.getState().setFontSize('20px')
    setNativeTheme.mockRejectedValueOnce(new Error('Window theme unavailable'))

    await expect(
      useInterfaceSettings.getState().resetInterface()
    ).rejects.toThrow('Window theme unavailable')

    expect(useTheme.getState().activeTheme).toBe('light')
    expect(useInterfaceSettings.getState().fontSize).toBe('20px')
  })

  describe('Reset interface functionality', () => {
    beforeEach(() => {
      // Mock document.documentElement.style.setProperty
      Object.defineProperty(document.documentElement, 'style', {
        value: {
          setProperty: vi.fn(),
        },
        writable: true,
      })
    })

    it('should reset CSS variables when resetInterface is called', async () => {
      const { result } = renderHook(() => useInterfaceSettings())

      await act(async () => {
        await result.current.resetInterface()
      })

      expect(document.documentElement.style.setProperty).toHaveBeenCalledWith(
        '--font-size-base',
        '16px'
      )
    })
  })

  describe('Type checking', () => {
    it('should only accept valid font sizes', () => {
      const { result } = renderHook(() => useInterfaceSettings())

      // These should work
      act(() => {
        result.current.setFontSize('14px')
      })
      expect(result.current.fontSize).toBe('14px')

      act(() => {
        result.current.setFontSize('16px')
      })
      expect(result.current.fontSize).toBe('16px')

      act(() => {
        result.current.setFontSize('18px')
      })
      expect(result.current.fontSize).toBe('18px')
    })
  })
})

import { emit } from '@tauri-apps/api/event'
import { localStorageKey } from '@/constants/localStorage'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mockIPC, mockWindows } from '@tauri-apps/api/mocks'
import type { InvokeArgs } from '@tauri-apps/api/core'
import { TauriWindowService } from '../window/tauri'

describe('TauriWindowService', () => {
  let ipcHandler: ReturnType<typeof vi.fn>
  let windowService: TauriWindowService

  beforeEach(() => {
    localStorage.clear()
    mockWindows('main', 'logs-app-window')
    ipcHandler = vi.fn()
    mockIPC(
      (command: string, args?: InvokeArgs) => {
        ipcHandler(command, args)
        if (command === 'plugin:window|get_all_windows') {
          return ['main', 'logs-app-window']
        }
        return undefined
      },
      { shouldMockEvents: true }
    )
    windowService = new TauriWindowService()
  })

  it('resolves windows registered by the official Tauri window mock', async () => {
    const existing =
      await windowService.getWebviewWindowByLabel('logs-app-window')

    expect(existing?.label).toBe('logs-app-window')
    await expect(existing?.show()).resolves.toBeUndefined()
    await expect(existing?.focus()).resolves.toBeUndefined()
    expect(ipcHandler).toHaveBeenCalled()
  })

  it('returns null for an unknown window label', async () => {
    await expect(
      windowService.getWebviewWindowByLabel('missing-window')
    ).resolves.toBeNull()
  })

  it('reuses the existing logs window instead of creating a duplicate', async () => {
    await expect(windowService.openLogsWindow()).resolves.toBeUndefined()

    const commands = ipcHandler.mock.calls.map(([command]) => command)
    expect(commands).not.toContain('plugin:webview|create_webview_window')
  })
  it('uses the GChat theme preference for a new window', async () => {
    localStorage.setItem(
      localStorageKey.theme,
      JSON.stringify({ state: { activeTheme: 'light' } })
    )
    await windowService.createWebviewWindow({
      label: 'new-window',
      url: '/logs',
    })
    const creation = ipcHandler.mock.calls.find(
      ([command]) => command === 'plugin:webview|create_webview_window'
    )
    expect(creation?.[1]).toMatchObject({ options: { theme: 'light' } })
  })

  it('stops forwarding theme updates after the window is destroyed', async () => {
    await windowService.createWebviewWindow({
      label: 'new-window',
      url: '/logs',
    })
    await emit('theme-changed', 'dark')
    expect(
      ipcHandler.mock.calls.some(
        ([command]) => command === 'plugin:window|set_theme'
      )
    ).toBe(true)
    await emit('tauri://destroyed')
    ipcHandler.mockClear()
    await emit('theme-changed', 'light')
    expect(
      ipcHandler.mock.calls.some(
        ([command]) => command === 'plugin:window|set_theme'
      )
    ).toBe(false)
  })
})

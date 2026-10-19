import { emit } from '@tauri-apps/api/event'
import { localStorageKey } from '@/constants/localStorage'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mockIPC, mockWindows } from '@tauri-apps/api/mocks'
import type { InvokeArgs } from '@tauri-apps/api/core'
import { TauriWindowService } from '../window/tauri'

describe('TauriWindowService', () => {
  let ipcHandler: ReturnType<typeof vi.fn>
  let windowService: TauriWindowService
  let registeredWindows: Set<string>

  beforeEach(() => {
    localStorage.clear()
    mockWindows('main', 'logs-app-window')
    registeredWindows = new Set(['main', 'logs-app-window'])
    ipcHandler = vi.fn((command: string, args?: InvokeArgs) => {
      if (command === 'plugin:window|get_all_windows') {
        return [...registeredWindows]
      }
      if (command === 'open_auxiliary_window') {
        registeredWindows.add((args as { label: string }).label)
      }
      return undefined
    })
    mockIPC(
      (command: string, args?: InvokeArgs) => ipcHandler(command, args),
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
    expect(commands).not.toContain('open_auxiliary_window')
  })

  it.each([
    'logs-app-window',
    'system-monitor-window',
    'logs-window-local-api-server',
  ])(
    'opens %s through the fixed native command without forwarding a URL',
    async (label) => {
      registeredWindows.delete(label)
      const created = await windowService.createWebviewWindow({
        label,
        url: 'https://untrusted.example',
        title: 'Untrusted title',
        width: 123,
      })

      expect(created.label).toBe(label)
      expect(ipcHandler).toHaveBeenCalledWith('open_auxiliary_window', {
        label,
        theme: undefined,
      })
      expect(ipcHandler.mock.calls.map(([command]) => command)).not.toContain(
        'plugin:webview|create_webview_window'
      )
      await created.show()
      await created.focus()
      await created.hide()
      await created.setTitle('Updated title')
      await created.close()
      expect(ipcHandler).toHaveBeenCalledWith('plugin:window|show', { label })
      expect(ipcHandler).toHaveBeenCalledWith('plugin:window|set_focus', { label })
      expect(ipcHandler).toHaveBeenCalledWith('plugin:window|hide', { label })
      expect(ipcHandler).toHaveBeenCalledWith('plugin:window|set_title', {
        label,
        value: 'Updated title',
      })
      expect(ipcHandler).toHaveBeenCalledWith('plugin:window|close', { label })
    }
  )

  it('uses the GChat theme preference for a new window', async () => {
    localStorage.setItem(
      localStorageKey.theme,
      JSON.stringify({ state: { activeTheme: 'light' } })
    )
    await windowService.createWebviewWindow({
      label: 'system-monitor-window',
      url: '/logs',
    })
    const creation = ipcHandler.mock.calls.find(
      ([command]) => command === 'open_auxiliary_window'
    )
    expect(creation?.[1]).toEqual({
      label: 'system-monitor-window',
      theme: 'light',
    })
  })

  it('propagates native creation rejection without querying or constructing a window', async () => {
    ipcHandler.mockRejectedValueOnce(new Error('Unsupported auxiliary window'))

    await expect(
      windowService.createWebviewWindow({
        label: 'unknown-window',
        url: '/logs',
      })
    ).rejects.toThrow('Unsupported auxiliary window')
    expect(ipcHandler).toHaveBeenCalledTimes(1)
  })

  it('rejects when the native command completes without registering the window', async () => {
    ipcHandler.mockImplementationOnce(() => undefined)

    await expect(
      windowService.createWebviewWindow({
        label: 'system-monitor-window',
        url: '/system-monitor',
      })
    ).rejects.toThrow('Auxiliary window was not created: system-monitor-window')
  })

  it('stops forwarding theme updates after the window is destroyed', async () => {
    await windowService.createWebviewWindow({
      label: 'system-monitor-window',
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

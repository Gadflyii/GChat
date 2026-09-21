import { listen } from '@tauri-apps/api/event'
import { localStorageKey } from '@/constants/localStorage'
import { createSafeUnlisten } from '@/lib/tauriEvent'
/**
 * Tauri Window Service - Desktop implementation
 */

import { WebviewWindow } from '@tauri-apps/api/webviewWindow'
import type { WindowConfig, WebviewWindowInstance } from './types'
import { DefaultWindowService } from './default'

export class TauriWindowService extends DefaultWindowService {
  async createWebviewWindow(
    config: WindowConfig
  ): Promise<WebviewWindowInstance> {
    try {
      // Get current theme from localStorage
      const storedTheme = localStorage.getItem(localStorageKey.theme)
      let theme: 'light' | 'dark' | undefined = undefined

      if (storedTheme) {
        try {
          const themeData = JSON.parse(storedTheme)
          const activeTheme = themeData?.state?.activeTheme
          if (activeTheme === 'dark' || activeTheme === 'light') {
            theme = activeTheme
          }
        } catch (e) {
          console.warn('Failed to parse theme from localStorage:', e)
        }
      }

      const webviewWindow = new WebviewWindow(config.label, {
        url: config.url,
        title: config.title,
        width: config.width,
        height: config.height,
        center: config.center,
        resizable: config.resizable,
        minimizable: config.minimizable,
        maximizable: config.maximizable,
        closable: config.closable,
        fullscreen: config.fullscreen,
        theme: theme,
      })

      // Setup theme listener for this window
      await this.setupThemeListenerForWindow(webviewWindow)

      return {
        label: config.label,
        async close() {
          await webviewWindow.close()
        },
        async show() {
          await webviewWindow.show()
        },
        async hide() {
          await webviewWindow.hide()
        },
        async focus() {
          await webviewWindow.setFocus()
        },
        async setTitle(title: string) {
          await webviewWindow.setTitle(title)
        },
      }
    } catch (error) {
      console.error('Error creating Tauri window:', error)
      throw error
    }
  }

  async getWebviewWindowByLabel(
    label: string
  ): Promise<WebviewWindowInstance | null> {
    try {
      const existingWindow = await WebviewWindow.getByLabel(label)

      if (existingWindow) {
        return {
          label: label,
          async close() {
            await existingWindow.close()
          },
          async show() {
            await existingWindow.show()
          },
          async hide() {
            await existingWindow.hide()
          },
          async focus() {
            await existingWindow.setFocus()
          },
          async setTitle(title: string) {
            await existingWindow.setTitle(title)
          },
        }
      }

      return null
    } catch (error) {
      console.error('Error getting Tauri window by label:', error)
      return null
    }
  }

  async openWindow(config: WindowConfig): Promise<void> {
    // Check if window already exists first
    const existing = await this.getWebviewWindowByLabel(config.label)
    if (existing) {
      await existing.show()
      await existing.focus()
    } else {
      await this.createWebviewWindow(config)
    }
  }

  async openLogsWindow(): Promise<void> {
    try {
      await this.openWindow({
        url: '/logs',
        label: 'logs-app-window',
        title: 'App Logs - GChat',
        width: 800,
        height: 600,
        resizable: true,
        center: true,
      })
    } catch (error) {
      console.error('Error opening logs window in Tauri:', error)
      throw error
    }
  }

  async openSystemMonitorWindow(): Promise<void> {
    try {
      await this.openWindow({
        url: '/system-monitor',
        label: 'system-monitor-window',
        title: 'System Monitor - GChat',
        width: 1000,
        height: 700,
        resizable: true,
        center: true,
      })
    } catch (error) {
      console.error('Error opening system monitor window in Tauri:', error)
      throw error
    }
  }

  async openLocalApiServerLogsWindow(): Promise<void> {
    try {
      await this.openWindow({
        url: '/local-api-server/logs',
        label: 'logs-window-local-api-server',
        title: 'Local API Server Logs - GChat',
        width: 800,
        height: 600,
        resizable: true,
        center: true,
      })
    } catch (error) {
      console.error(
        'Error opening local API server logs window in Tauri:',
        error
      )
      throw error
    }
  }

  private async setupThemeListenerForWindow(
    window: WebviewWindow
  ): Promise<void> {
    let disposed = false
    let detachTheme: (() => Promise<void>) | undefined
    await window
      .once('tauri://destroyed', () => {
        disposed = true
        void detachTheme?.()
      })
      .then(async (unlistenDestroyed) => {
        if (disposed) return
        try {
          const unlisten = await listen<string>(
            'theme-changed',
            async ({ payload }) => {
              if (disposed) return
              try {
                await window.setTheme(
                  payload === 'dark' || payload === 'light' ? payload : null
                )
              } catch (error) {
                console.error('Failed to update window theme:', error)
              }
            }
          )
          detachTheme = createSafeUnlisten(unlisten)
          if (disposed) await detachTheme()
        } catch (error) {
          await createSafeUnlisten(unlistenDestroyed)()
          throw error
        }
      })
      .catch((error) => {
        console.error('Failed to setup theme listener for window:', error)
      })
  }
}

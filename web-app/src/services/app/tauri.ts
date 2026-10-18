/**
 * Tauri App Service - Desktop implementation
 */

import { invoke } from '@tauri-apps/api/core'
import { type AppConfiguration, type AutostartPreference } from '@gchat/core'
import { localStorageKey } from '@/constants/localStorage'
import type { LogEntry } from './types'
import { DefaultAppService } from './default'

export class TauriAppService extends DefaultAppService {
  async factoryReset(): Promise<void> {
    const previousResetPending = window.localStorage.getItem(
      localStorageKey.factoryResetPending
    )
    // Native reset drains Agent runs before stopping their dependencies. Keep
    // preferences until the restarted app consumes this flag before stores load.
    window.localStorage.setItem(localStorageKey.factoryResetPending, 'true')
    try {
      await invoke('factory_reset')
    } catch (error) {
      if (previousResetPending === null) {
        window.localStorage.removeItem(localStorageKey.factoryResetPending)
      } else {
        window.localStorage.setItem(
          localStorageKey.factoryResetPending,
          previousResetPending
        )
      }
      throw error
    }
  }

  async readLogs(): Promise<LogEntry[]> {
    const logData: string = (await invoke('read_logs')) ?? ''
    return logData.split('\n').map(this.parseLogLine)
  }

  async getInstallerType(): Promise<string | undefined> {
    try {
      const value = (await invoke('get_installer_type')) as string | null
      return value ?? undefined
    } catch (error) {
      console.debug('get_installer_type unavailable:', error)
      return undefined
    }
  }

  async getGchatDataFolder(): Promise<string | undefined> {
    try {
      const appConfiguration: AppConfiguration | undefined =
        await window.core?.api?.getAppConfigurations()

      return appConfiguration?.data_folder
    } catch (error) {
      console.error('Failed to get GChat data folder:', error)
      return undefined
    }
  }

  async relocateGchatDataFolder(path: string): Promise<void> {
    await invoke('change_app_data_folder', { newDataFolder: path })
  }

  async getAutostartPreference(): Promise<AutostartPreference> {
    const configuration: AppConfiguration =
      await window.core?.api?.getAppConfigurations()
    return configuration.autostart_preference ?? 'unmanaged'
  }

  async setAutostartPreference(preference: AutostartPreference): Promise<void> {
    const configuration: AppConfiguration =
      await window.core?.api?.getAppConfigurations()
    configuration.autostart_preference = preference
    await window.core?.api?.updateAppConfiguration({ configuration })
  }

  parseLogLine(line: string): LogEntry {
    const regex = /^\[(.*?)\]\[(.*?)\]\[(.*?)\]\[(.*?)\]\s(.*)$/
    const match = line.match(regex)

    if (!match)
      return {
        timestamp: Date.now(),
        level: 'info' as 'info' | 'warn' | 'error' | 'debug',
        target: 'info',
        message: line ?? '',
      } as LogEntry

    const [, date, time, target, levelRaw, message] = match

    const level = levelRaw.toLowerCase() as 'info' | 'warn' | 'error' | 'debug'
    const utcTime = time.endsWith('Z') ? time : `${time}Z`

    return {
      timestamp: `${date}T${utcTime}`,
      level,
      target,
      message,
    }
  }

  async getServerStatus(): Promise<boolean> {
    return await invoke<boolean>('get_server_status')
  }

  async readYaml<T = unknown>(path: string): Promise<T> {
    return await invoke<T>('read_yaml', { path })
  }
}

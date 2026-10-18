import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mockIPC } from '@tauri-apps/api/mocks'
import type { InvokeArgs } from '@tauri-apps/api/core'
import { APIs } from '@/lib/service'
import { TauriCoreService } from '../core/tauri'
import { TauriAppService } from '../app/tauri'
import { seedServiceHub } from '@/test/service-hub'
import { localStorageKey } from '@/constants/localStorage'

const engineMocks = vi.hoisted(() => ({
  getLoadedModels: vi.fn().mockResolvedValue(['model1', 'model2']),
  unload: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@gchat/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@gchat/core')>()
  return {
    ...actual,
    EngineManager: {
      instance: () => ({
        engines: new Map([['engine1', engineMocks]]),
      }),
    },
  }
})

describe('TauriAppService', () => {
  let appService: TauriAppService
  let ipcHandler: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.clearAllMocks()
    ipcHandler = vi.fn()
    mockIPC((command: string, args?: InvokeArgs) => ipcHandler(command, args))
    seedServiceHub({ core: new TauriCoreService() })
    window.core = {
      api: APIs,
      extensionManager: undefined,
    }
    appService = new TauriAppService()
    window.localStorage.clear()
  })

  describe('parseLogLine', () => {
    it('parses a valid log line', () => {
      expect(
        appService.parseLogLine(
          '[2024-01-01][10:00:00][target][INFO] Test message'
        )
      ).toEqual({
        timestamp: '2024-01-01T10:00:00Z',
        level: 'info',
        target: 'target',
        message: 'Test message',
      })
    })

    it('preserves an invalid log line as an info entry', () => {
      const result = appService.parseLogLine('Invalid log line')

      expect(result).toEqual(
        expect.objectContaining({
          level: 'info',
          target: 'info',
          message: 'Invalid log line',
        })
      )
      expect(typeof result.timestamp).toBe('number')
    })
  })

  it('reads and parses logs through real invoke', async () => {
    ipcHandler.mockReturnValue(
      '[2024-01-01][10:00:00Z][target][INFO] Test message\n' +
        '[2024-01-01][10:01:00Z][target][ERROR] Error message'
    )

    const result = await appService.readLogs()

    expect(ipcHandler).toHaveBeenCalledWith('read_logs', {})
    expect(result.map((entry) => entry.message)).toEqual([
      'Test message',
      'Error message',
    ])
  })

  it('routes data-folder reads through APIs and TauriCoreService', async () => {
    ipcHandler.mockReturnValue({ data_folder: '/path/to/gchat/data' })

    await expect(appService.getGchatDataFolder()).resolves.toBe(
      '/path/to/gchat/data'
    )
    expect(ipcHandler).toHaveBeenCalledWith('get_app_configurations', {})
  })

  it('invokes exactly one native data-folder transaction without a separate config update', async () => {
    ipcHandler.mockReturnValue(undefined)

    await appService.relocateGchatDataFolder('/new/path/to/gchat/data')

    expect(ipcHandler).toHaveBeenCalledWith('change_app_data_folder', {
      newDataFolder: '/new/path/to/gchat/data',
    })
    expect(ipcHandler).toHaveBeenCalledTimes(1)
  })

  it('propagates a native busy refusal without updating app configuration', async () => {
    ipcHandler.mockRejectedValue('Host is busy: model load in progress')

    await expect(
      appService.relocateGchatDataFolder('/new/path/to/gchat/data')
    ).rejects.toBe('Host is busy: model load in progress')

    expect(ipcHandler).toHaveBeenCalledExactlyOnceWith('change_app_data_folder', {
      newDataFolder: '/new/path/to/gchat/data',
    })
  })

  it('reads and updates the durable autostart preference', async () => {
    const configuration = {
      data_folder: '/path/to/gchat/data',
      quick_ask: false,
      autostart_preference: 'disabled' as const,
    }
    ipcHandler.mockImplementation((command: string) =>
      command === 'get_app_configurations' ? configuration : undefined
    )

    await expect(appService.getAutostartPreference()).resolves.toBe('disabled')
    await appService.setAutostartPreference('enabled')

    expect(ipcHandler).toHaveBeenCalledWith('update_app_configuration', {
      configuration: {
        ...configuration,
        autostart_preference: 'enabled',
      },
    })
  })

  it('defers preferences reset to the restarted app without unloading Agent dependencies', async () => {
    window.localStorage.setItem(localStorageKey.settingGeneral, 'saved-settings')
    ipcHandler.mockImplementation(() => {
      expect(window.localStorage.getItem(localStorageKey.settingGeneral)).toBe(
        'saved-settings'
      )
      expect(
        window.localStorage.getItem(localStorageKey.factoryResetPending)
      ).toBe('true')
      expect(engineMocks.getLoadedModels).not.toHaveBeenCalled()
      expect(engineMocks.unload).not.toHaveBeenCalled()
    })

    await appService.factoryReset()

    expect(window.localStorage.getItem(localStorageKey.settingGeneral)).toBe(
      'saved-settings'
    )
    expect(window.localStorage.getItem(localStorageKey.factoryResetPending)).toBe(
      'true'
    )
    expect(ipcHandler).toHaveBeenCalledExactlyOnceWith('factory_reset', {})
  })

  it.each([null, 'false'])(
    'preserves preferences and restores pending flag %s when native reset refuses',
    async (previousResetPending) => {
      const failure = 'Agent runs did not finish shutting down within 15 seconds'
      window.localStorage.setItem(localStorageKey.settingGeneral, 'saved-settings')
      if (previousResetPending !== null) {
        window.localStorage.setItem(
          localStorageKey.factoryResetPending,
          previousResetPending
        )
      }
      ipcHandler.mockRejectedValue(failure)

      await expect(appService.factoryReset()).rejects.toBe(failure)

      expect(window.localStorage.getItem(localStorageKey.settingGeneral)).toBe(
        'saved-settings'
      )
      expect(
        window.localStorage.getItem(localStorageKey.factoryResetPending)
      ).toBe(previousResetPending)
      expect(engineMocks.getLoadedModels).not.toHaveBeenCalled()
      expect(engineMocks.unload).not.toHaveBeenCalled()
      expect(ipcHandler).toHaveBeenCalledExactlyOnceWith('factory_reset', {})
    }
  )

  it('returns undefined when installer type invoke rejects', async () => {
    ipcHandler.mockRejectedValue(new Error('unavailable'))

    await expect(appService.getInstallerType()).resolves.toBeUndefined()
  })

  it('passes readYaml arguments through real invoke', async () => {
    ipcHandler.mockReturnValue({ enabled: true })

    await expect(appService.readYaml('/tmp/config.yml')).resolves.toEqual({
      enabled: true,
    })
    expect(ipcHandler).toHaveBeenCalledWith('read_yaml', {
      path: '/tmp/config.yml',
    })
  })
})

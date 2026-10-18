import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  getLaunchAtStartup,
  reconcileLaunchAtStartup,
  setLaunchAtStartup,
} from '../launchAtStartup'
import type { AppService } from '@/services/app/types'

const autostart = vi.hoisted(() => ({
  disable: vi.fn(),
  enable: vi.fn(),
  isEnabled: vi.fn(),
  invoke: vi.fn(),
}))

vi.mock('@tauri-apps/api/core', () => ({ invoke: autostart.invoke }))

const createPreferenceStore = (
  preference: Awaited<ReturnType<AppService['getAutostartPreference']>>
) => ({
  getAutostartPreference: vi.fn().mockResolvedValue(preference),
  setAutostartPreference: vi.fn().mockResolvedValue(undefined),
})

describe('launch at startup', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    autostart.invoke.mockImplementation((command, args) => {
      if (command === 'is_launch_at_startup_enabled') {
        return autostart.isEnabled()
      }
      if (command === 'set_launch_at_startup_enabled') {
        return args.enabled ? autostart.enable() : autostart.disable()
      }
      throw new Error(`Unexpected native command: ${command}`)
    })
  })

  it('reads startup state from the same native owner used by the toggle', async () => {
    autostart.isEnabled.mockResolvedValue(true)

    await expect(getLaunchAtStartup()).resolves.toBe(true)

    expect(autostart.invoke).toHaveBeenCalledExactlyOnceWith(
      'is_launch_at_startup_enabled'
    )
  })

  it('completes a saved pending-default preference exactly once', async () => {
    const store = createPreferenceStore('pending_default_on')
    autostart.isEnabled.mockResolvedValueOnce(false).mockResolvedValueOnce(true)

    await expect(reconcileLaunchAtStartup(store)).resolves.toBe(true)

    expect(autostart.enable).toHaveBeenCalledOnce()
    expect(autostart.invoke).toHaveBeenCalledWith(
      'set_launch_at_startup_enabled',
      { enabled: true }
    )
    expect(store.setAutostartPreference).toHaveBeenCalledWith('enabled')
  })

  it('adopts existing OS state without changing it for upgraded users', async () => {
    const store = createPreferenceStore('unmanaged')
    autostart.isEnabled.mockResolvedValue(false)

    await expect(reconcileLaunchAtStartup(store)).resolves.toBe(false)

    expect(autostart.enable).not.toHaveBeenCalled()
    expect(autostart.disable).not.toHaveBeenCalled()
    expect(store.setAutostartPreference).toHaveBeenCalledWith('disabled')
  })

  it('preserves an autostart disable made through the operating system', async () => {
    const store = createPreferenceStore('enabled')
    autostart.isEnabled.mockResolvedValue(false)

    await expect(reconcileLaunchAtStartup(store)).resolves.toBe(false)

    expect(autostart.enable).not.toHaveBeenCalled()
    expect(store.setAutostartPreference).toHaveBeenCalledWith('disabled')
  })

  it('adopts an autostart enable made through the operating system', async () => {
    const store = createPreferenceStore('disabled')
    autostart.isEnabled.mockResolvedValue(true)

    await expect(reconcileLaunchAtStartup(store)).resolves.toBe(true)

    expect(autostart.disable).not.toHaveBeenCalled()
    expect(store.setAutostartPreference).toHaveBeenCalledWith('enabled')
  })

  it('persists the state applied by the Settings toggle', async () => {
    const store = createPreferenceStore('disabled')
    autostart.isEnabled.mockResolvedValue(true)

    await expect(setLaunchAtStartup(store, true)).resolves.toBe(true)

    expect(autostart.enable).toHaveBeenCalledOnce()
    expect(store.setAutostartPreference).toHaveBeenCalledWith('enabled')
  })

  it('disables autostart through the Settings toggle', async () => {
    const store = createPreferenceStore('enabled')
    autostart.isEnabled.mockResolvedValue(false)

    await expect(setLaunchAtStartup(store, false)).resolves.toBe(false)

    expect(autostart.disable).toHaveBeenCalledOnce()
    expect(autostart.invoke).toHaveBeenCalledWith(
      'set_launch_at_startup_enabled',
      { enabled: false }
    )
    expect(store.setAutostartPreference).toHaveBeenCalledWith('disabled')
  })

  it('rejects a toggle change the operating system did not apply', async () => {
    const store = createPreferenceStore('enabled')
    autostart.isEnabled.mockResolvedValue(true)

    await expect(setLaunchAtStartup(store, false)).rejects.toThrow(
      'Operating system did not apply launch-at-startup setting'
    )
    expect(store.setAutostartPreference).not.toHaveBeenCalled()
  })

  it('does not persist success when native startup registration fails', async () => {
    const store = createPreferenceStore('disabled')
    autostart.enable.mockRejectedValue(
      new Error('Could not create startup directory')
    )

    await expect(setLaunchAtStartup(store, true)).rejects.toThrow(
      'Could not create startup directory'
    )

    expect(store.setAutostartPreference).not.toHaveBeenCalled()
    expect(autostart.isEnabled).not.toHaveBeenCalled()
  })

  it('does not replace the saved preference when startup state cannot be read', async () => {
    const store = createPreferenceStore('enabled')
    autostart.isEnabled.mockRejectedValue(new Error('Could not read startup entry'))

    await expect(reconcileLaunchAtStartup(store)).rejects.toThrow(
      'Could not read startup entry'
    )

    expect(autostart.enable).not.toHaveBeenCalled()
    expect(autostart.disable).not.toHaveBeenCalled()
    expect(store.setAutostartPreference).not.toHaveBeenCalled()
  })
})

import { invoke } from '@tauri-apps/api/core'
import type { AppService } from '@/services/app/types'
import type { AutostartPreference } from '@gchat/core'

type AutostartPreferenceStore = Pick<
  AppService,
  'getAutostartPreference' | 'setAutostartPreference'
>

const preferenceForState = (enabled: boolean): AutostartPreference =>
  enabled ? 'enabled' : 'disabled'

export const getLaunchAtStartup = (): Promise<boolean> =>
  invoke<boolean>('is_launch_at_startup_enabled')

export const setLaunchAtStartupState = (enabled: boolean): Promise<void> =>
  invoke<void>('set_launch_at_startup_enabled', { enabled })

export async function reconcileLaunchAtStartup(
  appService: AutostartPreferenceStore
): Promise<boolean> {
  const preference = await appService.getAutostartPreference()
  let enabled = await getLaunchAtStartup()

  if (preference === 'pending_default_on') {
    if (!enabled) {
      await setLaunchAtStartupState(true)
      enabled = await getLaunchAtStartup()
    }
    if (!enabled) {
      throw new Error('Operating system did not enable launch at startup')
    }
  }

  const resolvedPreference = preferenceForState(enabled)
  if (preference !== resolvedPreference) {
    await appService.setAutostartPreference(resolvedPreference)
  }

  return enabled
}

export async function setLaunchAtStartup(
  appService: AutostartPreferenceStore,
  enabled: boolean
): Promise<boolean> {
  await setLaunchAtStartupState(enabled)

  const actualState = await getLaunchAtStartup()
  if (actualState !== enabled) {
    throw new Error('Operating system did not apply launch-at-startup setting')
  }

  await appService.setAutostartPreference(preferenceForState(actualState))
  return actualState
}

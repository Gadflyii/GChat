import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { localStorageKey } from '@/constants/localStorage'

import {
  restoreFreshInstallBackup,
  runFreshInstallReset,
} from '@/lib/freshInstall'

const BACKUP_KEY = '__gchat_fresh_install_backup_v1__'
const SESSION_MARKER = 'gchat_fresh_install_launch'

vi.mock('@/lib/extension', () => ({
  ExtensionManager: { getInstance: vi.fn() },
}))

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('runFreshInstallReset (FRESH_INSTALL builds)', () => {
  beforeEach(() => {
    vi.stubGlobal('FRESH_INSTALL', true)
  })

  it('backs up the profile and starts the launch with an empty localStorage', () => {
    localStorage.setItem('model-provider', '{"state":{}}')
    localStorage.setItem('setup-completed', 'true')

    runFreshInstallReset()

    expect(localStorage.getItem('model-provider')).toBeNull()
    expect(localStorage.getItem('setup-completed')).toBeNull()
    expect(JSON.parse(localStorage.getItem(BACKUP_KEY) ?? '{}')).toEqual({
      'model-provider': '{"state":{}}',
      'setup-completed': 'true',
    })
    expect(sessionStorage.getItem(SESSION_MARKER)).toBe('true')
  })

  it('wipes once per launch, not on reloads within the same launch', () => {
    runFreshInstallReset()
    // A reload keeps sessionStorage; mid-flow progress must survive it.
    localStorage.setItem('setup-completed', 'true')

    runFreshInstallReset()

    expect(localStorage.getItem('setup-completed')).toBe('true')
  })

  it('keeps the original backup across fresh launches, discarding fresh-run residue', () => {
    localStorage.setItem('model-provider', 'original-profile')
    runFreshInstallReset()

    // Next app launch (sessionStorage gone), fresh-run data present.
    sessionStorage.clear()
    localStorage.setItem('model-provider', 'fresh-run-data')
    runFreshInstallReset()

    expect(localStorage.getItem('model-provider')).toBeNull()
    expect(JSON.parse(localStorage.getItem(BACKUP_KEY) ?? '{}')).toEqual({
      'model-provider': 'original-profile',
    })
  })

  it('never restores the backup mid-fresh-mode', () => {
    localStorage.setItem('model-provider', 'original-profile')
    runFreshInstallReset()

    restoreFreshInstallBackup()

    expect(localStorage.getItem('model-provider')).toBeNull()
    expect(localStorage.getItem(BACKUP_KEY)).not.toBeNull()
  })
})

describe('restoreFreshInstallBackup (normal builds)', () => {
  it('puts the original profile back and drops the backup and fresh-run keys', () => {
    localStorage.setItem(
      BACKUP_KEY,
      JSON.stringify({ 'model-provider': 'original-profile' })
    )
    localStorage.setItem('atomic_turboquant_default_active_v1', 'false')

    restoreFreshInstallBackup()

    expect(localStorage.getItem('model-provider')).toBe('original-profile')
    expect(localStorage.getItem(BACKUP_KEY)).toBeNull()
    expect(
      localStorage.getItem('atomic_turboquant_default_active_v1')
    ).toBeNull()
  })

  it('is a no-op when no backup exists', () => {
    localStorage.setItem('model-provider', 'untouched')

    restoreFreshInstallBackup()

    expect(localStorage.getItem('model-provider')).toBe('untouched')
  })
})

describe('shipped builds (flag undefined)', () => {
  it('reset is a no-op', () => {
    localStorage.setItem('model-provider', 'untouched')

    runFreshInstallReset()

    expect(localStorage.getItem('model-provider')).toBe('untouched')
    expect(localStorage.getItem(BACKUP_KEY)).toBeNull()
  })
})

describe('startup reset before persisted stores load', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.stubGlobal('FRESH_INSTALL', false)
  })

  const savedSettings = JSON.stringify({
    state: {
      preloadModelOnStartup: true,
      huggingfaceToken: 'saved-token',
    },
    version: 3,
  })

  it('clears confirmed reset preferences before hydration and consumes the flag once', async () => {
    localStorage.setItem(localStorageKey.settingGeneral, savedSettings)
    localStorage.setItem(localStorageKey.setupCompleted, 'true')
    localStorage.setItem(localStorageKey.factoryResetPending, 'true')
    localStorage.setItem(
      BACKUP_KEY,
      JSON.stringify({ [localStorageKey.settingGeneral]: savedSettings })
    )

    await import('@/lib/freshInstallBoot')
    const { useGeneralSetting } = await import('@/hooks/useGeneralSetting')

    expect(useGeneralSetting.getState().preloadModelOnStartup).toBe(false)
    expect(useGeneralSetting.getState().huggingfaceToken).toBeUndefined()
    expect(localStorage.getItem(localStorageKey.setupCompleted)).toBeNull()
    expect(localStorage.getItem(localStorageKey.factoryResetPending)).toBeNull()
    expect(localStorage.getItem(BACKUP_KEY)).toBeNull()

    useGeneralSetting.getState().setPreloadModelOnStartup(true)
    localStorage.setItem(localStorageKey.setupCompleted, 'true')
    vi.resetModules()
    await import('@/lib/freshInstallBoot')
    const restarted = await import('@/hooks/useGeneralSetting')

    expect(restarted.useGeneralSetting.getState().preloadModelOnStartup).toBe(true)
    expect(localStorage.getItem(localStorageKey.setupCompleted)).toBe('true')
  })

  it('preserves saved preferences when no reset was requested', async () => {
    localStorage.setItem(localStorageKey.settingGeneral, savedSettings)

    await import('@/lib/freshInstallBoot')
    const { useGeneralSetting } = await import('@/hooks/useGeneralSetting')

    expect(useGeneralSetting.getState().preloadModelOnStartup).toBe(true)
    expect(useGeneralSetting.getState().huggingfaceToken).toBe('saved-token')
  })

  it('discards the dev-fresh backup before reset so a normal launch cannot restore it', async () => {
    vi.stubGlobal('FRESH_INSTALL', true)
    localStorage.setItem(localStorageKey.factoryResetPending, 'true')
    localStorage.setItem(
      BACKUP_KEY,
      JSON.stringify({ [localStorageKey.settingGeneral]: savedSettings })
    )

    await import('@/lib/freshInstallBoot')

    expect(JSON.parse(localStorage.getItem(BACKUP_KEY) ?? '{}')).toEqual({})
    expect(localStorage.getItem(localStorageKey.factoryResetPending)).toBeNull()

    vi.stubGlobal('FRESH_INSTALL', false)
    vi.resetModules()
    await import('@/lib/freshInstallBoot')
    const { useGeneralSetting } = await import('@/hooks/useGeneralSetting')

    expect(useGeneralSetting.getState().preloadModelOnStartup).toBe(false)
    expect(useGeneralSetting.getState().huggingfaceToken).toBeUndefined()
    expect(localStorage.getItem(BACKUP_KEY)).toBeNull()
  })
})

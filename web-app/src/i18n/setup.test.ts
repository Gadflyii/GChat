import { describe, expect, it } from 'vitest'
import i18n, { loadTranslations, subscribeLanguage } from './setup'
import { localStorageKey } from '@/constants/localStorage'

// Exercise actual bundled translation inputs rather than a mock dictionary.
describe('language loading', () => {
  it('resolves the saved initial language before returning ready to render', async () => {
    localStorage.setItem(localStorageKey.settingGeneral, JSON.stringify({ state: { currentLanguage: 'ja' } }))
    await loadTranslations()
    expect(i18n.language).toBe('ja')
    expect(i18n.t('common:settings')).toBe(i18n.resources.ja.common.settings)
    await i18n.changeLanguage('en')
  })
  it('loads a selected language and publishes translated values', async () => {
    let published = 0
    const unsubscribe = subscribeLanguage(() => { published++ })
    await i18n.changeLanguage('ru')
    expect(i18n.language).toBe('ru')
    expect(i18n.t('common:settings')).toBe(i18n.resources.ru.common.settings)
    expect(published).toBe(1)
    unsubscribe()
  })

  it('keeps the newest selection when an earlier language finishes loading', async () => {
    const earlier = i18n.changeLanguage('ja')
    const latest = i18n.changeLanguage('en')
    await Promise.all([earlier, latest])
    expect(i18n.language).toBe('en')
    expect(i18n.t('common:settings')).toBe(i18n.resources.en.common.settings)
  })

  it('retains the active language for an unavailable selection and English fallback', async () => {
    await i18n.changeLanguage('ru')
    await i18n.changeLanguage('unavailable')
    expect(i18n.language).toBe('ru')
    expect(i18n.t('missing:key', { defaultValue: 'Fallback' })).toBe('Fallback')
    await i18n.changeLanguage('en')
  })
})

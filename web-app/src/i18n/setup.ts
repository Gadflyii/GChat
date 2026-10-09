import { localStorageKey } from '@/constants/localStorage'

// Types for our i18n implementation
export interface TranslationResources {
  [language: string]: {
    [namespace: string]: {
      [key: string]: string
    }
  }
}

export interface I18nInstance {
  language: string
  fallbackLng: string
  resources: TranslationResources
  namespaces: string[]
  defaultNS: string
  changeLanguage: (lng: string) => Promise<void>
  t: (key: string, options?: Record<string, unknown>) => string
}

// Global i18n instance
let i18nInstance: I18nInstance

// English is the synchronous fallback. Other languages are loaded only when
// selected, including the persisted initial selection before React mounts.
const englishFiles = import.meta.glob('../locales/en/*.json', { eager: true, import: 'default' })
const localeFiles = import.meta.glob([
  '../locales/**/*.json', '!../locales/en/*.json',
], { import: 'default' })
const resources: TranslationResources = { en: {} }
const namespaces = Object.keys(englishFiles).map(path => path.split('/').pop()!.replace('.json', ''))
for (const [path, value] of Object.entries(englishFiles)) {
  resources.en[path.split('/').pop()!.replace('.json', '')] = value as Record<string, string>
}
const languageLoads = new Map<string, Promise<void>>()
const listeners = new Set<() => void>()
let languageRequest = 0

export function subscribeLanguage(listener: () => void) {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

async function ensureLanguage(language: string) {
  if (resources[language]) return
  const files = Object.entries(localeFiles).filter(([path]) => path.startsWith(`../locales/${language}/`))
  if (files.length === 0) return
  let loading = languageLoads.get(language)
  if (!loading) {
    loading = Promise.all(files.map(async ([path, load]) => {
      const value = await load()
      return [path.split('/').pop()!.replace('.json', ''), value] as const
    })).then(entries => { resources[language] = Object.fromEntries(entries) as Record<string, Record<string, string>> })
    languageLoads.set(language, loading)
    loading.catch(() => { languageLoads.delete(language) })
  }
  await loading
}

// Get stored language preference
const getStoredLanguage = (): string => {
  try {
    const stored = localStorage.getItem(localStorageKey.settingGeneral)
    const parsed = stored ? JSON.parse(stored) : {}
    return parsed?.state?.currentLanguage || 'en'
  } catch {
    return 'en'
  }
}

// Translation function
const translate = (key: string, options: Record<string, unknown> = {}): string => {
  const { language, fallbackLng, resources: res, defaultNS } = i18nInstance
  
  // Parse key to extract namespace and actual key
  let namespace = defaultNS
  let translationKey = key
  
  if (key.includes(':')) {
    const parts = key.split(':')
    namespace = parts[0]
    translationKey = parts[1]
  }
  
  // Helper function to get nested value from object using dot notation
  const getNestedValue = (obj: Record<string, unknown>, path: string): string | undefined => {
    return path.split('.').reduce((current, key) => {
      return current && typeof current === 'object' && current !== null && key in current
        ? (current as Record<string, unknown>)[key]
        : undefined
    }, obj as unknown) as string | undefined
  }
  
  // Try to get translation from current language
  let translation = getNestedValue(res[language]?.[namespace], translationKey)
  
  // Fallback to fallback language if not found
  if (translation === undefined && language !== fallbackLng) {
    translation = getNestedValue(res[fallbackLng]?.[namespace], translationKey)
  }
  
  // If still not found, honor a caller-supplied `defaultValue`
  // (matches react-i18next semantics). Only fall back to returning
  // the raw key when no default was provided — keeps debugging easy
  // for genuinely missing translations.
  if (translation === undefined) {
    const fallback = options?.defaultValue
    if (typeof fallback === 'string') {
      translation = fallback
    } else {
      console.warn(`Translation missing for key: ${key}`)
      return key
    }
  }
  
  // Handle interpolation
  if (typeof translation === 'string' && options) {
    return translation.replace(/\{\{(\w+)\}\}/g, (match, variable) => {
      return options[variable] !== undefined ? String(options[variable]) : match
    })
  }
  
  return String(translation)
}

// Change language function
const changeLanguage = async (lng: string): Promise<void> => {
  const request = ++languageRequest
  await ensureLanguage(lng)
  if (request !== languageRequest) return
  if (i18nInstance && resources[lng]) {
    i18nInstance.language = lng
    for (const listener of listeners) listener()
    
    // Update localStorage
    try {
      const stored = localStorage.getItem(localStorageKey.settingGeneral)
      const parsed = stored ? JSON.parse(stored) : { state: {} }
      parsed.state ??= {}
      parsed.state.currentLanguage = lng
      localStorage.setItem(localStorageKey.settingGeneral, JSON.stringify(parsed))
    } catch (error) {
      console.error('Failed to save language preference:', error)
    }
  }
}

// Initialize i18n instance
const initI18n = (): I18nInstance => {
  const currentLanguage = 'en'
  
  i18nInstance = {
    language: currentLanguage,
    fallbackLng: 'en',
    resources,
    namespaces,
    defaultNS: 'common',
    changeLanguage,
    t: translate,
  }
  
  return i18nInstance
}

export const loadTranslations = (): Promise<void> => changeLanguage(getStoredLanguage())

// Initialize and export the i18n instance
const i18n = initI18n()

export default i18n

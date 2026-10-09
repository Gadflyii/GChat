import { type ReactNode, useEffect, useSyncExternalStore } from 'react'
import i18next, { subscribeLanguage } from './setup'
import { useGeneralSetting } from '@/hooks/useGeneralSetting'
import { TranslationContext } from './context'

export const TranslationProvider = ({ children }: { children: ReactNode }) => {
  const currentLanguage = useGeneralSetting(state => state.currentLanguage)
  useSyncExternalStore(subscribeLanguage, () => i18next.language)
  useEffect(() => {
    if (currentLanguage) {
      void i18next.changeLanguage(currentLanguage).catch(error => {
        console.error('Failed to load translations:', error)
      })
    }
  }, [currentLanguage])

  return <TranslationContext.Provider value={{ t: i18next.t, i18n: i18next }}>{children}</TranslationContext.Provider>
}

export default TranslationProvider

/**
 * Apply confirmed factory resets and dev-only fresh-install mode before any
 * persisted store loads. MUST stay the very first import of `main.tsx`:
 * zustand `persist` stores rehydrate synchronously when imported, so code in
 * the `main.tsx` body would run too late.
 */
import { localStorageKey } from '@/constants/localStorage'
import {
  restoreFreshInstallBackup,
  runFreshInstallReset,
} from './freshInstall'

if (
  typeof window !== 'undefined' &&
  localStorage.getItem(localStorageKey.factoryResetPending) === 'true'
) {
  // Also discard any dev-fresh backup so it cannot undo a confirmed reset.
  localStorage.clear()
}

runFreshInstallReset()
restoreFreshInstallBackup()

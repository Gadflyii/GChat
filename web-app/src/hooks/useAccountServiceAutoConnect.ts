import { useEffect } from 'react'
import { getGbotServiceTarget } from '@/services/gbot'
import { connectorAccounts } from '@/services/workspace-connectors'

/**
 * Connects this computer's account service once when GChat opens, so Workspace connections never asks the
 * person to press a Connect button. Connecting reads no saved sign-in; secure storage is opened only when an
 * account is actually used. A service on another computer is left alone, and a failure is silent here: the
 * Workspace connections page retries and shows a plain error with a Try again button.
 */
export function useAccountServiceAutoConnect(): void {
  useEffect(() => {
    let cancelled = false
    void Promise.resolve()
      .then(() => getGbotServiceTarget())
      .then((target) => {
        if (cancelled || target?.kind === 'paired_host') return
        return connectorAccounts(true)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [])
}

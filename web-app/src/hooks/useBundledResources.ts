import { useEffect, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { createSafeUnlisten } from '@/lib/tauriEvent'

/** Observe the retained installation result without waiting on service startup. */
export function useBundledResources(enabled = true) {
  const [status, setStatus] = useState<{
    ready: boolean | null
    error: string
  }>({ ready: null, error: '' })

  useEffect(() => {
    if (!IS_TAURI || !enabled) return
    let disposed = false
    let generation = 0
    let detach: (() => Promise<void>) | undefined

    const refresh = async () => {
      const current = ++generation
      try {
        const ready = await invoke<boolean>('bundled_resources_ready')
        if (!disposed && current === generation) setStatus({ ready, error: '' })
      } catch (error) {
        if (!disposed && current === generation)
          setStatus({ ready: null, error: String(error) })
      }
    }

    // Subscribe first so completion during registration is covered by the
    // retained snapshot, and completion during a snapshot triggers a fresh read.
    void listen('bundled-resources-update', () => void refresh())
      .then((unlisten) => {
        detach = createSafeUnlisten(unlisten)
        if (disposed) void detach()
        else void refresh()
      })
      .catch((error: unknown) => {
        if (!disposed) setStatus({ ready: null, error: String(error) })
      })

    return () => {
      disposed = true
      if (detach) void detach()
    }
  }, [enabled])

  return !IS_TAURI || !enabled ? { ready: true, error: '' } : status
}

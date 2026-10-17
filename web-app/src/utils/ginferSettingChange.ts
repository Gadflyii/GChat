import { confirmAction } from '@/lib/confirm'
import { ginferRestartKeys } from '@/lib/ginfer-settings-labels'

/**
 * After a GInfer setting is saved: live settings do nothing to the running
 * model; restart-required settings ask first and restart only on "Restart now".
 * Returns true when the running model(s) were restarted.
 */
export async function afterGinferSettingSaved(opts: {
  key: string
  activeModelIds: string[]
  restart: (modelId: string) => Promise<void>
  onError?: (error: unknown) => void
}): Promise<boolean> {
  if (!ginferRestartKeys.has(opts.key) || opts.activeModelIds.length === 0) {
    return false
  }
  const accepted = await confirmAction({
    title: 'Restart the model?',
    message: 'This change takes effect after the model restarts. Restart now?',
    confirmLabel: 'Restart now',
    cancelLabel: 'Later',
  })
  if (!accepted) return false
  try {
    for (const id of opts.activeModelIds) await opts.restart(id)
  } catch (error) {
    opts.onError?.(error)
    return false
  }
  return true
}

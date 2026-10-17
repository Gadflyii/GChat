import { vi } from 'vitest'
import { settleConfirm, useConfirmStore } from '@/lib/confirm'

const stops: Array<() => void> = []

/**
 * Stand in for the user answering confirmAction() dialogs. The returned spy is
 * called with each dialog's message; its return value is the answer, so
 * `mockReturnValue(true)` and `toHaveBeenCalledOnce()` work as they did for the
 * old window.confirm spy. Subscriptions are removed after every test.
 */
export function spyConfirm(answer = true) {
  const spy = vi.fn<(message: string) => boolean>().mockReturnValue(answer)
  stops.push(useConfirmStore.subscribe((state) => {
    const pending = state.pending
    if (pending) queueMicrotask(() => settleConfirm(!!spy(pending.message)))
  }))
  return spy
}

export function stopConfirmSpies() {
  while (stops.length) stops.pop()!()
  settleConfirm(false)
}

import { create } from 'zustand'

export type ConfirmOptions = {
  /** What will happen, in a sentence or two. */
  message: string
  title?: string
  confirmLabel?: string
  cancelLabel?: string
  /** Style the confirm button as destructive. */
  destructive?: boolean
  /** Stable opener when the initiating menu item will be removed. */
  returnFocus?: HTMLElement | null
}

type Pending = ConfirmOptions & {
  resolve: (accepted: boolean) => void
  returnFocus: HTMLElement | null
}

export const useConfirmStore = create<{ pending: Pending | null }>(() => ({ pending: null }))

/**
 * Ask the user to confirm with the app's own dialog (never the OS popup).
 * Resolves true only when they choose the confirm button. A second request
 * while one is open cancels the first.
 */
export function confirmAction(options: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    const previous = useConfirmStore.getState().pending
    const returnFocus = options.returnFocus ?? (
      previous
        ? previous.returnFocus
        : typeof document !== 'undefined' && document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null
    )
    previous?.resolve(false)
    useConfirmStore.setState({ pending: { ...options, resolve, returnFocus } })
  })
}

export function settleConfirm(accepted: boolean) {
  const pending = useConfirmStore.getState().pending
  if (!pending) return
  useConfirmStore.setState({ pending: null })
  pending.resolve(accepted)
}

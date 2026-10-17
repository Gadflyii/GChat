import { useRef } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { settleConfirm, useConfirmStore } from '@/lib/confirm'

/** Renders the dialog for confirmAction(); mount once at the app root. */
export function ConfirmDialogHost() {
  const pending = useConfirmStore((state) => state.pending)
  const cancelRef = useRef<HTMLButtonElement>(null)
  return (
    <Dialog open={!!pending} onOpenChange={(open) => { if (!open) settleConfirm(false) }}>
      <DialogContent
        showCloseButton={false}
        onOpenAutoFocus={(event) => {
          // Cancel is the safe default: Enter or Space never confirms by accident.
          event.preventDefault()
          cancelRef.current?.focus()
        }}
      >
        <DialogHeader>
          <DialogTitle>{pending?.title ?? 'Are you sure?'}</DialogTitle>
          <DialogDescription>{pending?.message}</DialogDescription>
        </DialogHeader>
        <DialogFooter className="mt-2">
          <Button ref={cancelRef} variant="outline" onClick={() => settleConfirm(false)}>
            {pending?.cancelLabel ?? 'Cancel'}
          </Button>
          <Button
            variant={pending?.destructive ? 'destructive' : 'default'}
            onClick={() => settleConfirm(true)}
          >
            {pending?.confirmLabel ?? 'Confirm'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

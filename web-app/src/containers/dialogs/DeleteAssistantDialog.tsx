import { useRef, useState } from 'react'
import { useTranslation } from '@/i18n/react-i18next-compat'
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogHeader,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'

interface DeleteAssistantDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: () => void | Promise<void>
}

export function DeleteAssistantDialog({
  open,
  onOpenChange,
  onConfirm,
}: DeleteAssistantDialogProps) {
  const { t } = useTranslation()
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const deletionPending = useRef(false)
  const cancelButtonRef = useRef<HTMLButtonElement>(null)

  const handleConfirm = async () => {
    if (deletionPending.current) return
    // Lock before rendering pending controls so repeated input cannot start
    // another deletion of the same assistant.
    deletionPending.current = true
    setDeleting(true)
    setError(null)
    try {
      await onConfirm()
    } catch (error) {
      setError(String(error))
    } finally {
      deletionPending.current = false
      setDeleting(false)
    }
  }

  const handleOpenChange = (open: boolean) => {
    if (deletionPending.current) return
    setError(null)
    onOpenChange(open)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className="sm:max-w-[425px] max-w-[90vw]"
        aria-busy={deleting}
        showCloseButton={!deleting}
        onOpenAutoFocus={(e) => {
          e.preventDefault()
          cancelButtonRef.current?.focus()
        }}
        onEscapeKeyDown={(e) => {
          if (deletionPending.current) e.preventDefault()
        }}
        onInteractOutside={(e) => {
          if (deletionPending.current) e.preventDefault()
        }}
      >
        <DialogHeader>
          <DialogTitle>{t('assistants:deleteConfirmation')}</DialogTitle>
          <DialogDescription>
            {t('assistants:deleteConfirmationDesc')}
          </DialogDescription>
        </DialogHeader>
        {error !== null && (
          <p role="alert" className="text-destructive text-sm">
            {error}
          </p>
        )}
        <DialogFooter className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
          <Button
            ref={cancelButtonRef}
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => handleOpenChange(false)}
            disabled={deleting}
            className="w-full sm:w-auto"
          >
            {t('assistants:cancel')}
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={() => void handleConfirm()}
            disabled={deleting}
            aria-busy={deleting}
            size="sm"
            className="w-full sm:w-auto"
            aria-label={t('assistants:delete')}
          >
            {deleting ? t('common:loading') : t('assistants:delete')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

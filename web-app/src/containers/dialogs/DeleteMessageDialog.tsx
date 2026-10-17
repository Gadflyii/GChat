import { useState, useRef } from 'react'
import { useTranslation } from '@/i18n/react-i18next-compat'
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogTitle,
  DialogDescription,
  DialogClose,
  DialogFooter,
  DialogHeader,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { IconTrash } from '@tabler/icons-react'

interface DeleteMessageDialogProps {
  onDelete: () => void | Promise<void>
}

export function DeleteMessageDialog({ onDelete }: DeleteMessageDialogProps) {
  const { t } = useTranslation()
  const [isOpen, setIsOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const deletionPending = useRef(false)
  const cancelButtonRef = useRef<HTMLButtonElement>(null)

  const handleOpenChange = (open: boolean) => {
    if (deletionPending.current) return
    setError(null)
    setIsOpen(open)
  }

  const handleDelete = async () => {
    if (deletionPending.current) return
    // Lock before rendering pending controls so repeated input cannot start
    // another deletion of the same message.
    deletionPending.current = true
    setDeleting(true)
    setError(null)
    try {
      await onDelete()
      setIsOpen(false)
    } catch (error) {
      setError(String(error))
    } finally {
      deletionPending.current = false
      setDeleting(false)
    }
  }

  const trigger = (
    <Button
      type="button"
      variant="ghost"
      size="icon-xs"
      aria-label={t('common:deleteMessage')}
    >
      <IconTrash size={16} />
    </Button>
  )

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent
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
          <DialogTitle>{t('common:deleteMessage')}</DialogTitle>
          <DialogDescription>
            Are you sure you want to delete this message? This action cannot be
            undone.
          </DialogDescription>
          {error !== null && (
            <p role="alert" className="text-destructive text-sm">
              {error}
            </p>
          )}
          <DialogFooter className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
            <DialogClose asChild>
              <Button
                ref={cancelButtonRef}
                type="button"
                variant="ghost"
                size="sm"
                className="w-full sm:w-auto"
                disabled={deleting}
              >
                {t('common:cancel')}
              </Button>
            </DialogClose>
            <Button
              type="button"
              variant="destructive"
              onClick={() => void handleDelete()}
              disabled={deleting}
              aria-busy={deleting}
              size="sm"
              className="w-full sm:w-auto"
              aria-label={t('common:deleteMessage')}
            >
              {deleting ? t('common:loading') : t('common:delete')}
            </Button>
          </DialogFooter>
        </DialogHeader>
      </DialogContent>
    </Dialog>
  )
}

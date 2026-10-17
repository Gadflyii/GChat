import { useState, useRef } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useTranslation } from '@/i18n/react-i18next-compat'
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogHeader,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { IconTrash } from '@tabler/icons-react'
import { DropdownMenuItem } from '@/components/ui/dropdown-menu'
import { toast } from 'sonner'
import { route } from '@/constants/routes'

interface DeleteAllThreadsDialogProps {
  onDeleteAll: () => void | Promise<void>
  onDropdownClose?: () => void
}

export function DeleteAllThreadsDialog({
  onDeleteAll,
  onDropdownClose,
}: DeleteAllThreadsDialogProps) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [isOpen, setIsOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const cancelButtonRef = useRef<HTMLButtonElement>(null)
  const deletionPending = useRef(false)

  const handleOpenChange = (open: boolean) => {
    if (deletionPending.current) return
    setErrorMessage(null)
    setIsOpen(open)
    if (!open && onDropdownClose) {
      onDropdownClose()
    }
  }

  const handleDeleteAll = async () => {
    if (deletionPending.current) return
    deletionPending.current = true
    setDeleting(true)
    setErrorMessage(null)
    try {
      await onDeleteAll()
      setIsOpen(false)
      if (onDropdownClose) onDropdownClose()
      toast.success(t('common:toast.deleteAllThreads.title'), {
        id: 'delete-all-threads',
        description: t('common:toast.deleteAllThreads.description'),
      })
      setTimeout(() => { navigate({ to: route.home }) }, 0)
    } catch (error) {
      const message = String(error)
      setErrorMessage(message)
      toast.error('Could not delete conversations.', { description: message })
    } finally {
      deletionPending.current = false
      setDeleting(false)
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <DropdownMenuItem
          variant="destructive"
          onSelect={(e) => e.preventDefault()}
        >
          <IconTrash size={16} />
          <span>{t('common:deleteAll')}</span>
        </DropdownMenuItem>
      </DialogTrigger>
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
          <DialogTitle>
            {t('common:dialogs.deleteAllThreads.title')}
          </DialogTitle>
          <DialogDescription>
            {t('common:dialogs.deleteAllThreads.description')}
          </DialogDescription>
          {errorMessage && (
            <p role="alert" className="text-destructive text-sm">
              {errorMessage}
            </p>
          )}
          <DialogFooter className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
            <Button
              ref={cancelButtonRef}
              type="button"
              variant="ghost"
              size="sm"
              className="w-full sm:w-auto"
              disabled={deleting}
              onClick={() => handleOpenChange(false)}
            >
              {t('common:cancel')}
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => void handleDeleteAll()}
              disabled={deleting}
              aria-busy={deleting}
              size="sm"
              className="w-full sm:w-auto"
              aria-label={t('common:deleteAll')}
            >
              {t(deleting ? 'common:loading' : 'common:deleteAll')}
            </Button>
          </DialogFooter>
        </DialogHeader>
      </DialogContent>
    </Dialog>
  )
}

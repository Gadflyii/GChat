import { useState, useRef } from 'react'
import { useNavigate } from '@tanstack/react-router'
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
import { DropdownMenuItem } from '@/components/ui/dropdown-menu'
import { toast } from 'sonner'
import { route } from '@/constants/routes'

interface DeleteThreadDialogProps {
  thread: Thread
  onDelete: (threadId: string) => void | Promise<void>
  onDropdownClose?: () => void
  variant?: 'default' | 'project'
  open?: boolean
  onOpenChange?: (open: boolean) => void
  withoutTrigger?: boolean
}

export function DeleteThreadDialog({
  thread,
  onDelete,
  onDropdownClose,
  variant = 'default',
  open,
  onOpenChange,
  withoutTrigger,
}: DeleteThreadDialogProps) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [internalOpen, setInternalOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const deletionPending = useRef(false)
  const cancelButtonRef = useRef<HTMLButtonElement>(null)

  const isControlled = open !== undefined
  const isOpen = isControlled ? !!open : internalOpen
  const setOpenSafe = (next: boolean) => {
    if (isControlled) {
      onOpenChange?.(next)
    } else {
      setInternalOpen(next)
    }
  }

  const handleOpenChange = (open: boolean) => {
    if (deletionPending.current) return
    setError(null)
    setOpenSafe(open)
    if (!open) {
      onDropdownClose?.()
    }
  }

  const handleDelete = async () => {
    if (deletionPending.current) return
    // Lock synchronously so input repeated before the pending render cannot
    // start another deletion of the same thread.
    deletionPending.current = true
    setDeleting(true)
    setError(null)
    try {
      await onDelete(thread.id)
      setOpenSafe(false)
      onDropdownClose?.()
      toast.success(t('common:toast.deleteThread.title'), {
        id: 'delete-thread',
        description: t('common:toast.deleteThread.description'),
      })
      if (variant !== 'project') {
        setTimeout(() => {
          navigate({ to: route.home })
        }, 0)
      }
    } catch (error) {
      const message = String(error)
      setError(message)
      toast.error(message)
    } finally {
      deletionPending.current = false
      setDeleting(false)
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      {!withoutTrigger && (
        <DialogTrigger asChild>
          <DropdownMenuItem onSelect={(e) => e.preventDefault()}>
            <IconTrash />
            <span>{t('common:delete')}</span>
          </DropdownMenuItem>
        </DialogTrigger>
      )}
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
          <DialogTitle>{t('common:deleteThread')}</DialogTitle>
          <DialogDescription>
            {t('common:dialogs.deleteThread.description')}
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
              aria-label={`${t('common:delete')} ${thread.title || t('common:newThread')}`}
            >
              {deleting ? t('common:loading') : t('common:delete')}
            </Button>
          </DialogFooter>
        </DialogHeader>
      </DialogContent>
    </Dialog>
  )
}

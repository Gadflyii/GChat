import { useRef, useMemo, useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { toast } from 'sonner'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { useThreads } from '@/hooks/useThreads'
import { useThreadManagement } from '@/hooks/useThreadManagement'

interface DeleteProjectDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  projectId?: string
  projectName?: string
}

export function DeleteProjectDialog({
  open,
  onOpenChange,
  projectId,
  projectName,
}: DeleteProjectDialogProps) {
  const { t } = useTranslation()
  const cancelButtonRef = useRef<HTMLButtonElement>(null)
  const deletionPending = useRef(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [hasError, setHasError] = useState(false)
  const threads = useThreads((state) => state.threads)
  const { deleteFolderWithThreads } = useThreadManagement()

  const threadCount = useMemo(() => {
    if (!projectId) return 0

    return Object.values(threads).filter(
      (thread) => thread.metadata?.project?.id === projectId
    ).length
  }, [projectId, threads])

  const handleConfirm = async () => {
    if (!projectId || deletionPending.current) return

    // Lock before awaiting or rendering so repeated input cannot start another
    // project/thread deletion while the first request is still in flight.
    deletionPending.current = true
    setIsDeleting(true)
    setHasError(false)

    try {
      await deleteFolderWithThreads(projectId)
      toast.success(
        projectName
          ? t('projects.deleteProjectDialog.successWithName', { projectName })
          : t('projects.deleteProjectDialog.successWithoutName')
      )
      onOpenChange(false)
    } catch (error) {
      setHasError(true)
      toast.error(t('projects.deleteProjectDialog.error'))
      console.error('Delete project error:', error)
    } finally {
      deletionPending.current = false
      setIsDeleting(false)
    }
  }

  const handleOpenChange = (nextOpen: boolean) => {
    if (deletionPending.current) return
    setHasError(false)
    onOpenChange(nextOpen)
  }

  const hasThreads = threadCount > 0

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        aria-busy={isDeleting}
        showCloseButton={!isDeleting}
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
          <DialogTitle>{t('projects.deleteProjectDialog.title')}</DialogTitle>
          <DialogDescription>
            {hasThreads
              ? t('projects.deleteProjectDialog.permanentDelete')
              : t('projects.deleteProjectDialog.deleteEmptyProject', {
                  projectName,
                })}
          </DialogDescription>
        </DialogHeader>
        {hasError && (
          <p role="alert" className="text-destructive text-sm">
            {t('projects.deleteProjectDialog.error')}
          </p>
        )}
        <DialogFooter>
          <Button
            ref={cancelButtonRef}
            type="button"
            size="sm"
            variant="ghost"
            disabled={isDeleting}
            onClick={() => handleOpenChange(false)}
          >
            {t('cancel')}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="destructive"
            disabled={isDeleting || !projectId}
            aria-busy={isDeleting}
            onClick={handleConfirm}
            aria-label={t('projects.deleteProjectDialog.ariaLabel', {
              projectName: projectName || t('projects.title').toLowerCase(),
            })}
          >
            {isDeleting
              ? t('loading')
              : t('projects.deleteProjectDialog.deleteButton')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

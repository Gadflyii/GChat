import { useCallback, useRef, useState, type RefObject } from 'react'
import { IconTrash } from '@tabler/icons-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { useServiceHub } from '@/hooks/useServiceHub'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { deleteLocalModel } from '@/lib/model-deletion'
import { notifyModelDeletion } from './notifyModelDeletion'

export type DeleteModelActionProps = {
  /** Id the engine registered the model under, not the catalog's spelling. */
  modelId: string
  /** Local provider that owns the files. */
  provider: string
  /** Readable name for the dialog and messages; the id is a package hash for local GInfer models. */
  label?: string
  /** The catalog refers to a file outside app-managed storage. */
  externalReference?: boolean
  /** Called after accepted removal and the initial inventory refresh attempt. */
  onDeleted?: () => void
  /** Stable page control to focus if deleting the model removes its row. */
  returnFocusRef?: RefObject<HTMLElement | null>
}

/**
 * Trash button + confirmation for a model installed on this device.
 *
 * Until now removing a download was only reachable from Settings → Model
 * Providers, which is nowhere near where the user downloaded it. This is the
 * same operation, rendered next to the Hub's download/"New chat" action.
 */
export function DeleteModelAction({
  modelId,
  provider,
  label,
  externalReference = false,
  onDeleted,
  returnFocusRef,
}: DeleteModelActionProps) {
  const { t } = useTranslation()
  const serviceHub = useServiceHub()

  const [open, setOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const deletingRef = useRef(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const [error, setError] = useState<string | null>(null)

  const handleDelete = useCallback(async () => {
    if (deletingRef.current) return
    deletingRef.current = true
    setDeleting(true)
    setError(null)
    try {
      const refreshError = await deleteLocalModel(serviceHub, modelId, provider)
      onDeleted?.()
      notifyModelDeletion({
        serviceHub,
        modelId,
        title: externalReference ? 'Model removed' : 'Model deleted',
        description: externalReference ? 'Removed from Models. The original file remains in place.' : t('common:deleteModel.success', { modelId: label ?? modelId }),
        refreshError,
      })
      setOpen(false)
    } catch (error) {
      console.error('[DeleteModelAction] deleteModel failed:', error)
      const message = externalReference
        ? 'Could not remove this model from Models. Stop it if it is running, then try again.'
        : 'Could not delete this model. Stop it if it is running, then try again.'
      setError(error instanceof Error ? error.message : String(error))
      toast.error(message, { id: `delete-model-${modelId}` })
    } finally {
      deletingRef.current = false
      setDeleting(false)
    }
  }, [externalReference, label, modelId, onDeleted, provider, serviceHub, t])

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          ref={triggerRef}
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={() => { setError(null) }}
          title={externalReference ? 'Remove from Models' : t('common:deleteModel.delete')}
          aria-label={externalReference ? 'Remove from Models' : t('common:deleteModel.delete')}
          className="shrink-0 text-muted-foreground hover:text-destructive"
        >
          <IconTrash size={16} />
        </Button>
      </DialogTrigger>
      <DialogContent onCloseAutoFocus={event => {
        const target = triggerRef.current?.isConnected ? triggerRef.current : returnFocusRef?.current
        if (target) {
          event.preventDefault()
          target.focus()
        }
      }}>
        <DialogHeader>
          <DialogTitle>
            {externalReference ? `Remove ${label ?? modelId} from Models?` : t('common:deleteModel.title', { modelId: label ?? modelId })}
          </DialogTitle>
          <DialogDescription>
            {externalReference ? 'The original model file will remain in place. Only its Models entry will be removed.' : t('common:deleteModel.description')}
          </DialogDescription>
        </DialogHeader>
        {deleting && <p role="status" aria-live="polite">{externalReference ? 'Removing model…' : 'Deleting model…'} You can close this dialog while the request finishes.</p>}
        {error && <div role="alert" className="space-y-2 text-sm text-destructive">
          <p>{externalReference ? 'Could not remove this model from Models. Stop it if it is running, then try again.' : 'Could not delete this model. Stop it if it is running, then try again.'}</p>
          <details><summary className="cursor-pointer">Technical details</summary><p className="mt-2 whitespace-pre-wrap break-words">{error}</p></details>
        </div>}
        <DialogFooter className="mt-2">
          <Button
            variant="ghost"
            size="sm"
            autoFocus
            onClick={() => setOpen(false)}
          >
            {deleting ? 'Close' : t('common:deleteModel.cancel')}
          </Button>
          <Button
            variant="destructive"
            size="sm"
            disabled={deleting}
            onClick={handleDelete}
          >
            {deleting ? (externalReference ? 'Removing model…' : 'Deleting model…') : externalReference ? 'Remove from Models' : t('common:deleteModel.delete')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

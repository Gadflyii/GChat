import { useCallback, useState } from 'react'
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
} from '@/components/ui/dialog'
import { useServiceHub } from '@/hooks/useServiceHub'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { deleteLocalModel } from '@/lib/model-deletion'

export type DeleteModelActionProps = {
  /** Id the engine registered the model under, not the catalog's spelling. */
  modelId: string
  /** Local provider that owns the files. */
  provider: string
  /** Readable name for the dialog and messages; the id is a package hash for local GInfer models. */
  label?: string
  /** The catalog refers to a file outside app-managed storage. */
  externalReference?: boolean
  /** Called after removal, before the provider list is refreshed. */
  onDeleted?: () => void
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
}: DeleteModelActionProps) {
  const { t } = useTranslation()
  const serviceHub = useServiceHub()

  const [open, setOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleDelete = useCallback(async () => {
    setDeleting(true)
    setError(null)
    try {
      await deleteLocalModel(serviceHub, modelId, provider)
      onDeleted?.()
      toast.success(externalReference ? 'Model removed' : 'Model deleted', {
        id: `delete-model-${modelId}`,
        description: externalReference ? 'Removed from Models. The original file remains in place.' : t('common:deleteModel.success', { modelId: label ?? modelId }),
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
      setDeleting(false)
    }
  }, [externalReference, label, modelId, onDeleted, provider, serviceHub, t])

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        onClick={() => { setError(null); setOpen(true) }}
        title={externalReference ? 'Remove from Models' : t('common:deleteModel.delete')}
        aria-label={externalReference ? 'Remove from Models' : t('common:deleteModel.delete')}
        className="shrink-0 text-muted-foreground hover:text-destructive"
      >
        <IconTrash size={16} />
      </Button>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {externalReference ? `Remove ${label ?? modelId} from Models?` : t('common:deleteModel.title', { modelId: label ?? modelId })}
          </DialogTitle>
          <DialogDescription>
            {externalReference ? 'The original model file will remain in place. Only its Models entry will be removed.' : t('common:deleteModel.description')}
          </DialogDescription>
        </DialogHeader>
        {error && <div role="alert" className="space-y-2 text-sm text-destructive">
          <p>{externalReference ? 'Could not remove this model from Models. Stop it if it is running, then try again.' : 'Could not delete this model. Stop it if it is running, then try again.'}</p>
          <details><summary className="cursor-pointer">Technical details</summary><p className="mt-2 whitespace-pre-wrap break-words">{error}</p></details>
        </div>}
        <DialogFooter className="mt-2">
          <Button
            variant="ghost"
            size="sm"
            disabled={deleting}
            onClick={() => setOpen(false)}
          >
            {t('common:deleteModel.cancel')}
          </Button>
          <Button
            variant="destructive"
            size="sm"
            autoFocus
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

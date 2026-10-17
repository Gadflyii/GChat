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
import { deleteLocalModel } from '@/lib/model-deletion'

import { IconTrash } from '@tabler/icons-react'

import { useState, useEffect, useRef } from 'react'
import { toast } from 'sonner'
import { useTranslation } from '@/i18n/react-i18next-compat'

type DialogDeleteModelProps = {
  provider: ModelProvider
  modelId?: string
}

export const DialogDeleteModel = ({
  provider,
  modelId,
}: DialogDeleteModelProps) => {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [selectedModelId, setSelectedModelId] = useState<string>('')
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const deletionPending = useRef(false)
  const cancelButtonRef = useRef<HTMLButtonElement>(null)
  const serviceHub = useServiceHub()

  const removeModel = async () => {
    if (deletionPending.current) return
    deletionPending.current = true
    setDeleting(true)
    setError(null)
    // Keep the result bound to the submitted model even if inventory refreshes.
    const deletingModelId = selectedModelId
    try {
      await deleteLocalModel(serviceHub, deletingModelId, provider.provider)
      setOpen(false)
      toast.success(
        t('providers:deleteModel.title', { modelId: deletingModelId }),
        {
          id: `delete-model-${deletingModelId}`,
          description: t('providers:deleteModel.success', {
            modelId: deletingModelId,
          }),
        }
      )
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error))
      console.error('[DialogDeleteModel] deleteModel failed:', error)
      toast.error(
        t('providers:deleteModel.title', { modelId: deletingModelId }),
        {
          id: `delete-model-${deletingModelId}`,
          description: error instanceof Error ? error.message : String(error),
        }
      )
    } finally {
      deletionPending.current = false
      setDeleting(false)
    }
  }

  const handleOpenChange = (nextOpen: boolean) => {
    if (deletionPending.current) return
    setError(null)
    setOpen(nextOpen)
  }

  // Initialize with the provided model ID or the first model if available
  useEffect(() => {
    if (modelId) {
      setSelectedModelId(modelId)
    } else if (provider.models && provider.models.length > 0) {
      setSelectedModelId(provider.models[0].id)
    }
  }, [provider, modelId])

  // Get the currently selected model
  const selectedModel = provider.models.find(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (m: any) => m.id === selectedModelId
  )

  if (!selectedModel) {
    return null
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          className="cursor-pointer flex items-center justify-center rounded transition-all duration-200 ease-in-out"
          title={t('providers:deleteModel.delete')}
          aria-label={t('providers:deleteModel.delete')}
        >
          <IconTrash size={18} className="text-muted-foreground" />
        </Button>
      </DialogTrigger>
      <DialogContent
        aria-busy={deleting}
        showCloseButton={!deleting}
        onOpenAutoFocus={(event) => {
          event.preventDefault()
          cancelButtonRef.current?.focus()
        }}
        onEscapeKeyDown={(event) => {
          if (deletionPending.current) event.preventDefault()
        }}
        onInteractOutside={(event) => {
          if (deletionPending.current) event.preventDefault()
        }}
      >
        <DialogHeader>
          <DialogTitle>
            {t('providers:deleteModel.title', { modelId: selectedModel.id })}
          </DialogTitle>
          <DialogDescription>
            {t('providers:deleteModel.description')}
          </DialogDescription>
        </DialogHeader>

        {error !== null && (
          <p role="alert" className="text-destructive text-sm">
            {error}
          </p>
        )}
        <DialogFooter className="mt-2">
          <Button
            ref={cancelButtonRef}
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => handleOpenChange(false)}
            disabled={deleting}
          >
            {t('providers:deleteModel.cancel')}
          </Button>
          <Button
            type="button"
            variant="destructive"
            size="sm"
            onClick={() => void removeModel()}
            disabled={deleting}
            aria-busy={deleting}
            aria-label={t('providers:deleteModel.delete')}
          >
            {deleting ? t('common:loading') : t('providers:deleteModel.delete')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

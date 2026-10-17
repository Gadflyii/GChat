import { useRef, useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { useTranslation } from '@/i18n/react-i18next-compat'

interface DeleteMCPServerConfirmProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  serverName: string
  onConfirm: () => boolean | void | Promise<boolean | void>
}

export default function DeleteMCPServerConfirm({
  open,
  onOpenChange,
  serverName,
  onConfirm,
}: DeleteMCPServerConfirmProps) {
  const { t } = useTranslation()
  const cancelButtonRef = useRef<HTMLButtonElement>(null)
  const removalPending = useRef(false)
  const [isRemoving, setIsRemoving] = useState(false)
  const [hasError, setHasError] = useState(false)

  const handleOpenChange = (nextOpen: boolean) => {
    if (removalPending.current) return
    setHasError(false)
    onOpenChange(nextOpen)
  }

  const handleConfirm = async () => {
    if (removalPending.current) return
    removalPending.current = true
    setIsRemoving(true)
    setHasError(false)
    try {
      // The caller reports persistence failures without throwing because it also
      // displays the connection error. Keep this confirmation open for retry.
      if ((await onConfirm()) === false) {
        setHasError(true)
      } else {
        onOpenChange(false)
      }
    } catch {
      setHasError(true)
    } finally {
      removalPending.current = false
      setIsRemoving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        aria-busy={isRemoving}
        showCloseButton={!isRemoving}
        onOpenAutoFocus={(event) => {
          event.preventDefault()
          cancelButtonRef.current?.focus()
        }}
        onEscapeKeyDown={(event) => {
          if (removalPending.current) event.preventDefault()
        }}
        onInteractOutside={(event) => {
          if (removalPending.current) event.preventDefault()
        }}
      >
        <DialogHeader>
          <DialogTitle>{t('mcp-servers:deleteServer.title')}</DialogTitle>
          <DialogDescription>
            {t('mcp-servers:deleteServer.description', { serverName })}
          </DialogDescription>
        </DialogHeader>
        {hasError && (
          <p role="alert" className="text-destructive text-sm">
            {t('mcp-servers:deleteServer.error', {
              defaultValue: "Couldn't remove this connection. Please try again.",
            })}
          </p>
        )}
        <DialogFooter>
          <Button
            ref={cancelButtonRef}
            type="button"
            size="sm"
            variant="ghost"
            disabled={isRemoving}
            onClick={() => handleOpenChange(false)}
          >
            {t('common:cancel')}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="destructive"
            disabled={isRemoving}
            aria-busy={isRemoving}
            onClick={handleConfirm}
          >
            {isRemoving
              ? t('common:loading')
              : t('mcp-servers:deleteServer.delete')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

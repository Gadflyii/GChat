import { useEffect, useRef, useState } from 'react'
import { useTranslation } from '@/i18n/react-i18next-compat'
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogTitle,
  DialogClose,
  DialogFooter,
  DialogHeader,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { IconEdit } from '@tabler/icons-react'
import { DropdownMenuItem } from '@/components/ui/dropdown-menu'
import { toast } from 'sonner'

interface RenameThreadDialogProps {
  thread: Thread
  plainTitleForRename: string
  onRename: (threadId: string, title: string) => void | Promise<void>
  onDropdownClose?: () => void
  open?: boolean
  onOpenChange?: (open: boolean) => void
  withoutTrigger?: boolean
}

export function RenameThreadDialog({
  thread,
  plainTitleForRename,
  onRename,
  onDropdownClose,
  open,
  onOpenChange,
  withoutTrigger,
}: RenameThreadDialogProps) {
  const { t } = useTranslation()
  const [title, setTitle] = useState('')
  const [internalOpen, setInternalOpen] = useState(false)
  const [isRenaming, setIsRenaming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const renamePending = useRef(false)

  const isControlled = open !== undefined
  const isOpen = isControlled ? !!open : internalOpen
  const setOpenSafe = (next: boolean) => {
    if (isControlled) {
      onOpenChange?.(next)
    } else {
      setInternalOpen(next)
    }
  }

  useEffect(() => {
    if (isOpen) {
      setTitle(plainTitleForRename || t('common:newThread'))
      setError(null)
      setTimeout(() => {
        inputRef.current?.focus()
        inputRef.current?.select()
      }, 100)
    }
  }, [isOpen, plainTitleForRename, t])

  const handleOpenChange = (open: boolean) => {
    if (renamePending.current) return
    setOpenSafe(open)
    if (!open) {
      onDropdownClose?.()
    }
  }

  const handleRename = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const nextTitle = title.trim()
    if (
      renamePending.current ||
      !nextTitle ||
      nextTitle === plainTitleForRename
    ) {
      return
    }

    renamePending.current = true
    setIsRenaming(true)
    setError(null)
    try {
      await onRename(thread.id, nextTitle)
      setOpenSafe(false)
      onDropdownClose?.()
      toast.success(t('common:toast.renameThread.title'), {
        id: 'rename-thread',
        description: t('common:toast.renameThread.description', {
          title: nextTitle,
        }),
      })
    } catch (error) {
      const message = String(error)
      setError(message)
      toast.error(message)
    } finally {
      renamePending.current = false
      setIsRenaming(false)
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      {!withoutTrigger && (
        <DialogTrigger asChild>
          <DropdownMenuItem onSelect={(e) => e.preventDefault()}>
            <IconEdit />
            <span>{t('common:rename')}</span>
          </DropdownMenuItem>
        </DialogTrigger>
      )}
      <DialogContent showCloseButton={!isRenaming}>
        <form onSubmit={handleRename}>
          <DialogHeader>
            <DialogTitle>{t('common:threadTitle')}</DialogTitle>
            <Input
              ref={inputRef}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              disabled={isRenaming}
              className="mt-2"
              onKeyDown={(e) => e.stopPropagation()}
              placeholder={t('common:threadTitle')}
              aria-label={t('common:threadTitle')}
            />
            {error && (
              <p role="alert" className="text-destructive text-sm">
                {error}
              </p>
            )}
            <DialogFooter className="mt-2 flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
              <DialogClose asChild>
                <Button
                  type="button"
                  disabled={isRenaming}
                  variant="ghost"
                  size="sm"
                  className="w-full sm:w-auto"
                >
                  {t('common:cancel')}
                </Button>
              </DialogClose>
              <Button
                type="submit"
                disabled={
                  isRenaming ||
                  !title.trim() ||
                  title.trim() === plainTitleForRename
                }
                aria-busy={isRenaming}
                size="sm"
                className="w-full sm:w-auto"
              >
                {t('common:rename')}
              </Button>
            </DialogFooter>
          </DialogHeader>
        </form>
      </DialogContent>
    </Dialog>
  )
}

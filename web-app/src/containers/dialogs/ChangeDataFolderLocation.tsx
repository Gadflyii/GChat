import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { IconFolder } from '@tabler/icons-react'
import { useTranslation } from '@/i18n/react-i18next-compat'

interface ChangeDataFolderLocationProps {
  children: React.ReactNode
  currentPath: string
  newPath: string
  onConfirm: () => void
  pending?: boolean
  open: boolean
  onOpenChange: (open: boolean) => void
}

export default function ChangeDataFolderLocation({
  children,
  currentPath,
  newPath,
  onConfirm,
  pending = false,
  open,
  onOpenChange,
}: ChangeDataFolderLocationProps) {
  const { t } = useTranslation()
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent aria-busy={pending}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <IconFolder size={20} />
            {t('settings:dialogs.changeDataFolder.title')}
          </DialogTitle>
          <DialogDescription>
            {t('settings:dialogs.changeDataFolder.description')}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <h4 className="text-sm font-medium mb-2">
              {t('settings:dialogs.changeDataFolder.currentLocation')}
            </h4>
            <div className="bg-secondary border p-2 rounded-lg">
              <code className="text-xs text-muted-foreground break-all">
                {currentPath}
              </code>
            </div>
          </div>

          <div>
            <h4 className="text-sm font-medium mb-2">
              {t('settings:dialogs.changeDataFolder.newLocation')}
            </h4>
            <div className="bg-secondary border p-2 rounded-lg">
              <code className="text-xs break-all">{newPath}</code>
            </div>
          </div>
        </div>

        <DialogFooter className="flex items-center gap-2">
          <DialogClose asChild>
            <Button variant="ghost" size="sm" disabled={pending}>
              {t('settings:dialogs.changeDataFolder.cancel')}
            </Button>
          </DialogClose>
          <Button size="sm" onClick={onConfirm} disabled={pending}>
            {pending
              ? t('common:loading')
              : t('settings:dialogs.changeDataFolder.changeLocation')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

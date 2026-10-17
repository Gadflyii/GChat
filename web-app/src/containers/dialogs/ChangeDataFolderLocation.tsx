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
            {t('settings:dialogs.changeDataFolder.copyDescription', {
              defaultValue:
                'GChat copies the chats, settings, and model files inside your current data folder. Model files stored elsewhere stay where they are.',
            })}
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

          <div className="space-y-2 text-sm">
            <h4 className="font-medium">
              {t('settings:dialogs.changeDataFolder.preparationTitle', {
                defaultValue: 'Before you move',
              })}
            </h4>
            <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
              <li>
                {t('settings:dialogs.changeDataFolder.destinationGuidance', {
                  defaultValue:
                    'Choose an empty folder outside your current data folder, on a drive that will stay connected.',
                })}
              </li>
              <li>
                {t('settings:dialogs.changeDataFolder.spaceGuidance', {
                  defaultValue:
                    'Allow enough free space for a second copy. The original folder is kept.',
                })}
              </li>
              <li>
                {t('settings:dialogs.changeDataFolder.serviceGuidance', {
                  defaultValue:
                    'Finish any model loads or chats in progress and quit the Gbot service before continuing.',
                })}
              </li>
            </ul>
            <p>
              {t('settings:dialogs.changeDataFolder.completionGuidance', {
                defaultValue:
                  'When the copy finishes, GChat restarts and uses the new folder.',
              })}
            </p>
            <p className="text-muted-foreground">
              {t('settings:dialogs.changeDataFolder.errorGuidance', {
                defaultValue:
                  'If an error appears, follow its instructions before retrying. If the files moved but the Host could not restart, open Manager and start the Host there.',
              })}
            </p>
          </div>

          {pending && (
            <p
              role="status"
              aria-live="polite"
              className="rounded-lg border bg-secondary p-3 text-sm"
            >
              {t('settings:dialogs.changeDataFolder.copyingGuidance', {
                defaultValue:
                  'Copying your data. Keep GChat open until it restarts. Large folders can take a while.',
              })}
            </p>
          )}
        </div>

        <DialogFooter className="flex items-center gap-2">
          <DialogClose asChild>
            <Button variant="ghost" size="sm" disabled={pending}>
              {t('settings:dialogs.changeDataFolder.cancel')}
            </Button>
          </DialogClose>
          <Button size="sm" onClick={onConfirm} disabled={pending}>
            {pending
              ? t('settings:dialogs.changeDataFolder.copying', {
                  defaultValue: 'Copying data…',
                })
              : t('settings:dialogs.changeDataFolder.copyAndRestart', {
                  defaultValue: 'Copy data and restart',
                })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

import { useState, useEffect, useRef } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useThreadManagement } from '@/hooks/useThreadManagement'
import { useAssistant } from '@/hooks/useAssistant'
import { AvatarEmoji } from '@/containers/AvatarEmoji'
import { toast } from 'sonner'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { ChevronDown, Plus } from 'lucide-react'
import AddEditAssistant from './AddEditAssistant'

interface AddProjectDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  editingKey: string | null
  initialData?: {
    id: string
    name: string
    updated_at: number
    assistantId?: string
  }
  onSave: (name: string, assistantId?: string) => void | Promise<void>
}

export default function AddProjectDialog({
  open,
  onOpenChange,
  editingKey,
  initialData,
  onSave,
}: AddProjectDialogProps) {
  const { t } = useTranslation()
  const [name, setName] = useState(initialData?.name || '')
  const [selectedAssistantId, setSelectedAssistantId] = useState<
    string | undefined
  >(initialData?.assistantId)
  const { folders } = useThreadManagement()
  const { assistants, addAssistant } = useAssistant()
  const [addAssistantDialogOpen, setAddAssistantDialogOpen] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const savePending = useRef(false)

  const selectedAssistant = assistants.find((a) => a.id === selectedAssistantId)

  useEffect(() => {
    if (open) {
      setName(initialData?.name || '')
      setSelectedAssistantId(initialData?.assistantId)
      setError(null)
    }
  }, [open, initialData?.id, initialData?.name, initialData?.assistantId])

  const hasChanged = editingKey
    ? name.trim() !== initialData?.name ||
      selectedAssistantId !== initialData?.assistantId
    : true
  const isButtonDisabled = !name.trim() || (editingKey && !hasChanged)
  const saveLabel = editingKey
    ? t('projects.addProjectDialog.updateButton')
    : t('projects.addProjectDialog.createButton')

  const handleSave = async () => {
    if (savePending.current || isButtonDisabled) return

    const trimmedName = name.trim()

    // Check for duplicate names (excluding current project when editing)
    const isDuplicate = folders.some(
      (folder) =>
        folder.name.toLowerCase() === trimmedName.toLowerCase() &&
        folder.id !== editingKey
    )

    if (isDuplicate) {
      toast.warning(
        t('projects.addProjectDialog.alreadyExists', { projectName: trimmedName })
      )
      return
    }

    savePending.current = true
    setIsSaving(true)
    setError(null)
    try {
      await onSave(trimmedName, selectedAssistantId)
      if (editingKey) {
        toast.success(
          t('projects.addProjectDialog.updateSuccess', { projectName: trimmedName })
        )
      } else {
        toast.success(
          t('projects.addProjectDialog.createSuccess', { projectName: trimmedName })
        )
      }
      setName('')
      setSelectedAssistantId(undefined)
    } catch (error) {
      const message = String(error)
      setError(message)
      toast.error(message)
    } finally {
      savePending.current = false
      setIsSaving(false)
    }
  }

  const handleOpenChange = (nextOpen: boolean) => {
    if (savePending.current) return
    onOpenChange(nextOpen)
    if (!nextOpen) {
      setName('')
      setSelectedAssistantId(undefined)
      setError(null)
    }
  }

  return (
    <>
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent aria-busy={isSaving} showCloseButton={!isSaving}>
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault()
              void handleSave()
            }}
          >
            <DialogHeader>
              <DialogTitle>
                {editingKey
                  ? t('projects.addProjectDialog.editTitle')
                  : t('projects.addProjectDialog.createTitle')}
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={t('projects.addProjectDialog.namePlaceholder')}
                  aria-label={t('projects.addProjectDialog.nameLabel')}
                  className="mt-1"
                  autoFocus
                  disabled={isSaving}
                  onKeyDown={(e) => e.stopPropagation()}
                />
              </div>
              <div>
                <label className="text-sm font-medium mb-1.5 block">
                  {t('projects.addProjectDialog.assistant')}
                </label>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      type="button"
                      variant="outline"
                      className="w-full justify-between rounded-md"
                      disabled={isSaving}
                    >
                      {selectedAssistant ? (
                        <div className="flex items-center gap-2">
                          {selectedAssistant.avatar && (
                            <AvatarEmoji
                              avatar={selectedAssistant.avatar}
                              imageClassName="w-4 h-4 object-contain"
                              textClassName="text-sm"
                            />
                          )}
                          <span>{selectedAssistant.name}</span>
                        </div>
                      ) : (
                        <span className="text-muted-foreground">
                          {t('projects.addProjectDialog.selectAssistant')}
                        </span>
                      )}
                      <ChevronDown className="size-4 text-muted-foreground" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent
                    align="start"
                    className="w-(--radix-dropdown-menu-trigger-width)"
                  >
                    <DropdownMenuItem
                      onSelect={() => setSelectedAssistantId(undefined)}
                    >
                      <span className="text-muted-foreground">
                        {t('projects.addProjectDialog.noAssistant')}
                      </span>
                    </DropdownMenuItem>
                    {assistants.map((assistant) => (
                      <DropdownMenuItem
                        key={assistant.id}
                        onSelect={() => setSelectedAssistantId(assistant.id)}
                      >
                        <div className="flex items-center gap-2">
                          {assistant.avatar && (
                            <AvatarEmoji
                              avatar={assistant.avatar}
                              imageClassName="w-4 h-4 object-contain"
                              textClassName="text-sm"
                            />
                          )}
                          <span>{assistant.name}</span>
                        </div>
                      </DropdownMenuItem>
                    ))}
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      onSelect={() => setAddAssistantDialogOpen(true)}
                    >
                      <div className="flex items-center gap-2">
                        <Plus className="size-4" />
                        <span>{t('projects.addProjectDialog.addAssistant')}</span>
                      </div>
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>
            {error && (
              <p role="alert" className="text-destructive text-sm">
                {error}
              </p>
            )}
            <DialogFooter>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => handleOpenChange(false)}
                disabled={isSaving}
              >
                {t('cancel')}
              </Button>
              <Button
                type="submit"
                size="sm"
                disabled={isSaving || Boolean(isButtonDisabled)}
                aria-busy={isSaving}
                aria-label={saveLabel}
              >
                {isSaving ? t('loading') : saveLabel}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AddEditAssistant
        open={addAssistantDialogOpen}
        onOpenChange={setAddAssistantDialogOpen}
        editingKey={null}
        onSave={async (assistant) => {
          await addAssistant(assistant)
          setSelectedAssistantId(assistant.id)
        }}
      />
    </>
  )
}

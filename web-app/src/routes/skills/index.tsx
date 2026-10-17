import { useEffect, useRef, useState } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import {
  IconAlertTriangle,
  IconChevronDown,
  IconClipboardText,
  IconDots,
  IconDownload,
  IconEdit,
  IconMessage,
  IconRefresh,
  IconTrash,
  IconUpload,
} from '@tabler/icons-react'
import { toast } from 'sonner'
import {
  AgentStudioHeader,
  type AgentStudioSection,
} from '@/containers/AgentStudioHeader'
import { AgentSkillCreateDialog } from '@/containers/AgentSkillCreateDialog'
import { AgentSkillEditDialog } from '@/containers/AgentSkillEditDialog'
import { AgentSkillUploadDialog } from '@/containers/AgentSkillUploadDialog'
import { RenderMarkdown } from '@/containers/RenderMarkdown'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Switch } from '@/components/ui/switch'
import { route } from '@/constants/routes'
import { useAgentSkills } from '@/hooks/useAgentSkills'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { cn } from '@/lib/utils'
import type { AgentSkill, AgentSkillDetail } from '@/services/agent/skills'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const Route = createFileRoute(route.skills.index as any)({
  component: SkillsPage,
})

export function SkillsPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const {
    skills,
    selected,
    loading,
    error,
    load,
    select,
    setEnabled,
    addCreated,
    addImported,
    remove,
    update,
    exportSkill,
  } = useAgentSkills()
  const [deleteName, setDeleteName] = useState<string | null>(null)
  const deletePending = useRef(false)
  const [deletingSkill, setDeletingSkill] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const deleteCancelRef = useRef<HTMLButtonElement>(null)
  const [editingSkill, setEditingSkill] = useState<AgentSkillDetail | null>(null)
  const editRequest = useRef(0)
  const [createOpen, setCreateOpen] = useState(false)
  const [uploadOpen, setUploadOpen] = useState(false)
  const pendingSkillToggles = useRef(new Map<string, boolean>())
  const [togglingSkills, setTogglingSkills] = useState(new Map<string, boolean>())
  const pendingDownload = useRef(false)
  const [downloadingSkill, setDownloadingSkill] = useState<string | null>(null)

  useEffect(() => {
    return () => {
      editRequest.current += 1
    }
  }, [])

  const edit = async (name: string) => {
    const request = ++editRequest.current
    const detail = await select(name)
    if (request === editRequest.current && detail?.name === name) {
      setEditingSkill(detail)
    }
  }

  const mutate = async (operation: () => Promise<void>) => {
    try {
      await operation()
    } catch (reason) {
      toast.error(String(reason))
    }
  }

  const toggleSkill = async (name: string, enabled: boolean) => {
    if (pendingSkillToggles.current.has(name)) return
    pendingSkillToggles.current.set(name, enabled)
    setTogglingSkills(new Map(pendingSkillToggles.current))
    try {
      await mutate(() => setEnabled(name, enabled))
    } finally {
      pendingSkillToggles.current.delete(name)
      setTogglingSkills(new Map(pendingSkillToggles.current))
    }
  }

  const closeDelete = () => {
    if (deletePending.current) return
    setDeleteName(null)
    setDeleteError(null)
  }

  const deleteSkill = async () => {
    if (!deleteName || deletePending.current) return
    deletePending.current = true
    setDeletingSkill(true)
    setDeleteError(null)
    try {
      await remove(deleteName)
      setDeleteName(null)
    } catch (reason) {
      setDeleteError(String(reason))
    } finally {
      deletePending.current = false
      setDeletingSkill(false)
    }
  }

  const tryInChat = (name: string) => {
    void navigate({
      to: route.home,
      search: { agentSkill: name },
    })
  }

  const download = async (name: string) => {
    if (pendingDownload.current) return
    pendingDownload.current = true
    setDownloadingSkill(name)
    try {
      if (await exportSkill(name)) {
        toast.success(t('common:skillExported'))
      }
    } catch (reason) {
      toast.error(String(reason))
    } finally {
      pendingDownload.current = false
      setDownloadingSkill(null)
    }
  }

  const selectStudioSection = (section: AgentStudioSection) => {
    if (section === 'skills') return
    void navigate({
      to: route.agents.index,
      search: { view: section },
    })
  }

  return (
    <div className="grid h-svh w-full grid-cols-[minmax(260px,360px)_1fr] grid-rows-[auto_minmax(0,1fr)]">
      <div className="col-span-2 min-w-0">
        <AgentStudioHeader
          active="skills"
          onSelect={selectStudioSection}
          actions={
            <>
              <Button
                size="icon-sm"
                variant="ghost"
                title={t('common:refresh')}
                disabled={loading}
                onClick={() => {
                  editRequest.current += 1
                  void load(true)
                }}
              >
                <IconRefresh className={cn(loading && 'animate-spin')} />
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button size="sm">
                    {t('common:createNewSkill')}
                    <IconChevronDown />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-max">
                  <DropdownMenuItem
                    onSelect={() => {
                      editRequest.current += 1
                      setCreateOpen(true)
                    }}
                  >
                    <IconClipboardText />
                    {t('common:writeSkillInstructions')}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onSelect={() => {
                      editRequest.current += 1
                      setUploadOpen(true)
                    }}
                  >
                    <IconUpload />
                    {t('common:uploadASkill')}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </>
          }
        />
      </div>

      <div className="min-h-0 overflow-y-auto p-3">
        {error && (
          <div className="mb-3 rounded-md border border-destructive/40 p-3 text-sm text-destructive">
            {error}
          </div>
        )}
        {!loading && skills.length === 0 && (
          <p className="p-3 text-sm text-muted-foreground">
            {t('common:skillsEmpty')}
          </p>
        )}
        <div className="space-y-2">
          {skills.map((skill) => {
            const canTry = canTrySkill(skill)
            const toggling = togglingSkills.has(skill.name)
            return (
              <div
                key={skill.name}
                className={cn(
                  'flex w-full items-center gap-2 rounded-lg border p-2 transition-colors hover:bg-accent',
                  selected?.name === skill.name && 'bg-accent'
                )}
              >
                <button
                  type="button"
                  className="min-w-0 flex-1 p-1 text-left"
                  onClick={() => {
                    editRequest.current += 1
                    void select(skill.name)
                  }}
                >
                  <div className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate font-medium">
                      {skill.name}
                    </span>
                    {skill.error && (
                      <IconAlertTriangle className="size-4 text-destructive" />
                    )}
                  </div>
                  <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                    {skill.error || skill.description}
                  </p>
                  {toggling && (
                    <span
                      role="status"
                      className="mt-1 block text-xs text-muted-foreground"
                    >
                      {t(
                        togglingSkills.get(skill.name)
                          ? 'common:enablingSkill'
                          : 'common:disablingSkill',
                        {
                          name: skill.name,
                          defaultValue: togglingSkills.get(skill.name)
                            ? 'Enabling {{name}}…'
                            : 'Disabling {{name}}…',
                        }
                      )}
                    </span>
                  )}
                  {downloadingSkill === skill.name && (
                    <span
                      role="status"
                      className="mt-1 block text-xs text-muted-foreground"
                    >
                      {t('common:savingSkill', {
                        name: skill.name,
                        defaultValue: 'Saving {{name}}…',
                      })}
                    </span>
                  )}
                </button>
                <Switch
                  checked={skill.enabled}
                  disabled={Boolean(skill.error) || toggling}
                  aria-busy={toggling}
                  aria-label={`${t('common:enableSkill')}: ${skill.name}`}
                  onCheckedChange={(enabled) =>
                    void toggleSkill(skill.name, enabled)
                  }
                />
                <SkillActionsMenu
                  skill={skill}
                  canTry={canTry}
                  downloading={downloadingSkill !== null}
                  onDownload={() => void download(skill.name)}
                  onTry={() => tryInChat(skill.name)}
                  onEdit={() => void edit(skill.name)}
                  onUninstall={() => {
                    if (deletePending.current) return
                    editRequest.current += 1
                    setDeleteError(null)
                    setDeleteName(skill.name)
                  }}
                />
              </div>
            )
          })}
        </div>
      </div>

      <div className="col-start-2 row-start-2 min-h-0 min-w-0 overflow-y-auto p-3">
        {!selected ? (
          <p className="text-sm text-muted-foreground">
            {t('common:selectSkill')}
          </p>
        ) : (
          <div className="flex min-h-full flex-col gap-2">
            {selected.unavailableReasons.length > 0 && (
              <section className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-4 text-sm">
                <h2 className="mb-2 font-medium">
                  {t('common:skillUnavailable')}
                </h2>
                {selected.unavailableReasons.join('\n')}
              </section>
            )}
            {selected.error && (
              <section className="rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
                <h2 className="mb-2 font-medium">{t('common:skillError')}</h2>
                {selected.error}
              </section>
            )}
            <section className="flex-1 rounded-lg border bg-background p-4 text-sm">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="font-medium">{t('common:skillInstructions')}</h2>
                {!selected.reserved && (
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label={t('common:editSkill')}
                    onClick={() => {
                      editRequest.current += 1
                      setEditingSkill(selected)
                    }}
                  >
                    <IconEdit />
                  </Button>
                )}
              </div>
              <RenderMarkdown
                content={selected.body}
                components={{}}
                isAnimating={false}
              />
            </section>
          </div>
        )}
      </div>

      <Dialog
        open={deleteName !== null}
        onOpenChange={(open) => !open && closeDelete()}
      >
        <DialogContent
          aria-busy={deletingSkill}
          showCloseButton={!deletingSkill}
          onOpenAutoFocus={(event) => {
            event.preventDefault()
            deleteCancelRef.current?.focus()
          }}
          onEscapeKeyDown={(event) => {
            if (deletePending.current) event.preventDefault()
          }}
          onInteractOutside={(event) => {
            if (deletePending.current) event.preventDefault()
          }}
        >
          <DialogHeader>
            <DialogTitle>{t('common:deleteSkill')}</DialogTitle>
            <DialogDescription>
              {t('common:deleteSkillDescription', { name: deleteName })}
            </DialogDescription>
          </DialogHeader>
          {deleteError && (
            <p role="alert" className="text-sm text-destructive">
              {t('common:deleteSkillFailed', {
                defaultValue: 'Could not delete this skill. Please try again.',
              })}{' '}
              {deleteError}
            </p>
          )}
          <DialogFooter>
            <Button
              ref={deleteCancelRef}
              type="button"
              variant="ghost"
              disabled={deletingSkill}
              onClick={closeDelete}
            >
              {t('common:cancel')}
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={deletingSkill}
              aria-busy={deletingSkill}
              onClick={() => void deleteSkill()}
            >
              {t(deletingSkill ? 'common:loading' : 'common:delete')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <AgentSkillCreateDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreate={addCreated}
      />
      <AgentSkillUploadDialog
        open={uploadOpen}
        onOpenChange={setUploadOpen}
        onUpload={addImported}
      />
      <AgentSkillEditDialog
        skill={editingSkill}
        open={editingSkill !== null}
        onOpenChange={(open) => !open && setEditingSkill(null)}
        onUpdate={update}
      />
    </div>
  )
}

function canTrySkill(skill: AgentSkill) {
  return (
    skill.enabled &&
    skill.compatible &&
    !skill.error &&
    skill.unavailableReasons.length === 0
  )
}

type SkillActionsMenuProps = {
  skill: AgentSkill
  canTry: boolean
  downloading: boolean
  onDownload: () => void
  onTry: () => void
  onEdit: () => void
  onUninstall: () => void
}

function SkillActionsMenu({
  skill,
  canTry,
  downloading,
  onDownload,
  onTry,
  onEdit,
  onUninstall,
}: SkillActionsMenuProps) {
  const { t } = useTranslation()

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label={t('common:skillActions')}
        >
          <IconDots />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem disabled={downloading} onSelect={onDownload}>
          <IconDownload />
          {t('common:downloadSkill')}
        </DropdownMenuItem>
        <DropdownMenuItem disabled={!canTry} onSelect={onTry}>
          <IconMessage />
          {t('common:tryInChat')}
        </DropdownMenuItem>
        {!skill.reserved && (
          <>
            <DropdownMenuItem onSelect={onEdit}>
              <IconEdit />
              {t('common:editSkill')}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onSelect={onUninstall}>
              <IconTrash />
              {t('common:uninstallSkill')}
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

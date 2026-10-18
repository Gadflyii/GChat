import { useEffect, useRef, useState, type RefObject } from 'react'
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
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { confirmAction } from '@/lib/confirm'
import type {
  AgentSkillDetail,
  UpdateAgentSkillRequest,
} from '@/services/agent/skills'

type AgentSkillEditDialogProps = {
  skill: AgentSkillDetail | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onUpdate: (request: UpdateAgentSkillRequest) => Promise<void>
  returnFocusRef?: RefObject<HTMLElement | null>
}

export function AgentSkillEditDialog({
  skill,
  open,
  onOpenChange,
  onUpdate,
  returnFocusRef,
}: AgentSkillEditDialogProps) {
  const { t } = useTranslation()
  const [description, setDescription] = useState('')
  const [instructions, setInstructions] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const pending = useRef(false)
  const confirmingClose = useRef(false)

  useEffect(() => {
    if (!open || !skill) return
    setDescription(skill.description)
    setInstructions(skill.body)
    setSubmitting(false)
  }, [open, skill])

  const requestClose = async () => {
    if (pending.current || confirmingClose.current) return
    if (
      skill &&
      (description !== skill.description || instructions !== skill.body)
    ) {
      confirmingClose.current = true
      try {
        const discard = await confirmAction({
          title: 'Discard unsaved skill changes?',
          message: `Your changes to "${skill.name}" have not been saved. Discard them to close the editor.`,
          confirmLabel: 'Discard changes',
          cancelLabel: 'Keep editing',
          destructive: true,
        })
        if (!discard) return
      } finally {
        confirmingClose.current = false
      }
    }
    onOpenChange(false)
  }

  const submit = async () => {
    if (!skill || pending.current) return
    pending.current = true
    setSubmitting(true)
    try {
      await onUpdate({
        name: skill.name,
        description: description.trim(),
        instructions: instructions.trim(),
      })
      onOpenChange(false)
    } catch (reason) {
      toast.error(String(reason))
    } finally {
      pending.current = false
      setSubmitting(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) void requestClose()
      }}
    >
      <DialogContent
        className="max-w-2xl"
        onCloseAutoFocus={(event) => {
          if (returnFocusRef?.current?.isConnected) {
            event.preventDefault()
            returnFocusRef.current.focus()
          }
        }}
      >
        <DialogHeader>
          <DialogTitle>{t('common:editSkill')}</DialogTitle>
          <DialogDescription>
            {t('common:editSkillDescription')}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-5 py-2">
          <div className="space-y-2">
            <Label htmlFor="agent-skill-edit-name">
              {t('common:skillName')}
            </Label>
            <Input
              id="agent-skill-edit-name"
              value={skill?.name ?? ''}
              disabled
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="agent-skill-edit-description">
              {t('common:description')}
            </Label>
            <Textarea
              id="agent-skill-edit-description"
              value={description}
              className="min-h-24 resize-none"
              disabled={submitting}
              onChange={(event) => setDescription(event.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="agent-skill-edit-instructions">
              {t('common:instructions')}
            </Label>
            <Textarea
              id="agent-skill-edit-instructions"
              value={instructions}
              className="min-h-64 resize-y"
              disabled={submitting}
              onChange={(event) => setInstructions(event.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button
            variant="ghost"
            disabled={submitting}
            onClick={() => void requestClose()}
          >
            {t('common:cancel')}
          </Button>
          <Button
            aria-busy={submitting}
            disabled={submitting || !description.trim() || !instructions.trim()}
            onClick={() => void submit()}
          >
            {submitting ? t('common:savingSkill') : t('common:save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

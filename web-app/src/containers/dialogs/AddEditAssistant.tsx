import { lazy, Suspense, useState, useEffect, useRef, useId } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { IconMoodSmile } from '@tabler/icons-react'
import type { EmojiClickData, Theme } from 'emoji-picker-react'
const EmojiPicker = lazy(() => import('emoji-picker-react'))

import { Textarea } from '@/components/ui/textarea'

import { useTheme } from '@/hooks/useTheme'
import { defaultAssistant } from '@/hooks/useAssistant'
import { AvatarEmoji } from '@/containers/AvatarEmoji'
import { useTranslation } from '@/i18n/react-i18next-compat'

interface AddEditAssistantProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  editingKey: string | null
  initialData?: Assistant
  onSave: (assistant: Assistant) => void | Promise<void>
}

export default function AddEditAssistant({
  open,
  onOpenChange,
  editingKey,
  initialData,
  onSave,
}: AddEditAssistantProps) {
  const [avatar, setAvatar] = useState<string | undefined>(initialData?.avatar)

  const [name, setName] = useState(initialData?.name || '')
  const [description, setDescription] = useState<string | undefined>(
    initialData?.description
  )
  const [instructions, setInstructions] = useState(
    initialData?.instructions || ''
  )
  const { isDark } = useTheme()
  const [showEmojiPicker, setShowEmojiPicker] = useState(false)
  const emojiPickerRef = useRef<HTMLDivElement>(null)
  const emojiPickerTriggerRef = useRef<HTMLButtonElement>(null)
  const [nameError, setNameError] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const savePending = useRef(false)
  const initializedDraft = useRef<string | null>(null)
  const newAssistantIdentity = useRef<{
    id: string
    created_at: number
  } | null>(null)
  const fieldId = useId()

  // Handle click outside emoji picker or trigger
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        emojiPickerRef.current &&
        emojiPickerTriggerRef.current &&
        !emojiPickerRef.current.contains(event.target as Node) &&
        !emojiPickerTriggerRef.current.contains(event.target as Node)
      ) {
        setShowEmojiPicker(false)
      }
    }

    if (showEmojiPicker) {
      document.addEventListener('mousedown', handleClickOutside)
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [showEmojiPicker])

  // A parent can recreate initialData while a save fails. Initialize once per
  // opened assistant so that rerendering does not discard the user's draft.
  useEffect(() => {
    if (!open) {
      initializedDraft.current = null
      return
    }
    const draftKey = `${editingKey ?? ''}:${initialData?.id ?? ''}`
    if (initializedDraft.current === draftKey) return
    initializedDraft.current = draftKey
    setNameError(null)
    setSaveError(null)
    newAssistantIdentity.current = null
    if (open && editingKey && initialData) {
      setAvatar(initialData.avatar)
      setName(initialData.name)
      setDescription(initialData.description)
      setInstructions(initialData.instructions)
      setShowEmojiPicker(false)
    } else if (open) {
      // Add mode - reset form
      resetForm()
    }
  }, [open, editingKey, initialData])

  const resetForm = () => {
    setAvatar(undefined)
    setName('')
    setDescription(undefined)
    setInstructions('')
    setNameError(null)
    setSaveError(null)
    setShowEmojiPicker(false)
    newAssistantIdentity.current = null
  }

  const handleSave = async () => {
    if (savePending.current) return
    if (!name.trim()) {
      setNameError(t('assistants:nameRequired'))
      return
    }
    setNameError(null)
    setSaveError(null)
    savePending.current = true
    setIsSaving(true)
    setShowEmojiPicker(false)
    const identity = initialData ?? newAssistantIdentity.current ?? {
      id: Math.random().toString(36).substring(7),
      created_at: Date.now(),
    }
    newAssistantIdentity.current = identity

    const assistant: Assistant = {
      avatar,
      id: identity.id,
      name,
      created_at: identity.created_at,
      description,
      instructions,
      // Sampling is edited in the model-bar Sampling popover, not here:
      // keep this assistant's own values untouched, seed a new one with the
      // built-in defaults so the popover opens on sane values.
      parameters: initialData?.parameters ?? { ...defaultAssistant.parameters },
      sampling_overridden: initialData?.sampling_overridden,
    }
    try {
      await onSave(assistant)
      onOpenChange(false)
      resetForm()
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : String(error))
    } finally {
      savePending.current = false
      setIsSaving(false)
    }
  }

  const handleOpenChange = (nextOpen: boolean) => {
    if (savePending.current) return
    onOpenChange(nextOpen)
    if (!nextOpen) resetForm()
  }

  const { t } = useTranslation()

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        aria-busy={isSaving}
        showCloseButton={!isSaving}
        onEscapeKeyDown={(event) => {
          if (savePending.current) event.preventDefault()
        }}
        onInteractOutside={(event) => {
          if (savePending.current) event.preventDefault()
        }}
      >
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
                ? t('assistants:editAssistant')
                : t('assistants:addAssistant')}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <div className="relative">
                <label className="text-sm mb-2 inline-block">
                  {t('assistants:emoji')}
                </label>
                <button
                  type="button"
                  aria-label={t('assistants:emoji')}
                  className="border rounded-sm p-1 size-9 flex items-center justify-center cursor-pointer"
                  onClick={() => setShowEmojiPicker(!showEmojiPicker)}
                  ref={emojiPickerTriggerRef}
                  disabled={isSaving}
                >
                  {avatar ? (
                    <AvatarEmoji
                      avatar={avatar}
                      imageClassName="size-5 object-contain"
                      textClassName=""
                    />
                  ) : (
                    <IconMoodSmile size={18} className="text-muted-foreground" />
                  )}
                </button>
                <div className="relative" ref={emojiPickerRef}>
                  {showEmojiPicker && <Suspense fallback={null}><EmojiPicker
                    open={showEmojiPicker}
                    theme={isDark ? ('dark' as Theme) : ('light' as Theme)}
                    className="absolute!s z-40! overflow-y-auto! top-2"
                    height={350}
                    lazyLoadEmojis
                    previewConfig={{ showPreview: false }}
                    onEmojiClick={(emojiData: EmojiClickData) => {
                      // For custom emojis, use the imageUrl instead of the emoji name
                      if (emojiData.isCustom && emojiData.imageUrl) {
                        setAvatar(emojiData.imageUrl)
                      } else {
                        setAvatar(emojiData.emoji)
                      }
                      setShowEmojiPicker(false)
                    }}
                  /></Suspense>}
                </div>
              </div>

              <div className="space-y-2 w-full">
                <label
                  htmlFor={`${fieldId}-name`}
                  className="text-sm mb-2 inline-block"
                >
                  {t(`common:name`)}
                </label>
                <Input
                  id={`${fieldId}-name`}
                  value={name}
                  disabled={isSaving}
                  onChange={(e) => {
                    setName(e.target.value)
                    if (e.target.value.trim()) setNameError(null)
                  }}
                  placeholder={t('assistants:enterName')}
                  autoFocus
                />
              </div>
            </div>

            {nameError && (
              <div className="ml-12 text-xs text-destructive mt-1">
                {nameError}
              </div>
            )}

            <div className="space-y-2">
              <label
                htmlFor={`${fieldId}-description`}
                className="text-sm mb-2 inline-block"
              >
                {t('assistants:description')}
              </label>
              <Textarea
                id={`${fieldId}-description`}
                value={description || ''}
                disabled={isSaving}
                onChange={(e) => setDescription(e.target.value)}
                placeholder={t('assistants:enterDescription')}
                className="resize-none"
              />
            </div>

            <div className="space-y-2">
              <label
                htmlFor={`${fieldId}-instructions`}
                className="text-sm mb-2 inline-block"
              >
                {t('assistants:instructions')}
              </label>
              <Textarea
                id={`${fieldId}-instructions`}
                value={instructions}
                disabled={isSaving}
                onChange={(e) => setInstructions(e.target.value)}
                placeholder={t('assistants:enterInstructions')}
                className="resize-none"
                rows={4}
              />
              <div className="text-xs text-muted-foreground">
                {t('assistants:instructionsDateHint')}
              </div>
            </div>
          </div>

          {saveError && (
            <p role="alert" className="text-sm text-destructive">
              {saveError}
            </p>
          )}
          <DialogFooter>
            <Button
              type="submit"
              disabled={isSaving}
              aria-busy={isSaving}
              aria-label={t('assistants:save')}
            >
              {isSaving ? t('loading') : t('assistants:save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

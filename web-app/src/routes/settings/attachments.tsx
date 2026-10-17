import { createFileRoute } from '@tanstack/react-router'
import SettingsMenu from '@/containers/SettingsMenu'
import HeaderPage from '@/containers/HeaderPage'
import { Card, CardItem } from '@/containers/Card'
import {
  useAttachments,
  type AttachmentsSettings as AttachmentValues,
} from '@/hooks/useAttachments'
import type { SettingComponentProps } from '@gchat/core'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { DynamicControllerSetting } from '@/containers/dynamicControllerSetting'
import { useEffect, useState, useCallback, useRef } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useGeneralSetting } from '@/hooks/useGeneralSetting'

// Longest-edge presets (px) offered for the image downscale setting. `0`
// keeps the original resolution (no limit).
const IMAGE_SIZE_PRESETS = [0, 768, 1024, 1536, 2048, 3072] as const

// GInfer does not provide embeddings. Keep the extension's persisted settings,
// but do not offer controls that cannot affect a supported document workflow.
const DOCUMENT_SEARCH_SETTINGS = new Set([
  'retrieval_limit',
  'retrieval_threshold',
  'chunk_size_chars',
  'overlap_chars',
  'search_mode',
])

const NUMERIC_SETTING_FIELDS = {
  max_file_size_mb: 'maxFileSizeMB',
  retrieval_limit: 'retrievalLimit',
  retrieval_threshold: 'retrievalThreshold',
  chunk_size_chars: 'chunkSizeChars',
  overlap_chars: 'overlapChars',
  auto_inline_context_ratio: 'autoInlineContextRatio',
} as const

type NumericSettingKey = keyof typeof NUMERIC_SETTING_FIELDS

function reportSaveError(error: unknown) {
  console.error('Failed to save attachment settings:', error)
}

export const Route = createFileRoute('/settings/attachments')({
  component: AttachmentsSettings,
})

// Helper to extract constraints from settingsDefs
function getConstraints(def: SettingComponentProps) {
  const props = def.controllerProps as Partial<{
    min: number
    max: number
    step: number
  }>
  return {
    min: props.min ?? -Infinity,
    max: props.max ?? Infinity,
    step: props.step ?? 1,
  }
}

// Helper to validate and clamp numeric values
function clampValue(
  val: unknown,
  def: SettingComponentProps,
  currentValue: number
): number {
  const num = typeof val === 'number' ? val : Number(val)
  if (!Number.isFinite(num)) return currentValue
  const { min, max, step } = getConstraints(def)
  // Floor integer values, preserve decimals for threshold
  const adjusted = step >= 1 ? Math.floor(num) : num
  return Math.max(min, Math.min(max, adjusted))
}

function AttachmentsSettings() {
  const { t } = useTranslation()
  const hookDefs = useAttachments((s) => s.settingsDefs)
  const loadDefs = useAttachments((s) => s.loadSettingsDefs)
  const maxImageSizePx = useGeneralSetting((s) => s.maxImageSizePx)
  const setMaxImageSizePx = useGeneralSetting((s) => s.setMaxImageSizePx)
  const [defs, setDefs] = useState<SettingComponentProps[]>([])

  // Load schema from extension via the hook once
  useEffect(() => {
    loadDefs()
  }, [loadDefs])

  // Mirror the hook's defs into local state for display
  useEffect(() => {
    setDefs(hookDefs)
  }, [hookDefs])

  // Track values for live updates
  const sel = useAttachments(
    useShallow((s) => ({
      enabled: s.enabled,
      maxFileSizeMB: s.maxFileSizeMB,
      retrievalLimit: s.retrievalLimit,
      retrievalThreshold: s.retrievalThreshold,
      chunkSizeChars: s.chunkSizeChars,
      overlapChars: s.overlapChars,
      searchMode: s.searchMode,
      parseMode: s.parseMode,
      autoInlineContextRatio: s.autoInlineContextRatio,
      saveSettings: s.saveSettings,
    }))
  )

  // Local state for inputs to allow intermediate values while typing
  const [localValues, setLocalValues] = useState<
    Record<string, string | number | boolean | string[]>
  >({})

  const timersRef = useRef<
    Partial<Record<NumericSettingKey, ReturnType<typeof setTimeout>>>
  >({})
  const pendingRef = useRef<
    Partial<Record<NumericSettingKey, { value: unknown; def: SettingComponentProps }>>
  >({})

  const flushPending = useCallback(
    (keys: NumericSettingKey[], updateInputs: boolean) => {
      const current = useAttachments.getState()
      const changes: Partial<AttachmentValues> = {}
      const validatedValues: Record<string, number> = {}
      keys.forEach((key) => {
        const pending = pendingRef.current[key]
        if (!pending) return
        delete pendingRef.current[key]
        clearTimeout(timersRef.current[key])
        delete timersRef.current[key]
        const field = NUMERIC_SETTING_FIELDS[key]
        const validated = clampValue(pending.value, pending.def, current[field])
        changes[field] = validated
        validatedValues[key] = validated
      })
      if (Object.keys(changes).length === 0) return

      // One batch survives the page and cannot race other settings writes.
      void current.saveSettings(changes).catch(reportSaveError)
      if (updateInputs) {
        setLocalValues((prev) => ({ ...prev, ...validatedValues }))
      }
    },
    []
  )

  useEffect(() => {
    const pending = pendingRef.current
    return () => {
      // Leaving before the typing debounce expires must still save every edit.
      flushPending(Object.keys(pending) as NumericSettingKey[], false)
    }
  }, [flushPending])

  const debouncedSet = useCallback(
    (key: string, val: unknown, def: SettingComponentProps) => {
      setLocalValues((prev) => ({
        ...prev,
        [key]: val as string | number | boolean | string[],
      }))

      if (key === 'enabled') {
        void sel.saveSettings({ enabled: !!val }).catch(reportSaveError)
      } else if (key === 'search_mode') {
        void sel
          .saveSettings({ searchMode: val as AttachmentValues['searchMode'] })
          .catch(reportSaveError)
      } else if (key === 'parse_mode') {
        void sel
          .saveSettings({ parseMode: val as AttachmentValues['parseMode'] })
          .catch(reportSaveError)
      } else if (
        Object.prototype.hasOwnProperty.call(NUMERIC_SETTING_FIELDS, key)
      ) {
        const numericKey = key as NumericSettingKey
        clearTimeout(timersRef.current[numericKey])
        pendingRef.current[numericKey] = { value: val, def }
        timersRef.current[numericKey] = setTimeout(() => {
          flushPending([numericKey], true)
        }, 500)
      }
    },
    [sel.saveSettings, flushPending]
  )

  const visibleDefs = defs.filter((d) => !DOCUMENT_SEARCH_SETTINGS.has(d.key))

  return (
    <div className="flex flex-col h-svh w-full">
      <HeaderPage>
        <div className="flex items-center gap-2 w-full">
          <span className='font-medium text-base font-studio'>{t('common:settings')}</span>
        </div>
      </HeaderPage>
      <div className="flex h-[calc(100%-60px)]">
        <SettingsMenu />
        <div className="p-4 pt-0 w-full overflow-y-auto">
          <div className="flex flex-col justify-between gap-4 gap-y-3 w-full">
            <Card title={t('common:attachments') || 'Attachments'}>
              <CardItem
                title={t('settings:attachments.documentSearchUnavailable')}
                description={t(
                  'settings:attachments.documentSearchUnavailableDesc'
                )}
              />
              {visibleDefs.map((d) => {
                // Use local value if typing, else use store value
                const storeValue = (() => {
                  switch (d.key) {
                    case 'enabled':
                      return sel.enabled
                    case 'max_file_size_mb':
                      return sel.maxFileSizeMB
                    case 'retrieval_limit':
                      return sel.retrievalLimit
                    case 'retrieval_threshold':
                      return sel.retrievalThreshold
                    case 'chunk_size_chars':
                      return sel.chunkSizeChars
                    case 'overlap_chars':
                      return sel.overlapChars
                    case 'search_mode':
                      return sel.searchMode
                    case 'parse_mode':
                      return sel.parseMode
                    case 'auto_inline_context_ratio':
                      return sel.autoInlineContextRatio
                    default:
                      return d?.controllerProps?.value
                  }
                })()

                const currentValue =
                  localValues[d.key] !== undefined
                    ? localValues[d.key]
                    : storeValue

                // Convert to DynamicControllerSetting compatible props
                const baseProps = d.controllerProps
                const normalizedValue: string | number | boolean = (() => {
                  if (Array.isArray(currentValue)) {
                    return currentValue.join(',')
                  }
                  return currentValue as string | number | boolean
                })()

                const props = {
                  value: normalizedValue,
                  placeholder:
                    'placeholder' in baseProps
                      ? baseProps.placeholder
                      : undefined,
                  type: 'type' in baseProps ? baseProps.type : undefined,
                  options:
                    'options' in baseProps ? baseProps.options : undefined,
                  input_actions:
                    'inputActions' in baseProps
                      ? baseProps.inputActions
                      : undefined,
                  rows: undefined,
                  min: 'min' in baseProps ? baseProps.min : undefined,
                  max: 'max' in baseProps ? baseProps.max : undefined,
                  step: 'step' in baseProps ? baseProps.step : undefined,
                  recommended:
                    'recommended' in baseProps
                      ? baseProps.recommended
                      : undefined,
                }

                const title = d.titleKey ? t(d.titleKey) : d.title
                const description =
                  d.key === 'parse_mode'
                    ? t('settings:attachments.availableParseModeDesc')
                    : d.key === 'auto_inline_context_ratio'
                      ? t(
                          'settings:attachments.availableAutoInlineThresholdDesc'
                        )
                      : d.descriptionKey
                        ? t(d.descriptionKey)
                        : d.description

                return (
                  <CardItem
                    key={d.key}
                    title={title}
                    description={description}
                    actions={
                      d.key === 'parse_mode' ? (
                        <div className="space-y-2">
                          <select
                            aria-label={title}
                            className="border-input bg-background rounded-md border px-2 py-1 text-sm"
                            value={String(normalizedValue)}
                            onChange={(event) =>
                              debouncedSet(d.key, event.target.value, d)
                            }
                          >
                            {normalizedValue === 'embeddings' && (
                              <option value="embeddings" disabled>
                                {t(
                                  'settings:attachments.savedDocumentSearchUnavailable'
                                )}
                              </option>
                            )}
                            <option value="auto">
                              {t('settings:attachments.parseModeAuto')}
                            </option>
                            <option value="inline">
                              {t('settings:attachments.parseModeInline')}
                            </option>
                            <option value="prompt">
                              {t('settings:attachments.parseModePrompt')}
                            </option>
                          </select>
                          {normalizedValue === 'embeddings' && (
                            <p className="text-sm text-muted-foreground">
                              {t(
                                'settings:attachments.savedDocumentSearchUnavailableDesc'
                              )}
                            </p>
                          )}
                        </div>
                      ) : (
                        <DynamicControllerSetting
                          controllerType={d.controllerType}
                          controllerProps={props}
                          onChange={(val) => debouncedSet(d.key, val, d)}
                        />
                      )
                    }
                  />
                )
              })}
            </Card>

            <Card title={t('settings:attachments.images')}>
              <CardItem
                title={t('settings:attachments.maxImageSize')}
                description={t('settings:attachments.maxImageSizeDesc')}
                actions={
                  <select
                    aria-label={t('settings:attachments.maxImageSize')}
                    className="border-input bg-background rounded-md border px-2 py-1 text-sm"
                    value={maxImageSizePx}
                    onChange={(e) => setMaxImageSizePx(Number(e.target.value))}
                  >
                    {IMAGE_SIZE_PRESETS.map((px) => (
                      <option key={px} value={px}>
                        {px === 0
                          ? t('settings:attachments.original')
                          : `${px} px`}
                      </option>
                    ))}
                  </select>
                }
              />
            </Card>
          </div>
        </div>
      </div>
    </div>
  )
}

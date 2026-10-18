import { useEffect, useId, useState } from 'react'
import { Input } from '@/components/ui/input'
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'
import {
  paramCategories,
  paramGroups,
  paramsSettings,
  SAMPLING_PARAM_KEYS,
  type ParamSetting,
} from '@/lib/predefinedParams'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { cn } from '@/lib/utils'

interface ParametersSectionProps {
  parameters: Record<string, unknown>
  onChange: (key: string, value: number | boolean) => void
  /** Subset/order of param keys to render. Defaults to all sampling keys. */
  paramKeys?: string[]
  className?: string
}

function readNumber(
  parameters: Record<string, unknown>,
  setting: ParamSetting
): number {
  const raw = parameters[setting.key]
  if (typeof raw === 'number' && !Number.isNaN(raw)) return raw
  if (typeof raw === 'string' && raw.trim() !== '' && !Number.isNaN(Number(raw)))
    return Number(raw)
  return setting.value as number
}

function readBoolean(
  parameters: Record<string, unknown>,
  setting: ParamSetting
): boolean {
  const raw = parameters[setting.key]
  if (typeof raw === 'boolean') return raw
  return setting.value as boolean
}

function clamp(value: number, min?: number, max?: number): number {
  let next = value
  if (typeof min === 'number') next = Math.max(min, next)
  if (typeof max === 'number') next = Math.min(max, next)
  return next
}

function ParameterNumberInput({
  id,
  value,
  setting,
  onChange,
}: {
  id: string
  value: number
  setting: ParamSetting
  onChange: (value: number) => void
}) {
  const [draft, setDraft] = useState<{
    text: string
    numeric: number
  } | null>(null)

  useEffect(() => {
    setDraft((current) => (current?.numeric === value ? current : null))
  }, [value])

  return (
    <Input
      id={id}
      type="number"
      value={draft?.numeric === value ? draft.text : String(value)}
      min={setting.min}
      max={setting.max}
      step={setting.step ?? 'any'}
      onChange={(event) => {
        const text = event.target.value
        const parsed = Number(text)
        // An empty field or an unfinished minus sign must remain editable.
        if (text === '' || Number.isNaN(parsed)) {
          setDraft({ text, numeric: value })
          return
        }
        const numeric = clamp(parsed, setting.min, setting.max)
        setDraft({ text: numeric === parsed ? text : String(numeric), numeric })
        onChange(numeric)
      }}
      onBlur={() => setDraft(null)}
      className="h-6 w-14 rounded-md border-0 bg-transparent px-1 py-0 text-right text-xs! leading-6 text-muted-foreground/80 tabular-nums shadow-none focus-visible:ring-0 dark:bg-transparent"
    />
  )
}

export function ParametersSection({
  parameters,
  onChange,
  paramKeys = SAMPLING_PARAM_KEYS,
  className,
}: ParametersSectionProps) {
  const { t } = useTranslation()
  const id = useId()
  const visible = new Set(paramKeys)

  return (
    <div className={cn('space-y-2.5', className)}>
      {paramCategories.map((category) => {
        const keys = paramGroups[category.id].filter((key) => visible.has(key))
        if (keys.length === 0) return null

        return (
          <div key={category.id} className="space-y-1.5">
            <div className="text-[11px] font-medium text-muted-foreground/70 uppercase tracking-wide">
              {t(`assistants:paramCategory.${category.id}`)}
            </div>

            {keys.map((key) => {
              const setting = paramsSettings[key]
              if (!setting) return null
              const inputId = `${id}-${key}`
              const labelId = `${inputId}-label`

              if (setting.controllerType === 'checkbox') {
                const checked = readBoolean(parameters, setting)
                return (
                  <div
                    key={key}
                    className="flex items-center justify-between gap-4"
                  >
                    <label
                      id={labelId}
                      htmlFor={inputId}
                      className="text-sm text-muted-foreground truncate"
                      title={setting.description}
                    >
                      {setting.title}
                    </label>
                    <Switch
                      id={inputId}
                      aria-labelledby={labelId}
                      checked={checked}
                      onCheckedChange={(value) => onChange(key, value)}
                    />
                  </div>
                )
              }

              const value = readNumber(parameters, setting)
              return (
                <div key={key} className="space-y-1">
                  <div className="flex items-center justify-between gap-3">
                    <label
                      id={labelId}
                      htmlFor={inputId}
                      className="text-sm text-muted-foreground truncate"
                      title={setting.description}
                    >
                      {setting.title}
                    </label>
                    <ParameterNumberInput
                      id={inputId}
                      value={value}
                      setting={setting}
                      onChange={(numeric) => onChange(key, numeric)}
                    />
                  </div>
                  {setting.controllerType === 'slider' && (
                    <Slider
                      aria-labelledby={labelId}
                      value={[value]}
                      min={setting.min ?? 0}
                      max={setting.max ?? 1}
                      step={setting.step ?? 0.01}
                      onValueChange={(values) => onChange(key, values[0])}
                      className="[&_[data-slot=slider-track]]:bg-muted [&_[data-slot=slider-range]]:bg-muted-foreground/40 [&_[data-slot=slider-thumb]]:border-muted-foreground/40 [&_[data-slot=slider-thumb]]:bg-muted-foreground"
                    />
                  )}
                </div>
              )
            })}
          </div>
        )
      })}
    </div>
  )
}

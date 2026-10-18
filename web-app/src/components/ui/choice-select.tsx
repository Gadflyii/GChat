import { useEffect, useRef, useState, type ComponentProps } from 'react'
import { ChevronDownIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent,
  DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuLabel,
} from './dropdown-menu'

export type ChoiceOption = {
  value: string
  label: string
  disabled?: boolean
  title?: string
  group?: string
}

/** App-rendered choices: native WebKitGTK popups ignore the app's dark palette. */
export function ChoiceSelect({ value, onValueChange, options, className, ...props }:
  Omit<ComponentProps<'button'>, 'value' | 'onChange' | 'children'> & {
    value: string
    onValueChange: (value: string) => void
    options: ChoiceOption[]
  }) {
  const [open, setOpen] = useState(false)
  const trigger = useRef<HTMLButtonElement>(null)
  const content = useRef<HTMLDivElement>(null)
  const tabTarget = useRef<HTMLElement | null>(null)
  const selected = options.find(option => option.value === value)
  useEffect(() => {
    if (!open) return
    const frame = requestAnimationFrame(() => {
      const items = content.current?.querySelectorAll<HTMLElement>('[role="menuitemradio"]:not([data-disabled])')
      const checked = content.current?.querySelector<HTMLElement>('[role="menuitemradio"][aria-checked="true"]:not([data-disabled])')
      ;(checked ?? items?.[0] ?? content.current)?.focus()
    })
    return () => cancelAnimationFrame(frame)
  }, [open])
  return <DropdownMenu modal={false} open={open} onOpenChange={setOpen}>
    <DropdownMenuTrigger asChild disabled={props.disabled}>
      <button {...props} ref={trigger} type="button" data-choice-select
        className={cn('inline-flex min-h-9 min-w-0 items-center justify-between gap-2 rounded-md border border-input bg-background px-3 py-2 text-left font-sans text-sm font-normal text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50', className)}>
        <span className="min-w-0 truncate" title={selected?.label}>{selected?.label ?? value}</span>
        <ChevronDownIcon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
      </button>
    </DropdownMenuTrigger>
    <DropdownMenuContent ref={content} align="start"
      className="w-(--radix-dropdown-menu-trigger-width) min-w-56 max-w-[calc(100vw-2rem)]"
      onCloseAutoFocus={event => {
        if (tabTarget.current) {
          event.preventDefault()
          tabTarget.current.focus()
          tabTarget.current = null
        }
      }}
      onKeyDown={event => {
        if (event.key !== 'Tab') return
        event.preventDefault()
        // Radix menus trap Tab. A choice field instead advances to the adjacent
        // field in document order, excluding the portalled popup itself.
        const fields = [...document.querySelectorAll<HTMLElement>('button, input, select, textarea, a[href], summary, [tabindex]')]
          .filter(field => field.tabIndex >= 0 && !field.matches(':disabled') &&
            !field.closest('[inert], [aria-hidden="true"]') && !content.current?.contains(field) &&
            field.getClientRects().length > 0)
        const index = fields.indexOf(trigger.current!)
        tabTarget.current = fields[index + (event.shiftKey ? -1 : 1)] ?? trigger.current
        setOpen(false)
      }}>
      <DropdownMenuRadioGroup value={value} onValueChange={next => { if (next !== value) onValueChange(next) }}>
        {options.map((option, index) => <div key={option.value}>
          {option.group && option.group !== options[index - 1]?.group && <DropdownMenuLabel>{option.group}</DropdownMenuLabel>}
          <DropdownMenuRadioItem value={option.value} disabled={option.disabled} title={option.title}
            textValue={option.label} className="whitespace-normal break-words font-normal">
            {option.label}
          </DropdownMenuRadioItem>
        </div>)}
      </DropdownMenuRadioGroup>
    </DropdownMenuContent>
  </DropdownMenu>
}

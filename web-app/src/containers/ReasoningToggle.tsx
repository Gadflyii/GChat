import { memo } from 'react'
import { IconBulb } from '@tabler/icons-react'
import { ChevronDown } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import {
  useGeneralSetting,
  type ReasoningBudgetLevel,
} from '@/hooks/useGeneralSetting'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { cn } from '@/lib/utils'

type ReasoningToggleProps = {
  className?: string
}

const REASONING_OPTIONS: Array<{ value: ReasoningBudgetLevel; label: string }> = [
  { value: 'off', label: 'Off' },
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'xhigh', label: 'Extra high' },
  { value: 'unlimited', label: 'Model default' },
]

const ReasoningToggle = memo(function ReasoningToggle({
  className,
}: ReasoningToggleProps) {
  const { t } = useTranslation()

  const disableReasoning = useGeneralSetting((state) => state.disableReasoning)
  const setDisableReasoning = useGeneralSetting(
    (state) => state.setDisableReasoning
  )

  const budget = useGeneralSetting((state) => state.reasoningBudget)
  const setBudget = useGeneralSetting((state) => state.setReasoningBudget)
  const enabled = !disableReasoning && budget !== 'off'
  const selectedValue = enabled ? budget : 'off'
  const selectedLabel = REASONING_OPTIONS.find(
    (option) => option.value === selectedValue
  )!.label
  const label = enabled
    ? t('common:reasoningToggleEnabled')
    : t('common:reasoningToggleDisabled')

  const handleClick = () => {
    if (!enabled && budget === 'off') setBudget('high')
    setDisableReasoning(enabled)
  }

  return (
    <div className="flex items-center gap-1">
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-xs"
              className={cn(
                enabled &&
                  'bg-primary/10 text-primary hover:bg-primary/15 hover:text-primary',
                className
              )}
              aria-label={label}
              aria-pressed={enabled}
              onClick={handleClick}
            >
              <IconBulb
                size={18}
                className={cn(enabled ? 'text-primary' : 'text-muted-foreground')}
              />
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            <p>{label}</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label="Reasoning effort"
            title="Requested reasoning effort; the model uses its nearest supported level. This is not a token budget."
            className="flex max-w-24 cursor-pointer items-center gap-1 rounded border border-input bg-background px-1 py-0.5 text-xs text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <span className="truncate">{selectedLabel}</span>
            <ChevronDown className="size-3 shrink-0" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuRadioGroup
            aria-label="Reasoning effort"
            value={selectedValue}
            onValueChange={(value) => {
              setDisableReasoning(value === 'off')
              setBudget(value as ReasoningBudgetLevel)
            }}
          >
            {REASONING_OPTIONS.map((option) => (
              <DropdownMenuRadioItem key={option.value} value={option.value}>
                {option.label}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
})

export default ReasoningToggle

import { memo } from 'react'
import { IconBulb } from '@tabler/icons-react'

import { Button } from '@/components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { useGeneralSetting } from '@/hooks/useGeneralSetting'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { cn } from '@/lib/utils'

type ReasoningToggleProps = {
  className?: string
}

const ReasoningToggle = memo(function ReasoningToggle({
  className,
}: ReasoningToggleProps) {
  const { t } = useTranslation()

  const disableReasoning = useGeneralSetting((state) => state.disableReasoning)
  const setDisableReasoning = useGeneralSetting(
    (state) => state.setDisableReasoning
  )

  const budget = useGeneralSetting(state => state.reasoningBudget)
  const setBudget = useGeneralSetting(state => state.setReasoningBudget)
  const enabled = !disableReasoning && budget !== 'off'
  const label = enabled
    ? t('common:reasoningToggleEnabled')
    : t('common:reasoningToggleDisabled')

  const handleClick = () => {
    if (!enabled && budget === 'off') setBudget('high')
    setDisableReasoning(enabled)
  }

  return (
    <div className="flex items-center gap-1"><TooltipProvider>
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
    <select aria-label="Reasoning effort" title="Requested reasoning effort; the model uses its nearest supported level. This is not a token budget." className="max-w-24 rounded border border-input bg-background px-1 py-0.5 text-xs" value={enabled ? budget : 'off'} onChange={event => {
      const value = event.target.value as typeof budget
      setDisableReasoning(value === 'off')
      setBudget(value)
    }}>
      <option value="off">Off</option>
      <option value="low">Low</option>
      <option value="medium">Medium</option>
      <option value="high">High</option>
      <option value="xhigh">Extra high</option>
      <option value="unlimited">Model default</option>
    </select></div>
  )
})

export default ReasoningToggle

import { IconChevronDown, IconChevronRight } from '@tabler/icons-react'
import { Button } from '@/components/ui/button'
import { CopyButton } from '@/containers/CopyButton'
import i18n from '@/i18n/setup'

export function ModelLoadErrorBody({
  description,
  details,
  expanded,
  onToggle,
}: {
  description: string
  details?: string
  expanded: boolean
  onToggle: () => void
}) {
  const log = details?.trim()

  return (
    <div className="flex w-full flex-col gap-2">
      <span>{description}</span>
      {log && (
        <>
          <Button
            variant="ghost"
            size="xs"
            onClick={onToggle}
            className="-ml-1.5 w-fit gap-1 px-1.5 text-muted-foreground"
          >
            {expanded ? (
              <IconChevronDown size={14} />
            ) : (
              <IconChevronRight size={14} />
            )}
            {i18n.t(
              expanded ? 'model-errors:hideDetails' : 'model-errors:showDetails'
            )}
          </Button>
          {expanded && (
            <div className="relative">
              <pre className="max-h-56 select-text overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted/40 p-2 pr-8 font-mono text-[11px] leading-snug">
                {log}
              </pre>
              <div className="absolute right-1 top-1">
                <CopyButton text={log} />
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}

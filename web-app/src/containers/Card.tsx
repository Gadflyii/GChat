import { cn } from '@/lib/utils'
import { ReactNode, useId } from 'react'
import { LabelledByContext } from '@/components/ui/labelled-by-context'

type CardProps = {
  title?: string
  children?: ReactNode
  header?: ReactNode
  className?: string
}

type CardItemProps = {
  title?: string | ReactNode
  description?: string | ReactNode
  descriptionOutside?: string | ReactNode
  align?: 'start' | 'center' | 'end'
  actions?: ReactNode
  column?: boolean
  className?: string
  classNameWrapperAction?: string
}

export function CardItem({
  title,
  description,
  descriptionOutside,
  className,
  classNameWrapperAction,
  align = 'center',
  column,
  actions,
}: CardItemProps) {
  const rowId = useId()
  const labelId = title ? `${rowId}-title` : undefined
  const descriptionId = description ? `${rowId}-description` : undefined
  return (
    <>
      <div
        className={cn(
          'flex justify-between mt-2 first:mt-0 border-b border-border/40 pb-3 last:border-none last:pb-0 gap-8',
          descriptionOutside && 'border-0',
          align === 'start' && 'items-start',
          align === 'center' && 'items-center',
          align === 'end' && 'items-end',
          column && 'flex-col gap-y-0 items-start',
          className
        )}
      >
        <div className="space-y-1.5">
          <h3 id={labelId} className="font-medium text-foreground">
            {title}
          </h3>
          {description && (
            <span
              id={descriptionId}
              className="text-muted-foreground leading-normal"
            >
              {description}
            </span>
          )}
        </div>
        {actions && (
          <div
            className={cn(
              'shrink-0',
              classNameWrapperAction,
              column && 'w-full'
            )}
          >
            <LabelledByContext.Provider value={{ labelId, descriptionId }}>
              {actions}
            </LabelledByContext.Provider>
          </div>
        )}
      </div>
      {descriptionOutside && (
        <span className="text-muted-foreground leading-normal">
          {descriptionOutside}
        </span>
      )}
    </>
  )
}

export function Card({ title, children, header, className }: CardProps) {
  return (
    <div
      className={cn(
        'p-4 text-muted-foreground w-full',
        !className && 'bg-card rounded-lg',
        className
      )}
    >
      {title && (
        <h2 className="text-foreground font-studio font-medium text-base mb-4">
          {title}
        </h2>
      )}
      {header && header}
      {children}
    </div>
  )
}

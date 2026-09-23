import './sectile-activity-indicator.css'

type SectileActivityIndicatorProps = {
  active: boolean
}

export function SectileActivityIndicator({ active }: SectileActivityIndicatorProps) {
  return (
    <span
      aria-hidden="true"
      className="sectile-activity-indicator"
      data-active={active}
    >
      <span className="sectile-activity-indicator-square" />
    </span>
  )
}

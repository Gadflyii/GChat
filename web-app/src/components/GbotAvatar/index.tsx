import { useTheme } from '@/hooks/useTheme'
import './avatar.css'

export type AvatarState =
  | 'idle'
  | 'listening'
  | 'thinking'
  | 'thinking-hard'
  | 'speaking'
  | 'greeting'
  | 'sleeping'

export default function GbotAvatar({
  state = 'idle',
  size = 40,
  decorative = false,
}: {
  state?: AvatarState
  size?: number
  decorative?: boolean
}) {
  const dark = useTheme((theme) => theme.isDark)
  return (
    <div
      className={`gbot gbot--${dark ? 'dark' : 'light'} gbot--${state}`}
      style={{ fontSize: size }}
      role={decorative ? undefined : 'img'}
      aria-hidden={decorative || undefined}
      aria-label={decorative ? undefined : `Gbot ${state}`}
    >
      <div className="gbot__body">
        <div className="gbot__face" />
        <div className="gbot__shine" />
        <div className="gbot__view">
          <div className="gbot__eyes">
            {[0, 1].map((eye) => (
              <div key={eye} className="gbot__eye">
                <div className="gbot__pupil" />
              </div>
            ))}
          </div>
        </div>
        <div className="gbot__shade" />
        <div className="gbot__arc" />
      </div>
    </div>
  )
}

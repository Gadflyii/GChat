import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react'
import { Button } from '@/components/ui/button'
import { gbot, type Identity, type ViewTicket } from '@/services/gbot'
import { MediaSession, type MediaStatus } from '@/vendor/cua-media/mediaSession'

export type DesktopViewHandle = { stopInput: () => void }

const GbotDesktopView = forwardRef<
  DesktopViewHandle,
  {
    identity: Identity
    owner: string
    interactive: boolean
    visible?: boolean
  }
>(function GbotDesktopView({ identity, owner, interactive, visible = true }, ref) {
  const [opened, setOpened] = useState(false)
  const [audio, setAudio] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const [status, setStatus] = useState<MediaStatus>('connecting')
  const [error, setError] = useState('')
  const canvas = useRef<HTMLCanvasElement>(null)
  const stopMedia = useRef<(() => void) | null>(null)
  useImperativeHandle(
    ref,
    () => ({ stopInput: () => stopMedia.current?.() }),
    []
  )

  const { workspace_id, session_id } = identity
  useEffect(() => {
    const identity = { workspace_id, session_id }
    if (!visible || !opened || !canvas.current) return
    let cancelled = false
    let session: MediaSession | null = null
    let ticket: ViewTicket | null = null
    const stop = () => {
      cancelled = true
      session?.stop()
    }
    const stopInput = () => {
      stop()
      setStatus('ended')
    }
    stopMedia.current = stopInput
    const close = (value: ViewTicket) =>
      gbot('view/close', {
        identity,
        owner,
        lease_id: value.lease_id,
      })
    setStatus('connecting')
    setError('')
    void (async () => {
      try {
        ticket = await gbot<ViewTicket>('view/open', {
          identity,
          owner,
          interactive,
          audio,
          h264: typeof VideoDecoder !== 'undefined',
        })
        if (cancelled) {
          const lateTicket = ticket
          ticket = null
          await close(lateTicket)
          return
        }
        session = new MediaSession({
          canvas: canvas.current!,
          ticket: {
            wsUrl: ticket.ws_url,
            mediaSessionId: ticket.media_session_id,
          },
          interactive: ticket.interactive,
          audio,
          onStatus: (value) => {
            if (!cancelled) setStatus(value)
          },
        })
        session.start()
      } catch (cause) {
        session?.stop()
        if (ticket) {
          void close(ticket).catch(() => {})
          ticket = null
        }
        if (!cancelled) {
          setError(String(cause))
          setStatus('failed')
        }
      }
    })()
    return () => {
      stop()
      if (stopMedia.current === stopInput) stopMedia.current = null
      if (ticket) void close(ticket).catch(() => {})
    }
  }, [visible, opened, audio, attempt, workspace_id, session_id, owner, interactive])

  if (!opened)
    return (
      <Button variant="outline" onClick={() => setOpened(true)}>
        View bot’s desktop
      </Button>
    )
  return (
    <section
      aria-label="Bot desktop"
      className="space-y-2 rounded-lg border p-3"
    >
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <span>{interactive ? 'You have control' : 'View only'}</span>
        <span role="status" className="text-muted-foreground">
          {status}
        </span>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={audio}
            onChange={(event) => setAudio(event.target.checked)}
          />
          Desktop audio
        </label>
        <Button variant="ghost" size="sm" onClick={() => setOpened(false)}>
          Close view
        </Button>
        {(status === 'failed' || status === 'ended') && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setAttempt((value) => value + 1)}
          >
            Reconnect view
          </Button>
        )}
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <canvas
        ref={canvas}
        aria-label="Bot computer desktop"
        tabIndex={interactive ? 0 : -1}
        className="block max-h-[65vh] w-full rounded bg-black object-contain"
      />
      <p className="text-xs text-muted-foreground">
        Take over pauses the bot and enables desktop input. Hand back ends your
        input before the bot resumes.
      </p>
    </section>
  )
})
export default GbotDesktopView

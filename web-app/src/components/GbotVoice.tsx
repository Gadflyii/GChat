import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  NO_SPEECH_SERVICE,
  onVoiceDownload,
  voiceListenCancel,
  voiceListenStart,
  voiceListenStop,
  voicePrepare,
  voiceSpeak,
  voiceSpeakStop,
  voiceStatus,
  type VoiceStatus,
} from '@/services/voice'

const message = (cause: unknown) =>
  cause instanceof Error ? cause.message : String(cause)

/** Speak a task: records, turns the speech into text on this computer, and hands the text over for review. */
export function VoiceInput({
  onText,
  disabled,
}: {
  onText: (text: string) => void
  disabled?: boolean
}) {
  const [status, setStatus] = useState<VoiceStatus>()
  const [phase, setPhase] = useState<
    'idle' | 'asking' | 'downloading' | 'listening' | 'understanding'
  >('idle')
  const [percent, setPercent] = useState(0)
  const [error, setError] = useState<string>()
  const mounted = useRef(true)

  useEffect(() => {
    mounted.current = true
    voiceStatus()
      .then((value) => mounted.current && setStatus(value))
      .catch(() => undefined)
    return () => {
      mounted.current = false
      void voiceListenCancel().catch(() => undefined)
    }
  }, [])

  async function download() {
    setError(undefined)
    setPhase('downloading')
    setPercent(0)
    const unlisten = await onVoiceDownload(({ done, total }) =>
      setPercent(total ? Math.min(100, Math.floor((done / total) * 100)) : 0)
    ).catch(() => undefined)
    try {
      await voicePrepare()
      setStatus((current) => current && { ...current, model_ready: true })
      setPhase('idle')
    } catch (cause) {
      setError(message(cause))
      setPhase('asking')
    } finally {
      unlisten?.()
    }
  }

  async function toggle() {
    setError(undefined)
    if (phase === 'listening') {
      setPhase('understanding')
      try {
        onText(await voiceListenStop())
      } catch (cause) {
        setError(message(cause))
      }
      setPhase('idle')
      return
    }
    if (!status?.model_ready) {
      setPhase('asking')
      return
    }
    try {
      await voiceListenStart()
      setPhase('listening')
    } catch (cause) {
      setError(message(cause))
    }
  }

  const megabytes = Math.round((status?.download_bytes ?? 0) / 1_000_000)
  return (
    <div className="contents">
      <Button
        type="button"
        variant="outline"
        aria-label={phase === 'listening' ? 'Stop and use what I said' : 'Speak a task'}
        disabled={disabled || phase === 'understanding' || phase === 'downloading'}
        onClick={() => void toggle()}
      >
        {phase === 'listening'
          ? 'Stop listening'
          : phase === 'understanding'
            ? 'Understanding…'
            : 'Speak'}
      </Button>
      {phase === 'listening' && (
        <p role="status" className="order-last basis-full text-sm text-muted-foreground">
          Listening… speak your request, then choose Stop listening. It appears in the task box for you
          to check before you choose Run.
        </p>
      )}
      {phase === 'asking' && (
        <div className="order-last basis-full space-y-2 rounded-lg border p-3 text-sm">
          <p>
            Speaking a task needs a one-time download of about {megabytes} MB, a speech recognition
            model that runs on this computer. Nothing you say leaves this computer.
          </p>
          <div className="flex gap-2">
            <Button type="button" onClick={() => void download()}>
              Download speech model
            </Button>
            <Button type="button" variant="outline" onClick={() => setPhase('idle')}>
              Not now
            </Button>
          </div>
        </div>
      )}
      {phase === 'downloading' && (
        <p role="status" className="order-last basis-full text-sm text-muted-foreground">
          Downloading the speech model… {percent}%
        </p>
      )}
      {error !== undefined && (
        <p role="alert" className="order-last basis-full text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  )
}

/** Hear a reply with the operating system's speech service. */
export function ReadAloud({ text }: { text: string }) {
  const [reading, setReading] = useState(false)
  const [error, setError] = useState<string>()
  if (!text.trim()) return null
  return (
    <div>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={async () => {
          setError(undefined)
          if (reading) {
            await voiceSpeakStop().catch(() => undefined)
            setReading(false)
            return
          }
          try {
            await voiceSpeak(text)
            setReading(true)
          } catch (cause) {
            const detail = message(cause)
            setError(detail.includes('speech service') ? NO_SPEECH_SERVICE : detail)
          }
        }}
      >
        {reading ? 'Stop reading' : 'Read aloud'}
      </Button>
      {error !== undefined && (
        <p role="alert" className="mt-1 text-sm text-muted-foreground">
          {error} The reply stays here as text.
        </p>
      )}
    </div>
  )
}

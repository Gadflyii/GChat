import { Button } from '@/components/ui/button'
import { IconCopy, IconCopyCheck } from '@tabler/icons-react'
import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'

export const CopyButton = ({ text }: { text: string }) => {
  const [copied, setCopied] = useState(false)
  const [pending, setPending] = useState(false)
  const copying = useRef(false)
  const resetTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  useEffect(() => () => clearTimeout(resetTimer.current), [])

  const handleCopy = async () => {
    if (copying.current) return
    copying.current = true
    clearTimeout(resetTimer.current)
    setCopied(false)
    setPending(true)

    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      resetTimer.current = setTimeout(() => setCopied(false), 2000)
    } catch {
      toast.error('Could not copy. Try again.')
    } finally {
      copying.current = false
      setPending(false)
    }
  }

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        aria-label={pending ? 'Copying…' : copied ? 'Copied' : 'Copy'}
        disabled={pending}
        onClick={handleCopy}
      >
        {copied ? (
          <IconCopyCheck size={16} className="text-primary" aria-hidden="true" />
        ) : (
          <IconCopy size={16} aria-hidden="true" />
        )}
      </Button>
      <span className="sr-only" role="status" aria-live="polite">
        {copied ? 'Copied' : ''}
      </span>
    </>
  )
}

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { memoryCommand } from '@/lib/memory'
import { WorkspacePicker } from './WorkspacePicker'

export function RememberMemory({
  text,
  messageId,
}: {
  text: string
  messageId: string
}) {
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [workspace, setWorkspace] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  if (!text.trim()) return null
  return (
    <>
      <Button
        size="sm"
        variant="ghost"
        onClick={() => {
          setTitle(text.trim().split('\n')[0].slice(0, 80))
          setContent(text.slice(0, 2000))
          setError('')
          setOpen(true)
        }}
      >
        Remember this
      </Button>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!busy) setOpen(next)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remember this</DialogTitle>
            <DialogDescription>
              Review a durable fact before saving. Keep only useful, verified
              information; never passwords or secrets.{' '}
              {text.length > 2000
                ? 'This message was shortened to 2,000 characters; edit it into a concise memory.'
                : ''}
            </DialogDescription>
          </DialogHeader>
          <label>
            Title
            <Input
              value={title}
              maxLength={120}
              onChange={(e) => setTitle(e.target.value)}
            />
          </label>
          <label>
            Memory
            <Textarea
              rows={5}
              maxLength={2000}
              value={content}
              onChange={(e) => setContent(e.target.value)}
            />
          </label>
          <WorkspacePicker
            personalWhenEmpty
            value={workspace}
            onChange={setWorkspace}
          />
          {error && (
            <p role="alert" className="text-destructive">
              {error}
            </p>
          )}
          <Button
            disabled={busy || !title.trim() || !content.trim()}
            onClick={() => {
              setBusy(true)
              void memoryCommand('save', {
                title,
                content,
                workspace: workspace.trim() || null,
                origin: `message:${messageId}`,
              })
                .then(() => setOpen(false))
                .catch((e) => setError(String(e)))
                .finally(() => setBusy(false))
            }}
          >
            Save memory
          </Button>
        </DialogContent>
      </Dialog>
    </>
  )
}

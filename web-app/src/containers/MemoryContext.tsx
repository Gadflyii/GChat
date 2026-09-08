import { useState } from 'react'
import { useMemoryContext } from '@/stores/memory-context-store'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'

export function MemoryContext({ threadId }: { threadId: string }) {
  const memories = useMemoryContext((s) => s.threads[threadId])
  const [open, setOpen] = useState(false)
  if (!memories?.length) return null
  return (
    <>
      <Button size="sm" variant="ghost" onClick={() => setOpen(true)}>
        {memories.length} memories used
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[80vh] overflow-auto">
          <DialogHeader>
            <DialogTitle>Memories used</DialogTitle>
            <DialogDescription>
              Selected for the last GChat memory lookup in this conversation.
              This is a snapshot; edits in the Memory library affect future
              lookups.
            </DialogDescription>
          </DialogHeader>
          {memories.map((memory) => (
            <article key={memory.id} className="space-y-2 rounded border p-3">
              <h3 className="font-medium">{memory.title}</h3>
              <p className="whitespace-pre-wrap text-sm">{memory.content}</p>
              <p className="text-xs text-muted-foreground">
                {memory.workspace ?? 'Personal'} · Revision {memory.revision} ·{' '}
                {memory.origin ?? memory.source}
              </p>
            </article>
          ))}
        </DialogContent>
      </Dialog>
    </>
  )
}

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { gbotTaskFile, type Task } from '@/services/gbot'

function size(bytes: number): string {
  if (bytes < 1024) return `${bytes} bytes`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/**
 * The finished files a bot handed back from a task. Open uses the app you already have for
 * that kind of file; Save as asks where to keep it. Nothing here runs the file.
 */
export function GbotTaskFiles({ task }: { task: Task }) {
  const [message, setMessage] = useState<{ text: string; error: boolean }>()
  const [working, setWorking] = useState<string>()
  const files = task.outputs ?? []
  if (files.length === 0) return null
  const act = async (id: string, name: string, open: boolean) => {
    setWorking(id)
    setMessage(undefined)
    try {
      const path = await gbotTaskFile(task.id, id, open)
      if (path !== null)
        setMessage({
          text: open ? `Opened ${name}.` : `Saved ${name}.`,
          error: false,
        })
    } catch (cause) {
      setMessage({ text: String(cause), error: true })
    } finally {
      setWorking(undefined)
    }
  }
  return (
    <section
      aria-label="Files from this task"
      className="space-y-2 rounded-md border p-3"
    >
      <h3 className="text-sm font-medium">Files from this task</h3>
      <p className="text-xs text-muted-foreground">
        The bot finished these files for you. They are copies on this computer.
      </p>
      <ul className="space-y-2">
        {files.map((file) => (
          <li
            key={file.id}
            className="flex flex-wrap items-center justify-between gap-2 text-sm"
          >
            <span className="min-w-0 break-all">
              <span className="font-medium">{file.name}</span>
              <span className="text-muted-foreground"> · {size(file.bytes)}</span>
            </span>
            <span className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={working !== undefined}
                aria-label={`Open ${file.name}`}
                onClick={() => void act(file.id, file.name, true)}
              >
                Open
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={working !== undefined}
                aria-label={`Save ${file.name} as`}
                onClick={() => void act(file.id, file.name, false)}
              >
                Save as…
              </Button>
            </span>
          </li>
        ))}
      </ul>
      {message && (
        <p
          role={message.error ? 'alert' : 'status'}
          className={
            message.error ? 'text-sm text-destructive' : 'text-sm'
          }
        >
          {message.text}
        </p>
      )}
    </section>
  )
}

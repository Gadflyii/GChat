import { useEffect, useId, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { resolveAgentWorkspaceRoot } from '@/services/agent/tauri'
import { memoryCommand } from '@/lib/memory'

const recentKey = 'gchat-recent-workspaces'
function recentPaths(): string[] {
  try {
    return JSON.parse(localStorage.getItem(recentKey) ?? '[]')
      .filter((p: unknown) => typeof p === 'string')
      .slice(0, 10)
  } catch {
    return []
  }
}

export function WorkspacePicker({
  value,
  onChange,
  personalWhenEmpty = false,
  onValidity,
}: {
  value: string
  onChange: (path: string) => void
  personalWhenEmpty?: boolean
  onValidity?: (valid: boolean) => void
}) {
  const id = useId()
  const [recent, setRecent] = useState(recentPaths)
  const [resolved, setResolved] = useState('')
  const [error, setError] = useState('')
  const [instructions, setInstructions] = useState<string>()
  useEffect(() => {
    let cancelled = false
    setResolved('')
    onValidity?.(false)
    setError('')
    setInstructions(undefined)
    if (!value.trim() && personalWhenEmpty) {
      onValidity?.(true)
      return
    }
    const timer = setTimeout(() => {
      void resolveAgentWorkspaceRoot(value.trim() || undefined)
        .then((root) => {
          if (!cancelled) {
            setResolved(root.path)
            onValidity?.(true)
          }
        })
        .catch((e) => {
          if (!cancelled) setError(String(e))
        })
    }, 250)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [value, personalWhenEmpty, onValidity])
  const choose = async () => {
    try {
      const path = await invoke<string | string[] | null>('open_dialog', {
        options: { directory: true, multiple: false },
      })
      if (typeof path !== 'string') return
      const root = await resolveAgentWorkspaceRoot(path)
      const paths = [
        root.path,
        ...recentPaths().filter((p) => p !== root.path),
      ].slice(0, 10)
      try {
        localStorage.setItem(recentKey, JSON.stringify(paths))
      } catch {
        /* Folder selection does not require persistent browser storage. */
      }
      setRecent(paths)
      onChange(root.path)
    } catch (e) {
      setError(String(e))
    }
  }
  return (
    <div className="space-y-2 text-sm">
      <label htmlFor={id}>
        Workspace{personalWhenEmpty ? ' (blank for personal memory)' : ''}
      </label>
      <div className="flex gap-2">
        <Input
          id={id}
          list={`${id}-recent`}
          value={value}
          placeholder={
            personalWhenEmpty
              ? 'Personal memory — no workspace'
              : 'Default GChat agent workspace'
          }
          onChange={(e) => onChange(e.target.value)}
        />
        <Button type="button" variant="outline" onClick={() => void choose()}>
          Browse
        </Button>
      </div>
      <datalist id={`${id}-recent`}>
        {recent.map((path) => (
          <option key={path} value={path} />
        ))}
      </datalist>
      {resolved && (
        <div className="space-y-2">
          <p className="break-all font-mono text-xs text-muted-foreground">
            {resolved}
          </p>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() =>
                void invoke('open_file_explorer', { path: resolved }).catch(
                  (e) => setError(String(e))
                )
              }
            >
              Open folder
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() =>
                void memoryCommand<{ text: string }>('instructions', {
                  workspace: resolved,
                })
                  .then((r) =>
                    setInstructions(
                      r.text ||
                        'No AGENTS.md file; workspace instructions are optional.'
                    )
                  )
                  .catch((e) => setError(String(e)))
              }
            >
              View AGENTS.md
            </Button>
          </div>
        </div>
      )}
      {error && (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}
      {instructions !== undefined && (
        <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words rounded border p-3 text-xs">
          {instructions}
        </pre>
      )}
    </div>
  )
}

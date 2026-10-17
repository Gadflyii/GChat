import { useEffect, useId, useRef, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { resolveConversationWorkspaceRoot } from '@/services/agent/tauri'
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
  const [readingInstructions, setReadingInstructions] = useState(false)
  const readingInstructionsRef = useRef(false)
  const instructionsGeneration = useRef(0)
  const [choosing, setChoosing] = useState(false)
  const choosingRef = useRef(false)
  const choiceGeneration = useRef(0)
  const mounted = useRef(false)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      choiceGeneration.current += 1
    }
  }, [])
  useEffect(() => {
    choiceGeneration.current += 1
    instructionsGeneration.current += 1
    readingInstructionsRef.current = false
    setReadingInstructions(false)
  }, [value, personalWhenEmpty])
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
      void resolveConversationWorkspaceRoot(value.trim() || undefined)
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
    if (choosingRef.current) return
    choosingRef.current = true
    setChoosing(true)
    setError('')
    const generation = choiceGeneration.current
    const isCurrent = () =>
      mounted.current && generation === choiceGeneration.current
    try {
      const path = await invoke<string | string[] | null>('open_dialog', {
        options: { directory: true, multiple: false },
      })
      if (!isCurrent() || typeof path !== 'string') return
      const root = await resolveConversationWorkspaceRoot(path)
      if (!isCurrent()) return
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
      if (isCurrent()) {
        setError(`Could not choose a folder. Try Browse again. ${String(e)}`)
      }
    } finally {
      choosingRef.current = false
      if (mounted.current) setChoosing(false)
    }
  }
  const readInstructions = async () => {
    if (!resolved || readingInstructionsRef.current) return
    readingInstructionsRef.current = true
    setReadingInstructions(true)
    setInstructions(undefined)
    setError('')
    const generation = instructionsGeneration.current
    const workspaceGeneration = choiceGeneration.current
    const isCurrentRequest = () =>
      mounted.current && generation === instructionsGeneration.current
    const isCurrentWorkspace = () =>
      isCurrentRequest() && workspaceGeneration === choiceGeneration.current
    try {
      const result = await memoryCommand<{ text: string }>('instructions', {
        workspace: resolved,
      })
      if (isCurrentWorkspace()) {
        setInstructions(
          result.text || 'No AGENTS.md file; workspace instructions are optional.'
        )
      }
    } catch (e) {
      if (isCurrentWorkspace()) {
        setError(`Could not read AGENTS.md. Try View AGENTS.md again. ${String(e)}`)
      }
    } finally {
      if (isCurrentRequest()) {
        readingInstructionsRef.current = false
        setReadingInstructions(false)
      }
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
          onChange={(e) => {
            choiceGeneration.current += 1
            onChange(e.target.value)
          }}
        />
        <Button
          type="button"
          variant="outline"
          disabled={choosing}
          aria-busy={choosing}
          onClick={() => void choose()}
        >
          {choosing ? 'Choosing folder…' : 'Browse'}
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
              disabled={readingInstructions}
              aria-busy={readingInstructions}
              onClick={() => void readInstructions()}
            >
              {readingInstructions ? 'Reading AGENTS.md…' : 'View AGENTS.md'}
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

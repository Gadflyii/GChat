import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { Assignment, SavedAssignment } from '@/services/gbot'

interface Props {
  value: Assignment
  saved?: SavedAssignment
  busy: boolean
  computerReady: boolean
  onChange: (value: Assignment) => void
  onSave: () => Promise<void>
}

export function BrainSetup({
  value,
  saved,
  busy,
  computerReady,
  onChange,
  onSave,
}: Props) {
  const [editing, setEditing] = useState(!saved)
  const [error, setError] = useState<string>()
  const valid = Boolean(
    value.api_base.trim() &&
      value.model.trim() &&
      Number.isSafeInteger(value.context_tokens) &&
      value.context_tokens > 0
  )

  if (saved && !editing) {
    return (
      <section aria-label="Bot brain" className="rounded-lg border p-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-medium">Brain configured</h3>
            <p className="text-sm text-muted-foreground">
              {saved.model} · {saved.context_tokens.toLocaleString()} context
              tokens
            </p>
          </div>
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => setEditing(true)}
          >
            Edit brain
          </Button>
        </div>
      </section>
    )
  }

  return (
    <form
      aria-label="Set up bot brain"
      className="space-y-4 rounded-lg border p-3"
      onSubmit={(event) => {
        event.preventDefault()
        if (busy || !valid) return
        setError(undefined)
        void onSave().then(
          () => setEditing(false),
          (reason: unknown) =>
            setError(reason instanceof Error ? reason.message : String(reason))
        )
      }}
    >
      <div>
        <h3 className="text-sm font-medium">
          {saved ? 'Edit bot brain' : 'Next: choose a brain'}
        </h3>
        <p className="mt-1 text-sm text-muted-foreground">
          {computerReady
            ? 'Your bot’s computer is connected. Choose the model that will do its work.'
            : 'Choose a brain now, then connect the bot’s computer before starting a task.'}
        </p>
      </div>
      <fieldset disabled={busy} className="space-y-3">
        <legend className="text-sm font-medium">1. Inference server</legend>
        <p className="text-xs text-muted-foreground">
          Use a GInfer API endpoint that stays running when GChat closes.
          GChat’s local port 1337 API stops when GChat exits.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-sm">
            GInfer API URL
            <Input
              type="url"
              placeholder="http://host:port/v1"
              value={value.api_base}
              onChange={(event) =>
                onChange({ ...value, api_base: event.target.value })
              }
            />
          </label>
          <label className="text-sm">
            API key
            <Input
              type="password"
              autoComplete="off"
              placeholder={
                saved?.credential_ref ? 'Saved in vault' : 'If required'
              }
              value={value.api_key || ''}
              disabled={Boolean(saved?.credential_ref && value.api_key === '')}
              onChange={(event) =>
                onChange({ ...value, api_key: event.target.value || undefined })
              }
            />
          </label>
        </div>
        <p className="text-xs text-muted-foreground">
          {saved?.credential_ref
            ? 'Leave the key blank to keep this bot’s saved key.'
            : 'This bot’s key is stored in the vault.'}
        </p>
        {saved?.credential_ref && (
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={value.api_key === ''}
              onChange={(event) =>
                onChange({
                  ...value,
                  api_key: event.target.checked ? '' : undefined,
                })
              }
            />
            Remove saved API key
          </label>
        )}
      </fieldset>
      <fieldset disabled={busy} className="space-y-3">
        <legend className="text-sm font-medium">2. Model</legend>
        <p className="text-xs text-muted-foreground">
          Enter the model ID and context capacity served by that endpoint. Qwen
          or Muse SMOL with at least 128K context is recommended.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-sm">
            Model ID
            <Input
              value={value.model}
              onChange={(event) =>
                onChange({ ...value, model: event.target.value })
              }
            />
          </label>
          <label className="text-sm">
            Model context tokens
            <Input
              type="number"
              min="1"
              step="1"
              value={value.context_tokens || ''}
              onChange={(event) =>
                onChange({
                  ...value,
                  context_tokens: Number(event.target.value),
                })
              }
            />
          </label>
        </div>
      </fieldset>
      <div className="space-y-2">
        <h4 className="text-sm font-medium">3. Save this bot’s brain</h4>
        <p className="text-xs text-muted-foreground">
          Saving stores these settings. The connection is used when you start a
          task.
        </p>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <Button type="submit" disabled={busy || !valid}>
          {busy ? 'Saving…' : 'Save brain settings'}
        </Button>
      </div>
    </form>
  )
}

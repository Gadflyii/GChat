import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  gbot,
  emptyPairedConnection,
  type Assignment,
  type PairedModel,
  type SavedAssignment,
} from '@/services/gbot'

const modelKey = (item: PairedModel) =>
  `${item.target.host_id}/${item.target.instance_id}/${item.target.session_id}`

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
  const [models, setModels] = useState<PairedModel[]>([])
  const [loading, setLoading] = useState(false)
  const [refresh, setRefresh] = useState(0)
  const paired = value.connection.kind === 'paired_host'
  useEffect(() => {
    if (!editing || !paired) return
    let current = true
    setLoading(true)
    setError(undefined)
    void gbot<PairedModel[]>('assignments/models')
      .then(
        (items) => {
          if (current) setModels(items)
        },
        (reason: unknown) => {
          if (current) {
            setModels([])
            setError(String(reason))
          }
        }
      )
      .finally(() => {
        if (current) setLoading(false)
      })
    return () => {
      current = false
    }
  }, [editing, paired, refresh])
  const connection = value.connection
  const selected =
    connection.kind === 'paired_host'
      ? models.find(
          (item) =>
            item.target.host_id === connection.target.host_id &&
            item.target.instance_id === connection.target.instance_id &&
            item.target.session_id === connection.target.session_id
        )
      : undefined
  const valid = Boolean(
    (connection.kind === 'endpoint'
      ? connection.api_base.trim()
      : selected && !loading) &&
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
        <div className="flex flex-wrap gap-4 text-sm">
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name="brain-connection"
              checked={paired}
              onChange={() =>
                onChange({
                  connection: emptyPairedConnection,
                  model: '',
                  context_tokens: 0,
                })
              }
            />
            Paired GInfer Host
          </label>
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name="brain-connection"
              checked={!paired}
              onChange={() =>
                onChange({
                  connection: { kind: 'endpoint', api_base: '' },
                  model: '',
                  context_tokens: 0,
                })
              }
            />
            API endpoint
          </label>
        </div>
        {paired ? (
          <>
            <div className="flex items-center gap-2">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    aria-label="Ready Host model"
                    disabled={busy || loading || !models.length}
                  >
                    {selected
                      ? `${selected.host_name} · ${selected.model}`
                      : loading
                        ? 'Checking paired hosts…'
                        : 'Choose a ready model'}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent>
                  {models.map((item) => (
                    <DropdownMenuItem
                      key={modelKey(item)}
                      onSelect={() =>
                        onChange({
                          connection: {
                            kind: 'paired_host',
                            target: item.target,
                          },
                          model: item.model,
                          context_tokens: item.context_tokens,
                        })
                      }
                    >
                      {item.host_name} · {item.model} ·{' '}
                      {item.context_tokens.toLocaleString()} context
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
              <Button
                type="button"
                variant="outline"
                disabled={busy || loading}
                onClick={() => setRefresh((count) => count + 1)}
              >
                Refresh hosts
              </Button>
            </div>
            {!loading && !models.length && (
              <p className="text-sm text-muted-foreground">
                No ready models. Pair a host and start a model in GInfer Hosts,
                then refresh.
              </p>
            )}
            {!loading &&
              !selected &&
              connection.kind === 'paired_host' &&
              connection.target.session_id && (
                <p role="status" className="text-sm text-muted-foreground">
                  The saved session is unavailable. Select a ready model again.
                </p>
              )}
            <p className="text-xs text-muted-foreground">
              Gbot uses the paired host while GChat is closed. If that model
              restarts, select its new session here.
            </p>
          </>
        ) : (
          connection.kind === 'endpoint' && (
            <>
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
                    value={connection.api_base}
                    onChange={(event) =>
                      onChange({
                        ...value,
                        connection: {
                          kind: 'endpoint',
                          api_base: event.target.value,
                        },
                      })
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
                    disabled={Boolean(
                      saved?.credential_ref && value.api_key === ''
                    )}
                    onChange={(event) =>
                      onChange({
                        ...value,
                        api_key: event.target.value || undefined,
                      })
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
            </>
          )
        )}
      </fieldset>
      <fieldset disabled={busy} className="space-y-3">
        <legend className="text-sm font-medium">2. Model</legend>
        <p className="text-xs text-muted-foreground">
          {paired
            ? 'Model and served context come from the selected Host instance.'
            : 'Enter the model ID and context capacity served by that endpoint.'}{' '}
          For vision and Gbot, prefer Muse INT if it fits your GPU, or Qwen. Use
          at least 128K context.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-sm">
            Model ID
            <Input
              value={value.model}
              readOnly={paired}
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
              readOnly={paired}
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

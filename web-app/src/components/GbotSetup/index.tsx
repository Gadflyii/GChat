import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import KvmSetup from './KvmSetup'

export type BotConnection = {
  name: string
  hostname: string
  port: string
  user: string
  hostKey: string
  key: string
  passphrase: string
}

const computers = [
  [
    'local',
    'A separate local VM',
    'Create a separate Linux KVM guest with approved local assets. Hyper-V setup remains unfinished.',
  ],
  [
    'lan',
    'Another computer on the LAN',
    'Connect an existing dedicated bot computer or VM with the Cua guest tools.',
  ],
  [
    'cloud',
    'Cloud hosted',
    'Provider creation and cost review are not available yet.',
  ],
  ['m365', 'M365 Cloud PC', 'The Cloud PC connection is not available yet.'],
] as const
const steps = ['Name', 'Computer', 'Connection', 'Review']

export default function GbotSetup({
  save,
  cancel,
  localReady,
}: {
  save: (connection: BotConnection) => Promise<void>
  cancel: () => void
  localReady: (id: string) => Promise<void>
}) {
  const [step, setStep] = useState(0)
  const [computer, setComputer] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [connection, setConnection] = useState<BotConnection>({
    name: '',
    hostname: '',
    port: '22',
    user: '',
    hostKey: '',
    key: '',
    passphrase: '',
  })
  const update = (field: keyof BotConnection, value: string) => {
    setError('')
    setConnection((previous) => ({ ...previous, [field]: value }))
  }
  const port = Number(connection.port)
  const canContinue =
    step === 0
      ? Boolean(connection.name.trim())
      : step === 1
        ? computer === 'lan' || computer === 'local'
        : step === 2
          ? Boolean(
              connection.hostname.trim() &&
                connection.user.trim() &&
                connection.key.trim() &&
                connection.hostKey.trim().split(/\s+/).length >= 2 &&
                Number.isInteger(port) &&
                port > 0 &&
                port <= 65535
            )
          : true
  const submit = async () => {
    if (saving || !canContinue) return
    if (step < 3) {
      setStep(step + 1)
      return
    }
    setSaving(true)
    setError('')
    try {
      await save({
        ...connection,
        name: connection.name.trim(),
        hostname: connection.hostname.trim(),
        user: connection.user.trim(),
        hostKey: connection.hostKey.trim(),
      })
    } catch (cause) {
      setError(String(cause))
    } finally {
      setSaving(false)
    }
  }
  return (
    <form
      aria-label="Set up Gbot"
      className="space-y-4 rounded-lg border p-4"
      onSubmit={(event) => {
        event.preventDefault()
        void submit()
      }}
    >
      <div>
        <h3 className="font-medium">Set up your bot</h3>
        <p className="text-sm text-muted-foreground">
          Step {step + 1} of {computer === 'local' ? 3 : 4} ·{' '}
          {step === 2 && computer === 'local'
            ? 'Review and setup'
            : steps[step]}
        </p>
      </div>
      {step === 0 && (
        <label className="block space-y-1 text-sm">
          Bot name
          <Input
            autoFocus
            required
            value={connection.name}
            onChange={(event) => update('name', event.target.value)}
          />
        </label>
      )}
      {step === 1 && (
        <>
          <fieldset className="space-y-2">
            <legend className="mb-2 text-sm font-medium">
              Where should the Gbot service run?
            </legend>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="service"
                checked
                readOnly
                className="size-4 accent-primary"
              />
              This PC (recommended)
            </label>
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              <input type="radio" name="service" disabled className="size-4" />
              Another PC on the LAN — setup not available yet
            </label>
          </fieldset>
          <fieldset className="space-y-2">
            <legend className="mb-2 text-sm font-medium">
              Where should the bot's computer be?
            </legend>
            {computers.map(([value, label, description]) => (
              <label
                key={value}
                className="flex gap-2 rounded-md border p-3 text-sm"
              >
                <input
                  type="radio"
                  name="computer"
                  value={value}
                  checked={computer === value}
                  onChange={() => setComputer(value)}
                  className="mt-0.5 size-4 shrink-0 accent-primary"
                />
                <span>
                  <span className="font-medium">{label}</span>
                  <span className="mt-1 block text-muted-foreground">
                    {description}
                  </span>
                </span>
              </label>
            ))}
          </fieldset>
          <p className="text-xs text-muted-foreground">
            Use a dedicated computer or VM. The bot must not share your own
            desktop.
          </p>
        </>
      )}
      {step === 2 && computer === 'local' && (
        <KvmSetup name={connection.name} connected={localReady} />
      )}
      {step === 2 && computer === 'lan' && (
        <>
          <p className="text-sm text-muted-foreground">
            Enter the connection details for the prepared bot computer. Verify
            its SSH host public key on that computer.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            {(['hostname', 'port', 'user', 'hostKey'] as const).map((field) => (
              <label key={field} className="space-y-1 text-sm">
                {
                  {
                    hostname: 'SSH host',
                    port: 'SSH port',
                    user: 'SSH user',
                    hostKey: 'SSH host public key',
                  }[field]
                }
                <Input
                  required
                  type={field === 'port' ? 'number' : 'text'}
                  min={field === 'port' ? 1 : undefined}
                  max={field === 'port' ? 65535 : undefined}
                  value={connection[field]}
                  onChange={(event) => update(field, event.target.value)}
                />
              </label>
            ))}
          </div>
          <label className="block space-y-1 text-sm">
            SSH private key
            <textarea
              required
              autoComplete="off"
              className="min-h-24 w-full rounded-md border bg-background p-2 font-mono"
              value={connection.key}
              onChange={(event) => update('key', event.target.value)}
            />
          </label>
          <label className="block space-y-1 text-sm">
            Key passphrase
            <Input
              type="password"
              autoComplete="off"
              value={connection.passphrase}
              onChange={(event) => update('passphrase', event.target.value)}
            />
          </label>
        </>
      )}
      {step === 3 && (
        <>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
            <dt>Bot</dt>
            <dd>{connection.name.trim()}</dd>
            <dt>Service</dt>
            <dd>This PC</dd>
            <dt>Computer</dt>
            <dd>
              {connection.user.trim()}@{connection.hostname.trim()}:{port}
            </dd>
            <dt>SSH host public key</dt>
            <dd className="break-all font-mono">{connection.hostKey.trim()}</dd>
          </dl>
          <p className="text-sm text-muted-foreground">
            Save imports the private key into GChat's vault. No accounts are
            inherited. After saving, connect the computer, assign a brain and
            check its desktop before running a task.
          </p>
        </>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        {!(step === 2 && computer === 'local') && (
          <Button disabled={saving || !canContinue}>
            {saving ? 'Saving…' : step === 3 ? 'Save bot' : 'Continue'}
          </Button>
        )}
        {step > 0 && (
          <Button
            type="button"
            variant="outline"
            disabled={saving}
            onClick={() => {
              setError('')
              setStep(step - 1)
            }}
          >
            Back
          </Button>
        )}
        <Button
          type="button"
          variant="ghost"
          disabled={saving}
          onClick={cancel}
        >
          Cancel
        </Button>
      </div>
    </form>
  )
}

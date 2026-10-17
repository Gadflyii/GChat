import { useCallback, useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useBundledResources } from '@/hooks/useBundledResources'
import { useEngineHosts } from '@/stores/engine-hosts-store'
import KvmSetup from './KvmSetup'
import LanSetup from './LanSetup'
import CloudSetup from './CloudSetup'
import M365Setup from './M365Setup'
import ServiceSetup from './ServiceSetup'
import {
  getGbotServiceTarget,
  selectGbotService,
  type ServiceTarget,
} from '@/services/gbot'
import type {
  CloudReview,
  GuidedCloudComputer,
  M365SetupRecord,
  Workspace,
} from '@/services/gbot'

export type BotConnection = {
  name: string
  hostname: string
  port: string
  user: string
  hostKey: string
  key: string
  passphrase: string
  workspaceId?: string
  cloud?: GuidedCloudComputer
}

export type SetupResume = {
  id: string
  name: string
  connection?: Workspace['connection']
  cloud?: CloudReview
  bot_pc?: Workspace['bot_pc']
  m365?: M365SetupRecord
}

const computers = [
  [
    'local',
    'A separate local VM',
    'Create a separate Linux desktop inside this computer using KVM. Requires Linux and the prepared setup files; Windows Hyper-V setup is not available yet.',
  ],
  [
    'lan',
    'Another computer on the LAN',
    'Connect a separate computer or virtual machine on your home or office network. It needs SSH access and Gbot desktop tools.',
  ],
  [
    'cloud',
    'Cloud hosted',
    'Rent a separate computer from Hetzner or DigitalOcean, or connect one you created in Azure, AWS or Google Cloud. Your provider bills you separately.',
  ],
  [
    'm365',
    'M365 Cloud PC',
    'Prepare a Windows 365 Cloud PC assigned to your work or school account. Desktop control is not available yet; this saves the connection setup.',
  ],
] as const
const steps = ['Name', 'Service', 'Computer', 'Connection', 'Review']

export default function GbotSetup({
  save,
  cancel,
  localReady,
  cloudReviewed = async () => {},
  m365Saved = async () => {},
  resume,
}: {
  save: (connection: BotConnection) => Promise<void>
  cancel: () => void
  localReady: (id: string) => Promise<void>
  cloudReviewed?: () => Promise<void>
  m365Saved?: () => Promise<void>
  resume?: SetupResume
}) {
  const [step, setStep] = useState(resume ? 3 : 0)
  const [computer, setComputer] = useState(
    resume?.m365
      ? 'm365'
      : resume?.cloud || resume?.bot_pc?.kind === 'cloud'
        ? 'cloud'
        : resume?.connection
          ? 'lan'
          : resume
            ? 'local'
            : ''
  )
  const [saving, setSaving] = useState(false)
  const submissionPending = useRef(false)
  const [error, setError] = useState('')
  const [lanReady, setLanReady] = useState(false)
  const [connecting, setConnecting] = useState(false)
  const [service, setService] = useState<ServiceTarget>({ kind: 'local' })
  const [serviceReady, setServiceReady] = useState(false)
  const serviceChoiceVersion = useRef(0)
  const hosts = useEngineHosts((state) => state.hosts)
  const serviceName =
    service.kind === 'local'
      ? 'This PC'
      : hosts.find((host) => host.host_id === service.host_id)?.name ||
        'Paired service computer (unavailable)'
  const resources = useBundledResources()
  const preparingService = step === 1 && saving && resources.ready !== true
  useEffect(() => {
    let current = true
    const version = serviceChoiceVersion.current
    void getGbotServiceTarget()
      .then((target) => {
        if (current && serviceChoiceVersion.current === version) {
          setService(target)
          setServiceReady(target.kind === 'local')
        }
      })
      .catch((cause) => {
        if (current && serviceChoiceVersion.current === version)
          setError(String(cause))
      })
    return () => {
      current = false
    }
  }, [])
  const changeService = useCallback((target: ServiceTarget, ready: boolean) => {
    if (submissionPending.current) return
    ++serviceChoiceVersion.current
    setService(target)
    setServiceReady(ready)
  }, [])
  const [connection, setConnection] = useState<BotConnection>({
    name: resume?.name ?? '',
    hostname: resume?.connection?.endpoint?.hostname ?? '',
    port: String(resume?.connection?.endpoint?.port ?? 22),
    user: resume?.connection?.endpoint?.user ?? '',
    hostKey: resume?.connection?.pinned_host_key
      ? `${resume.connection.pinned_host_key.algorithm} ${resume.connection.pinned_host_key.public_key}`
      : '',
    key: '',
    passphrase: '',
    ...(resume?.connection ? { workspaceId: resume.id } : {}),
    ...(resume?.bot_pc?.kind === 'cloud' &&
    ['azure', 'aws', 'gcp'].includes(resume.bot_pc.provider ?? '')
      ? { cloud: resume.bot_pc as GuidedCloudComputer }
      : {}),
  })
  const guidedCloud = computer === 'cloud' && Boolean(connection.cloud)
  const update = (field: keyof BotConnection, value: string) => {
    setError('')
    setConnection((previous) => ({ ...previous, [field]: value }))
  }
  const canContinue =
    step === 0
      ? Boolean(connection.name.trim())
      : step === 1
        ? serviceReady && !resources.error
        : step === 2
          ? ['lan', 'local', 'cloud', 'm365'].includes(computer)
          : step === 3
            ? (computer === 'lan' || guidedCloud) && lanReady
            : true
  const submit = async () => {
    if (submissionPending.current || saving || connecting || !canContinue)
      return
    if (step === 1) {
      submissionPending.current = true
      setSaving(true)
      setError('')
      try {
        await selectGbotService(service)
        setStep(2)
      } catch (cause) {
        setError(String(cause))
      } finally {
        submissionPending.current = false
        setSaving(false)
      }
      return
    }
    if (step < 4) {
      setStep(step + 1)
      return
    }
    submissionPending.current = true
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
      submissionPending.current = false
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
          Step {step + 1} of{' '}
          {['local', 'cloud', 'm365'].includes(computer) && !guidedCloud
            ? 4
            : 5}{' '}
          ·{' '}
          {step === 3 && computer === 'local'
            ? 'Review and setup'
            : step === 3 && computer === 'cloud' && !guidedCloud
              ? 'Create and connect'
              : step === 3 && computer === 'm365'
                ? 'Prepare your Cloud PC connection'
                : steps[step]}
        </p>
      </div>
      {step === 0 && (
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">
            Give your bot a name so you can recognize its computer, tasks and
            schedules later. You will choose its computer and model next.
          </p>
          <label className="block space-y-1 text-sm">
            Bot name
            <Input
              autoFocus
              required
              value={connection.name}
              onChange={(event) => update('name', event.target.value)}
            />
          </label>
        </div>
      )}
      {step === 1 && (
        <fieldset disabled={saving} aria-label="Gbot service selection">
          <ServiceSetup target={service} change={changeService} />
        </fieldset>
      )}
      {step === 2 && (
        <>
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
                  onChange={() => {
                    setComputer(value)
                    setLanReady(false)
                    setConnection((previous) => ({
                      ...previous,
                      cloud: undefined,
                    }))
                  }}
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
            Give the bot its own desktop to keep its actions separate from your
            personal work. A virtual machine (VM) is a separate computer running
            inside another computer.
          </p>
        </>
      )}
      {step === 3 && computer === 'local' && (
        <KvmSetup
          name={connection.name}
          initialId={resume?.id}
          connected={localReady}
        />
      )}
      {step === 3 && computer === 'lan' && (
        <LanSetup
          connection={connection}
          change={setConnection}
          ready={setLanReady}
          busy={setConnecting}
        />
      )}
      {step === 3 && computer === 'cloud' && (
        <CloudSetup
          name={connection.name}
          initial={resume?.cloud}
          connection={connection}
          change={setConnection}
          ready={setLanReady}
          busy={setConnecting}
          reviewed={cloudReviewed}
          connected={localReady}
        />
      )}
      {step === 3 && computer === 'm365' && (
        <M365Setup
          name={connection.name}
          initial={resume?.m365}
          busy={setConnecting}
          saved={m365Saved}
        />
      )}
      {step === 4 && (
        <>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
            <dt>Bot</dt>
            <dd>{connection.name.trim()}</dd>
            <dt>Service</dt>
            <dd>{serviceName}</dd>
            <dt>Computer</dt>
            <dd>
              {connection.user.trim()}@{connection.hostname.trim()}:
              {Number(connection.port)}
            </dd>
            {connection.cloud && (
              <>
                <dt>Cloud VM</dt>
                <dd>
                  {connection.cloud.provider} · {connection.cloud.resource_id}
                </dd>
              </>
            )}
            <dt>SSH host public key</dt>
            <dd className="break-all font-mono">{connection.hostKey.trim()}</dd>
          </dl>
          <p className="text-sm text-muted-foreground">
            {connection.workspaceId
              ? 'The secure connection key is saved in GChat’s protected storage and SSH access is verified.'
              : 'Save protects the private connection key in GChat’s secure storage.'}{' '}
            The bot can only use accounts you explicitly link to it. Next,
            connect the computer, follow “Choose a brain” to select its model,
            and check its desktop before running a task.
          </p>
        </>
      )}
      {step === 1 && saving && !resources.error && (
        <div role="status" className="space-y-1 text-sm text-muted-foreground">
          <p>
            {preparingService
              ? 'Preparing and validating bundled resources…'
              : 'Selecting Gbot service…'}
          </p>
          {preparingService && (
            <p>
              This can take a few minutes. You can keep using other parts of
              GChat while preparation continues.
            </p>
          )}
        </div>
      )}
      {step === 1 && resources.error && (
        <div role="alert" className="space-y-1 text-sm text-destructive">
          <p>{resources.error}</p>
          <p>Restart GChat to try resource preparation again.</p>
        </div>
      )}
      {step === 4 && saving && (
        <p role="status" className="text-sm text-muted-foreground">
          Saving {connection.name.trim()} and its computer connection…
        </p>
      )}
      {error && !(step === 1 && error === resources.error) && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        {!(
          step === 3 &&
          ['local', 'cloud', 'm365'].includes(computer) &&
          !guidedCloud
        ) && (
          <Button disabled={saving || connecting || !canContinue}>
            {saving
              ? step === 1
                ? preparingService
                  ? 'Preparing resources…'
                  : 'Selecting service…'
                : 'Saving…'
              : step === 4
                ? 'Save bot'
                : 'Continue'}
          </Button>
        )}
        {step > 0 && !resume && !connection.workspaceId && (
          <Button
            type="button"
            variant="outline"
            disabled={saving || connecting}
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
          disabled={saving || connecting}
          onClick={cancel}
        >
          {connection.workspaceId || (step === 3 && computer === 'm365')
            ? 'Finish later'
            : 'Cancel'}
        </Button>
      </div>
    </form>
  )
}

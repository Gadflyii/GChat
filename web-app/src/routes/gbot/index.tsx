import { GbotTaskFiles } from '@/components/GbotTaskFiles'
import { ReadAloud, VoiceInput } from '@/components/GbotVoice'
import { useCallback, useEffect, useRef, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { listen } from '@tauri-apps/api/event'
import { toast } from 'sonner'
import { confirmAction } from '@/lib/confirm'
import HeaderPage from '@/containers/HeaderPage'
import GbotAvatar from '@/components/GbotAvatar'
import GbotTaskActions from '@/components/GbotTaskActions'
import GbotTaskInterruption from '@/components/GbotTaskInterruption'
import HumanHelp from '@/components/GbotHumanHelp'
import GbotTaskApproval from '@/components/GbotTaskApproval'
import { GbotSubAgents } from '@/components/GbotSubAgents'
import { gbotTopLevelTasks } from '@/lib/gbot-sub-agents'
import { useGbotCompanion } from '@/stores/gbot-companion-store'
import GbotLanBot from '@/components/GbotLanBot'
import GbotConnectors from '@/components/GbotConnectors'
import GbotSchedules from '@/components/GbotSchedules'
import GbotSetup, {
  type BotConnection,
  type SetupResume,
} from '@/components/GbotSetup'
import { BrainSetup } from '@/components/GbotSetup/BrainSetup'
import ServiceSetup from '@/components/GbotSetup/ServiceSetup'
import { CloudDeploymentIssue } from '@/components/GbotSetup/CloudComputer'
import { useGeneralSetting } from '@/hooks/useGeneralSetting'
import GbotDesktopView, {
  type DesktopViewHandle,
} from '@/components/GbotDesktopView'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  gbot,
  gbotControlOwner,
  messageText,
  quitGbotService,
  startGbotService,
  getGbotServiceTarget,
  selectGbotService,
  type ServiceTarget,
  type Approval,
  type Assignment,
  emptyPairedConnection,
  validBrainConnection,
  type BotState,
  type Identity,
  type KvmSetupRecord,
  type CloudReview,
  type M365SetupRecord,
  type Task,
} from '@/services/gbot'

export const Route = createFileRoute('/gbot/')({ component: GbotPage })

function GbotPage() {
  const mounted = useRef(false)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])
  const [state, setState] = useState<BotState>()
  const [tasks, setTasks] = useState<Task[]>([])
  const [approvals, setApprovals] = useState<Approval[]>([])
  const [selected, setSelected] = useState('')
  const [owner] = useState(gbotControlOwner)
  const desktop = useRef<DesktopViewHandle>(null)
  const [operationBusy, setBusy] = useState(false)
  const [serviceAction, setServiceAction] = useState<
    'starting' | 'connecting' | 'stopping' | 'disconnecting'
  >()
  const busy = operationBusy || Boolean(serviceAction)
  const [recoveryConfirmation, setRecoveryConfirmation] = useState('')
  const [serviceStopped, setServiceStopped] = useState(false)
  const [serviceTarget, setServiceTarget] = useState<ServiceTarget>({
    kind: 'local',
  })
  const [choosingService, setChoosingService] = useState(false)
  const [serviceDraft, setServiceDraft] = useState<ServiceTarget>({
    kind: 'local',
  })
  const [serviceReady, setServiceReady] = useState(false)
  const [serviceError, setServiceError] = useState('')
  const serviceChange = useRef(false)
  const [serviceActionErrors, setServiceActionErrors] = useState<
    Record<string, { message: string; details: string } | undefined>
  >({})
  const serviceActionErrorKey = JSON.stringify(serviceTarget)
  const serviceActionError = serviceActionErrors[serviceActionErrorKey]
  const serviceSelectionPending = useRef(false)
  const changeServiceDraft = useCallback(
    (target: ServiceTarget, ready: boolean) => {
      if (serviceSelectionPending.current) return
      setServiceDraft(target)
      setServiceReady(ready)
    },
    []
  )
  const stopped = useRef(false)
  const [error, setError] = useState('')
  const [executorError, setExecutorError] = useState('')
  const [loadingTasks, setLoadingTasks] = useState(false)
  const taskHistoryRetry = useRef(false)
  const [adding, setAdding] = useState(false)
  const [resuming, setResuming] = useState<SetupResume>()
  const [setups, setSetups] = useState<KvmSetupRecord[]>()
  const [cloudReviews, setCloudReviews] = useState<CloudReview[]>([])
  const [m365Setups, setM365Setups] = useState<M365SetupRecord[]>([])
  const [setupError, setSetupError] = useState('')
  const [prompts, setPrompts] = useState<Record<string, string>>({})
  const [submittingTask, setSubmittingTask] = useState<string>()
  const [taskErrors, setTaskErrors] = useState<Record<string, string | undefined>>(
    {}
  )
  const taskSubmission = useRef(false)
  const controlChange = useRef(false)
  const [controlErrors, setControlErrors] = useState<
    Record<string, { returning: boolean; details: string } | undefined>
  >({})
  const [recoveryErrors, setRecoveryErrors] = useState<
    Record<string, string | undefined>
  >({})
  const connectionChange = useRef(false)
  const localVmChange = useRef(false)
  const [localVmAction, setLocalVmAction] = useState<{
    id: string
    kind: 'start' | 'stop'
  }>()
  const [localVmErrors, setLocalVmErrors] = useState<
    Record<string, { kind: 'start' | 'stop'; details: string } | undefined>
  >({})
  const [connectionErrors, setConnectionErrors] = useState<
    Record<string, { disconnecting: boolean; details: string } | undefined>
  >({})
  const [assignments, setAssignments] = useState<Record<string, Assignment>>({})
  const gbotEnabled = useGeneralSetting((state) => state.gbotEnabled)
  const setGbotEnabled = useGeneralSetting((state) => state.setGbotEnabled)
  const setupOffered = useRef(false)
  const setupIdentity = useRef<{ id: string; computerId: string } | null>(null)
  const refreshVersion = useRef(0)
  const refresh = useCallback(async () => {
    if (stopped.current) return
    const version = ++refreshVersion.current
    try {
      const target = await getGbotServiceTarget()
      if (stopped.current || version !== refreshVersion.current) return
      setServiceTarget(target)
      const value = await gbot<BotState>('state')
      if (stopped.current || version !== refreshVersion.current) return
      setState(value)
      setSetupError('')
      let kvm: KvmSetupRecord[] | undefined
      let cloud: CloudReview[] | undefined
      let m365: M365SetupRecord[] | undefined
      try {
        const saved = await gbot<CloudReview[]>('setup/cloud/status', {})
        if (stopped.current || version !== refreshVersion.current) return
        cloud = Array.isArray(saved) ? saved : []
        setCloudReviews(cloud)
      } catch (cause) {
        if (stopped.current || version !== refreshVersion.current) return
        setSetupError(String(cause))
      }
      try {
        const saved = await gbot<M365SetupRecord[]>('setup/m365/status', {})
        if (stopped.current || version !== refreshVersion.current) return
        m365 = Array.isArray(saved) ? saved : []
        setM365Setups(m365)
      } catch (cause) {
        if (stopped.current || version !== refreshVersion.current) return
        setSetupError(String(cause))
      }
      try {
        const records = await gbot<KvmSetupRecord[]>(
          'setup/local-vm/status',
          {}
        )
        if (stopped.current || version !== refreshVersion.current) return
        kvm = Array.isArray(records) ? records : []
        setSetups(kvm)
      } catch (cause) {
        if (stopped.current || version !== refreshVersion.current) return
        setSetups(undefined)
        setSetupError(String(cause))
      }
      if (
        !setupOffered.current &&
        kvm !== undefined &&
        cloud !== undefined &&
        m365 !== undefined
      ) {
        setupOffered.current = true
        if (
          !value.workspaces.length &&
          !cloud.length &&
          !m365.length &&
          !kvm.some((record) => record.stage !== 'removed')
        )
          setAdding(true)
      }
      setError('')
      try {
        const [history, pending] = await Promise.all([
          gbot<Task[]>('tasks'),
          gbot<Approval[]>('tasks/approvals'),
        ])
        if (stopped.current || version !== refreshVersion.current) return
        setTasks(history)
        setApprovals(pending)
        setExecutorError('')
      } catch (cause) {
        if (stopped.current || version !== refreshVersion.current) return
        setExecutorError(String(cause))
      }
    } catch (cause) {
      if (stopped.current || version !== refreshVersion.current) return
      setSetups(undefined)
      setError(String(cause))
    } finally {
      if (!stopped.current && version === refreshVersion.current)
        void useGbotCompanion.getState().refresh()
    }
  }, [])
  const retryTaskHistory = async () => {
    if (busy || taskHistoryRetry.current) return
    taskHistoryRetry.current = true
    setLoadingTasks(true)
    try {
      await refresh()
    } finally {
      taskHistoryRetry.current = false
      if (mounted.current) setLoadingTasks(false)
    }
  }
  useEffect(() => {
    if (!gbotEnabled || serviceStopped) return
    void refresh()
    const subscriptions = [
      listen('gbot-task-update', () => void refresh()),
      listen('gbot-setup-update', () => void refresh()),
    ]
    return () => {
      subscriptions.forEach((subscription) => {
        void subscription.then((stop) => stop())
      })
    }
  }, [refresh, gbotEnabled, serviceStopped])
  const changeService = async (start: boolean) => {
    if (busy || serviceChange.current) return
    serviceChange.current = true
    const key = serviceActionErrorKey
    setServiceActionErrors((previous) => ({ ...previous, [key]: undefined }))
    const paired = serviceTarget.kind === 'paired_host'
    const action = start
      ? paired
        ? 'connecting'
        : 'starting'
      : paired
        ? 'disconnecting'
        : 'stopping'
    setServiceAction(action)
    try {
      if (start) {
        await startGbotService()
        stopped.current = false
        setServiceStopped(false)
        await refresh()
      } else {
        stopped.current = true
        await quitGbotService()
        setServiceStopped(true)
      }
    } catch (cause) {
      if (!start) stopped.current = false
      setServiceActionErrors((previous) => ({
        ...previous,
        [key]: {
          message: {
            starting:
              'Could not start Gbot on this computer. Try Start Gbot service again.',
            connecting:
              'Could not connect to the Gbot service on your LAN computer. Try Connect Gbot service again.',
            stopping:
              'Could not stop Gbot on this computer. Try Quit Gbot service again.',
            disconnecting:
              'Could not disconnect from the Gbot service on your LAN computer. Try Disconnect Gbot service again.',
          }[action],
          details: cause instanceof Error ? cause.message : String(cause),
        },
      }))
    } finally {
      serviceChange.current = false
      setServiceAction(undefined)
      void useGbotCompanion.getState().refresh()
    }
  }
  const chooseService = async () => {
    if (busy || serviceSelectionPending.current || !serviceReady) return
    serviceSelectionPending.current = true
    setBusy(true)
    setServiceError('')
    try {
      await selectGbotService(serviceDraft)
      refreshVersion.current += 1
      setServiceTarget(serviceDraft)
      setChoosingService(false)
      setState(undefined)
      setSetups(undefined)
      setTasks([])
      setApprovals([])
      setSelected('')
      setPrompts({})
      setAssignments({})
      setCloudReviews([])
      setM365Setups([])
      setAdding(false)
      setResuming(undefined)
      setupIdentity.current = null
      setupOffered.current = false
      stopped.current = false
      setServiceStopped(false)
      await refresh()
    } catch (cause) {
      setServiceError(String(cause))
    } finally {
      serviceSelectionPending.current = false
      setBusy(false)
    }
  }
  const perform = async (
    action: () => Promise<unknown>,
    propagateError = false
  ) => {
    if (busy) return
    setBusy(true)
    try {
      await action()
    } catch (cause) {
      if (propagateError) throw cause
      toast.error(String(cause))
    } finally {
      try {
        await refresh()
      } finally {
        setBusy(false)
      }
    }
  }
  const removeCloudSetup = async (review: CloudReview) => {
    if (busy) return
    const accepted = await confirmAction({
      title: `Remove ${review.name}’s saved cloud setup?`,
      message:
        'This removes the saved setup, its cloud provider access key and any saved SSH connection key from GChat. You’ll need to enter your access key again to restart setup.',
      confirmLabel: 'Remove saved setup',
      destructive: true,
    })
    if (accepted && mounted.current)
      await perform(() => gbot('setup/cloud/remove', { id: review.id }))
  }
  const removeM365Setup = async (record: M365SetupRecord) => {
    if (busy) return
    const accepted = await confirmAction({
      title: `Remove ${record.name}’s saved Cloud PC setup?`,
      message:
        'This removes this saved setup from GChat. Your Microsoft account and Cloud PC are kept. You’ll need to choose them again to restart setup.',
      confirmLabel: 'Remove saved Cloud PC setup',
      destructive: true,
    })
    if (accepted && mounted.current)
      await perform(() => gbot('setup/m365/remove', { id: record.id }))
  }
  const workspaceId = selected || state?.workspaces[0]?.id
  const prompt = prompts[workspaceId || ''] || ''
  const bot = state?.workspaces.find(
    (workspace) => workspace.id === workspaceId
  )
  const unfinishedSetups = setups?.filter(
    (record) =>
      record.stage !== 'removed' &&
      !state?.workspaces.some((workspace) => workspace.id === record.id)
  )
  const identity = state?.live_sessions.find(
    (session) => session.workspace_id === workspaceId
  )
  const control = state?.controls.find(
    (value) => value.identity.workspace_id === workspaceId
  )
  const history = tasks.filter(
    (task) => task.identity.workspace_id === workspaceId
  )
  const savedAssignment = state?.assignments?.find(
    (value) => value.workspace_id === workspaceId
  )
  const draft = assignments[workspaceId || '']
  const assignment = draft ||
    savedAssignment || {
      connection: emptyPairedConnection,
      model: '',
      context_tokens: 0,
    }
  const setAssignment = (value: Assignment) => {
    if (workspaceId)
      setAssignments((previous) => ({ ...previous, [workspaceId]: value }))
  }
  const discardAssignment = () => {
    if (!workspaceId) return
    setAssignments((previous) => {
      const next = { ...previous }
      delete next[workspaceId]
      return next
    })
  }
  const isLocalVm =
    bot?.bot_pc?.kind === 'local_vm' &&
    ['kvm', 'hyper_v'].includes(bot.bot_pc.hypervisor ?? '')
  const setup = isLocalVm
    ? setups?.find((record) => record.id === bot.id)
    : undefined
  const setupBlocked = Boolean(
    isLocalVm && (setups === undefined || (setup && setup.stage !== 'ready'))
  )
  const renderLocalVmError = (record?: KvmSetupRecord) => {
    const failure = localVmErrors[JSON.stringify([serviceTarget, record?.id])]
    if (
      !failure ||
      (failure.kind === 'start'
        ? record?.stage === 'ready'
        : record?.stage === 'stopped')
    )
      return null
    const recovery =
      record?.stage === 'stopped'
        ? 'Start computer'
        : record?.stage === 'ready' || record?.stage === 'stopping_computer'
          ? 'Stop computer'
          : 'Resume setup'
    return (
      <div role="alert" className="space-y-1 text-sm">
        <p>
          Could not {failure.kind} this computer. Choose {recovery} to try again.
        </p>
        <details className="text-muted-foreground">
          <summary>Details</summary>
          <p className="whitespace-pre-wrap break-words">{failure.details}</p>
        </details>
      </div>
    )
  }
  const changeLocalVm = async (
    kind: 'start' | 'stop',
    record: KvmSetupRecord
  ) => {
    if (busy || localVmChange.current) return
    localVmChange.current = true
    setBusy(true)
    setLocalVmAction({ id: record.id, kind })
    const key = JSON.stringify([serviceTarget, record.id])
    setLocalVmErrors((previous) => ({
      ...previous,
      [key]: undefined,
    }))
    try {
      await gbot(
        `setup/local-vm/${kind}`,
        kind === 'start'
          ? { id: record.id, name: record.name }
          : { id: record.id }
      )
    } catch (cause) {
      setLocalVmErrors((previous) => ({
        ...previous,
        [key]: {
          kind,
          details: cause instanceof Error ? cause.message : String(cause),
        },
      }))
    } finally {
      try {
        await refresh()
      } finally {
        localVmChange.current = false
        setLocalVmAction(undefined)
        setBusy(false)
      }
    }
  }
  const canHandBackDuringSetup = Boolean(
    setupBlocked &&
      setup &&
      identity &&
      setup.identity?.workspace_id === identity.workspace_id &&
      setup.identity.session_id === identity.session_id &&
      control?.identity.workspace_id === identity.workspace_id &&
      control.identity.session_id === identity.session_id &&
      (control.state === 'human' || control.state === 'paused') &&
      control.owner === owner
  )
  const recoverableControl =
    serviceTarget.kind === 'local' &&
    control?.state === 'paused' &&
    control.owner &&
    control.owner !== owner
      ? state?.recoverable_controls?.find(
          (value) =>
            value.state === 'paused' &&
            value.owner === control.owner &&
            value.identity.workspace_id === control.identity.workspace_id &&
            value.identity.session_id === control.identity.session_id
        )
      : undefined
  const recoveryKey = recoverableControl
    ? `${recoverableControl.identity.workspace_id}:${recoverableControl.identity.session_id}:${recoverableControl.owner}`
    : ''
  const recoveryErrorKey = JSON.stringify([serviceTarget, recoveryKey])
  const recoveryError = recoveryErrors[recoveryErrorKey]
  const controlErrorKey = JSON.stringify([
    serviceTarget,
    identity?.workspace_id,
    identity?.session_id,
  ])
  const controlError = controlErrors[controlErrorKey]
  const connectionErrorKey = JSON.stringify([
    serviceTarget,
    workspaceId,
    identity?.session_id,
  ])
  const connectionError = connectionErrors[connectionErrorKey]
  const changeConnection = () => {
    if (busy || connectionChange.current || !bot || setupBlocked) return
    connectionChange.current = true
    const key = connectionErrorKey
    const disconnecting = Boolean(identity)
    setConnectionErrors((previous) => ({ ...previous, [key]: undefined }))
    void perform(
      () =>
        gbot(
          disconnecting ? 'disconnect' : 'connect',
          identity ||
            (control && control.state !== 'bot'
              ? control.identity
              : {
                  workspace_id: bot.id,
                  session_id: crypto.randomUUID(),
                })
        ),
      true
    )
      .catch((cause) =>
        setConnectionErrors((previous) => ({
          ...previous,
          [key]: {
            disconnecting,
            details: cause instanceof Error ? cause.message : String(cause),
          },
        }))
      )
      .finally(() => {
        connectionChange.current = false
      })
  }
  const recoverControl = () => {
    if (
      busy ||
      controlChange.current ||
      !recoverableControl ||
      recoveryConfirmation !== recoveryKey
    )
      return
    controlChange.current = true
    const key = recoveryErrorKey
    setRecoveryErrors((previous) => ({ ...previous, [key]: undefined }))
    void perform(
      async () => {
        await gbot('control/recover', {
          identity: recoverableControl.identity,
          expected_owner: recoverableControl.owner,
          owner,
        })
        setRecoveryConfirmation('')
      },
      true
    )
      .catch((cause) =>
        setRecoveryErrors((previous) => ({
          ...previous,
          [key]: cause instanceof Error ? cause.message : String(cause),
        }))
      )
      .finally(() => {
        controlChange.current = false
      })
  }
  const changeControl = () => {
    if (
      busy ||
      controlChange.current ||
      !identity ||
      (setupBlocked && !canHandBackDuringSetup)
    )
      return
    controlChange.current = true
    const key = controlErrorKey
    const returning = control?.state === 'human' || control?.state === 'paused'
    setControlErrors((previous) => ({ ...previous, [key]: undefined }))
    if (returning) desktop.current?.stopInput()
    void perform(
      () =>
        gbot(returning ? 'control/hand-back' : 'control/take-over', {
          identity,
          owner,
        }),
      true
    )
      .catch((cause) =>
        setControlErrors((previous) => ({
          ...previous,
          [key]: {
            returning,
            details: cause instanceof Error ? cause.message : String(cause),
          },
        }))
      )
      .finally(() => {
        controlChange.current = false
      })
  }
  const botHasControl = !control || control.state === 'bot'
  const ready = Boolean(
    identity &&
      !setupBlocked &&
      !executorError &&
      !draft &&
      savedAssignment &&
      validBrainConnection(savedAssignment.connection) &&
      savedAssignment.model.trim() &&
      savedAssignment.context_tokens > 0
  )
  const taskGuidance = (() => {
    if (submittingTask === workspaceId) return 'Sending this task to the bot…'
    if (busy)
      return 'Wait for the current operation to finish before running a task.'
    if (setupBlocked) {
      if (canHandBackDuringSetup)
        return 'Choose Hand back, then Resume setup before running a task.'
      if (!botHasControl)
        return 'Setup is incomplete and this bot is paused. Its control owner must hand back control before setup can continue.'
      return setups === undefined
        ? 'Wait for setup status before running a task.'
        : 'Finish this bot’s setup with Resume setup before running a task.'
    }
    if (executorError)
      return 'Choose Retry loading tasks above before running a task.'
    if (!identity) return 'Connect this bot’s computer before running a task.'
    if (!botHasControl) {
      const ownsCurrentControl =
        control?.owner === owner &&
        control.identity.session_id === identity.session_id
      return ownsCurrentControl
        ? 'This bot is paused while you have control. Choose Hand back before running a task.'
        : 'This bot is paused under another session’s control. Its owner must hand back control before a task can run.'
    }
    if (draft) return 'Save the brain settings above before running a task.'
    if (!ready)
      return savedAssignment
        ? 'The saved brain settings are incomplete or invalid. Edit the brain settings above and save a valid connection, model and context limit.'
        : 'Configure and save a brain above before running a task.'
    return prompt.trim()
      ? 'Ready to run this task.'
      : 'Enter a task, then choose Run.'
  })()
  const taskErrorKey = JSON.stringify([serviceTarget, workspaceId])
  const taskError = taskErrors[taskErrorKey]
  const add = async (connection: BotConnection) => {
    if (connection.workspaceId) {
      setSelected(connection.workspaceId)
      setAdding(false)
      setResuming(undefined)
      await refresh()
      return
    }
    const [algorithm, publicKey] = connection.hostKey.trim().split(/\s+/)
    if (!algorithm || !publicKey)
      throw new Error('Enter the dedicated computer’s SSH host public key')
    const identity = setupIdentity.current || {
      id: crypto.randomUUID(),
      computerId: crypto.randomUUID(),
    }
    setupIdentity.current = identity
    const created = await gbot<{ id: string }>('workspaces/ssh', {
      id: identity.id,
      name: connection.name,
      service_pc: { kind: 'local' },
      bot_pc: connection.cloud ?? {
        kind: 'lan',
        computer_id: identity.computerId,
      },
      endpoint: {
        hostname: connection.hostname,
        port: Number(connection.port),
        user: connection.user,
      },
      pinned_host_key: { algorithm, public_key: publicKey },
      private_key: connection.key,
      passphrase: connection.passphrase || null,
    })
    setupIdentity.current = null
    setSelected(created.id)
    setAdding(false)
    await refresh()
  }
  if (!gbotEnabled)
    return (
      <div className="flex h-full flex-col">
        <HeaderPage>Gbot</HeaderPage>
        <div className="space-y-3 p-5">
          <p>Enable Gbot to set up your bot's separate computer workspace.</p>
          <Button onClick={() => setGbotEnabled(true)}>Enable Gbot</Button>
        </div>
      </div>
    )
  return (
    <div className="flex h-full flex-col overflow-hidden">
      <HeaderPage>
        <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 pr-4">
          <span className="truncate">Gbot</span>
          <div className="flex items-center justify-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => {
                setServiceDraft(serviceTarget)
                setServiceReady(serviceTarget.kind === 'local')
                setServiceError('')
                setChoosingService(true)
              }}
            >
              Service computer
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={busy}
              aria-describedby={
                serviceActionError ? 'gbot-service-action-error' : undefined
              }
              onClick={() =>
                void changeService(serviceStopped || Boolean(error))
              }
            >
              {serviceAction
                ? {
                    starting: 'Starting Gbot service…',
                    connecting: 'Connecting Gbot service…',
                    stopping: 'Stopping Gbot service…',
                    disconnecting: 'Disconnecting Gbot service…',
                  }[serviceAction]
                : serviceTarget.kind === 'paired_host'
                  ? serviceStopped || error
                    ? 'Connect Gbot service'
                    : 'Disconnect Gbot service'
                  : serviceStopped || error
                    ? 'Start Gbot service'
                    : 'Quit Gbot service'}
            </Button>
          </div>
        </div>
      </HeaderPage>
      {serviceAction && (
        <p role="status" className="border-b px-5 py-3 text-sm">
          {
            {
              starting:
                'Starting Gbot on this computer. First-time setup or an update may need several minutes to prepare files. The service will start automatically when preparation finishes. You can keep using GChat.',
              connecting:
                'Connecting to the Gbot service on your selected LAN computer. Please wait.',
              stopping:
                'Stopping the Gbot service. Unfinished tasks will stop. After restarting, review them before choosing Resume. Check Scheduled tasks for schedules that need review.',
              disconnecting:
                'Disconnecting from the LAN Gbot service. Tasks and schedules continue on that computer.',
            }[serviceAction]
          }
        </p>
      )}
      {serviceActionError && (
        <div
          id="gbot-service-action-error"
          role="alert"
          className="space-y-1 border-b px-5 py-3 text-sm"
        >
          <p>{serviceActionError.message}</p>
          <details className="text-muted-foreground">
            <summary className="cursor-pointer">Details</summary>
            <p className="break-words">{serviceActionError.details}</p>
          </details>
        </div>
      )}
      {choosingService && (
        <section
          aria-label="Choose service computer"
          className="space-y-3 overflow-y-auto border-b p-5"
        >
          <fieldset disabled={busy} aria-label="Gbot service selection">
            <ServiceSetup target={serviceDraft} change={changeServiceDraft} />
          </fieldset>
          {serviceError && (
            <div role="alert" className="space-y-2 text-sm text-destructive">
              <p>
                Could not confirm the service computer change. Review your
                choice, then choose Use this service to try again.
              </p>
              <details className="text-muted-foreground">
                <summary>Details</summary>
                <p className="whitespace-pre-wrap break-words">{serviceError}</p>
              </details>
            </div>
          )}
          <div className="flex gap-2">
            <Button
              disabled={busy || !serviceReady}
              onClick={() => void chooseService()}
            >
              Use this service
            </Button>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => setChoosingService(false)}
            >
              Cancel service change
            </Button>
          </div>
        </section>
      )}
      {serviceStopped ? (
        <div className="space-y-3 p-5">
          <p>
            {serviceTarget.kind === 'paired_host'
              ? 'Disconnected from the LAN Gbot service. Tasks and schedules continue on that computer.'
              : 'Gbot service is stopped. Choose Start Gbot service, then review unfinished tasks before choosing Resume. Check Scheduled tasks for schedules that need review.'}
          </p>
          <p className="text-sm text-muted-foreground">
            {serviceTarget.kind === 'paired_host'
              ? 'Connect again or choose another service computer. Ordinary Chat accounts remain on this PC.'
              : 'Connected account operations also use this service. Saved workspaces, schedules and accounts are retained.'}
          </p>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1">
          <aside className="w-48 shrink-0 space-y-2 overflow-y-auto border-r p-3">
            {state?.workspaces.map((workspace) => (
              <Button
                key={workspace.id}
                variant={workspace.id === workspaceId ? 'secondary' : 'ghost'}
                className="w-full justify-start truncate"
                onClick={() => setSelected(workspace.id)}
              >
                <GbotAvatar
                  size={24}
                  decorative
                  state={
                    !state.live_sessions.some(
                      (session) => session.workspace_id === workspace.id
                    )
                      ? 'sleeping'
                      : tasks.some(
                            (task) =>
                              task.identity.workspace_id === workspace.id &&
                              task.state === 'running'
                          )
                        ? 'thinking'
                        : 'idle'
                  }
                />
                {workspace.name}
              </Button>
            ))}
            <Button
              variant="outline"
              className="w-full"
              onClick={() => {
                if (adding) setupIdentity.current = null
                setResuming(undefined)
                setAdding(!adding)
              }}
            >
              Add bot
            </Button>
          </aside>
          <main className="min-w-0 flex-1 space-y-4 overflow-y-auto p-5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <GbotAvatar
                  state={
                    !identity
                      ? 'sleeping'
                      : history.some(
                            (task) => task.state === 'waiting_for_human'
                          ) ||
                          approvals.some((approval) =>
                            history.some((task) => task.id === approval.task_id)
                          ) ||
                          prompt.trim()
                        ? 'listening'
                        : history.some((task) => task.state === 'running')
                          ? 'thinking'
                          : 'idle'
                  }
                />
                <h2 className="text-lg font-medium">
                  {bot?.name || 'Your bots'}
                </h2>
              </div>
              <Button
                variant="ghost"
                disabled={busy}
                onClick={() => void refresh()}
              >
                Refresh
              </Button>
            </div>
            {error && !serviceAction && (
              <div role="alert" className="space-y-2 text-destructive">
                <p>
                  Could not load your bots. Choose Refresh to try again. If Gbot
                  is stopped or disconnected, choose{' '}
                  {serviceTarget.kind === 'paired_host'
                    ? 'Connect Gbot service'
                    : 'Start Gbot service'}{' '}
                  above.
                </p>
                <details className="text-muted-foreground">
                  <summary>Details</summary>
                  <p className="whitespace-pre-wrap break-words">{error}</p>
                </details>
              </div>
            )}
            {setupError && (
              <div role="alert" className="space-y-2 text-sm text-destructive">
                <p>
                  Could not check your saved computer setups. Choose Refresh to
                  try again before starting another setup.
                </p>
                <details className="text-muted-foreground">
                  <summary>Details</summary>
                  <p className="whitespace-pre-wrap break-words">{setupError}</p>
                </details>
              </div>
            )}
            {adding && (
              <GbotSetup
                key={resuming?.id ?? 'new'}
                resume={resuming}
                save={add}
                localReady={async (id) => {
                  setSelected(id)
                  setAdding(false)
                  setResuming(undefined)
                  await refresh()
                }}
                cloudReviewed={async () => {
                  await refresh()
                }}
                m365Saved={async () => {
                  await refresh()
                }}
                cancel={() => {
                  setupIdentity.current = null
                  setResuming(undefined)
                  setAdding(false)
                  void refresh()
                }}
              />
            )}
            {!adding &&
              unfinishedSetups?.map((record) => (
                <section
                  key={record.id}
                  aria-label={`Local setup ${record.name}`}
                  className="space-y-2 rounded-md border p-3 text-sm"
                >
                  <p className="font-medium">
                    {record.name} · Local computer setup
                  </p>
                  <p>Computer {record.stage.replaceAll('_', ' ')}</p>
                  {record.issue && (
                    <div role="alert">
                      <p>{record.issue.message}</p>
                      <p>{record.issue.next_action}</p>
                    </div>
                  )}
                  <Button
                    variant="outline"
                    disabled={busy || record.stage === 'removing'}
                    onClick={() => {
                      if (
                        record.stage === 'stopped' ||
                        record.stage === 'stopping_computer'
                      ) {
                        void changeLocalVm(
                          record.stage === 'stopped' ? 'start' : 'stop',
                          record
                        )
                      } else {
                        setResuming({ id: record.id, name: record.name })
                        setAdding(true)
                      }
                    }}
                  >
                    {record.stage === 'stopped'
                      ? localVmAction?.id === record.id
                        ? 'Starting computer…'
                        : 'Start computer'
                      : record.stage === 'stopping_computer'
                        ? localVmAction?.id === record.id
                          ? 'Stopping computer…'
                          : 'Stop computer'
                        : 'Resume setup'}
                  </Button>
                  {renderLocalVmError(record)}
                </section>
              ))}
            {!adding &&
              cloudReviews.map((review) => (
                <section
                  key={review.id}
                  aria-label={`Cloud setup ${review.name}`}
                  className="space-y-2 rounded-md border p-3 text-sm"
                >
                  <p className="font-medium">
                    {review.name} · Cloud computer setup
                  </p>
                  <p>
                    {review.deployment
                      ? `Computer ${review.deployment.phase.replaceAll('_', ' ')}`
                      : review.confirmed
                        ? 'Cost review saved'
                        : 'Cost review incomplete · No VM created'}
                  </p>
                  <CloudDeploymentIssue deployment={review.deployment} saved />
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      disabled={busy}
                      onClick={() => {
                        setResuming({
                          id: review.id,
                          name: review.name,
                          cloud: review,
                        })
                        setAdding(true)
                      }}
                    >
                      Resume setup
                    </Button>
                    <Button
                      variant="ghost"
                      disabled={
                        busy ||
                        Boolean(
                          review.deployment &&
                            review.deployment.phase !== 'deleted'
                        ) ||
                        Boolean(
                          state?.workspaces.some(
                            (workspace) => workspace.id === review.id
                          )
                        )
                      }
                      onClick={() => void removeCloudSetup(review)}
                    >
                      Remove saved setup
                    </Button>
                  </div>
                </section>
              ))}
            {!adding &&
              m365Setups.map((record) => (
                <section
                  key={record.id}
                  aria-label={`M365 setup ${record.name}`}
                  className="space-y-2 rounded-md border p-3 text-sm"
                >
                  <p className="font-medium">
                    {record.name} · M365 Cloud PC setup
                  </p>
                  <p>Setup saved · Desktop control is not connected yet</p>
                  <p>
                    {record.cloud_pc.display_name || record.cloud_pc.id} ·{' '}
                    {record.cloud_pc.image_name || 'Image not supplied'} ·{' '}
                    {record.cloud_pc.plan_name || 'Plan not supplied'}
                  </p>
                  <p>
                    {record.route === 'guest_worker'
                      ? 'Worker in the Cloud PC user session'
                      : 'Supported Microsoft client'}{' '}
                    · Resume setup to prepare the desktop connection
                  </p>
                  <p className="text-muted-foreground">
                    This saved setup is not a connected bot workspace. Removing
                    it keeps your Microsoft account and Cloud PC.
                  </p>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      disabled={busy}
                      onClick={() => {
                        setResuming({
                          id: record.id,
                          name: record.name,
                          m365: record,
                        })
                        setAdding(true)
                      }}
                    >
                      Resume Cloud PC setup
                    </Button>
                    <Button
                      variant="ghost"
                      disabled={busy}
                      onClick={() => void removeM365Setup(record)}
                    >
                      Remove saved Cloud PC setup
                    </Button>
                  </div>
                </section>
              ))}
            {bot && (
              <>
                {(setup?.stage === 'ready' ||
                  setup?.stage === 'stopping_computer') && (
                  <div className="space-y-2 rounded-md border p-3 text-sm">
                    <p>
                      Stopping this computer keeps its virtual disk and saved
                      files.
                    </p>
                    <Button
                      variant="outline"
                      disabled={busy}
                      onClick={() => void changeLocalVm('stop', setup)}
                    >
                      {localVmAction?.id === setup.id &&
                      localVmAction.kind === 'stop'
                        ? 'Stopping computer…'
                        : 'Stop computer'}
                    </Button>
                  </div>
                )}
                {recoverableControl && (
                  <div className="space-y-2 rounded-md border p-3 text-sm">
                    <p>
                      This bot was paused by a previous app session. Recover
                      control to hand it back, then resume any unfinished setup.
                      The bot will remain paused until you hand back control.
                    </p>
                    {recoveryConfirmation === recoveryKey ? (
                      <div className="flex flex-wrap gap-2">
                        <Button
                          disabled={busy}
                          aria-describedby={
                            recoveryError
                              ? 'gbot-settings-recovery-error'
                              : undefined
                          }
                          onClick={recoverControl}
                        >
                          Confirm recovery
                        </Button>
                        <Button
                          variant="outline"
                          disabled={busy}
                          onClick={() => {
                            setRecoveryConfirmation('')
                            setRecoveryErrors((previous) => ({
                              ...previous,
                              [recoveryErrorKey]: undefined,
                            }))
                          }}
                        >
                          Cancel recovery
                        </Button>
                      </div>
                    ) : (
                      <Button
                        variant="outline"
                        disabled={busy}
                        onClick={() => setRecoveryConfirmation(recoveryKey)}
                      >
                        Recover control
                      </Button>
                    )}
                    {recoveryError && (
                      <div
                        id="gbot-settings-recovery-error"
                        role="alert"
                        className="space-y-1"
                      >
                        <p>
                          Could not recover control of this desktop. Try Confirm
                          recovery again.
                        </p>
                        <details className="text-muted-foreground">
                          <summary className="cursor-pointer">Details</summary>
                          <p className="break-words">{recoveryError}</p>
                        </details>
                      </div>
                    )}
                  </div>
                )}
                {setupBlocked && (
                  <div className="space-y-2 rounded-md border p-3 text-sm">
                    <p role="status">
                      {setup?.stage === 'stopped'
                        ? 'Computer stopped'
                        : setup?.stage === 'stopping_computer'
                          ? 'Computer is stopping'
                          : 'Setup incomplete'}
                    </p>
                    {setup?.stage === 'stopped' && (
                      <p>
                        Its virtual disk and saved files are kept. Start this
                        computer to use it again.
                      </p>
                    )}
                    {setups === undefined && !setupError && (
                      <p>Checking setup status…</p>
                    )}
                    {setup?.issue && (
                      <div role="alert">
                        <p>{setup.issue.message}</p>
                        <p>{setup.issue.next_action}</p>
                      </div>
                    )}
                    {setup && setup.stage !== 'stopping_computer' && (
                      <Button
                        variant="outline"
                        disabled={busy}
                        onClick={() => {
                          if (setup.stage === 'stopped') {
                            void changeLocalVm('start', setup)
                          } else {
                            setResuming({ id: setup.id, name: setup.name })
                            setAdding(true)
                          }
                        }}
                      >
                        {setup.stage === 'stopped'
                          ? localVmAction?.id === setup.id &&
                            localVmAction.kind === 'start'
                            ? 'Starting computer…'
                            : 'Start computer'
                          : 'Resume setup'}
                      </Button>
                    )}
                    {canHandBackDuringSetup && (
                      <div className="space-y-2">
                        <p>Hand back control, then resume the saved setup.</p>
                        <Button
                          variant="outline"
                          disabled={busy}
                          aria-describedby={
                            controlError ? 'gbot-settings-control-error' : undefined
                          }
                          onClick={changeControl}
                        >
                          Hand back
                        </Button>
                      </div>
                    )}
                  </div>
                )}
                {renderLocalVmError(setup)}
                {controlError && (
                  <div
                    id="gbot-settings-control-error"
                    role="alert"
                    className="space-y-1 text-sm"
                  >
                    <p>
                      {controlError.returning
                        ? 'Could not hand back control. Try again.'
                        : 'Could not take over this desktop. Try again.'}
                    </p>
                    <details className="text-muted-foreground">
                      <summary className="cursor-pointer">Details</summary>
                      <p className="break-words">{controlError.details}</p>
                    </details>
                  </div>
                )}
                <fieldset disabled={setupBlocked} className="min-w-0 space-y-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm text-muted-foreground">
                      {setupBlocked
                        ? 'Computer setup is incomplete'
                        : identity
                          ? control?.state === 'human'
                            ? 'Bot paused · you have control'
                            : control?.state === 'paused'
                              ? 'Bot paused'
                              : 'Connected'
                          : 'Disconnected'}
                    </span>
                    {!identity &&
                      (bot.bot_pc?.kind === 'lan' ||
                        (bot.bot_pc?.kind === 'cloud' &&
                          ['azure', 'aws', 'gcp'].includes(
                            bot.bot_pc.provider ?? ''
                          ))) &&
                      bot.connection?.kind === 'ssh' && (
                        <Button
                          variant="outline"
                          disabled={busy}
                          onClick={() => {
                            setResuming({
                              id: bot.id,
                              name: bot.name,
                              connection: bot.connection,
                              bot_pc: bot.bot_pc,
                            })
                            setAdding(true)
                          }}
                        >
                          Set up SSH access
                        </Button>
                      )}
                    <Button
                      variant="outline"
                      disabled={busy}
                      aria-describedby={
                        connectionError
                          ? 'gbot-settings-connection-error'
                          : undefined
                      }
                      onClick={changeConnection}
                    >
                      {identity ? 'Disconnect' : 'Connect'}
                    </Button>
                    {identity && !canHandBackDuringSetup && (
                      <Button
                        variant="outline"
                        aria-describedby={
                          controlError ? 'gbot-settings-control-error' : undefined
                        }
                        disabled={
                          busy || (!!control?.owner && control.owner !== owner)
                        }
                        onClick={changeControl}
                      >
                        {control?.state === 'human' ||
                        control?.state === 'paused'
                          ? 'Hand back'
                          : 'Take over'}
                      </Button>
                    )}
                  </div>
                  {connectionError && (
                    <div
                      id="gbot-settings-connection-error"
                      role="alert"
                      className="space-y-1 text-sm"
                    >
                      <p>
                        {connectionError.disconnecting
                          ? 'Could not disconnect this bot’s computer. Try Disconnect again.'
                          : 'Could not connect this bot’s computer. Try Connect again.'}
                      </p>
                      <details className="text-muted-foreground">
                        <summary className="cursor-pointer">Details</summary>
                        <p className="break-words">{connectionError.details}</p>
                      </details>
                    </div>
                  )}
                  {bot.bot_pc?.kind === 'lan' && (
                    <GbotLanBot
                      key={bot.id}
                      id={bot.id}
                      name={bot.name}
                      busy={busy}
                      connected={Boolean(identity)}
                      perform={perform}
                      removed={() => setSelected('')}
                    />
                  )}
                  {identity && !setupBlocked && (
                    <GbotDesktopView
                      key={`${identity.workspace_id}:${identity.session_id}`}
                      ref={desktop}
                      identity={identity}
                      owner={owner}
                      interactive={
                        control?.state === 'human' && control.owner === owner
                      }
                    />
                  )}

                  {executorError && (
                    <div
                      role="alert"
                      aria-busy={loadingTasks}
                      className="space-y-2 rounded-md border p-3 text-sm"
                    >
                      <p>Could not load tasks and approval requests. Try again.</p>
                      <details className="text-muted-foreground">
                        <summary className="cursor-pointer">Details</summary>
                        <p className="break-words">{executorError}</p>
                      </details>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={busy || loadingTasks}
                        onClick={() => void retryTaskHistory()}
                      >
                        {loadingTasks ? 'Loading tasks…' : 'Retry loading tasks'}
                      </Button>
                    </div>
                  )}
                  <GbotConnectors key={bot.id} workspaceId={bot.id} />
                  <GbotSchedules
                    key={`schedules-${bot.id}`}
                    workspaceId={bot.id}
                    assignment={savedAssignment}
                  />
                  <BrainSetup
                    key={`brain-${workspaceId}`}
                    value={assignment}
                    saved={savedAssignment}
                    busy={busy}
                    computerReady={Boolean(identity && !setupBlocked)}
                    onChange={setAssignment}
                    onCancel={discardAssignment}
                    onSave={async () => {
                      if (busy) return
                      setBusy(true)
                      try {
                        await gbot('assignments/save', {
                          workspace_id: workspaceId,
                          connection: assignment.connection,
                          model: assignment.model,
                          context_tokens: assignment.context_tokens,
                          api_key: assignment.api_key,
                        })
                        discardAssignment()
                      } finally {
                        await refresh()
                        setBusy(false)
                      }
                    }}
                  />
                  {approvals
                    .filter((approval) =>
                      history.some((task) => task.id === approval.task_id)
                    )
                    .map((approval) => (
                      <GbotTaskApproval
                        key={approval.id}
                        approval={approval}
                        busy={busy}
                        reply={(allow) =>
                          perform(
                            () => gbot('tasks/approval', { id: approval.id, allow }),
                            true
                          )
                        }
                      />
                    ))}
                  {gbotTopLevelTasks(history).map((task) => (
                    <article
                      key={task.id}
                      className="space-y-2 rounded-lg border p-3"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <span className="text-sm capitalize">
                          {task.state.replaceAll('_', ' ')}
                        </span>
                        <GbotTaskActions
                          taskState={task.state}
                          busy={busy}
                          ready={ready}
                          botHasControl={botHasControl}
                          stopLabel="Stop"
                          resumeLabel="Resume"
                          size="default"
                          onAction={(action) =>
                            perform(
                              () => gbot(`tasks/${action}`, { id: task.id }),
                              true
                            )
                          }
                        />
                      </div>
                      <GbotTaskInterruption task={task} />
                      {task.messages
                        .filter(
                          (message) =>
                            message.role === 'user' ||
                            message.role === 'assistant'
                        )
                        .map((message, index, shown) => (
                          <div key={index} className="space-y-1">
                            <p className="text-xs font-medium text-muted-foreground">
                              {message.role === 'user' ? 'You' : bot.name}
                            </p>
                            <p className="whitespace-pre-wrap break-words text-sm">
                              {messageText(message.content)}
                            </p>
                            {message.role === 'assistant' &&
                              index === shown.length - 1 &&
                              task.state !== 'running' && (
                                <ReadAloud text={messageText(message.content)} />
                              )}
                          </div>
                        ))}
                      {task.help_requests?.map((request) => (
                        <HumanHelp
                          key={request.id}
                          request={request}
                          taskState={task.state}
                          busy={busy}
                          reply={(response) =>
                            perform(
                              () =>
                                gbot('tasks/help', {
                                  id: task.id,
                                  request_id: request.id,
                                  response,
                                }),
                              true
                            )
                          }
                        />
                      ))}
                      <GbotTaskFiles task={task} />
                      <GbotSubAgents
                        parent={task}
                        tasks={history}
                        approvals={approvals}
                        busy={busy}
                        onStop={(id) =>
                          void perform(() => gbot('tasks/cancel', { id }))
                        }
                        onAnswer={(id, requestId, response) =>
                          perform(
                            () =>
                              gbot('tasks/help', {
                                id,
                                request_id: requestId,
                                response,
                              }),
                            true
                          )
                        }
                      />
                    </article>
                  ))}
                  <p
                    id="gbot-task-guidance"
                    role={submittingTask === workspaceId ? 'status' : undefined}
                    className="text-sm text-muted-foreground"
                  >
                    {taskGuidance}
                  </p>
                  {taskError !== undefined && (
                    <div
                      id="gbot-task-error"
                      role="alert"
                      className="space-y-1 text-sm"
                    >
                      <p>Could not send this task. Try again.</p>
                      <details className="text-muted-foreground">
                        <summary className="cursor-pointer">Details</summary>
                        <p className="break-words">{taskError}</p>
                      </details>
                    </div>
                  )}
                  <form
                    className="flex flex-wrap gap-2"
                    aria-busy={submittingTask === workspaceId}
                    onSubmit={(event) => {
                      event.preventDefault()
                      if (
                        busy ||
                        taskSubmission.current ||
                        !identity ||
                        !ready ||
                        !botHasControl ||
                        !prompt.trim()
                      )
                        return
                      const submittedIdentity: Identity = identity
                      const submittedPrompt = prompt
                      taskSubmission.current = true
                      setSubmittingTask(submittedIdentity.workspace_id)
                      setTaskErrors((previous) => ({
                        ...previous,
                        [taskErrorKey]: undefined,
                      }))
                      void perform(
                        async () => {
                          await gbot('tasks/start', {
                            identity: submittedIdentity,
                            prompt: submittedPrompt,
                          })
                          setPrompts((previous) =>
                            previous[submittedIdentity.workspace_id] ===
                            submittedPrompt
                              ? {
                                  ...previous,
                                  [submittedIdentity.workspace_id]: '',
                                }
                              : previous
                          )
                        },
                        true
                      )
                        .catch((cause) => {
                          setTaskErrors((previous) => ({
                            ...previous,
                            [taskErrorKey]:
                              cause instanceof Error
                                ? cause.message
                                : String(cause),
                          }))
                        })
                        .finally(() => {
                          taskSubmission.current = false
                          setSubmittingTask(undefined)
                        })
                    }}
                  >
                    <Input
                      className="min-w-0 flex-1"
                      aria-label="Bot task"
                      aria-describedby={
                        taskError !== undefined
                          ? 'gbot-task-guidance gbot-task-error'
                          : 'gbot-task-guidance'
                      }
                      placeholder="Give this bot a task"
                      value={prompt}
                      onChange={(event) => {
                        const value = event.target.value
                        if (workspaceId)
                          setPrompts((previous) => ({
                            ...previous,
                            [workspaceId]: value,
                          }))
                      }}
                    />
                    <VoiceInput
                      disabled={busy || Boolean(submittingTask) || !ready || !botHasControl}
                      onText={(spoken) => {
                        if (workspaceId)
                          setPrompts((previous) => ({
                            ...previous,
                            [workspaceId]: previous[workspaceId]
                              ? `${previous[workspaceId]} ${spoken}`
                              : spoken,
                          }))
                      }}
                    />
                    <Button
                      aria-describedby="gbot-task-guidance"
                      disabled={
                        busy ||
                        Boolean(submittingTask) ||
                        !ready ||
                        !prompt.trim() ||
                        !botHasControl
                      }
                    >
                      {submittingTask === workspaceId ? 'Sending…' : 'Run'}
                    </Button>
                  </form>
                </fieldset>
              </>
            )}
            {!bot && !adding && (
              <p className="text-sm text-muted-foreground">
                Add a dedicated bot computer to start a channel. Each bot keeps
                its own task history.
              </p>
            )}
          </main>
        </div>
      )}
    </div>
  )
}

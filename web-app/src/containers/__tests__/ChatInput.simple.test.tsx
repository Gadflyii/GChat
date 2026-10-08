import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ChatInput from '../ChatInput'
import { NEW_THREAD_ATTACHMENT_KEY, useChatAttachments } from '@/hooks/useChatAttachments'
import { useModelProvider } from '@/hooks/useModelProvider'
import { usePrompt } from '@/hooks/usePrompt'
import { seedServiceHub } from '@/test/service-hub'
import type { AgentDefinition } from '@/types/agent'
import type { AgentSkill } from '@/services/agent/skills'
import { useAppState } from '@/hooks/useAppState'
import type { ModelsService } from '@/services/models/types'
import * as switchModel from '@/utils/switchModel'
import { toast } from 'sonner'
import { useThreads } from '@/hooks/useThreads'
import { useInitialMessage } from '@/hooks/useInitialMessage'
import { createDocumentAttachment } from '@/types/attachment'

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  downscaleImageDataUrl: vi.fn(),
}))
const agentDefinitions = vi.hoisted(() => ({
  value: [] as AgentDefinition[],
  loading: false,
}))
const agentSkills = vi.hoisted(() => ({ value: [] as AgentSkill[] }))
const conversationPolicyState = vi.hoisted(() => ({
  activeDefinitions: {} as Record<string, string>,
  setActiveDefinition: vi.fn(),
  activeSkills: {} as Record<string, string>,
  setActiveSkill: vi.fn(),
  approvalModes: {} as Record<string, 'manual' | 'skip'>,
  defaultApprovalMode: 'manual' as 'manual' | 'skip',
  setApprovalMode: vi.fn(),
  transferPolicy: vi.fn(),
}))

vi.mock('@tanstack/react-router', () => ({
  useRouter: () => ({ navigate: mocks.navigate }),
}))

vi.mock('@/i18n/react-i18next-compat', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

vi.mock('@/lib/imageDownscale', () => ({
  downscaleImageDataUrl: mocks.downscaleImageDataUrl,
}))

vi.mock('react-textarea-autosize', async () => {
  const React = await import('react')
  type AutosizeProps = React.TextareaHTMLAttributes<HTMLTextAreaElement> & {
    minRows?: number
    maxRows?: number
  }
  return {
    default: React.forwardRef<HTMLTextAreaElement, AutosizeProps>(
      ({ minRows, maxRows, ...props }, ref) => {
        void minRows
        void maxRows
        return <textarea {...props} ref={ref} />
      }
    ),
  }
})

vi.mock('@/hooks/useTools', () => ({
  useTools: vi.fn(),
}))

vi.mock('@/hooks/useAgentSkills', () => ({
  useAgentSkills: () => ({ skills: agentSkills.value, loading: false }),
}))

vi.mock('@/hooks/useAgentDefinitions', () => ({
  useAgentDefinitions: () => ({ definitions: agentDefinitions.value, loading: agentDefinitions.loading }),
}))

vi.mock('@/hooks/useConversationPolicy', () => {
  const useConversationPolicy = (
    selector: (value: typeof conversationPolicyState) => unknown
  ) => selector(conversationPolicyState)
  useConversationPolicy.getState = () => conversationPolicyState
  return { useConversationPolicy }
})

vi.mock('@/hooks/useGChatBrowserExtension', () => ({
  useGChatBrowserExtension: () => ({
    isActive: false,
    dialogOpen: false,
    dialogState: null,
    toggleBrowser: vi.fn(),
    handleCancel: vi.fn(),
    setDialogOpen: vi.fn(),
  }),
}))

vi.mock('@/containers/chatInput/useTauriDragDrop', () => ({
  useTauriDragDrop: vi.fn(),
}))

vi.mock('@/lib/extension', () => ({
  ExtensionManager: {
    getInstance: () => ({ get: () => undefined }),
  },
}))

vi.mock('@/containers/ContextSizeControl', () => ({
  ContextSizeControl: () => null,
}))

vi.mock('@/containers/DropdownToolsAvailable', () => ({
  default: () => null,
}))

vi.mock('@/containers/ReasoningToggle', () => ({
  default: () => null,
}))

vi.mock('@/containers/dialogs/GChatBrowserExtensionDialog', () => ({
  default: () => null,
}))

vi.mock('@/containers/ConversationApprovalModeSelect', () => ({
  ConversationApprovalModeSelect: ({ mode }: { mode: 'manual' | 'skip' }) => (
    <div data-testid="approval-mode-control" data-mode={mode} />
  ),
}))

vi.mock('@/containers/AgentExternalFolderButton', () => ({
  AgentExternalFolderButton: () => <div data-testid="external-folder-control" />,
}))

vi.mock('@/components/TokenCounter', () => ({
  TokenCounter: () => null,
}))

describe('ChatInput', () => {
  it.each(['submitted', 'streaming'] as const)('keeps Stop usable during %s without requiring a route thread ID', (chatStatus) => {
    const onStop = vi.fn()
    render(<ChatInput chatStatus={chatStatus} onStop={onStop} />)
    const stop = screen.getByRole('button', { name: 'Stop generation' })
    expect(stop).toBeEnabled()
    fireEvent.click(stop)
    expect(onStop).toHaveBeenCalledOnce()
  })

  beforeEach(() => {
    vi.clearAllMocks()
    seedServiceHub()
    usePrompt.setState({ prompt: '' })
    useChatAttachments.setState({ attachmentsByThread: {} })
    useThreads.setState({ threads: {}, currentThreadId: undefined })
    useInitialMessage.setState({ byThread: {} })
    agentDefinitions.value = []
    agentDefinitions.loading = false
    agentSkills.value = []
    conversationPolicyState.activeDefinitions = {}
    conversationPolicyState.activeSkills = {}
    conversationPolicyState.approvalModes = {}
    conversationPolicyState.defaultApprovalMode = 'manual'
    conversationPolicyState.setActiveDefinition.mockReset()
    conversationPolicyState.setApprovalMode.mockReset()

    const model = {
      id: 'test-model',
      capabilities: [],
      settings: {},
    } as Model
    const provider = {
      provider: 'openai',
      active: true,
      models: [model],
      settings: [],
    } as ModelProvider
    useModelProvider.setState({
      providers: [provider],
      selectedProvider: 'openai',
      selectedModel: model,
    })
  })

  it('carries an unprocessed home Excel attachment into the selected saved-agent conversation without embedding preflight', async () => {
    const createThread = vi.fn(async (thread: Thread) => thread)
    const ingestFileAttachment = vi.fn().mockRejectedValue(new Error('GInfer embeddings unavailable'))
    const parseDocumentMock = vi.fn().mockRejectedValue(new Error('Native read owns folder approval'))
    seedServiceHub({ threads: { createThread } as never, uploads: { ingestFileAttachment } as never, rag: { parseDocument: parseDocumentMock } as never })
    useModelProvider.setState((state) => ({ selectedModel: { ...state.selectedModel!, capabilities: ['tools'] } }))
    agentDefinitions.value = [{ id: 'reviewer', name: 'Reviewer', kind: 'standard', schemaVersion: 2, skills: [], instructions: '', description: '', outputContract: '', maxSteps: 25, modelInstanceId: null, builtIn: false }]
    const workbookAttachment = createDocumentAttachment({ name: 'Budget.xlsx', path: 'C:\\Users\\Ron\\Desktop\\Budget.xlsx', fileType: 'xlsx', parseMode: 'auto' })
    useChatAttachments.getState().setAttachments(NEW_THREAD_ATTACHMENT_KEY, [workbookAttachment])
    render(<ChatInput initialMessage />)
    fireEvent.change(screen.getByLabelText('Invoke saved agent'), { target: { value: 'reviewer' } })
    fireEvent.change(screen.getByTestId('chat-input'), { target: { value: 'Review the attached spreadsheet' } })
    fireEvent.click(document.querySelector('[data-test-id="send-message-button"]')!)
    await waitFor(() => expect(mocks.navigate).toHaveBeenCalled())
    const threadId = useThreads.getState().currentThreadId!
    expect(useInitialMessage.getState().consume(threadId)).toMatchObject({ text: 'Review the attached spreadsheet', agentDefinitionId: 'reviewer', documents: [workbookAttachment] })
    expect(ingestFileAttachment).not.toHaveBeenCalled()
    expect(parseDocumentMock).not.toHaveBeenCalled()
  })

  it('renders the production input with its translated placeholder', () => {
    const { unmount } = render(<ChatInput />)

    expect(screen.getByTestId('chat-input')).toHaveAttribute(
      'placeholder',
      'common:placeholder.chatInput'
    )
    expect(
      document.querySelector('[data-test-id="send-message-button"]')
    ).toBeDisabled()
    unmount()
  })

  it('shows folders, approvals and inline saved-agent invocation in ordinary Chat', () => {
    conversationPolicyState.defaultApprovalMode = 'skip'
    agentDefinitions.value = [{ id: 'workflow-1', name: 'Workflow' } as AgentDefinition]
    render(<ChatInput />)

    expect(screen.getByTestId('approval-mode-control')).toHaveAttribute('data-mode', 'skip')
    expect(screen.getByTestId('external-folder-control')).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Invoke saved agent' })).toHaveValue('general')
  })

  it('submits entered text and clears the controlled prompt', async () => {
    const onSubmit = vi.fn()
    const { unmount } = render(<ChatInput onSubmit={onSubmit} />)
    const input = screen.getByTestId('chat-input')
    const sendButton = document.querySelector(
      '[data-test-id="send-message-button"]'
    )

    fireEvent.change(input, { target: { value: 'Invoke the machine spirit' } })

    expect(input).toHaveValue('Invoke the machine spirit')
    expect(sendButton).toBeEnabled()
    fireEvent.click(sendButton!)

    expect(onSubmit).toHaveBeenCalledWith(
      'Invoke the machine spirit',
      undefined,
      undefined,
      undefined
    )
    await waitFor(() => expect(input).toHaveValue(''))
    unmount()
  })

  it('consumes /compact on the home input before model selection or thread creation', async () => {
    useModelProvider.setState({ selectedModel: undefined })
    const notice = vi.spyOn(toast, 'info')
    const view = render(<ChatInput />)
    fireEvent.change(screen.getByTestId('chat-input'), { target: { value: ' /COMPACT ' } })
    fireEvent.click(document.querySelector('[data-test-id="send-message-button"]')!)
    await waitFor(() => expect(notice).toHaveBeenCalledWith('Nothing to compact yet.'))
    expect(mocks.navigate).not.toHaveBeenCalled()
    expect(screen.getByTestId('chat-input')).toHaveValue('')
    view.unmount()
    notice.mockRestore()
  })

  it('reserves /compact ahead of skills and never starts an intentionally stopped model', async () => {
    const model = { id: 'test-model', capabilities: [], settings: {} } as Model
    useModelProvider.setState({
      providers: [{ provider: 'ginfer', active: true, models: [model], settings: [] } as ModelProvider],
      selectedProvider: 'ginfer', selectedModel: model,
    })
    useAppState.setState({ activeModels: [], intentionallyStoppedModels: new Set(['ginfer::test-model']) })
    seedServiceHub({ models: { getActiveModels: vi.fn().mockResolvedValue([]) } as unknown as ModelsService })
    agentSkills.value = [{ name: 'compact' } as AgentSkill]
    const start = vi.spyOn(switchModel, 'switchToModel').mockResolvedValue()
    const onSubmit = vi.fn()
    const view = render(<ChatInput onSubmit={onSubmit} chatStatus="streaming" />)
    const input = screen.getByTestId('chat-input')
    fireEvent.change(input, { target: { value: '/compact' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => expect(onSubmit).toHaveBeenCalledExactlyOnceWith('/compact'))
    expect(conversationPolicyState.setActiveSkill).not.toHaveBeenCalled()
    expect(start).not.toHaveBeenCalled()
    view.unmount()
    start.mockRestore()
  })

  it('rejects command attachments without submitting or clearing them', async () => {
    useChatAttachments.setState({ attachmentsByThread: { [NEW_THREAD_ATTACHMENT_KEY]: [{
      id: 'document', name: 'notes.txt', type: 'document', path: '/notes.txt', processed: true,
    }] } })
    const onSubmit = vi.fn()
    const failure = vi.spyOn(toast, 'error')
    const view = render(<ChatInput onSubmit={onSubmit} />)
    fireEvent.change(screen.getByTestId('chat-input'), { target: { value: '/compact' } })
    fireEvent.keyDown(screen.getByTestId('chat-input'), { key: 'Enter' })
    await waitFor(() => expect(failure).toHaveBeenCalledWith('Remove attachments before running /compact.'))
    expect(onSubmit).not.toHaveBeenCalled()
    expect(useChatAttachments.getState().attachmentsByThread[NEW_THREAD_ATTACHMENT_KEY]).toHaveLength(1)
    expect(screen.getByTestId('chat-input')).toHaveValue('/compact')
    view.unmount()
    failure.mockRestore()
  })

  it('keeps the draft, selected skill and attachments editable after failed restoration and sends once when ready', async () => {
    const threadId = 'failed-restoration'
    useThreads.setState({ currentThreadId: threadId })
    agentSkills.value = [{ name: 'agent-builder', description: 'Build agents', version: '1.2.0', requiresTools: [], requiresScripts: [], dangerous: false, platforms: null, enabled: true, compatible: true, reserved: false, unavailableReasons: [], error: null }]
    const attachment = createDocumentAttachment({ name: 'Budget.xlsx', path: '/Desktop/Budget.xlsx', fileType: 'xlsx' })
    useChatAttachments.getState().setAttachments(threadId, [attachment])
    const onSubmit = vi.fn()
    const view = render(<ChatInput onSubmit={onSubmit} chatStatus="ready" submissionReady={false} preselectedAgentSkillName="agent-builder" />)
    const input = screen.getByTestId('chat-input')
    const send = document.querySelector('[data-test-id="send-message-button"]')!
    fireEvent.change(input, { target: { value: 'Review the spreadsheet' } })
    expect(send).toBeDisabled()
    expect(input).toBeEnabled()
    expect(screen.queryByRole('button', { name: 'Stop generation' })).not.toBeInTheDocument()
    fireEvent.click(send)
    fireEvent.keyDown(input, { key: 'Enter' })
    fireEvent.change(input, { target: { value: 'Review the attached spreadsheet' } })
    expect(onSubmit).not.toHaveBeenCalled()
    expect(conversationPolicyState.setActiveSkill).not.toHaveBeenCalled()
    expect(conversationPolicyState.setActiveDefinition).not.toHaveBeenCalled()
    expect(input).toHaveValue('Review the attached spreadsheet')
    expect(useChatAttachments.getState().getAttachments(threadId)).toEqual([attachment])
    expect(screen.getByTestId('agent-skill-inline-token')).toHaveTextContent('/agent-builder')

    view.rerender(<ChatInput onSubmit={onSubmit} chatStatus="ready" submissionReady preselectedAgentSkillName="agent-builder" />)
    expect(send).toBeEnabled()
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => expect(onSubmit).toHaveBeenCalledExactlyOnceWith('Review the attached spreadsheet', undefined, 'agent-builder', undefined))
    expect(input).toHaveValue('')
    expect(useChatAttachments.getState().getAttachments(threadId)).toEqual([])
  })

  it('retains /compact without dispatch or selection changes while restoration blocks submission', () => {
    const onSubmit = vi.fn()
    render(<ChatInput onSubmit={onSubmit} chatStatus="ready" submissionReady={false} />)
    const input = screen.getByTestId('chat-input')
    fireEvent.change(input, { target: { value: '/compact' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(input).toHaveValue('/compact')
    expect(onSubmit).not.toHaveBeenCalled()
    expect(conversationPolicyState.setActiveDefinition).not.toHaveBeenCalled()
    expect(conversationPolicyState.setActiveSkill).not.toHaveBeenCalled()
  })

  it('lets an explicit Send start a model after the sidebar stopped it', async () => {
    const model = { id: 'test-model', capabilities: [], settings: {} } as Model
    useModelProvider.setState({
      providers: [{ provider: 'ginfer', active: true, models: [model], settings: [] } as ModelProvider],
      selectedProvider: 'ginfer',
      selectedModel: model,
    })
    useAppState.setState({ activeModels: [], intentionallyStoppedModels: new Set(['ginfer::test-model']) })
    const getActiveModels = vi.fn().mockResolvedValue([])
    seedServiceHub({
      models: { getActiveModels } as unknown as ModelsService,
    })
    const switchSpy = vi.spyOn(switchModel, 'switchToModel').mockImplementation(async (params) => {
      useAppState.getState().setIntentionalModelStop(params.providerName, params.modelId, false)
      useAppState.setState({ activeModels: [params.modelId] })
    })
    try {
      const onSubmit = vi.fn()
      const firstView = render(<ChatInput onSubmit={onSubmit} />)
      await waitFor(() => expect(getActiveModels).toHaveBeenCalledTimes(2))
      expect(switchSpy).not.toHaveBeenCalled()
      firstView.unmount()

      const view = render(<ChatInput onSubmit={onSubmit} />)
      await waitFor(() => expect(getActiveModels).toHaveBeenCalledTimes(4))
      expect(switchSpy).not.toHaveBeenCalled()
      fireEvent.change(screen.getByTestId('chat-input'), { target: { value: 'Continue' } })
      const sendButton = document.querySelector('[data-test-id="send-message-button"]')!
      expect(sendButton).toBeEnabled()
      fireEvent.click(sendButton)

      await waitFor(() => expect(onSubmit).toHaveBeenCalledWith('Continue', undefined, undefined, undefined))
      expect(switchSpy.mock.calls.some(([params]) =>
        params.modelId === 'test-model' &&
        params.providerName === 'ginfer' &&
        !params.isAutoStart
      )).toBe(true)
      view.unmount()
    } finally {
      switchSpy.mockRestore()
    }
  })

  it('keeps skill invocation on the default agent unless a saved workflow is explicitly selected', () => {
    const model = {
      id: 'agent-model',
      capabilities: [],
      settings: {},
    } as Model
    useModelProvider.setState({
      providers: [
        {
          provider: 'ginfer',
          active: true,
          models: [model],
          settings: [],
        } as ModelProvider,
      ],
      selectedProvider: 'ginfer',
      selectedModel: model,
    })
    useAppState.setState({ activeModels: ['agent-model'] })

    const empty = render(<ChatInput initialMessage />)
    expect(screen.queryByLabelText('Invoke saved agent')).not.toBeInTheDocument()
    empty.unmount()

    agentDefinitions.value = [
      {
        schemaVersion: 2,
        id: 'researcher',
        name: 'Researcher',
        description: '',
        instructions: '',
        skills: [],
        maxSteps: 25,
        outputContract: '',
        modelInstanceId: null,
        kind: 'standard',
        builtIn: false,
      },
    ]
    agentSkills.value = [{ name: 'agent-builder', description: 'Build agents', version: '1.1.0',
      requiresTools: [], requiresScripts: [], dangerous: false, platforms: null, enabled: true,
      compatible: true, reserved: false, unavailableReasons: [], error: null }]
    const onSubmit = vi.fn()
    const view = render(<ChatInput initialMessage onSubmit={onSubmit} preselectedAgentSkillName="agent-builder" />)

    expect(screen.getByLabelText('Invoke saved agent')).toHaveValue('general')
    expect(screen.queryByRole('option', { name: 'General Agent' })).not.toBeInTheDocument()
    fireEvent.change(screen.getByTestId('chat-input'), { target: { value: 'Build a model inventory agent' } })
    fireEvent.click(document.querySelector('[data-test-id="send-message-button"]')!)
    expect(onSubmit).toHaveBeenLastCalledWith('Build a model inventory agent', undefined, 'agent-builder', undefined)

    fireEvent.change(screen.getByLabelText('Invoke saved agent'), { target: { value: 'researcher' } })
    fireEvent.change(screen.getByTestId('chat-input'), { target: { value: 'Run my saved workflow' } })
    fireEvent.click(document.querySelector('[data-test-id="send-message-button"]')!)
    expect(onSubmit).toHaveBeenLastCalledWith('Run my saved workflow', undefined, undefined, 'researcher')

    agentDefinitions.loading = true
    agentDefinitions.value = []
    view.rerender(<ChatInput initialMessage onSubmit={onSubmit} />)
    agentDefinitions.loading = false
    view.rerender(<ChatInput initialMessage onSubmit={onSubmit} />)
    fireEvent.change(screen.getByTestId('chat-input'), { target: { value: 'Continue without deleted workflow' } })
    fireEvent.click(document.querySelector('[data-test-id="send-message-button"]')!)
    expect(onSubmit).toHaveBeenLastCalledWith('Continue without deleted workflow', undefined, undefined, undefined)
  })

  it('invokes a skill from ordinary chat without selecting an agent workflow', () => {
    agentSkills.value = [{ name: 'agent-builder', description: 'Build agents', version: '1.2.0',
      requiresTools: [], requiresScripts: [], dangerous: false, platforms: null, enabled: true,
      compatible: true, reserved: false, unavailableReasons: [], error: null }]
    const onSubmit = vi.fn()
    render(<ChatInput initialMessage onSubmit={onSubmit} />)
    fireEvent.change(screen.getByTestId('chat-input'), { target: { value: '/agent-builder Make an inventory agent' } })
    fireEvent.click(document.querySelector('[data-test-id="send-message-button"]')!)
    expect(onSubmit).toHaveBeenCalledWith('Make an inventory agent', undefined, 'agent-builder', undefined)
    expect(conversationPolicyState.setActiveSkill).toHaveBeenCalledWith(expect.any(String), 'agent-builder')
    expect(screen.getByTestId('chat-input')).toHaveValue('')
  })

  it('asks for a model instead of sending when none is selected', async () => {
    // With model preloading off by default, this is the state of every cold
    // launch until the user picks a model in the selector.
    useModelProvider.setState({ selectedProvider: '', selectedModel: null })
    const onSubmit = vi.fn()
    const { unmount } = render(<ChatInput onSubmit={onSubmit} />)
    const input = screen.getByTestId('chat-input')

    fireEvent.change(input, { target: { value: 'Invoke the machine spirit' } })
    fireEvent.click(
      document.querySelector('[data-test-id="send-message-button"]')!
    )

    expect(await screen.findByText('chat:selectModelToChat')).toBeVisible()
    expect(onSubmit).not.toHaveBeenCalled()
    // The typed prompt survives so the user can send it once a model is picked.
    expect(input).toHaveValue('Invoke the machine spirit')
    unmount()
  })

  it('downscales an image before applying the byte limit', async () => {
    const model = {
      id: 'vision-model',
      capabilities: ['vision'],
      settings: {},
    } as Model
    useModelProvider.setState({
      providers: [
        {
          provider: 'openai',
          active: true,
          models: [model],
          settings: [],
        } as ModelProvider,
      ],
      selectedProvider: 'openai',
      selectedModel: model,
    })
    mocks.downscaleImageDataUrl.mockResolvedValue({
      dataUrl: 'data:image/jpeg;base64,dGVzdA==',
      base64: 'dGVzdA==',
      mimeType: 'image/jpeg',
      size: 4,
    })

    render(<ChatInput />)
    const file = new File(['test'], 'camera.jpg', { type: 'image/jpeg' })
    Object.defineProperty(file, 'size', { value: 11 * 1024 * 1024 })

    fireEvent.paste(screen.getByTestId('chat-input'), {
      clipboardData: {
        items: [
          {
            type: 'image/jpeg',
            getAsFile: () => file,
          },
        ],
      },
    })

    await waitFor(() => {
      expect(useChatAttachments.getState().getAttachments()).toEqual([
        expect.objectContaining({
          name: 'camera.jpg',
          mimeType: 'image/jpeg',
          size: 4,
          base64: 'dGVzdA==',
        }),
      ])
    })
  })
})

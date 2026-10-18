import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
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
import { useToolAvailable } from '@/hooks/useToolAvailable'
import type { CapabilityTool } from '@/services/capabilities/types'
import { fs } from '@gchat/core'
import { useAttachments } from '@/hooks/useAttachments'
import { useAttachmentIngestionPrompt } from '@/hooks/useAttachmentIngestionPrompt'

const webTools: CapabilityTool[] = [
  { name: 'native_search', identity: 'os.web.search', origin: 'native', server: 'GChat', description: 'Search the web', inputSchema: {} },
  { name: 'native_fetch', identity: 'os.web.fetch', origin: 'native', server: 'GChat', description: 'Read a page', inputSchema: {} },
]
const fileTool: CapabilityTool = {
  name: 'native_read', identity: 'os.fs.read', origin: 'native', server: 'GChat', description: 'Read a file', inputSchema: {},
}

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  downscaleImageDataUrl: vi.fn(),
}))
const agentDefinitions = vi.hoisted(() => ({
  value: [] as AgentDefinition[],
  loading: false,
  error: null as string | null,
  load: vi.fn(),
}))
const agentSkills = vi.hoisted(() => ({
  value: [] as AgentSkill[],
  loading: false,
  error: null as string | null,
  load: vi.fn(),
}))
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
  useAgentSkills: () => ({
    skills: agentSkills.value,
    loading: agentSkills.loading,
    error: agentSkills.error,
    load: agentSkills.load,
  }),
}))

vi.mock('@/hooks/useAgentDefinitions', () => ({
  useAgentDefinitions: () => ({
    definitions: agentDefinitions.value,
    loading: agentDefinitions.loading,
    error: agentDefinitions.error,
    load: agentDefinitions.load,
  }),
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

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((done, fail) => {
    resolve = done
    reject = fail
  })
  return { promise, resolve, reject }
}

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
    usePrompt.setState(usePrompt.getInitialState())
    useChatAttachments.setState({ attachmentsByThread: {} })
    useThreads.setState({ threads: {}, currentThreadId: undefined })
    useInitialMessage.setState({ byThread: {} })
    useAppState.setState({ tools: [], activeModels: [] })
    useToolAvailable.setState({ disabledTools: {}, defaultDisabledTools: [], defaultsInitialized: false })
    agentDefinitions.value = []
    agentDefinitions.loading = false
    agentDefinitions.error = null
    agentDefinitions.load.mockReset()
    agentSkills.value = []
    agentSkills.loading = false
    agentSkills.error = null
    agentSkills.load.mockReset()
    conversationPolicyState.activeDefinitions = {}
    conversationPolicyState.activeSkills = {}
    conversationPolicyState.approvalModes = {}
    conversationPolicyState.defaultApprovalMode = 'manual'
    conversationPolicyState.setActiveDefinition.mockReset()
    conversationPolicyState.setActiveSkill.mockReset()
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
    const user = userEvent.setup()
    const createThread = vi.fn(async (thread: Thread) => thread)
    const ingestFileAttachment = vi.fn().mockRejectedValue(new Error('GInfer embeddings unavailable'))
    const parseDocumentMock = vi.fn().mockRejectedValue(new Error('Native read owns folder approval'))
    seedServiceHub({ threads: { createThread } as never, uploads: { ingestFileAttachment } as never, rag: { parseDocument: parseDocumentMock } as never })
    useModelProvider.setState((state) => ({ selectedModel: { ...state.selectedModel!, capabilities: ['tools'] } }))
    agentDefinitions.value = [{ id: 'reviewer', name: 'Reviewer', kind: 'standard', schemaVersion: 2, skills: [], instructions: '', description: '', outputContract: '', maxSteps: 25, modelInstanceId: null, builtIn: false }]
    const workbookAttachment = createDocumentAttachment({ name: 'Budget.xlsx', path: 'C:\\Users\\Ron\\Desktop\\Budget.xlsx', fileType: 'xlsx', parseMode: 'auto' })
    useChatAttachments.getState().setAttachments(NEW_THREAD_ATTACHMENT_KEY, [workbookAttachment])
    render(<ChatInput initialMessage />)
    await user.click(screen.getByRole('button', { name: 'Invoke saved agent' }))
    await user.click(screen.getByRole('menuitemradio', { name: 'Reviewer' }))
    fireEvent.change(screen.getByTestId('chat-input'), { target: { value: 'Review the attached spreadsheet' } })
    fireEvent.click(document.querySelector('[data-test-id="send-message-button"]')!)
    await waitFor(() => expect(mocks.navigate).toHaveBeenCalled())
    const threadId = useThreads.getState().currentThreadId!
    expect(useInitialMessage.getState().consume(threadId)).toMatchObject({ text: 'Review the attached spreadsheet', agentDefinitionId: 'reviewer', documents: [workbookAttachment] })
    expect(ingestFileAttachment).not.toHaveBeenCalled()
    expect(parseDocumentMock).not.toHaveBeenCalled()
  })

  it('retains the first-message draft, document and skill after conversation creation fails and lets the user retry', async () => {
    const first = deferred<Thread>()
    const retry = deferred<Thread>()
    const createThread = vi.fn<(thread: Thread) => Promise<Thread>>()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(retry.promise)
    seedServiceHub({ threads: { createThread } as never })
    agentSkills.value = [{ name: 'agent-builder', description: 'Build agents', version: '1.2.0', requiresTools: [], requiresScripts: [], dangerous: false, platforms: null, enabled: true, compatible: true, reserved: false, unavailableReasons: [], error: null }]
    const attachment = { ...createDocumentAttachment({ name: 'notes.txt', path: '/docs/notes.txt' }), id: 'home-notes', processed: true }
    useChatAttachments.getState().setAttachments(NEW_THREAD_ATTACHMENT_KEY, [attachment])
    const failure = vi.spyOn(toast, 'error')
    try {
      render(<ChatInput initialMessage preselectedAgentSkillName="agent-builder" />)
      const input = screen.getByTestId('chat-input')
      fireEvent.change(input, { target: { value: 'Review the attached notes' } })
      fireEvent.click(screen.getByRole('button', { name: 'Send message' }))
      expect(createThread).toHaveBeenCalledOnce()
      expect(useThreads.getState().currentThreadId).toBe(createThread.mock.calls[0][0].id)
      expect(input).toHaveValue('Review the attached notes')
      expect(useChatAttachments.getState().getAttachments(NEW_THREAD_ATTACHMENT_KEY)).toEqual([attachment])
      expect(screen.getByTestId('agent-skill-inline-token')).toHaveTextContent('/agent-builder')

      await act(async () => {
        first.reject(new Error('Conversation could not be saved'))
        await first.promise.catch(() => undefined)
      })

      expect(failure).toHaveBeenCalledWith('Could not send message. Your draft is still here.', {
        description: 'Conversation could not be saved',
      })
      expect(input).toHaveValue('Review the attached notes')
      expect(useChatAttachments.getState().getAttachments(NEW_THREAD_ATTACHMENT_KEY)).toEqual([attachment])
      expect(screen.getByTestId('agent-skill-inline-token')).toHaveTextContent('/agent-builder')
      expect(mocks.navigate).not.toHaveBeenCalled()
      expect(screen.getByRole('button', { name: 'Send message' })).toBeEnabled()

      fireEvent.click(screen.getByRole('button', { name: 'Send message' }))
      expect(createThread).toHaveBeenCalledTimes(2)
      const created = createThread.mock.calls[1][0]
      expect(created.title).toBe('Review the attached notes')
      await act(async () => {
        retry.resolve(created)
        await retry.promise
      })

      expect(useInitialMessage.getState().byThread[created.id]).toMatchObject({
        text: 'Review the attached notes', documents: [attachment], agentSkillName: 'agent-builder',
      })
      expect(mocks.navigate).toHaveBeenCalledOnce()
      expect(input).toHaveValue('')
      expect(useChatAttachments.getState().getAttachments(NEW_THREAD_ATTACHMENT_KEY)).toEqual([])
      expect(screen.queryByTestId('agent-skill-inline-token')).not.toBeInTheDocument()
    } finally {
      failure.mockRestore()
    }
  })

  it('creates only one conversation for repeated first-message Send and Enter while persistence is pending', async () => {
    const pending = deferred<Thread>()
    const createThread = vi.fn<(thread: Thread) => Promise<Thread>>().mockReturnValue(pending.promise)
    seedServiceHub({ threads: { createThread } as never })
    render(<ChatInput initialMessage />)
    const input = screen.getByTestId('chat-input')
    fireEvent.change(input, { target: { value: 'Start one conversation' } })
    const send = screen.getByRole('button', { name: 'Send message' })
    act(() => {
      fireEvent.click(send)
      fireEvent.click(send)
      fireEvent.keyDown(input, { key: 'Enter' })
    })

    expect(createThread).toHaveBeenCalledOnce()
    expect(screen.getByRole('button', { name: 'Preparing message' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Preparing message' })).toHaveAttribute('aria-busy', 'true')
    expect(input).toHaveValue('Start one conversation')
    expect(mocks.navigate).not.toHaveBeenCalled()
    const created = createThread.mock.calls[0][0]
    await act(async () => {
      pending.resolve(created)
      await pending.promise
    })

    expect(mocks.navigate).toHaveBeenCalledOnce()
    expect(useInitialMessage.getState().byThread[created.id]).toMatchObject({ text: 'Start one conversation' })
    expect(input).toHaveValue('')
    expect(screen.getByRole('button', { name: 'Send message' })).toHaveAttribute('aria-busy', 'false')
  })

  it('forwards only the first-message snapshot and keeps text and files added during conversation creation', async () => {
    const pending = deferred<Thread>()
    const createThread = vi.fn<(thread: Thread) => Promise<Thread>>().mockReturnValue(pending.promise)
    seedServiceHub({ threads: { createThread } as never })
    const sent = { ...createDocumentAttachment({ name: 'notes.txt', path: '/docs/sent/notes.txt' }), id: 'home-sent', processed: true }
    const newer = { ...createDocumentAttachment({ name: 'notes.txt', path: '/docs/new/notes.txt' }), id: 'home-new', processed: true }
    useChatAttachments.getState().setAttachments(NEW_THREAD_ATTACHMENT_KEY, [sent])
    render(<ChatInput initialMessage />)
    const input = screen.getByTestId('chat-input')
    fireEvent.change(input, { target: { value: 'Review the first file' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }))
    expect(createThread).toHaveBeenCalledOnce()
    const created = createThread.mock.calls[0][0]
    expect(useThreads.getState().currentThreadId).toBe(created.id)
    expect(input).toBeEnabled()
    fireEvent.change(input, { target: { value: 'My next question' } })
    act(() => useChatAttachments.getState().setAttachments(NEW_THREAD_ATTACHMENT_KEY, (attachments) => [...attachments, newer]))
    expect(useChatAttachments.getState().getAttachments(NEW_THREAD_ATTACHMENT_KEY)).toEqual([sent, newer])

    await act(async () => {
      pending.resolve(created)
      await pending.promise
    })

    expect(created.title).toBe('Review the first file')
    expect(useInitialMessage.getState().byThread[created.id]).toMatchObject({
      text: 'Review the first file', documents: [sent],
    })
    expect(input).toHaveValue('My next question')
    expect(useChatAttachments.getState().getAttachments(NEW_THREAD_ATTACHMENT_KEY)).toEqual([newer])
    expect(screen.getByRole('button', { name: 'Send message' })).toBeEnabled()
    expect(mocks.navigate).toHaveBeenCalledOnce()
  })

  it.each([
    { change: 'catalog arrives and reader is re-enabled', initiallyReady: false, initiallyDisabled: true, ready: true, disabled: false, nativeReference: true },
    { change: 'reader disappears', initiallyReady: true, initiallyDisabled: false, ready: false, disabled: false, nativeReference: false },
    { change: 'reader is disabled', initiallyReady: true, initiallyDisabled: false, ready: true, disabled: true, nativeReference: false },
    { change: 'catalog arrives while reader stays disabled', initiallyReady: false, initiallyDisabled: true, ready: true, disabled: true, nativeReference: false },
  ])('uses current document access when $change during the picker', async ({ initiallyReady, initiallyDisabled, ready, disabled, nativeReference }) => {
    const threadId = 'attachment-thread'
    const reader: CapabilityTool = {
      name: 'os_fs_read_document', identity: 'os.fs.read_document', origin: 'native',
      server: 'gchat-native', description: 'Read a document', inputSchema: {},
    }
    const readerKey = `${reader.server}::${reader.name}`
    let finishPicker!: (paths: string[]) => void
    const open = vi.fn(() => new Promise<string[]>((resolve) => { finishPicker = resolve }))
    const parseDocumentDuringPickerMock = vi.fn().mockResolvedValue('Selected file text')
    const ingestFileAttachment = vi.fn()
    const getTokensCount = vi.fn().mockResolvedValue(16)
    seedServiceHub({
      dialog: { open } as never,
      rag: { parseDocument: parseDocumentDuringPickerMock } as never,
      uploads: { ingestFileAttachment } as never,
      models: { getTokensCount } as never,
    })
    useThreads.setState({ currentThreadId: threadId })
    useAttachments.setState({ enabled: true, parseMode: 'auto', maxFileSizeMB: 20 })
    useAppState.setState({ tools: initiallyReady ? [reader] : [], activeModels: ['test-model'] })
    useToolAvailable.setState({
      defaultDisabledTools: [readerKey],
      disabledTools: { [threadId]: initiallyDisabled ? [readerKey] : [] },
    })
    useModelProvider.setState((state) => ({ selectedModel: {
      ...state.selectedModel!, capabilities: ['tools'],
      settings: { ctx_len: {
        key: 'ctx_len', title: 'Context length', description: 'Model context limit',
        controller_type: 'input', controller_props: { value: 4096 },
      } },
    } }))
    const fileStat = vi.spyOn(fs, 'fileStat').mockResolvedValue(undefined)
    const showPrompt = vi.spyOn(useAttachmentIngestionPrompt.getState(), 'showPrompt')
    try {
      const { container } = render(<ChatInput />)
      fireEvent.keyDown(container.querySelector('button[aria-haspopup="menu"]')!, { key: 'ArrowDown' })
      fireEvent.click(await screen.findByRole('menuitem', { name: 'Add documents or files' }))
      await waitFor(() => expect(open).toHaveBeenCalledOnce())
      act(() => {
        useAppState.setState({ tools: ready ? [reader] : [] })
        useToolAvailable.setState({ disabledTools: { [threadId]: disabled ? [readerKey] : [] } })
      })
      await act(async () => { finishPicker(['/documents/short.pdf']) })
      await waitFor(() => expect(useChatAttachments.getState().getAttachments(threadId)).toHaveLength(1))
      const attachment = useChatAttachments.getState().getAttachments(threadId)[0]
      expect(attachment).toMatchObject({ path: '/documents/short.pdf', parseMode: 'auto' })
      if (nativeReference) {
        expect(attachment.processed).toBeUndefined()
        expect(attachment.inlineContent).toBeUndefined()
        expect(attachment.injectionMode).toBeUndefined()
        expect(parseDocumentDuringPickerMock).not.toHaveBeenCalled()
        expect(getTokensCount).not.toHaveBeenCalled()
      } else {
        await waitFor(() => expect(useChatAttachments.getState().getAttachments(threadId)[0]).toMatchObject({
          processed: true, injectionMode: 'inline', inlineContent: 'Selected file text',
        }))
        expect(parseDocumentDuringPickerMock).toHaveBeenCalledWith('/documents/short.pdf', 'pdf')
      }
      expect(showPrompt).not.toHaveBeenCalled()
      expect(ingestFileAttachment).not.toHaveBeenCalled()
    } finally {
      fileStat.mockRestore()
      showPrompt.mockRestore()
    }
  })

  it('keeps New Chat and two saved conversation drafts separate across navigation and reopening', () => {
    const view = render(<ChatInput initialMessage />)
    const input = () => screen.getByTestId('chat-input')
    fireEvent.change(input(), { target: { value: 'Unsent new conversation' } })

    act(() => useThreads.setState({ currentThreadId: 'draft-a' }))
    view.rerender(<ChatInput />)
    expect(input()).toHaveValue('')
    fireEvent.change(input(), { target: { value: 'Reply to conversation A' } })

    act(() => useThreads.setState({ currentThreadId: 'draft-b' }))
    expect(input()).toHaveValue('')
    fireEvent.change(input(), { target: { value: 'Reply to conversation B' } })

    act(() => useThreads.setState({ currentThreadId: 'draft-a' }))
    expect(input()).toHaveValue('Reply to conversation A')
    view.unmount()

    const reopened = render(<ChatInput initialMessage />)
    expect(input()).toHaveValue('Unsent new conversation')
    reopened.rerender(<ChatInput />)
    expect(input()).toHaveValue('Reply to conversation A')
    act(() => useThreads.setState({ currentThreadId: 'draft-b' }))
    expect(input()).toHaveValue('Reply to conversation B')
  })

  it('restores saved-agent choices with each conversation draft across New Chat and reopening', async () => {
    const user = userEvent.setup()
    agentDefinitions.value = ['researcher', 'reviewer'].map((id) => ({
      id, name: id, kind: 'standard', schemaVersion: 2, skills: [], instructions: '',
      description: '', outputContract: '', maxSteps: 25, modelInstanceId: null, builtIn: false,
    }))
    conversationPolicyState.setActiveDefinition.mockImplementation((threadId: string, definition?: string) => {
      if (definition && definition !== 'general') conversationPolicyState.activeDefinitions[threadId] = definition
      else delete conversationPolicyState.activeDefinitions[threadId]
    })
    useThreads.setState({ currentThreadId: 'agent-draft-a' })
    const view = render(<ChatInput />)
    const choice = () => screen.getByRole('button', { name: 'Invoke saved agent' })
    const input = () => screen.getByTestId('chat-input')
    const choose = async (name: string) => {
      await user.click(choice())
      await user.click(screen.getByRole('menuitemradio', { name, exact: true }))
    }
    await choose('researcher')
    fireEvent.change(input(), { target: { value: 'Plan three weekly priorities' } })
    view.rerender(<ChatInput initialMessage />)
    expect(choice()).toHaveTextContent('Chat')
    expect(input()).toHaveValue('')
    view.rerender(<ChatInput />)
    expect(choice()).toHaveTextContent('researcher')
    expect(input()).toHaveValue('Plan three weekly priorities')

    act(() => useThreads.setState({ currentThreadId: 'agent-draft-b' }))
    expect(choice()).toHaveTextContent('Chat')
    await choose('reviewer')
    fireEvent.change(input(), { target: { value: 'Review the other plan' } })
    view.unmount()
    const reopened = render(<ChatInput />)
    expect(choice()).toHaveTextContent('reviewer')
    expect(input()).toHaveValue('Review the other plan')
    act(() => useThreads.setState({ currentThreadId: 'agent-draft-a' }))
    expect(choice()).toHaveTextContent('researcher')
    expect(input()).toHaveValue('Plan three weekly priorities')
    await choose('Chat')
    reopened.rerender(<ChatInput initialMessage />)
    reopened.rerender(<ChatInput />)
    expect(choice()).toHaveTextContent('Chat')
    act(() => useThreads.setState({ currentThreadId: 'agent-draft-b' }))
    expect(choice()).toHaveTextContent('reviewer')
  })

  it('keeps a changed agent choice when a route preselection is still present', async () => {
    const user = userEvent.setup()
    agentDefinitions.value = ['researcher', 'reviewer'].map((id) => ({
      id, name: id, kind: 'standard', schemaVersion: 2, skills: [], instructions: '',
      description: '', outputContract: '', maxSteps: 25, modelInstanceId: null, builtIn: false,
    }))
    conversationPolicyState.setActiveDefinition.mockImplementation((threadId: string, definition?: string) => {
      if (definition && definition !== 'general') conversationPolicyState.activeDefinitions[threadId] = definition
      else delete conversationPolicyState.activeDefinitions[threadId]
    })
    const view = render(<ChatInput initialMessage preselectedAgentDefinitionId="researcher" />)
    const choice = () => screen.getByRole('button', { name: 'Invoke saved agent' })
    expect(choice()).toHaveTextContent('researcher')
    await user.click(choice())
    await user.click(screen.getByRole('menuitemradio', { name: 'reviewer', exact: true }))
    view.rerender(<ChatInput initialMessage preselectedAgentDefinitionId="researcher" />)
    expect(choice()).toHaveTextContent('reviewer')
    await user.click(choice())
    await user.click(screen.getByRole('menuitemradio', { name: 'Chat', exact: true }))
    view.rerender(<ChatInput initialMessage preselectedAgentDefinitionId="researcher" />)
    expect(choice()).toHaveTextContent('Chat')
  })

  it.each(['click', 'Enter'])('preserves a selected saved agent through catalog loading and rejection, then retries with %s', async (method) => {
    const threadId = 'failed-agent-draft'
    useThreads.setState({ currentThreadId: threadId })
    usePrompt.setState({ drafts: { [threadId]: 'Review the original plan' } })
    conversationPolicyState.activeDefinitions[threadId] = 'reviewer'
    agentDefinitions.loading = true
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    const view = render(<ChatInput onSubmit={onSubmit} />)
    const input = screen.getByTestId('chat-input')
    const send = screen.getByRole('button', { name: 'Send message' })
    expect(screen.getByRole('status')).toHaveTextContent('Loading your selected saved agent…')
    expect(send).toBeDisabled()
    expect(send).toHaveAttribute('aria-busy', 'true')
    fireEvent.click(send)
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onSubmit).not.toHaveBeenCalled()
    expect(input).toHaveValue('Review the original plan')

    const catalog = deferred<AgentDefinition[]>()
    const rejected = catalog.promise.catch((error) => {
      agentDefinitions.loading = false
      agentDefinitions.error = String(error)
      // The catalog mock is not reactive; change a prop to rerender the memoized composer.
      view.rerender(<ChatInput onSubmit={onSubmit} chatStatus="ready" />)
    })
    await act(async () => {
      catalog.reject(new Error('Permission denied'))
      await rejected
    })
    expect(screen.getByRole('alert')).toHaveTextContent("Couldn't load saved agents.")
    expect(send).toBeDisabled()
    expect(send).toHaveAttribute('aria-busy', 'false')
    fireEvent.click(send)
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onSubmit).not.toHaveBeenCalled()
    expect(input).toHaveValue('Review the original plan')
    expect(conversationPolicyState.activeDefinitions[threadId]).toBe('reviewer')
    expect(conversationPolicyState.setActiveDefinition).not.toHaveBeenCalled()

    const retry = deferred<AgentDefinition[]>()
    agentDefinitions.load.mockImplementation(() => {
      agentDefinitions.loading = true
      agentDefinitions.error = null
      view.rerender(<ChatInput onSubmit={onSubmit} />)
      return retry.promise.then((definitions) => {
        agentDefinitions.value = definitions
        agentDefinitions.loading = false
        view.rerender(<ChatInput onSubmit={onSubmit} chatStatus="ready" />)
      })
    })
    fireEvent.click(screen.getByRole('button', { name: 'Retry saved agents' }))
    expect(agentDefinitions.load).toHaveBeenCalledOnce()
    expect(screen.getByRole('status')).toHaveTextContent('Loading your selected saved agent…')
    expect(send).toBeDisabled()
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onSubmit).not.toHaveBeenCalled()
    await act(async () => {
      retry.resolve([{
        id: 'reviewer', name: 'Reviewer', kind: 'standard', schemaVersion: 2,
        skills: [], instructions: '', description: '', outputContract: '',
        maxSteps: 25, modelInstanceId: null, builtIn: false,
      }])
      await agentDefinitions.load.mock.results[0].value
    })
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Invoke saved agent' })).toHaveTextContent('Reviewer')
    expect(send).toBeEnabled()
    expect(input).toHaveValue('Review the original plan')
    if (method === 'click') fireEvent.click(send)
    else fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => expect(onSubmit).toHaveBeenCalledExactlyOnceWith('Review the original plan', undefined, undefined, 'reviewer', []))
    expect(input).toHaveValue('')
  })

  it.each(['loading', 'failed'])('requires explicit Chat selection for a %s saved-agent catalog without sending or clearing an independent skill', async (status) => {
    const threadId = 'agent-opt-out-draft'
    useThreads.setState({ currentThreadId: threadId })
    usePrompt.setState({
      drafts: { [threadId]: 'Summarize the document', other: 'Other draft' },
      draftSkills: { [threadId]: 'pdf', other: 'slides' },
    })
    conversationPolicyState.activeDefinitions = { [threadId]: 'reviewer', other: 'researcher' }
    conversationPolicyState.activeSkills[threadId] = 'pdf'
    conversationPolicyState.setActiveDefinition.mockImplementation((key: string, definition?: string) => {
      if (definition && definition !== 'general') conversationPolicyState.activeDefinitions[key] = definition
      else delete conversationPolicyState.activeDefinitions[key]
    })
    agentSkills.value = [{
      name: 'pdf', description: 'PDF', version: '1.0.0', requiresTools: [], requiresScripts: [],
      dangerous: false, platforms: null, enabled: true, compatible: true,
      reserved: false, unavailableReasons: [], error: null,
    }]
    agentDefinitions.loading = status === 'loading'
    agentDefinitions.error = status === 'failed' ? 'Permission denied' : null
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    render(<ChatInput onSubmit={onSubmit} />)
    const input = screen.getByTestId('chat-input')
    const send = screen.getByRole('button', { name: 'Send message' })
    expect(send).toBeDisabled()
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onSubmit).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Use Chat instead' }))
    expect(onSubmit).not.toHaveBeenCalled()
    expect(input).toHaveValue('Summarize the document')
    expect(conversationPolicyState.activeDefinitions[threadId]).toBeUndefined()
    expect(conversationPolicyState.activeDefinitions.other).toBe('researcher')
    expect(usePrompt.getState().drafts.other).toBe('Other draft')
    expect(usePrompt.getState().draftSkills).toEqual({ [threadId]: 'pdf', other: 'slides' })
    expect(conversationPolicyState.activeSkills[threadId]).toBe('pdf')
    expect(conversationPolicyState.setActiveSkill).not.toHaveBeenCalled()
    expect(screen.getByTestId('agent-skill-inline-token')).toHaveTextContent('/pdf')
    expect(screen.queryByRole('button', { name: 'Use Chat instead' })).not.toBeInTheDocument()
    expect(send).toBeEnabled()
    fireEvent.click(send)
    await waitFor(() => expect(onSubmit).toHaveBeenCalledExactlyOnceWith('Summarize the document', undefined, 'pdf', undefined, []))
  })

  it.each(['loading', 'failed'])('allows ordinary Chat when the saved-agent catalog is %s', async (status) => {
    agentDefinitions.loading = status === 'loading'
    agentDefinitions.error = status === 'failed' ? 'Permission denied' : null
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    render(<ChatInput onSubmit={onSubmit} />)
    fireEvent.change(screen.getByTestId('chat-input'), { target: { value: 'An ordinary question' } })
    const send = screen.getByRole('button', { name: 'Send message' })
    expect(send).toBeEnabled()
    expect(screen.queryByRole('button', { name: 'Use Chat instead' })).not.toBeInTheDocument()
    fireEvent.click(send)
    await waitFor(() => expect(onSubmit).toHaveBeenCalledExactlyOnceWith('An ordinary question', undefined, undefined, undefined, []))
  })

  it.each(['loading', 'failed'])('reserves /compact when the selected saved-agent catalog is %s', async (status) => {
    const threadId = 'agent-compact-draft'
    useThreads.setState({ currentThreadId: threadId })
    conversationPolicyState.activeDefinitions[threadId] = 'reviewer'
    agentDefinitions.loading = status === 'loading'
    agentDefinitions.error = status === 'failed' ? 'Permission denied' : null
    useModelProvider.setState({ selectedModel: undefined })
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    render(<ChatInput onSubmit={onSubmit} />)
    const input = screen.getByTestId('chat-input')
    fireEvent.change(input, { target: { value: '/compact' } })
    const send = screen.getByRole('button', { name: 'Send message' })
    expect(send).toBeEnabled()
    expect(send).toHaveAttribute('aria-busy', 'false')
    if (status === 'loading') fireEvent.click(send)
    else fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => expect(onSubmit).toHaveBeenCalledExactlyOnceWith('/compact'))
    expect(input).toHaveValue('')
    expect(conversationPolicyState.activeDefinitions[threadId]).toBe('reviewer')
    expect(conversationPolicyState.setActiveDefinition).not.toHaveBeenCalled()
    expect(mocks.navigate).not.toHaveBeenCalled()
  })

  it('clears only the submitted conversation draft after a successful send', async () => {
    usePrompt.getState().setPrompt('Unsent home draft')
    useThreads.setState({ currentThreadId: 'sent-conversation' })
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    const view = render(<ChatInput onSubmit={onSubmit} />)
    fireEvent.change(screen.getByTestId('chat-input'), { target: { value: 'Send this reply' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }))
    await waitFor(() => expect(screen.getByTestId('chat-input')).toHaveValue(''))
    expect(onSubmit).toHaveBeenCalledWith('Send this reply', undefined, undefined, undefined, [])

    view.rerender(<ChatInput initialMessage />)
    expect(screen.getByTestId('chat-input')).toHaveValue('Unsent home draft')
    view.rerender(<ChatInput />)
    expect(screen.getByTestId('chat-input')).toHaveValue('')
  })

  it('restores each draft skill with its text across New Chat, conversation switches and reopening', () => {
    agentSkills.value = ['pdf', 'slides'].map((name) => ({
      name, description: name, version: '1.0.0', requiresTools: [], requiresScripts: [],
      dangerous: false, platforms: null, enabled: true, compatible: true,
      reserved: false, unavailableReasons: [], error: null,
    }))
    useThreads.setState({ currentThreadId: 'skill-draft-a' })
    const view = render(<ChatInput />)
    const input = () => screen.getByTestId('chat-input')
    const chooseSkill = (name: string) => {
      fireEvent.change(input(), { target: { value: `/${name}` } })
      fireEvent.keyDown(input(), { key: 'Enter' })
      expect(screen.getByTestId('agent-skill-inline-token')).toHaveTextContent(`/${name}`)
    }
    chooseSkill('pdf')
    fireEvent.change(input(), { target: { value: 'Summarize the document' } })

    view.rerender(<ChatInput initialMessage />)
    expect(input()).toHaveValue('')
    expect(screen.queryByTestId('agent-skill-inline-token')).not.toBeInTheDocument()
    chooseSkill('slides')
    fireEvent.change(input(), { target: { value: 'Prepare a presentation' } })

    view.rerender(<ChatInput />)
    expect(input()).toHaveValue('Summarize the document')
    expect(screen.getByTestId('agent-skill-inline-token')).toHaveTextContent('/pdf')
    act(() => useThreads.setState({ currentThreadId: 'skill-draft-b' }))
    expect(input()).toHaveValue('')
    expect(screen.queryByTestId('agent-skill-inline-token')).not.toBeInTheDocument()
    view.unmount()

    const reopened = render(<ChatInput initialMessage />)
    expect(input()).toHaveValue('Prepare a presentation')
    expect(screen.getByTestId('agent-skill-inline-token')).toHaveTextContent('/slides')
    reopened.rerender(<ChatInput />)
    act(() => useThreads.setState({ currentThreadId: 'skill-draft-a' }))
    expect(input()).toHaveValue('Summarize the document')
    expect(screen.getByTestId('agent-skill-inline-token')).toHaveTextContent('/pdf')
    fireEvent.change(input(), { target: { value: '' } })
    fireEvent.keyDown(input(), { key: 'Backspace' })
    expect(screen.queryByTestId('agent-skill-inline-token')).not.toBeInTheDocument()
    reopened.rerender(<ChatInput initialMessage />)
    expect(screen.getByTestId('agent-skill-inline-token')).toHaveTextContent('/slides')
    reopened.rerender(<ChatInput />)
    expect(screen.queryByTestId('agent-skill-inline-token')).not.toBeInTheDocument()
  })

  it.each([
    { method: 'click', previousSkill: undefined },
    { method: 'Enter', previousSkill: 'slides' },
  ])('waits for a reopened draft skill catalog before submitting with $method', async ({ method, previousSkill }) => {
    const threadId = 'loading-skill-draft'
    const skills = ['pdf', 'slides'].map((name) => ({
      name, description: name, version: '1.0.0', requiresTools: [], requiresScripts: [],
      dangerous: false, platforms: null, enabled: true, compatible: true,
      reserved: false, unavailableReasons: [], error: null,
    }))
    agentSkills.value = skills
    useThreads.setState({ currentThreadId: threadId })
    if (previousSkill) conversationPolicyState.activeSkills[threadId] = previousSkill
    const first = render(<ChatInput />)
    fireEvent.change(screen.getByTestId('chat-input'), { target: { value: '/pdf' } })
    fireEvent.keyDown(screen.getByTestId('chat-input'), { key: 'Enter' })
    fireEvent.change(screen.getByTestId('chat-input'), { target: { value: 'Summarize the document' } })
    first.unmount()

    const catalog = deferred<AgentSkill[]>()
    agentSkills.value = []
    agentSkills.loading = true
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    const view = render(<ChatInput onSubmit={onSubmit} />)
    const loaded = catalog.promise.then((value) => {
      agentSkills.value = value
      agentSkills.loading = false
      // The mock catalog is not reactive; change a prop to rerender the memoized composer.
      view.rerender(<ChatInput onSubmit={onSubmit} chatStatus="ready" />)
    })
    const input = screen.getByTestId('chat-input')
    const send = document.querySelector('[data-test-id="send-message-button"]')!
    expect(send).toBeDisabled()
    expect(send).toHaveAccessibleName('Restoring selected skill')
    expect(send).toHaveAttribute('aria-busy', 'true')
    fireEvent.click(send)
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onSubmit).not.toHaveBeenCalled()
    expect(conversationPolicyState.setActiveSkill).not.toHaveBeenCalled()
    expect(input).toHaveValue('Summarize the document')
    expect(usePrompt.getState().draftSkills[threadId]).toBe('pdf')

    await act(async () => {
      catalog.resolve(skills)
      await loaded
    })
    expect(screen.getByTestId('agent-skill-inline-token')).toHaveTextContent('/pdf')
    expect(screen.getByRole('button', { name: 'Send message' })).toBeEnabled()
    if (method === 'click') fireEvent.click(send)
    else fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => expect(onSubmit).toHaveBeenCalledExactlyOnceWith('Summarize the document', undefined, 'pdf', undefined, []))
    expect(input).toHaveValue('')
    expect(usePrompt.getState().draftSkills[threadId]).toBeUndefined()
  })

  it.each(['loading', 'failed'])('allows ordinary chat when the skill catalog is %s and there is no draft skill', async (status) => {
    agentSkills.loading = status === 'loading'
    agentSkills.error = status === 'failed' ? 'catalog read failed' : null
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    render(<ChatInput onSubmit={onSubmit} />)
    fireEvent.change(screen.getByTestId('chat-input'), { target: { value: 'An ordinary question' } })
    const send = screen.getByRole('button', { name: 'Send message' })
    expect(send).toBeEnabled()
    fireEvent.click(send)
    await waitFor(() => expect(onSubmit).toHaveBeenCalledExactlyOnceWith('An ordinary question', undefined, undefined, undefined, []))
  })

  it.each(['click', 'Enter'])('keeps a reopened skill draft blocked after a rejected catalog read, then retries with %s', async (method) => {
    const threadId = 'failed-skill-draft'
    useThreads.setState({ currentThreadId: threadId })
    usePrompt.setState({
      drafts: { [threadId]: 'Summarize the document' },
      draftSkills: { [threadId]: 'pdf' },
    })
    conversationPolicyState.activeSkills[threadId] = 'slides'
    agentSkills.loading = true
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    const view = render(<ChatInput onSubmit={onSubmit} />)
    const catalog = deferred<AgentSkill[]>()
    const rejected = catalog.promise.catch((error) => {
      agentSkills.loading = false
      agentSkills.error = String(error)
      view.rerender(<ChatInput onSubmit={onSubmit} chatStatus="ready" />)
    })
    await act(async () => {
      catalog.reject(new Error('catalog read failed'))
      await rejected
    })

    const input = screen.getByTestId('chat-input')
    const send = document.querySelector('[data-test-id="send-message-button"]')!
    expect(screen.getByRole('alert')).toHaveTextContent("Couldn't load skills. Retry to restore /pdf")
    expect(send).toBeDisabled()
    expect(send).toHaveAttribute('aria-busy', 'false')
    fireEvent.click(send)
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onSubmit).not.toHaveBeenCalled()
    expect(conversationPolicyState.setActiveSkill).not.toHaveBeenCalled()
    expect(input).toHaveValue('Summarize the document')
    expect(usePrompt.getState().draftSkills[threadId]).toBe('pdf')

    const retry = deferred<AgentSkill[]>()
    agentSkills.load.mockImplementation(() => {
      agentSkills.loading = true
      agentSkills.error = null
      view.rerender(<ChatInput onSubmit={onSubmit} />)
      return retry.promise.then((skills) => {
        agentSkills.value = skills
        agentSkills.loading = false
        view.rerender(<ChatInput onSubmit={onSubmit} chatStatus="ready" />)
      })
    })
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(agentSkills.load).toHaveBeenCalledOnce()
    expect(send).toBeDisabled()
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onSubmit).not.toHaveBeenCalled()
    expect(usePrompt.getState().draftSkills[threadId]).toBe('pdf')
    await act(async () => {
      retry.resolve([{
        name: 'pdf', description: 'PDF', version: '1.0.0', requiresTools: [], requiresScripts: [],
        dangerous: false, platforms: null, enabled: true, compatible: true,
        reserved: false, unavailableReasons: [], error: null,
      }])
      await agentSkills.load.mock.results[0].value
    })
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByTestId('agent-skill-inline-token')).toHaveTextContent('/pdf')
    if (method === 'click') fireEvent.click(send)
    else fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => expect(onSubmit).toHaveBeenCalledExactlyOnceWith('Summarize the document', undefined, 'pdf', undefined, []))
  })

  it.each(['click', 'Enter'])('preserves Try in chat skill intent through a deferred catalog rejection and retry with %s', async (method) => {
    const threadId = 'try-skill-retry'
    const prompt = 'Build a document-review agent'
    useThreads.setState({ currentThreadId: threadId })
    usePrompt.setState({ drafts: { [threadId]: prompt } })
    conversationPolicyState.activeSkills[threadId] = 'slides'
    agentSkills.loading = true
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    const view = render(<ChatInput onSubmit={onSubmit} preselectedAgentSkillName="agent-builder" />)
    const input = screen.getByTestId('chat-input')
    const send = document.querySelector('[data-test-id="send-message-button"]')!

    // Studio supplies a route choice, not an already-restored draft skill.
    expect(usePrompt.getState().draftSkills[threadId]).toBe('agent-builder')
    expect(send).toBeDisabled()
    expect(send).toHaveAccessibleName('Restoring selected skill')
    expect(send).toHaveAttribute('aria-busy', 'true')
    fireEvent.click(send)
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onSubmit).not.toHaveBeenCalled()
    expect(input).toHaveValue(prompt)

    const catalog = deferred<AgentSkill[]>()
    const rejected = catalog.promise.catch((error) => {
      agentSkills.loading = false
      agentSkills.error = String(error)
      view.rerender(<ChatInput onSubmit={onSubmit} preselectedAgentSkillName="agent-builder" chatStatus="ready" />)
    })
    await act(async () => {
      catalog.reject(new Error('catalog read failed'))
      await rejected
    })
    expect(screen.getByRole('alert')).toHaveTextContent("Couldn't load skills. Retry to restore /agent-builder")
    expect(screen.getByRole('button', { name: 'Send without skill' })).toBeEnabled()
    expect(send).toBeDisabled()
    expect(send).toHaveAttribute('aria-busy', 'false')
    fireEvent.click(send)
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onSubmit).not.toHaveBeenCalled()
    expect(conversationPolicyState.setActiveSkill).not.toHaveBeenCalled()
    expect(input).toHaveValue(prompt)
    expect(usePrompt.getState().draftSkills[threadId]).toBe('agent-builder')

    const retry = deferred<AgentSkill[]>()
    agentSkills.load.mockImplementation(() => {
      agentSkills.loading = true
      agentSkills.error = null
      view.rerender(<ChatInput onSubmit={onSubmit} preselectedAgentSkillName="agent-builder" />)
      return retry.promise.then((skills) => {
        agentSkills.value = skills
        agentSkills.loading = false
        view.rerender(<ChatInput onSubmit={onSubmit} preselectedAgentSkillName="agent-builder" chatStatus="ready" />)
      })
    })
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(agentSkills.load).toHaveBeenCalledOnce()
    expect(send).toBeDisabled()
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onSubmit).not.toHaveBeenCalled()
    await act(async () => {
      retry.resolve(['agent-builder', 'slides'].map((name) => ({
        name, description: name, version: '1.0.0', requiresTools: [], requiresScripts: [],
        dangerous: false, platforms: null, enabled: true, compatible: true,
        reserved: false, unavailableReasons: [], error: null,
      })))
      await agentSkills.load.mock.results[0].value
    })
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByTestId('agent-skill-inline-token')).toHaveTextContent('/agent-builder')
    expect(screen.getByRole('button', { name: 'Send message' })).toBeEnabled()
    if (method === 'click') fireEvent.click(send)
    else fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => expect(onSubmit).toHaveBeenCalledExactlyOnceWith(prompt, undefined, 'agent-builder', undefined, []))
    expect(conversationPolicyState.setActiveSkill).toHaveBeenCalledWith(threadId, 'agent-builder')
    expect(usePrompt.getState().draftSkills[threadId]).toBeUndefined()
  })

  it.each(['failed', 'missing'])('keeps a Try in chat skill opt-out after a %s catalog across same-route rerenders and conversation changes', async (status) => {
    const threadId = 'try-skill-opt-out'
    useThreads.setState({ currentThreadId: threadId })
    usePrompt.setState({
      drafts: { [threadId]: 'Build an agent', other: 'Other draft' },
      draftSkills: { other: 'pdf' },
    })
    conversationPolicyState.activeSkills = { [threadId]: 'slides', other: 'pdf' }
    conversationPolicyState.setActiveSkill.mockImplementation((key: string, name?: string) => {
      if (name) conversationPolicyState.activeSkills[key] = name
      else delete conversationPolicyState.activeSkills[key]
    })
    agentSkills.error = status === 'failed' ? 'catalog read failed' : null
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    const view = render(<ChatInput onSubmit={onSubmit} preselectedAgentSkillName="agent-builder" />)
    expect(usePrompt.getState().draftSkills[threadId]).toBe('agent-builder')
    expect(screen.getByRole('alert')).toHaveTextContent(status === 'failed'
      ? "Couldn't load skills. Retry to restore /agent-builder"
      : "Skill /agent-builder isn't available")
    expect(document.querySelector('[data-test-id="send-message-button"]')).toBeDisabled()
    fireEvent.keyDown(screen.getByTestId('chat-input'), { key: 'Enter' })
    expect(onSubmit).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Send without skill' }))
    await waitFor(() => expect(onSubmit).toHaveBeenCalledExactlyOnceWith('Build an agent', undefined, undefined, undefined, []))
    expect(usePrompt.getState().draftSkills[threadId]).toBeUndefined()
    expect(conversationPolicyState.activeSkills[threadId]).toBeUndefined()
    expect(conversationPolicyState.setActiveSkill).toHaveBeenCalledWith(threadId)

    // Catalog completion and rerenders of the unchanged route must not undo the opt-out.
    agentSkills.error = null
    agentSkills.value = ['agent-builder', 'slides', 'pdf'].map((name) => ({
      name, description: name, version: '1.0.0', requiresTools: [], requiresScripts: [],
      dangerous: false, platforms: null, enabled: true, compatible: true,
      reserved: false, unavailableReasons: [], error: null,
    }))
    view.rerender(<ChatInput onSubmit={onSubmit} preselectedAgentSkillName="agent-builder" chatStatus="ready" />)
    expect(screen.queryByTestId('agent-skill-inline-token')).not.toBeInTheDocument()
    expect(usePrompt.getState().draftSkills[threadId]).toBeUndefined()
    fireEvent.change(screen.getByTestId('chat-input'), { target: { value: 'Continue without a skill' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }))
    await waitFor(() => expect(onSubmit).toHaveBeenLastCalledWith('Continue without a skill', undefined, undefined, undefined, []))

    act(() => useThreads.setState({ currentThreadId: 'other' }))
    expect(screen.getByTestId('chat-input')).toHaveValue('Other draft')
    expect(screen.getByTestId('agent-skill-inline-token')).toHaveTextContent('/pdf')
    expect(usePrompt.getState().draftSkills.other).toBe('pdf')
    expect(conversationPolicyState.activeSkills.other).toBe('pdf')
    expect(onSubmit).toHaveBeenCalledTimes(2)
  })

  it.each(['failed', 'missing'])('requires explicit Send without skill for a %s draft skill and clears the previous active skill', async (status) => {
    const threadId = 'without-skill-draft'
    useThreads.setState({ currentThreadId: threadId })
    usePrompt.setState({
      drafts: { [threadId]: 'Summarize the document', other: 'Other draft' },
      draftSkills: { [threadId]: 'pdf', other: 'slides' },
    })
    conversationPolicyState.activeSkills = { [threadId]: 'slides', other: 'slides' }
    conversationPolicyState.setActiveSkill.mockImplementation((key: string, name?: string) => {
      if (name) conversationPolicyState.activeSkills[key] = name
      else delete conversationPolicyState.activeSkills[key]
    })
    agentSkills.error = status === 'failed' ? 'catalog read failed' : null
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    const view = render(<ChatInput onSubmit={onSubmit} />)
    const input = screen.getByTestId('chat-input')
    expect(document.querySelector('[data-test-id="send-message-button"]')).toBeDisabled()
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onSubmit).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Send without skill' }))
    await waitFor(() => expect(onSubmit).toHaveBeenCalledExactlyOnceWith('Summarize the document', undefined, undefined, undefined, []))
    expect(usePrompt.getState().draftSkills[threadId]).toBeUndefined()
    expect(conversationPolicyState.activeSkills[threadId]).toBeUndefined()
    expect(usePrompt.getState().draftSkills.other).toBe('slides')
    expect(usePrompt.getState().drafts.other).toBe('Other draft')
    expect(conversationPolicyState.activeSkills.other).toBe('slides')

    // The opt-out must also stick for later messages in the same conversation.
    view.unmount()
    render(<ChatInput onSubmit={onSubmit} />)
    fireEvent.change(screen.getByTestId('chat-input'), { target: { value: 'Next question' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }))
    await waitFor(() => expect(onSubmit).toHaveBeenLastCalledWith('Next question', undefined, undefined, undefined, []))
  })

  it.each([false, true])('clears the sending thread skill after an attachment send finishes away from its composer (reopen=%s)', async (reopen) => {
    agentSkills.value = ['pdf', 'slides'].map((name) => ({
      name, description: name, version: '1.0.0', requiresTools: [], requiresScripts: [],
      dangerous: false, platforms: null, enabled: true, compatible: true,
      reserved: false, unavailableReasons: [], error: null,
    }))
    useThreads.setState({ currentThreadId: 'skill-send-a' })
    const attachment = { ...createDocumentAttachment({ name: 'notes.pdf', path: '/docs/notes.pdf' }), id: 'skill-notes', processed: true }
    useChatAttachments.getState().setAttachments('skill-send-a', [attachment])
    const pending = deferred<void>()
    const onSubmit = vi.fn().mockReturnValue(pending.promise)
    let view = render(<ChatInput onSubmit={onSubmit} preselectedAgentSkillName="pdf" />)
    fireEvent.change(screen.getByTestId('chat-input'), { target: { value: 'Summarize the document' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }))
    expect(onSubmit).toHaveBeenCalledExactlyOnceWith('Summarize the document', undefined, 'pdf', undefined, [attachment])

    act(() => useThreads.setState({ currentThreadId: 'skill-send-b' }))
    if (reopen) {
      view.unmount()
      view = render(<ChatInput onSubmit={onSubmit} />)
    } else {
      view.rerender(<ChatInput onSubmit={onSubmit} />)
    }
    const input = screen.getByTestId('chat-input')
    expect(screen.queryByTestId('agent-skill-inline-token')).not.toBeInTheDocument()
    fireEvent.change(input, { target: { value: '/slides' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    fireEvent.change(input, { target: { value: 'Prepare a presentation' } })
    await act(async () => {
      pending.resolve(undefined)
      await pending.promise
    })

    expect(input).toHaveValue('Prepare a presentation')
    expect(screen.getByTestId('agent-skill-inline-token')).toHaveTextContent('/slides')
    act(() => useThreads.setState({ currentThreadId: 'skill-send-a' }))
    expect(input).toHaveValue('')
    expect(screen.queryByTestId('agent-skill-inline-token')).not.toBeInTheDocument()
    expect(useChatAttachments.getState().getAttachments('skill-send-a')).toEqual([])
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

  it('names the attach button and says why documents are unavailable for a model without tools', async () => {
    const { unmount } = render(<ChatInput />)
    const attach = screen.getByRole('button', { name: 'chat:attachMenu.label' })
    fireEvent.keyDown(attach, { key: 'ArrowDown' })

    const documents = await screen.findByRole('menuitem', { name: /Add documents or files/ })
    expect(documents).toHaveAttribute('aria-disabled', 'true')
    expect(documents).toHaveTextContent('chat:attachMenu.documentsNeedTools')
    unmount()
  })

  it('announces the choose-a-model hint and dismisses it with a keyboard-reachable button', () => {
    useModelProvider.setState({ selectedModel: undefined })
    const { unmount } = render(<ChatInput />)
    const input = screen.getByTestId('chat-input')
    fireEvent.change(input, { target: { value: 'Hello' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent('chat:selectModelToChat')
    const dismiss = screen.getByRole('button', { name: 'common:close' })
    expect(dismiss.tagName).toBe('BUTTON')
    fireEvent.click(dismiss)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(input).toHaveFocus()
    unmount()
  })

  it('toggles native web tools through the shared defaults without a hosted web-search capability', () => {
    useModelProvider.setState((state) => ({ selectedModel: { ...state.selectedModel!, capabilities: ['tools'] } }))
    useAppState.setState({ tools: [...webTools, fileTool] })
    useToolAvailable.setState({ defaultDisabledTools: ['GChat::native_read'], disabledTools: { other: ['GChat::native_fetch'] } })
    const { unmount } = render(<ChatInput initialMessage />)
    const globe = screen.getByRole('button', { name: 'Web search' })
    expect(globe).toBeEnabled()
    expect(globe).toHaveAttribute('aria-pressed', 'true')

    fireEvent.click(globe)
    expect(globe).toHaveAttribute('aria-pressed', 'false')
    expect(useToolAvailable.getState().getDefaultDisabledTools()).toEqual([
      'GChat::native_read', 'GChat::native_search', 'GChat::native_fetch',
    ])
    expect(useToolAvailable.getState().disabledTools.other).toEqual(['GChat::native_fetch'])
    unmount()
    render(<ChatInput initialMessage />)
    expect(screen.getByRole('button', { name: 'Web search' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('reflects individual Tools changes and enables both web tools from the partial state', () => {
    useModelProvider.setState((state) => ({ selectedModel: { ...state.selectedModel!, capabilities: ['tools'] } }))
    useAppState.setState({ tools: [...webTools, fileTool] })
    useThreads.setState({ currentThreadId: 'thread-web' })
    useToolAvailable.setState({ disabledTools: { 'thread-web': ['GChat::native_read'] } })
    render(<ChatInput />)
    const globe = screen.getByRole('button', { name: 'Web search' })

    act(() => useToolAvailable.getState().setToolDisabledForThread('thread-web', 'GChat', 'native_fetch', false))
    expect(globe).toHaveAttribute('aria-pressed', 'mixed')
    expect(globe).toHaveAccessibleDescription('Web search is partially enabled. Enable search and page reading.')
    fireEvent.click(globe)
    expect(globe).toHaveAttribute('aria-pressed', 'true')
    expect(useToolAvailable.getState().getDisabledToolsForThread('thread-web')).toEqual(['GChat::native_read'])
    fireEvent.click(globe)
    expect(globe).toHaveAttribute('aria-pressed', 'false')
    expect(useToolAvailable.getState().getDisabledToolsForThread('thread-web')).toEqual([
      'GChat::native_read', 'GChat::native_search', 'GChat::native_fetch',
    ])
  })

  it('preserves inherited unrelated exclusions when first changing web tools in a thread', () => {
    useModelProvider.setState((state) => ({ selectedModel: { ...state.selectedModel!, capabilities: ['tools'] } }))
    useAppState.setState({ tools: [...webTools, fileTool] })
    useThreads.setState({ currentThreadId: 'new-thread' })
    const defaults = ['GChat::native_read', 'GChat::native_search', 'GChat::native_fetch']
    useToolAvailable.setState({ defaultDisabledTools: defaults, disabledTools: { other: ['GChat::native_search'] } })
    render(<ChatInput />)
    const globe = screen.getByRole('button', { name: 'Web search' })
    expect(globe).toHaveAttribute('aria-pressed', 'false')
    fireEvent.click(globe)
    expect(useToolAvailable.getState().getDisabledToolsForThread('new-thread')).toEqual(['GChat::native_read'])
    expect(useToolAvailable.getState().getDefaultDisabledTools()).toEqual(defaults)
    expect(useToolAvailable.getState().disabledTools.other).toEqual(['GChat::native_search'])
  })

  it('requires ordinary model tool support even when a model advertises hosted web search', () => {
    useModelProvider.setState((state) => ({ selectedModel: { ...state.selectedModel!, capabilities: ['web_search'] } }))
    useAppState.setState({ tools: webTools })
    render(<ChatInput initialMessage />)
    const globe = screen.getByRole('button', { name: 'Web search' })
    expect(globe).toBeDisabled()
    expect(globe).toHaveAccessibleDescription('Select a model that supports tools to use web search.')
    fireEvent.click(globe)
    expect(useToolAvailable.getState().getDefaultDisabledTools()).toEqual([])
  })

  it('does not present missing or MCP-shadowed native web tools as usable', () => {
    useModelProvider.setState((state) => ({ selectedModel: { ...state.selectedModel!, capabilities: ['tools'] } }))
    useAppState.setState({ tools: [webTools[0], { ...webTools[1], origin: 'mcp' }] })
    render(<ChatInput initialMessage />)
    const globe = screen.getByRole('button', { name: 'Web search' })
    expect(globe).toBeDisabled()
    expect(globe).toHaveAccessibleDescription('Native web search and page reading tools are unavailable.')
    act(() => useAppState.setState({ tools: webTools }))
    expect(globe).toBeEnabled()
    expect(globe).toHaveAttribute('aria-pressed', 'true')
  })

  it('does not change defaults or another thread when no conversation is open', () => {
    useModelProvider.setState((state) => ({ selectedModel: { ...state.selectedModel!, capabilities: ['tools'] } }))
    useAppState.setState({ tools: webTools })
    const defaults = ['GChat::native_search']
    const otherThread = ['GChat::native_fetch']
    useToolAvailable.setState({ defaultDisabledTools: defaults, disabledTools: { other: otherThread } })
    render(<ChatInput />)
    const globe = screen.getByRole('button', { name: 'Web search' })
    expect(globe).toBeDisabled()
    expect(globe).toHaveAccessibleDescription('Open a conversation to change web search.')
    fireEvent.click(globe)
    expect(useToolAvailable.getState().getDefaultDisabledTools()).toEqual(defaults)
    expect(useToolAvailable.getState().disabledTools).toEqual({ other: otherThread })
  })

  it('shows folders, approvals and inline saved-agent invocation in ordinary Chat', () => {
    conversationPolicyState.defaultApprovalMode = 'skip'
    agentDefinitions.value = [{ id: 'workflow-1', name: 'Workflow' } as AgentDefinition]
    render(<ChatInput />)

    expect(screen.getByTestId('approval-mode-control')).toHaveAttribute('data-mode', 'skip')
    expect(screen.getByTestId('external-folder-control')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Invoke saved agent' })).toHaveTextContent('Chat')
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
      undefined,
      []
    )
    await waitFor(() => expect(input).toHaveValue(''))
    unmount()
  })

  it('retains the submitted draft, attachment and selected skill after failure so the user can retry', async () => {
    const threadId = 'submission-retry'
    useThreads.setState({ currentThreadId: threadId })
    agentSkills.value = [{ name: 'agent-builder', description: 'Build agents', version: '1.2.0', requiresTools: [], requiresScripts: [], dangerous: false, platforms: null, enabled: true, compatible: true, reserved: false, unavailableReasons: [], error: null }]
    const attachment = { ...createDocumentAttachment({ name: 'notes.txt', path: '/docs/notes.txt' }), id: 'review-notes', processed: true }
    useChatAttachments.getState().setAttachments(threadId, [attachment])
    const first = deferred<void>()
    const retry = deferred<void>()
    const onSubmit = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(retry.promise)
    const failure = vi.spyOn(toast, 'error')
    try {
      render(<ChatInput onSubmit={onSubmit} chatStatus="ready" preselectedAgentSkillName="agent-builder" />)
      const input = screen.getByTestId('chat-input')
      fireEvent.change(input, { target: { value: 'Review the attached notes' } })
      fireEvent.click(screen.getByRole('button', { name: 'Send message' }))
      expect(input).toHaveValue('Review the attached notes')
      expect(screen.getByTestId('agent-skill-inline-token')).toHaveTextContent('/agent-builder')

      await act(async () => {
        first.reject(new Error('Document preparation failed'))
        await first.promise.catch(() => undefined)
      })

      expect(failure).toHaveBeenCalledWith('Could not send message. Your draft is still here.', {
        description: 'Document preparation failed',
      })
      expect(input).toHaveValue('Review the attached notes')
      expect(useChatAttachments.getState().getAttachments(threadId)).toEqual([attachment])
      expect(screen.getByTestId('agent-skill-inline-token')).toHaveTextContent('/agent-builder')
      expect(screen.getByRole('button', { name: 'Send message' })).toBeEnabled()
      expect(onSubmit).toHaveBeenCalledExactlyOnceWith('Review the attached notes', undefined, 'agent-builder', undefined, [attachment])

      fireEvent.click(screen.getByRole('button', { name: 'Send message' }))
      expect(onSubmit).toHaveBeenCalledTimes(2)
      expect(onSubmit).toHaveBeenLastCalledWith('Review the attached notes', undefined, 'agent-builder', undefined, [attachment])
      await act(async () => {
        retry.resolve(undefined)
        await retry.promise
      })
      expect(input).toHaveValue('')
      expect(useChatAttachments.getState().getAttachments(threadId)).toEqual([])
      expect(screen.queryByTestId('agent-skill-inline-token')).not.toBeInTheDocument()
    } finally {
      failure.mockRestore()
    }
  })

  it('sends only once for repeated Send and Enter while submission is pending', async () => {
    useThreads.setState({ currentThreadId: 'single-submission' })
    const pending = deferred<void>()
    const onSubmit = vi.fn().mockReturnValue(pending.promise)
    render(<ChatInput onSubmit={onSubmit} chatStatus="ready" />)
    const input = screen.getByTestId('chat-input')
    fireEvent.change(input, { target: { value: 'Send this once' } })
    const send = screen.getByRole('button', { name: 'Send message' })
    act(() => {
      fireEvent.click(send)
      fireEvent.click(send)
      fireEvent.keyDown(input, { key: 'Enter' })
    })
    expect(onSubmit).toHaveBeenCalledExactlyOnceWith('Send this once', undefined, undefined, undefined, [])
    expect(screen.getByRole('button', { name: 'Preparing message' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Preparing message' })).toHaveAttribute('aria-busy', 'true')
    expect(input).toHaveValue('Send this once')

    await act(async () => {
      pending.resolve(undefined)
      await pending.promise
    })
    expect(input).toHaveValue('')
    expect(screen.getByRole('button', { name: 'Send message' })).toHaveAttribute('aria-busy', 'false')
  })

  it('removes only submitted attachments and preserves text and files added while sending', async () => {
    const threadId = 'newer-submission-draft'
    useThreads.setState({ currentThreadId: threadId })
    const sent = { ...createDocumentAttachment({ name: 'notes.txt', path: '/docs/sent/notes.txt' }), id: 'sent-notes', processed: true }
    const newer = { ...createDocumentAttachment({ name: 'notes.txt', path: '/docs/new/notes.txt' }), id: 'new-notes', processed: true }
    useChatAttachments.getState().setAttachments(threadId, [sent])
    const pending = deferred<void>()
    const onSubmit = vi.fn().mockReturnValue(pending.promise)
    render(<ChatInput onSubmit={onSubmit} chatStatus="ready" />)
    const input = screen.getByTestId('chat-input')
    fireEvent.change(input, { target: { value: 'Review the first attachment' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }))
    expect(input).toBeEnabled()
    fireEvent.change(input, { target: { value: 'My next message' } })
    act(() => useChatAttachments.getState().setAttachments(threadId, (attachments) => [...attachments, newer]))

    await act(async () => {
      pending.resolve(undefined)
      await pending.promise
    })
    expect(onSubmit).toHaveBeenCalledExactlyOnceWith('Review the first attachment', undefined, undefined, undefined, [sent])
    expect(input).toHaveValue('My next message')
    expect(useChatAttachments.getState().getAttachments(threadId)).toEqual([newer])
    expect(screen.getByRole('button', { name: 'Send message' })).toBeEnabled()
  })

  it('captures the sent text and documents before waiting for model startup', async () => {
    const threadId = 'model-start-submission'
    const model = { id: 'test-model', capabilities: [], settings: {} } as Model
    useModelProvider.setState({
      providers: [{ provider: 'ginfer', active: true, models: [model], settings: [] } as ModelProvider],
      selectedProvider: 'ginfer', selectedModel: model,
    })
    useAppState.setState({ activeModels: [], intentionallyStoppedModels: new Set(['ginfer::test-model']) })
    useThreads.setState({ currentThreadId: threadId })
    const sent = { ...createDocumentAttachment({ name: 'sent.txt', path: '/docs/sent.txt' }), id: 'sent-file', processed: true }
    const newer = { ...createDocumentAttachment({ name: 'new.txt', path: '/docs/new.txt' }), id: 'new-file', processed: true }
    useChatAttachments.getState().setAttachments(threadId, [sent])
    const getActiveModels = vi.fn(async () => useAppState.getState().activeModels)
    seedServiceHub({ models: { getActiveModels } as unknown as ModelsService })
    const starting = deferred<void>()
    const start = vi.spyOn(switchModel, 'switchToModel').mockImplementation(async (params) => {
      await starting.promise
      useAppState.getState().setIntentionalModelStop(params.providerName, params.modelId, false)
      useAppState.setState({ activeModels: [params.modelId] })
    })
    try {
      const onSubmit = vi.fn()
      render(<ChatInput onSubmit={onSubmit} chatStatus="ready" />)
      await waitFor(() => expect(getActiveModels).toHaveBeenCalledTimes(2))
      const input = screen.getByTestId('chat-input')
      fireEvent.change(input, { target: { value: 'Review the original file' } })
      fireEvent.click(screen.getByRole('button', { name: 'Send message' }))
      await waitFor(() => expect(start).toHaveBeenCalledOnce())
      expect(onSubmit).not.toHaveBeenCalled()
      expect(screen.getByRole('button', { name: 'Preparing message' })).toBeDisabled()
      fireEvent.change(input, { target: { value: 'My next question' } })
      act(() => useChatAttachments.getState().setAttachments(threadId, (attachments) => [...attachments, newer]))
      fireEvent.keyDown(input, { key: 'Enter' })

      await act(async () => {
        starting.resolve(undefined)
        await starting.promise
      })

      expect(start).toHaveBeenCalledOnce()
      expect(onSubmit).toHaveBeenCalledExactlyOnceWith('Review the original file', undefined, undefined, undefined, [sent])
      expect(input).toHaveValue('My next question')
      expect(useChatAttachments.getState().getAttachments(threadId)).toEqual([newer])
      expect(screen.getByRole('button', { name: 'Send message' })).toBeEnabled()
    } finally {
      start.mockRestore()
    }
  })

  it.each([
    { pendingDraft: 'Review these notes', restoredDraft: '' },
    { pendingDraft: 'My next question', restoredDraft: 'My next question' },
  ])('clears only the sent draft after switching conversations ($pendingDraft)', async ({ pendingDraft, restoredDraft }) => {
    const originalThread = 'original-conversation'
    const nextThread = 'next-conversation'
    const originalAttachment = { ...createDocumentAttachment({ name: 'original.txt', path: '/docs/original.txt' }), id: 'original-file', processed: true }
    const nextAttachment = { ...createDocumentAttachment({ name: 'next.txt', path: '/docs/next.txt' }), id: 'next-file', processed: true }
    useThreads.setState({ currentThreadId: originalThread })
    useChatAttachments.getState().setAttachments(originalThread, [originalAttachment])
    useChatAttachments.getState().setAttachments(nextThread, [nextAttachment])
    const pending = deferred<void>()
    const onSubmit = vi.fn().mockReturnValue(pending.promise)
    render(<ChatInput onSubmit={onSubmit} chatStatus="ready" />)
    const input = screen.getByTestId('chat-input')
    fireEvent.change(input, { target: { value: 'Review these notes' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }))
    expect(onSubmit).toHaveBeenCalledExactlyOnceWith('Review these notes', undefined, undefined, undefined, [originalAttachment])
    fireEvent.change(input, { target: { value: pendingDraft } })

    act(() => useThreads.setState({ currentThreadId: nextThread }))
    fireEvent.change(input, { target: { value: 'Review these notes' } })
    await act(async () => {
      pending.resolve(undefined)
      await pending.promise
    })

    expect(useThreads.getState().currentThreadId).toBe(nextThread)
    expect(input).toHaveValue('Review these notes')
    expect(useChatAttachments.getState().getAttachments(nextThread)).toEqual([nextAttachment])
    expect(useChatAttachments.getState().getAttachments(originalThread)).toEqual([])
    expect(screen.getByRole('button', { name: 'Send message' })).toBeEnabled()

    act(() => useThreads.setState({ currentThreadId: originalThread }))
    expect(input).toHaveValue(restoredDraft)
    act(() => useThreads.setState({ currentThreadId: nextThread }))
    expect(input).toHaveValue('Review these notes')
    expect(useChatAttachments.getState().getAttachments(nextThread)).toEqual([nextAttachment])
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

  it.each(['loading', 'failed'])('reserves /compact while the draft skill catalog is %s and never starts an intentionally stopped model', async (status) => {
    const model = { id: 'test-model', capabilities: [], settings: {} } as Model
    useModelProvider.setState({
      providers: [{ provider: 'ginfer', active: true, models: [model], settings: [] } as ModelProvider],
      selectedProvider: 'ginfer', selectedModel: model,
    })
    useAppState.setState({ activeModels: [], intentionallyStoppedModels: new Set(['ginfer::test-model']) })
    seedServiceHub({ models: { getActiveModels: vi.fn().mockResolvedValue([]) } as unknown as ModelsService })
    usePrompt.getState().setDraftSkill(usePrompt.getState().activeThreadId, 'pdf')
    agentSkills.loading = status === 'loading'
    agentSkills.error = status === 'failed' ? 'catalog read failed' : null
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
    await waitFor(() => expect(onSubmit).toHaveBeenCalledExactlyOnceWith('Review the attached spreadsheet', undefined, 'agent-builder', undefined, [attachment]))
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

      await waitFor(() => expect(onSubmit).toHaveBeenCalledWith('Continue', undefined, undefined, undefined, []))
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

  it('keeps skill invocation on the default agent unless a saved workflow is explicitly selected', async () => {
    const user = userEvent.setup()
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

    expect(screen.getByRole('button', { name: 'Invoke saved agent' })).toHaveTextContent('Chat')
    await user.click(screen.getByRole('button', { name: 'Invoke saved agent' }))
    expect(screen.getByRole('menuitemradio', { name: 'Chat' })).toHaveAttribute('aria-checked', 'true')
    expect(screen.queryByRole('menuitemradio', { name: 'General Agent' })).not.toBeInTheDocument()
    await user.keyboard('{Escape}')
    fireEvent.change(screen.getByTestId('chat-input'), { target: { value: 'Build a model inventory agent' } })
    fireEvent.click(document.querySelector('[data-test-id="send-message-button"]')!)
    expect(onSubmit).toHaveBeenLastCalledWith('Build a model inventory agent', undefined, 'agent-builder', undefined, [])
    await waitFor(() => expect(screen.getByTestId('chat-input')).toHaveValue(''))

    await user.click(screen.getByRole('button', { name: 'Invoke saved agent' }))
    await user.click(screen.getByRole('menuitemradio', { name: 'Researcher' }))
    fireEvent.change(screen.getByTestId('chat-input'), { target: { value: 'Run my saved workflow' } })
    fireEvent.click(document.querySelector('[data-test-id="send-message-button"]')!)
    expect(onSubmit).toHaveBeenLastCalledWith('Run my saved workflow', undefined, undefined, 'researcher', [])
    await waitFor(() => expect(screen.getByTestId('chat-input')).toHaveValue(''))

    agentDefinitions.loading = true
    agentDefinitions.value = []
    view.rerender(<ChatInput initialMessage onSubmit={onSubmit} />)
    agentDefinitions.loading = false
    view.rerender(<ChatInput initialMessage onSubmit={onSubmit} />)
    fireEvent.change(screen.getByTestId('chat-input'), { target: { value: 'Continue without deleted workflow' } })
    fireEvent.click(document.querySelector('[data-test-id="send-message-button"]')!)
    expect(onSubmit).toHaveBeenLastCalledWith('Continue without deleted workflow', undefined, undefined, undefined, [])
    await waitFor(() => expect(screen.getByTestId('chat-input')).toHaveValue(''))
  })

  it('invokes a skill from ordinary chat without selecting an agent workflow', async () => {
    agentSkills.value = [{ name: 'agent-builder', description: 'Build agents', version: '1.2.0',
      requiresTools: [], requiresScripts: [], dangerous: false, platforms: null, enabled: true,
      compatible: true, reserved: false, unavailableReasons: [], error: null }]
    const onSubmit = vi.fn()
    render(<ChatInput initialMessage onSubmit={onSubmit} />)
    fireEvent.change(screen.getByTestId('chat-input'), { target: { value: '/agent-builder Make an inventory agent' } })
    fireEvent.click(document.querySelector('[data-test-id="send-message-button"]')!)
    expect(onSubmit).toHaveBeenCalledWith('Make an inventory agent', undefined, 'agent-builder', undefined, [])
    expect(conversationPolicyState.setActiveSkill).toHaveBeenCalledWith(expect.any(String), 'agent-builder')
    await waitFor(() => expect(screen.getByTestId('chat-input')).toHaveValue(''))
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

  it.each([
    { menuItem: 'Add Images', errorTitle: 'Could not attach images' },
    { menuItem: 'Add audio', errorTitle: 'Could not attach audio' },
  ])('keeps the draft and files when $menuItem fails and allows a silent cancelled retry', async ({ menuItem, errorTitle }) => {
    const first = deferred<string[] | null>()
    const retry = deferred<string[] | null>()
    const open = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(retry.promise)
    seedServiceHub({ dialog: { open } as never })
    useModelProvider.setState((state) => ({
      selectedModel: { ...state.selectedModel!, capabilities: ['vision', 'audio'] },
    }))
    const attachment = createDocumentAttachment({ name: 'notes.txt', path: '/docs/notes.txt' })
    useChatAttachments.getState().setAttachments(NEW_THREAD_ATTACHMENT_KEY, [attachment])
    const failure = vi.spyOn(toast, 'error')
    try {
      const { container } = render(<ChatInput initialMessage />)
      const input = screen.getByTestId('chat-input')
      fireEvent.change(input, { target: { value: 'Keep my unfinished question' } })
      const chooseMedia = async () => {
        fireEvent.keyDown(container.querySelector('button[aria-haspopup="menu"]')!, { key: 'ArrowDown' })
        fireEvent.click(await screen.findByRole('menuitem', { name: menuItem }))
      }
      await chooseMedia()
      expect(open).toHaveBeenCalledOnce()
      await act(async () => {
        first.reject(new Error('Native file window unavailable'))
        await first.promise.catch(() => undefined)
      })

      expect(failure).toHaveBeenCalledExactlyOnceWith(errorTitle, {
        description: expect.stringMatching(/try choosing the files again.*restart GChat/i),
      })
      expect(input).toHaveValue('Keep my unfinished question')
      expect(useChatAttachments.getState().getAttachments(NEW_THREAD_ATTACHMENT_KEY)).toEqual([attachment])

      await chooseMedia()
      expect(open).toHaveBeenCalledTimes(2)
      await act(async () => {
        retry.resolve(null)
        await retry.promise
      })

      expect(failure).toHaveBeenCalledOnce()
      expect(input).toHaveValue('Keep my unfinished question')
      expect(useChatAttachments.getState().getAttachments(NEW_THREAD_ATTACHMENT_KEY)).toEqual([attachment])
      expect(mocks.navigate).not.toHaveBeenCalled()
    } finally {
      failure.mockRestore()
    }
  })

  it.each(['error', 'abort', 'empty result', 'synchronous error'] as const)(
    'retains the draft and other files after an image read %s and recovers when the same file is chosen again',
    async (failure) => {
      useModelProvider.setState((state) => ({
        selectedModel: { ...state.selectedModel!, capabilities: ['vision'] },
      }))
      const attachment = createDocumentAttachment({ name: 'notes.txt', path: '/docs/notes.txt' })
      useChatAttachments.getState().setAttachments(NEW_THREAD_ATTACHMENT_KEY, [attachment])
      mocks.downscaleImageDataUrl.mockResolvedValue(null)
      const file = new File(['test'], 'broken.png', { type: 'image/png' })
      const read = vi.spyOn(FileReader.prototype, 'readAsDataURL')
        .mockImplementationOnce(function (this: FileReader) {
          if (failure === 'synchronous error') {
            throw new DOMException('File unavailable', 'NotReadableError')
          }
          this.dispatchEvent(new ProgressEvent(
            failure === 'empty result' ? 'load' : failure
          ))
        })
        .mockImplementationOnce(function (this: FileReader) {
          Object.defineProperty(this, 'result', {
            value: 'data:image/png;base64,dGVzdA==',
          })
          this.dispatchEvent(new ProgressEvent('load'))
        })

      try {
        const { container } = render(<ChatInput initialMessage />)
        const input = screen.getByTestId('chat-input')
        fireEvent.change(input, { target: { value: 'Keep my unfinished question' } })
        const chooseImage = async () => {
          fireEvent.keyDown(container.querySelector('button[aria-haspopup="menu"]')!, { key: 'ArrowDown' })
          const menuItem = await screen.findByRole('menuitem', { name: 'Add Images' })
          fireEvent.change(menuItem.querySelector('input[type="file"]')!, {
            target: { files: [file] },
          })
        }
        await chooseImage()

        const error = 'Could not read images: broken.png. Try choosing the files again.'
        expect(await screen.findByText(error)).toBeVisible()
        expect(input).toHaveValue('Keep my unfinished question')
        expect(useChatAttachments.getState().getAttachments(NEW_THREAD_ATTACHMENT_KEY)).toEqual([attachment])

        await chooseImage()

        await waitFor(() => expect(useChatAttachments.getState().getAttachments(NEW_THREAD_ATTACHMENT_KEY)).toEqual([
          attachment,
          expect.objectContaining({
            type: 'image', name: 'broken.png', mimeType: 'image/png', base64: 'dGVzdA==',
          }),
        ]))
        expect(screen.queryByText(error)).not.toBeInTheDocument()
        expect(input).toHaveValue('Keep my unfinished question')
        expect(read).toHaveBeenCalledTimes(2)
        expect(read).toHaveBeenNthCalledWith(1, file)
        expect(read).toHaveBeenNthCalledWith(2, file)
      } finally {
        read.mockRestore()
      }
    }
  )

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

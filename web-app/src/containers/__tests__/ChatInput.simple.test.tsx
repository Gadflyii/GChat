import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ChatInput from '../ChatInput'
import { useChatAttachments } from '@/hooks/useChatAttachments'
import { useModelProvider } from '@/hooks/useModelProvider'
import { usePrompt } from '@/hooks/usePrompt'
import { seedServiceHub } from '@/test/service-hub'
import { TEMPORARY_CHAT_ID } from '@/constants/chat'
import type { AgentDefinition } from '@/types/agent'
import type { AgentSkill } from '@/services/agent/skills'
import { useAppState } from '@/hooks/useAppState'

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  downscaleImageDataUrl: vi.fn(),
}))
const agentDefinitions = vi.hoisted(() => ({
  value: [] as AgentDefinition[],
  loading: false,
}))
const agentSkills = vi.hoisted(() => ({ value: [] as AgentSkill[] }))
const agentModeState = vi.hoisted(() => ({
  agentThreads: {} as Record<string, boolean>,
  activeSkills: {} as Record<string, string>,
  setActiveSkill: vi.fn(),
  approvalModes: {} as Record<string, 'manual' | 'skip'>,
  setAgentMode: vi.fn(),
  setApprovalMode: vi.fn(),
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

vi.mock('@/hooks/useAgentMode', () => {
  const useAgentMode = (
    selector: (value: typeof agentModeState) => unknown
  ) => selector(agentModeState)
  useAgentMode.getState = () => agentModeState
  return { useAgentMode }
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

vi.mock('@/containers/AgentApprovalModeSelect', () => ({
  AgentApprovalModeSelect: () => null,
}))

vi.mock('@/containers/AgentExternalFolderButton', () => ({
  AgentExternalFolderButton: () => null,
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
    agentDefinitions.value = []
    agentDefinitions.loading = false
    agentSkills.value = []
    agentModeState.agentThreads = {}
    agentModeState.activeSkills = {}
    agentModeState.approvalModes = {}
    agentModeState.setAgentMode.mockReset()
    agentModeState.setApprovalMode.mockReset()

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
      undefined
    )
    await waitFor(() => expect(input).toHaveValue(''))
    unmount()
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
    agentModeState.agentThreads = { [TEMPORARY_CHAT_ID]: true }
    useAppState.setState({ activeModels: ['agent-model'] })

    const empty = render(<ChatInput initialMessage />)
    expect(screen.queryByLabelText('Agent definition')).not.toBeInTheDocument()
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

    expect(screen.getByLabelText('Agent definition')).toHaveValue('general')
    expect(screen.queryByRole('option', { name: 'General Agent' })).not.toBeInTheDocument()
    fireEvent.change(screen.getByTestId('chat-input'), { target: { value: 'Build a model inventory agent' } })
    fireEvent.click(document.querySelector('[data-test-id="send-message-button"]')!)
    expect(onSubmit).toHaveBeenLastCalledWith('Build a model inventory agent', undefined, 'agent-builder', 'general')

    fireEvent.change(screen.getByLabelText('Agent definition'), { target: { value: 'researcher' } })
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
    expect(onSubmit).toHaveBeenLastCalledWith('Continue without deleted workflow', undefined, undefined, 'general')
  })

  it('invokes a skill from ordinary chat without selecting an agent workflow', () => {
    agentSkills.value = [{ name: 'agent-builder', description: 'Build agents', version: '1.2.0',
      requiresTools: [], requiresScripts: [], dangerous: false, platforms: null, enabled: true,
      compatible: true, reserved: false, unavailableReasons: [], error: null }]
    const onSubmit = vi.fn()
    render(<ChatInput initialMessage onSubmit={onSubmit} />)
    fireEvent.change(screen.getByTestId('chat-input'), { target: { value: '/agent-builder Make an inventory agent' } })
    fireEvent.click(document.querySelector('[data-test-id="send-message-button"]')!)
    expect(onSubmit).toHaveBeenCalledWith('Make an inventory agent', undefined, 'agent-builder')
    expect(agentModeState.setAgentMode).not.toHaveBeenCalled()
    expect(agentModeState.setActiveSkill).toHaveBeenCalledWith(expect.any(String), 'agent-builder')
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

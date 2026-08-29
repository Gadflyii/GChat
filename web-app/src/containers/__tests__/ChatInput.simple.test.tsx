import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ChatInput from '../ChatInput'
import { useChatAttachments } from '@/hooks/useChatAttachments'
import { useModelProvider } from '@/hooks/useModelProvider'
import { usePrompt } from '@/hooks/usePrompt'
import { seedServiceHub } from '@/test/service-hub'
import { TEMPORARY_CHAT_ID } from '@/constants/chat'
import type { AgentDefinition } from '@/types/agent'

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  downscaleImageDataUrl: vi.fn(),
}))
const agentDefinitions = vi.hoisted(() => ({
  value: [] as AgentDefinition[],
}))
const agentModeState = vi.hoisted(() => ({
  agentThreads: {} as Record<string, boolean>,
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
  useAgentSkills: () => ({ skills: [], loading: false }),
}))

vi.mock('@/hooks/useAgentDefinitions', () => ({
  useAgentDefinitions: () => ({ definitions: agentDefinitions.value }),
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
  beforeEach(() => {
    vi.clearAllMocks()
    seedServiceHub()
    usePrompt.setState({ prompt: '' })
    useChatAttachments.setState({ attachmentsByThread: {} })
    agentDefinitions.value = []
    agentModeState.agentThreads = {}
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

  it('shows the Agent picker only when a user definition exists', () => {
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
    render(<ChatInput initialMessage />)

    expect(screen.getByLabelText('Agent definition')).toHaveValue('researcher')
    expect(screen.queryByRole('option', { name: 'General Agent' })).not.toBeInTheDocument()
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

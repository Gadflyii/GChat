import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { EngineManager, type ThreadMessage } from '@gchat/core'

import { ContextSizeControl } from '@/containers/ContextSizeControl'
import { useModelProvider } from '@/hooks/useModelProvider'
import { useContextUsage } from '@/hooks/useContextUsage'
import type { ModelsService } from '@/services/models/types'
import { seedServiceHub } from '@/test/service-hub'

const stopModel = vi.fn()
const startModel = vi.fn()
const getActiveModels = vi.fn()
const syncActiveModelsFromEngines = vi.fn()
const tokenCountState = vi.hoisted(() => ({ value: 164 }))

class MockResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

beforeAll(() => {
  global.ResizeObserver = MockResizeObserver
})

vi.mock('@/hooks/useTokensCount', () => ({
  useTokensCount: () => ({
    tokenCount: tokenCountState.value,
    maxTokens: 16384,
    isNearLimit: false,
    loading: false,
    calculateTokens: vi.fn(),
  }),
}))

vi.mock('@/utils/activeModelsSync', () => ({
  syncActiveModelsFromEngines: (...args: unknown[]) =>
    syncActiveModelsFromEngines(...args),
}))

function setSelectedModel(providerName: string) {
  const model = {
    id: 'test-model',
    name: 'Test model',
    settings: {
      ctx_len: {
        key: 'ctx_len',
        title: 'Context Size',
        description: 'Size of the prompt context.',
        controller_type: 'input',
        controller_props: {
          type: 'number',
          value: 16384,
          min: 0,
          max: 65536,
          step: 1024,
        },
      },
    },
  } as Model
  const provider = {
    provider: providerName,
    models: [model],
  } as ModelProvider

  useModelProvider.setState({
    providers: [provider],
    selectedProvider: providerName,
    selectedModel: model,
  })
}

describe('ContextSizeControl', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useContextUsage.setState({ requests: {} })
    tokenCountState.value = 164
    getActiveModels.mockResolvedValue([])
    seedServiceHub({
      models: {
        stopModel,
        startModel,
        getActiveModels,
      } as unknown as ModelsService,
    })
  })

  it('is visible for the local provider', () => {
    setSelectedModel('ginfer')
    render(<ContextSizeControl />)

    expect(
      screen.getByRole('button', { name: 'Context usage: 1.0%' })
    ).toBeInTheDocument()
  })

  it('shows full request usage including tools and tracks compaction live', () => {
    setSelectedModel('ginfer')
    const usage = {
      modelId: 'test-model', inputTokens: 42158, outputTokens: 234,
      contextTokens: 131072, reservedOutputTokens: 8192,
    }
    useContextUsage.getState().record('thread-a', usage)
    render(<ContextSizeControl threadId="thread-a" />)
    fireEvent.click(screen.getByRole('button', { name: 'Context usage: 32.3%' }))
    expect(screen.getByText('42.4K / 131.1K')).toBeInTheDocument()
    expect(screen.getByText(/Latest request · includes instructions and tools/)).toBeInTheDocument()
    expect(screen.getByText('Reserved for response')).toBeInTheDocument()
    act(() => useContextUsage.getState().record('thread-a', {
      ...usage, inputTokens: 160000, outputTokens: 0,
    }))
    expect(screen.getByRole('button', { name: 'Context usage: 122.1%' })).toBeInTheDocument()
    act(() => useContextUsage.getState().record('thread-a', {
      ...usage, inputTokens: 30000, outputTokens: 0,
    }))
    expect(screen.getByRole('button', { name: 'Context usage: 22.9%' })).toBeInTheDocument()
  })

  it('restores full request accounting on reopen and isolates other threads', () => {
    setSelectedModel('ginfer')
    useContextUsage.getState().record('other-thread', {
      modelId: 'test-model', inputTokens: 90000, outputTokens: 0,
      contextTokens: 131072, reservedOutputTokens: 8192,
    })
    const messages = [{ role: 'assistant', metadata: { contextUsage: {
      modelId: 'test-model', inputTokens: 42158, outputTokens: 234,
      contextTokens: 131072, reservedOutputTokens: 8192,
    } } }] as ThreadMessage[]
    render(<ContextSizeControl threadId="reopened-thread" messages={messages} />)
    expect(screen.getByRole('button', { name: 'Context usage: 32.3%' })).toBeInTheDocument()
  })

  it('does not let text-only counting hide server-reported tool usage', () => {
    setSelectedModel('ginfer')
    const messages = [{ role: 'assistant', metadata: {
      usage: { inputTokens: 8000, outputTokens: 192, totalTokens: 8192 },
    } }] as ThreadMessage[]
    render(<ContextSizeControl messages={messages} />)
    expect(screen.getByRole('button', { name: 'Context usage: 50.0%' })).toBeInTheDocument()
  })

  it('is hidden for non-local providers', () => {
    setSelectedModel('openai')
    render(<ContextSizeControl />)

    expect(
      screen.queryByRole('button', { name: /Context usage:/ })
    ).not.toBeInTheDocument()
  })

  it('shows the current input and latest output token usage', () => {
    setSelectedModel('ginfer')
    const messages = [
      {
        role: 'assistant',
        metadata: {
          usage: {
            outputTokens: 24,
          },
        },
      } as ThreadMessage,
    ]
    render(<ContextSizeControl messages={messages} />)

    fireEvent.click(screen.getByRole('button', { name: 'Context usage: 1.0%' }))

    expect(screen.getByText('Input')).toBeInTheDocument()
    expect(screen.getByText('Output')).toBeInTheDocument()
    expect(screen.queryByText('Remaining')).not.toBeInTheDocument()
    expect(screen.getByText('140')).toBeInTheDocument()
    expect(screen.getByText('24')).toBeInTheDocument()
    expect(screen.getByText('164 / 16.4K')).toBeInTheDocument()
    expect(screen.getByRole('progressbar').firstElementChild).toHaveClass(
      'bg-emerald-500'
    )

  })

  it('falls back to response usage when a new chat has not been tokenized', () => {
    tokenCountState.value = 0
    setSelectedModel('ginfer')
    const messages = [
      {
        role: 'assistant',
        metadata: {
          usage: {
            inputTokens: 37,
            outputTokens: 11,
            totalTokens: 48,
          },
        },
      } as ThreadMessage,
    ]
    render(<ContextSizeControl messages={messages} />)

    fireEvent.click(screen.getByRole('button', { name: 'Context usage: 0.3%' }))

    expect(screen.getByText('37')).toBeInTheDocument()
    expect(screen.getByText('11')).toBeInTheDocument()
    expect(screen.getByText('48 / 16.4K')).toBeInTheDocument()
  })

  it.each([
    [12000, 'bg-orange-500'],
    [14700, 'bg-destructive'],
  ])(
    'changes the context progress tone at usage thresholds',
    (additionalTokens, expectedClass) => {
      setSelectedModel('ginfer')
      render(<ContextSizeControl additionalTokens={additionalTokens} />)

      fireEvent.click(
        screen.getByRole('button', { name: /Context usage:/ })
      )

      expect(screen.getByRole('progressbar').firstElementChild).toHaveClass(
        expectedClass
      )
    }
  )

  it('shows the loaded profile capacity without a control that restarts it', async () => {
    const engineManager = vi.spyOn(EngineManager, 'instance').mockReturnValue({
      get: () => ({ getLoadedContext: async () => 131072 }),
    } as unknown as EngineManager)
    try {
      setSelectedModel('ginfer')
      render(<ContextSizeControl />)
      fireEvent.click(screen.getByRole('button', { name: /Context usage:/ }))
      await waitFor(() => expect(screen.getByText('Profile context: 128.0K')).toBeInTheDocument())
      expect(screen.queryByRole('slider')).not.toBeInTheDocument()
      expect(screen.getByText(/does not restart it/)).toBeInTheDocument()
      expect(stopModel).not.toHaveBeenCalled()
      expect(startModel).not.toHaveBeenCalled()
    } finally { engineManager.mockRestore() }
  })
})

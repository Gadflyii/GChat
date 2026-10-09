import { describe, it, expect, beforeEach, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { usePrompt } from '../usePrompt'
import { useTokensCount } from '../useTokensCount'
import { useModelProvider } from '../useModelProvider'
import { useServiceStore } from '../useServiceHub'
import type { ServiceHub } from '@/services'
import { ContentType, MessageStatus, type ThreadMessage } from '@gchat/core'

describe('usePrompt', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should initialize with empty prompt', () => {
    const { result } = renderHook(() => usePrompt())
    
    expect(result.current.prompt).toBe('')
    expect(typeof result.current.setPrompt).toBe('function')
  })

  it('should update prompt', () => {
    const { result } = renderHook(() => usePrompt())
    
    act(() => {
      result.current.setPrompt('Hello, world!')
    })
    
    expect(result.current.prompt).toBe('Hello, world!')
  })

  it('should clear prompt', () => {
    const { result } = renderHook(() => usePrompt())
    
    act(() => {
      result.current.setPrompt('Some text')
    })
    
    expect(result.current.prompt).toBe('Some text')
    
    act(() => {
      result.current.setPrompt('')
    })
    
    expect(result.current.prompt).toBe('')
  })

  it('should handle multiple prompt updates', () => {
    const { result } = renderHook(() => usePrompt())
    
    act(() => {
      result.current.setPrompt('First')
    })
    
    expect(result.current.prompt).toBe('First')
    
    act(() => {
      result.current.setPrompt('Second')
    })
    
    expect(result.current.prompt).toBe('Second')
    
    act(() => {
      result.current.setPrompt('Third')
    })
    
    expect(result.current.prompt).toBe('Third')
  })

  it('should handle special characters in prompt', () => {
    const { result } = renderHook(() => usePrompt())
    
    const specialText = 'Hello! @#$%^&*()_+{}|:"<>?[]\\;\',./'
    
    act(() => {
      result.current.setPrompt(specialText)
    })
    
    expect(result.current.prompt).toBe(specialText)
  })

  it('should handle multiline prompts', () => {
    const { result } = renderHook(() => usePrompt())
    
    const multilineText = 'Line 1\nLine 2\nLine 3'
    
    act(() => {
      result.current.setPrompt(multilineText)
    })
    
    expect(result.current.prompt).toBe(multilineText)
  })

  it('should handle very long prompts', () => {
    const { result } = renderHook(() => usePrompt())
    
    const longText = 'A'.repeat(10000)
    
    act(() => {
      result.current.setPrompt(longText)
    })
    
    expect(result.current.prompt).toBe(longText)
    expect(result.current.prompt.length).toBe(10000)
  })
})

describe('prompt token-count preparation', () => {
  it('preserves saved content, attachments, draft edits and model capacity', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(1700000000000)
    const getTokensCount = vi.fn().mockResolvedValue(42)
    const originalProvider = useModelProvider.getState()
    usePrompt.getState().resetPrompt()
    useServiceStore.setState({ serviceHub: { models: () => ({ getTokensCount }) } as unknown as ServiceHub })
    const model = { id: 'fixture', settings: { ctx_len: { controller_props: { value: '100' } } } } as Model
    useModelProvider.setState({ selectedProvider: 'ginfer', selectedModel: model })
    const history: ThreadMessage[] = [{ id: 'saved', object: 'thread.message', thread_id: 'thread', role: 'assistant',
      status: MessageStatus.Ready, created_at: 1, completed_at: 2,
      metadata: { inline_file_contents: [{ name: 'notes', content: 'note' }, { content: 'unnamed' }, { name: 3, content: 'ignored' }] },
      content: [{ type: ContentType.Text, text: { value: '<think>private</think>visible', annotations: [] } },
        { type: ContentType.Text, text: { value: '', annotations: [] } },
        { type: ContentType.Image, image_url: { url: 'saved-image', detail: 'low' } }] }]
    const originalHistory = structuredClone(history)
    const uploads = [{ name: 'draft.png', type: 'image/png', size: 1, base64: 'AQ==', dataUrl: 'data:image/png;base64,AQ==' }]
    usePrompt.getState().setPrompt('<think>private draft</think>Hello')
    const hook = renderHook(({ messages }) => useTokensCount(messages, uploads), { initialProps: { messages: history } })
    try {
      await act(async () => { await hook.result.current.calculateTokens() })
      const expectedHistory = { ...history[0], content: [
        { type: ContentType.Text, text: { value: 'visible\n\nFile: notes\nnote\n\nFile: attachment\nunnamed', annotations: [] } },
        { type: ContentType.Text, text: { value: 'File: notes\nnote\n\nFile: attachment\nunnamed', annotations: [] } },
        { type: ContentType.Image, image_url: { url: 'saved-image', detail: 'low' }, text: undefined },
      ] }
      const expectedDraft = { id: 'temp-prompt', thread_id: '', role: 'user', created_at: 1700000000000,
        content: [{ type: ContentType.Text, text: { value: 'Hello', annotations: [] } },
          { type: ContentType.Image, image_url: { url: uploads[0].dataUrl, detail: 'high' }, text: undefined }] }
      expect(getTokensCount).toHaveBeenLastCalledWith('fixture', [expectedHistory, expectedDraft])
      expect(hook.result.current).toMatchObject({ tokenCount: 42, maxTokens: 100, percentage: 42, loading: false })

      act(() => usePrompt.getState().setPrompt('<think>private draft</think>Hello!'))
      await act(async () => { await vi.advanceTimersByTimeAsync(500) })
      expect(getTokensCount).toHaveBeenLastCalledWith('fixture', [expectedHistory,
        { ...expectedDraft, content: [{ ...expectedDraft.content[0], text: { value: 'Hello!', annotations: [] } }, expectedDraft.content[1]] }])
      expect(history).toEqual(originalHistory)

      const edited: ThreadMessage[] = [{ ...history[0], content: [{ type: ContentType.Text, text: { value: 'edited', annotations: [] } }] }]
      act(() => {
        hook.rerender({ messages: edited })
        useModelProvider.setState({ selectedModel: { ...model, id: 'other', settings: { ctx_len: { controller_props: { value: 200 } } } } as Model })
      })
      await act(async () => { await hook.result.current.calculateTokens() })
      expect(getTokensCount.mock.lastCall?.[0]).toBe('other')
      expect(getTokensCount.mock.lastCall?.[1][0].content[0].text.value).toBe('edited\n\nFile: notes\nnote\n\nFile: attachment\nunnamed')
      expect(hook.result.current).toMatchObject({ tokenCount: 42, maxTokens: 200, percentage: 21 })
    } finally {
      hook.unmount()
      useModelProvider.setState(originalProvider)
      usePrompt.getState().resetPrompt()
      vi.useRealTimers()
    }
  })
})

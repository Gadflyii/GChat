import { describe, it, expect, beforeEach, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useAppState } from '../useAppState'
import { useModelLoad } from '../useModelLoad'


describe('useAppState', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Reset Zustand store
    act(() => {
      useAppState.setState({
        streamingContent: undefined,
        loadingModel: false,
        tools: [],
        serverStatus: 'stopped',
        abortControllers: {},
        tokenSpeed: undefined,
        currentToolCall: undefined,
        showOutOfContextDialog: false
      })
    })
  })

  it('should initialize with default state', () => {
    const { result } = renderHook(() => useAppState())

    expect(result.current.streamingContent).toBeUndefined()
    expect(result.current.loadingModel).toBe(false)
    expect(result.current.tools).toEqual([])
    expect(result.current.serverStatus).toBe('stopped')
    expect(result.current.abortControllers).toEqual({})
    expect(result.current.tokenSpeed).toBeUndefined()
    expect(result.current.currentToolCall).toBeUndefined()
    expect(result.current.showOutOfContextDialog).toBe(false)
  })

  it('should update streaming content', () => {
    const { result } = renderHook(() => useAppState())

    const content = { id: 'msg-1', content: 'Hello', role: 'user' }

    act(() => {
      result.current.updateStreamingContent(content)
    })

    // The function adds created_at if not present
    expect(result.current.streamingContent).toMatchObject({
      ...content,
      created_at: expect.any(Number),
    })
  })

  it('should update loading model state', () => {
    const { result } = renderHook(() => useAppState())

    act(() => {
      result.current.updateLoadingModel(true)
    })

    expect(result.current.loadingModel).toBe(true)

    act(() => {
      result.current.updateLoadingModel(false)
    })

    expect(result.current.loadingModel).toBe(false)
  })

  it('should update tools', () => {
    const { result } = renderHook(() => useAppState())

    const tools = [
      { name: 'tool1', description: 'First tool' },
      { name: 'tool2', description: 'Second tool' }
    ]

    act(() => {
      result.current.updateTools(tools)
    })

    expect(result.current.tools).toEqual(tools)
  })

  it('should update server status', () => {
    const { result } = renderHook(() => useAppState())

    act(() => {
      result.current.setServerStatus('running')
    })

    expect(result.current.serverStatus).toBe('running')

    act(() => {
      result.current.setServerStatus('pending')
    })

    expect(result.current.serverStatus).toBe('pending')
  })

  it('should set abort controller', () => {
    const { result } = renderHook(() => useAppState())

    const controller = new AbortController()

    act(() => {
      result.current.setAbortController('thread-123', controller)
    })

    expect(result.current.abortControllers['thread-123']).toBe(controller)
  })

  it('should set out of context dialog', () => {
    const { result } = renderHook(() => useAppState())

    act(() => {
      result.current.setOutOfContextDialog(true)
    })

    expect(result.current.showOutOfContextDialog).toBe(true)

    act(() => {
      result.current.setOutOfContextDialog(false)
    })

    expect(result.current.showOutOfContextDialog).toBe(false)
  })

  it('should update token speed', () => {
    const { result } = renderHook(() => useAppState())

    const message = {
      id: 'msg-1',
      content: 'Hello world',
      role: 'assistant',
      created_at: Date.now(),
      thread_id: 'thread-123'
    }

    act(() => {
      result.current.updateTokenSpeed(message)
    })

    // Token speed calculation depends on implementation
    expect(result.current.tokenSpeed).toBeDefined()
  })

  it('should reset token speed', () => {
    const { result } = renderHook(() => useAppState())

    const message = {
      id: 'msg-1',
      content: 'Hello world',
      role: 'assistant',
      created_at: Date.now(),
      thread_id: 'thread-123'
    }

    act(() => {
      result.current.updateTokenSpeed(message)
    })

    expect(result.current.tokenSpeed).toBeDefined()

    act(() => {
      result.current.resetTokenSpeed()
    })

    expect(result.current.tokenSpeed).toBeUndefined()
  })

  describe('stale model load errors', () => {
    const failure = { message: 'Failed to load qwen38_flash_next_180b_smol_mtp: No qualified automatic profile is available.' }

    beforeEach(() => {
      act(() => {
        useAppState.setState({ activeModels: [], serverStatus: 'stopped' })
        useModelLoad.getState().setModelLoadError(failure, 'qwen38_flash_next_180b_smol_mtp')
      })
    })

    it('clears the error when a model becomes active through any load path', () => {
      act(() => {
        useAppState.getState().setActiveModels(['ginfer/host-1/instance-1'])
      })
      expect(useModelLoad.getState().modelLoadError).toBeUndefined()
      expect(useModelLoad.getState().modelLoadErrorModelId).toBeUndefined()
    })

    it('keeps the error when no model becomes active', () => {
      act(() => {
        useAppState.getState().setActiveModels([])
      })
      expect(useModelLoad.getState().modelLoadError).toEqual(failure)
      expect(useModelLoad.getState().modelLoadErrorModelId).toBe('qwen38_flash_next_180b_smol_mtp')
    })

    it('clears the error on a server status change but not on a repeated status', () => {
      act(() => {
        useAppState.getState().setServerStatus('stopped')
      })
      expect(useModelLoad.getState().modelLoadError).toEqual(failure)
      act(() => {
        useAppState.getState().setServerStatus('running')
      })
      expect(useModelLoad.getState().modelLoadError).toBeUndefined()
    })
  })
})

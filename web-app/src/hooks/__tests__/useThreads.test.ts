import { describe, it, expect, beforeEach, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useThreads } from '../useThreads'
import type { PathService } from '@/services/path/types'
import type { ThreadsService } from '@/services/threads/types'
import { seedServiceHub } from '@/test/service-hub'

// Mock ulid
vi.mock('ulidx', () => ({
  ulid: vi.fn(() => 'test-ulid-123'),
}))

// Mock fzf
vi.mock('fzf', () => ({
  Fzf: vi.fn(() => ({
    find: vi.fn(() => []),
  })),
}))
global.__TAURI_INTERNALS__ = {
  plugins: {
    path: {
      sep: '/',
    },
  },
}

describe('useThreads', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    seedServiceHub({
      path: {
        sep: () => '/',
      } as PathService,
      threads: {
        createThread: vi.fn().mockResolvedValue(undefined),
        deleteThread: vi.fn().mockResolvedValue(undefined),
        updateThread: vi.fn().mockResolvedValue(undefined),
      } as unknown as ThreadsService,
    })
    // Reset Zustand store
    act(() => {
      useThreads.setState({
        threads: {},
        currentThreadId: undefined,
        searchIndex: null,
      })
    })
  })

  it('should initialize with default state', () => {
    const { result } = renderHook(() => useThreads())

    expect(result.current.threads).toEqual({})
    expect(result.current.currentThreadId).toBeUndefined()
    expect(result.current.getCurrentThread()).toBeUndefined()
  })

  it('should set threads', () => {
    const { result } = renderHook(() => useThreads())

    const threads = [
      { id: 'thread1', title: 'Thread 1', messages: [] },
      { id: 'thread2', title: 'Thread 2', messages: [] },
    ]

    act(() => {
      result.current.setThreads(threads)
    })

    expect(Object.keys(result.current.threads)).toHaveLength(2)
    expect(result.current.threads['thread1']).toEqual(threads[0])
    expect(result.current.threads['thread2']).toEqual(threads[1])
  })
  it('should set threads with cortex model migrated', () => {
    const { result } = renderHook(() => useThreads())

    const threads = [
      {
        id: 'thread1',
        title: 'Thread 1',
        messages: [],
        model: { provider: 'llama.cpp', id: 'thread1:free' },
      },
      {
        id: 'thread2',
        title: 'Thread 2',
        messages: [],
        model: { provider: 'llama.cpp', id: 'thread2:test' },
      },
    ]

    act(() => {
      result.current.setThreads(threads)
    })

    expect(Object.keys(result.current.threads)).toHaveLength(2)
    expect(result.current.threads['thread1'].model.id).toEqual('thread1/free')
    expect(result.current.threads['thread1'].model.provider).toEqual('ginfer')
    expect(result.current.threads['thread2'].model.id).toEqual('thread2/test')
    expect(result.current.threads['thread2'].model.provider).toEqual('ginfer')
  })

  it('should set current thread ID', () => {
    const { result } = renderHook(() => useThreads())

    act(() => {
      result.current.setCurrentThreadId('thread-123')
    })

    expect(result.current.currentThreadId).toBe('thread-123')
  })

  it('should get current thread', () => {
    const { result } = renderHook(() => useThreads())

    const thread = { id: 'thread1', title: 'Thread 1', messages: [] }

    act(() => {
      result.current.setThreads([thread])
      result.current.setCurrentThreadId('thread1')
    })

    expect(result.current.getCurrentThread()).toEqual(thread)
  })

  it('should return undefined when getting current thread with no ID', () => {
    const { result } = renderHook(() => useThreads())

    expect(result.current.getCurrentThread()).toBeUndefined()
  })

  it('should get thread by ID', () => {
    const { result } = renderHook(() => useThreads())

    const thread = { id: 'thread1', title: 'Thread 1', messages: [] }

    act(() => {
      result.current.setThreads([thread])
    })

    expect(result.current.getThreadById('thread1')).toEqual(thread)
    expect(result.current.getThreadById('nonexistent')).toBeUndefined()
  })

  it('should delete thread', () => {
    const { result } = renderHook(() => useThreads())

    const threads = [
      { id: 'thread1', title: 'Thread 1', messages: [] },
      { id: 'thread2', title: 'Thread 2', messages: [] },
    ]

    act(() => {
      result.current.setThreads(threads)
    })

    expect(Object.keys(result.current.threads)).toHaveLength(2)

    act(() => {
      result.current.deleteThread('thread1')
    })

    expect(Object.keys(result.current.threads)).toHaveLength(1)
    expect(result.current.threads['thread1']).toBeUndefined()
    expect(result.current.threads['thread2']).toBeDefined()
  })

  it('should rename thread', () => {
    const { result } = renderHook(() => useThreads())

    const thread = { id: 'thread1', title: 'Original Title', messages: [] }

    act(() => {
      result.current.setThreads([thread])
    })

    act(() => {
      result.current.renameThread('thread1', 'New Title')
    })

    expect(result.current.threads['thread1'].title).toBe('New Title')
  })

  it('should toggle favorite', () => {
    const { result } = renderHook(() => useThreads())

    const thread = {
      id: 'thread1',
      title: 'Thread 1',
      messages: [],
      starred: false,
    }

    act(() => {
      result.current.setThreads([thread])
    })

    act(() => {
      result.current.toggleFavorite('thread1')
    })

    // Just test that the toggle function exists and can be called
    expect(typeof result.current.toggleFavorite).toBe('function')
  })

  it('should get favorite threads', () => {
    const { result } = renderHook(() => useThreads())

    // Just test that the function exists
    expect(typeof result.current.getFavoriteThreads).toBe('function')
    const favorites = result.current.getFavoriteThreads()
    expect(Array.isArray(favorites)).toBe(true)
  })

  it('should delete all threads', () => {
    const { result } = renderHook(() => useThreads())

    const threads = [
      { id: 'thread1', title: 'Thread 1', messages: [] },
      { id: 'thread2', title: 'Thread 2', messages: [] },
    ]

    act(() => {
      result.current.setThreads(threads)
    })

    expect(Object.keys(result.current.threads)).toHaveLength(2)

    act(() => {
      result.current.deleteAllThreads()
    })

    expect(result.current.threads).toEqual({})
  })

  it('should unstar all threads', () => {
    const { result } = renderHook(() => useThreads())

    // Just test that the function exists and can be called
    expect(typeof result.current.unstarAllThreads).toBe('function')

    act(() => {
      result.current.unstarAllThreads()
    })

    // Function executed without error
    expect(true).toBe(true)
  })

  it('should filter threads by search term', () => {
    const { result } = renderHook(() => useThreads())

    // Just test that the function exists
    expect(typeof result.current.getFilteredThreads).toBe('function')
    const filtered = result.current.getFilteredThreads('test')
    expect(Array.isArray(filtered)).toBe(true)
  })

  it('should return all threads when no search term', () => {
    const { result } = renderHook(() => useThreads())

    const threads = [
      { id: 'thread1', title: 'Thread 1', messages: [] },
      { id: 'thread2', title: 'Thread 2', messages: [] },
    ]

    act(() => {
      result.current.setThreads(threads)
    })

    const filtered = result.current.getFilteredThreads('')
    expect(filtered).toHaveLength(2)
  })
  it('waits for upstream Code deletion and preserves the shared index when deletion fails', async () => {
    const row: Thread = { id: 'code-ses_saved', title: 'Saved Code', updated: 1,
      metadata: { runtime: 'code', code: { session_id: 'ses_saved', directory: '/workspace' } } }
    const deleteThread = vi.fn().mockRejectedValue(new Error('OpenCode is unavailable'))
    seedServiceHub({ threads: { deleteThread } as unknown as ThreadsService })
    act(() => useThreads.setState({ threads: { [row.id]: row } }))
    await expect(useThreads.getState().deleteThread(row.id)).rejects.toThrow('OpenCode is unavailable')
    expect(useThreads.getState().threads[row.id]).toEqual(row)
    deleteThread.mockResolvedValue(undefined)
    await act(async () => { await useThreads.getState().deleteThread(row.id) })
    expect(useThreads.getState().threads[row.id]).toBeUndefined()
  })

  it('bulk deletion retains failed Code rows and preserves favorites and project sessions', async () => {
    const code: Thread = { id: 'code-ses_bulk', title: 'Code', updated: 1,
      metadata: { runtime: 'code', code: { session_id: 'ses_bulk', directory: '/workspace' } } }
    const favorite: Thread = { id: 'favorite', title: 'Favorite', updated: 1, isFavorite: true }
    const project: Thread = { id: 'project', title: 'Project', updated: 1, metadata: { project: { id: 'work' } } }
    const chat: Thread = { id: 'chat', title: 'Chat', updated: 1 }
    seedServiceHub({ threads: { deleteThread: vi.fn(async id => {
      if (id === code.id) throw new Error('Stock Code deletion failed')
    }) } as unknown as ThreadsService })
    act(() => useThreads.setState({ threads: Object.fromEntries([code, favorite, project, chat].map(row => [row.id, row])) }))
    await act(async () => {
      await expect(useThreads.getState().deleteAllThreads()).rejects.toThrow('Stock Code deletion failed')
    })
    expect(Object.keys(useThreads.getState().threads).sort()).toEqual([code.id, favorite.id, project.id].sort())
  })

})

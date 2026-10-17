import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useAssistant, defaultAssistant } from '../useAssistant'
import type { AssistantsService } from '@/services/assistants/types'
import { seedServiceHub } from '@/test/service-hub'
import { localStorageKey } from '@/constants/localStorage'

function deferred() {
  let resolve!: () => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<void>((done, fail) => {
    resolve = done
    reject = fail
  })
  return { promise, resolve, reject }
}

describe('useAssistant', () => {
  let createAssistant: ReturnType<typeof vi.fn>
  let deleteAssistant: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.clearAllMocks()
    createAssistant = vi.fn().mockResolvedValue(undefined)
    deleteAssistant = vi.fn().mockResolvedValue(undefined)
    seedServiceHub({
      assistants: {
        createAssistant,
        deleteAssistant,
      } as unknown as AssistantsService,
    })
    localStorage.setItem(localStorageKey.defaultAssistantId, defaultAssistant.id)
    localStorage.setItem(localStorageKey.lastUsedAssistant, defaultAssistant.id)
    // Reset Zustand store to default state
    act(() => {
      useAssistant.setState({
        assistants: [defaultAssistant],
        currentAssistant: defaultAssistant,
        defaultAssistantId: defaultAssistant.id,
        pendingAssistant: undefined,
      })
    })
  })

  it('should initialize with default state', () => {
    const { result } = renderHook(() => useAssistant())

    expect(result.current.assistants).toEqual([defaultAssistant])
    expect(result.current.currentAssistant).toEqual(defaultAssistant)
  })

  it('should add assistant', () => {
    const { result } = renderHook(() => useAssistant())

    const newAssistant = {
      id: 'assistant-2',
      name: 'New Assistant',
      avatar: '🤖',
      description: 'A new assistant',
      instructions: 'Help the user',
      created_at: Date.now(),
      parameters: {},
    }

    act(() => {
      result.current.addAssistant(newAssistant)
    })

    expect(result.current.assistants).toHaveLength(2)
    expect(result.current.assistants).toContain(newAssistant)
  })

  it('should update assistant', () => {
    const { result } = renderHook(() => useAssistant())

    const updatedAssistant = {
      ...defaultAssistant,
      name: 'Updated GChat',
      description: 'Updated description',
    }

    act(() => {
      result.current.updateAssistant(updatedAssistant)
    })

    expect(result.current.assistants[0].name).toBe('Updated GChat')
    expect(result.current.assistants[0].description).toBe('Updated description')
  })

  it('should delete assistant after persistence succeeds', async () => {
    const { result } = renderHook(() => useAssistant())

    const assistant2 = {
      id: 'assistant-2',
      name: 'Assistant 2',
      avatar: '🤖',
      description: 'Second assistant',
      instructions: 'Help the user',
      created_at: Date.now(),
      parameters: {},
    }

    act(() => {
      result.current.addAssistant(assistant2)
    })

    expect(result.current.assistants).toHaveLength(2)

    await act(async () => {
      await result.current.deleteAssistant('assistant-2')
    })

    expect(deleteAssistant).toHaveBeenCalledExactlyOnceWith(assistant2)
    expect(result.current.assistants).toHaveLength(1)
    expect(result.current.assistants[0].id).toBe('gchat')
  })

  describe('deleteAssistant persistence', () => {
    const assistant: Assistant = {
      id: 'assistant-to-delete',
      name: 'Temporary assistant',
      instructions: 'Help the user',
      created_at: 1,
      parameters: {},
    }

    function selectAssistant() {
      act(() => {
        useAssistant.getState().setAssistants([defaultAssistant, assistant])
        useAssistant.getState().setCurrentAssistant(assistant)
        useAssistant.getState().setDefaultAssistant(assistant.id)
        useAssistant.getState().setPendingAssistant(assistant)
      })
    }

    it('keeps the assistant and selections while persistence waits, then applies fallback', async () => {
      const persistence = deferred()
      deleteAssistant.mockReturnValue(persistence.promise)
      selectAssistant()
      const { result } = renderHook(() => useAssistant())
      let deletion!: Promise<void>

      act(() => {
        deletion = result.current.deleteAssistant(assistant.id)
      })

      expect(deleteAssistant).toHaveBeenCalledExactlyOnceWith(assistant)
      expect(result.current.assistants).toEqual([defaultAssistant, assistant])
      expect(result.current.currentAssistant).toEqual(assistant)
      expect(result.current.defaultAssistantId).toBe(assistant.id)
      expect(result.current.pendingAssistant).toEqual(assistant)
      expect(localStorage.getItem(localStorageKey.lastUsedAssistant)).toBe(assistant.id)
      expect(localStorage.getItem(localStorageKey.defaultAssistantId)).toBe(assistant.id)

      await act(async () => {
        persistence.resolve()
        await deletion
      })

      expect(result.current.assistants).toEqual([defaultAssistant])
      expect(result.current.currentAssistant).toEqual(defaultAssistant)
      expect(result.current.defaultAssistantId).toBe(defaultAssistant.id)
      expect(result.current.pendingAssistant).toBeUndefined()
      expect(localStorage.getItem(localStorageKey.lastUsedAssistant)).toBe(defaultAssistant.id)
      expect(localStorage.getItem(localStorageKey.defaultAssistantId)).toBe(defaultAssistant.id)
    })

    it('propagates persistence failure without changing selection and allows retry', async () => {
      const error = new Error('Assistant storage is unavailable')
      deleteAssistant.mockRejectedValueOnce(error)
      selectAssistant()
      const { result } = renderHook(() => useAssistant())

      await act(async () => {
        await expect(result.current.deleteAssistant(assistant.id)).rejects.toBe(error)
      })

      expect(result.current.assistants).toEqual([defaultAssistant, assistant])
      expect(result.current.currentAssistant).toEqual(assistant)
      expect(result.current.defaultAssistantId).toBe(assistant.id)
      expect(result.current.pendingAssistant).toEqual(assistant)
      expect(localStorage.getItem(localStorageKey.lastUsedAssistant)).toBe(assistant.id)
      expect(localStorage.getItem(localStorageKey.defaultAssistantId)).toBe(assistant.id)

      await act(async () => {
        await result.current.deleteAssistant(assistant.id)
      })

      expect(deleteAssistant).toHaveBeenCalledTimes(2)
      expect(deleteAssistant).toHaveBeenLastCalledWith(assistant)
      expect(result.current.assistants).toEqual([defaultAssistant])
      expect(result.current.currentAssistant).toEqual(defaultAssistant)
      expect(result.current.defaultAssistantId).toBe(defaultAssistant.id)
      expect(result.current.pendingAssistant).toBeUndefined()
    })

    it('preserves other assistant edits, additions and selections made while deletion waits', async () => {
      const persistence = deferred()
      deleteAssistant.mockReturnValue(persistence.promise)
      selectAssistant()
      const { result } = renderHook(() => useAssistant())
      let deletion!: Promise<void>

      act(() => {
        deletion = result.current.deleteAssistant(assistant.id)
      })

      const editedDefault = { ...defaultAssistant, name: 'Updated GChat' }
      const replacement: Assistant = {
        ...assistant,
        id: 'assistant-added-during-deletion',
        name: 'Replacement assistant',
      }
      act(() => {
        result.current.updateAssistant(editedDefault)
        result.current.addAssistant(replacement)
        result.current.setCurrentAssistant(replacement)
        result.current.setDefaultAssistant(replacement.id)
        result.current.setPendingAssistant(replacement)
      })

      await act(async () => {
        persistence.resolve()
        await deletion
      })

      expect(result.current.assistants).toEqual([editedDefault, replacement])
      expect(result.current.currentAssistant).toEqual(replacement)
      expect(result.current.defaultAssistantId).toBe(replacement.id)
      expect(result.current.pendingAssistant).toEqual(replacement)
      expect(localStorage.getItem(localStorageKey.lastUsedAssistant)).toBe(replacement.id)
      expect(localStorage.getItem(localStorageKey.defaultAssistantId)).toBe(replacement.id)
    })
  })

  it('should set current assistant', () => {
    const { result } = renderHook(() => useAssistant())

    const newAssistant = {
      id: 'assistant-2',
      name: 'New Current Assistant',
      avatar: '🤖',
      description: 'New current assistant',
      instructions: 'Help the user',
      created_at: Date.now(),
      parameters: {},
    }

    act(() => {
      result.current.setCurrentAssistant(newAssistant)
    })

    expect(result.current.currentAssistant).toEqual(newAssistant)
  })

  it('should set assistants', () => {
    const { result } = renderHook(() => useAssistant())

    const assistants = [
      {
        id: 'assistant-1',
        name: 'Assistant 1',
        avatar: '🤖',
        description: 'First assistant',
        instructions: 'Help the user',
        created_at: Date.now(),
        parameters: {},
      },
      {
        id: 'assistant-2',
        name: 'Assistant 2',
        avatar: '🔧',
        description: 'Second assistant',
        instructions: 'Help with tasks',
        created_at: Date.now(),
        parameters: {},
      },
    ]

    act(() => {
      result.current.setAssistants(assistants)
    })

    expect(result.current.assistants).toEqual(assistants)
    expect(result.current.assistants).toHaveLength(2)
  })

  it('should maintain assistant structure', () => {
    const { result } = renderHook(() => useAssistant())

    expect(result.current.currentAssistant.id).toBe('gchat')
    expect(result.current.currentAssistant.name).toBe('GChat')
    expect(result.current.currentAssistant.avatar).toBe(
      '/images/transparent-logo.png'
    )
    expect(result.current.currentAssistant.instructions).toBe(
      'Current date: {{current_date}}'
    )
    expect(typeof result.current.currentAssistant.created_at).toBe('number')
    expect(typeof result.current.currentAssistant.parameters).toBe('object')
  })

  it('should handle empty assistants list', () => {
    const { result } = renderHook(() => useAssistant())

    act(() => {
      result.current.setAssistants([])
    })

    expect(result.current.assistants).toEqual([])
  })

  it('should update assistant in current assistant if it matches', () => {
    const { result } = renderHook(() => useAssistant())

    const updatedDefaultAssistant = {
      ...defaultAssistant,
      name: 'Updated GChat Name',
    }

    act(() => {
      result.current.updateAssistant(updatedDefaultAssistant)
    })

    expect(result.current.currentAssistant.name).toBe(
      'Updated GChat Name'
    )
  })

  describe('updateAssistantParam', () => {
    const otherAssistant: Assistant = {
      id: 'assistant-2',
      name: 'Assistant 2',
      instructions: 'Help the user',
      created_at: 1,
      parameters: { temperature: 0.2 },
    }

    beforeEach(() => {
      vi.useFakeTimers()
      act(() => {
        useAssistant.setState({
          assistants: [defaultAssistant, otherAssistant],
          currentAssistant: defaultAssistant,
        })
      })
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it('updates only the targeted assistant and marks it overridden', () => {
      const { result } = renderHook(() => useAssistant())

      act(() => {
        result.current.updateAssistantParam('assistant-2', 'temperature', 0.9)
      })

      const [first, second] = result.current.assistants
      expect(second.parameters.temperature).toBe(0.9)
      expect(second.sampling_overridden).toBe(true)
      expect(first.parameters).toEqual(defaultAssistant.parameters)
      expect(first.sampling_overridden).toBeUndefined()
    })

    it('refreshes the pending assistant copy so it is not stale', () => {
      const { result } = renderHook(() => useAssistant())

      act(() => {
        result.current.setPendingAssistant(otherAssistant)
        result.current.updateAssistantParam('assistant-2', 'top_k', 40)
      })

      expect(result.current.pendingAssistant?.parameters.top_k).toBe(40)
    })

    it('persists once after the debounce, with the latest value', () => {
      const { result } = renderHook(() => useAssistant())

      act(() => {
        result.current.updateAssistantParam('assistant-2', 'top_p', 0.5)
        result.current.updateAssistantParam('assistant-2', 'top_p', 0.6)
        result.current.updateAssistantParam('assistant-2', 'top_p', 0.7)
      })
      expect(createAssistant).not.toHaveBeenCalled()

      act(() => {
        vi.runAllTimers()
      })

      expect(createAssistant).toHaveBeenCalledTimes(1)
      expect(createAssistant.mock.calls[0][0]).toMatchObject({
        id: 'assistant-2',
        parameters: { temperature: 0.2, top_p: 0.7 },
        sampling_overridden: true,
      })
    })

    it('ignores an unknown assistant id', () => {
      const { result } = renderHook(() => useAssistant())

      act(() => {
        result.current.updateAssistantParam('missing', 'temperature', 0.9)
        vi.runAllTimers()
      })

      expect(createAssistant).not.toHaveBeenCalled()
      expect(result.current.assistants).toHaveLength(2)
    })
  })
})

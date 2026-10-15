import { useState } from 'react'
import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react'
import { invoke } from '@tauri-apps/api/core'
import { listen, type EventCallback } from '@tauri-apps/api/event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentDefinition } from '@/types/agent'
import { useAgentDefinitions } from './useAgentDefinitions'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn() }))

const definition: AgentDefinition = {
  schemaVersion: 3, id: 'reviewed', name: 'Reviewed reader', description: '',
  instructions: 'Read local documents.', skills: [], maxSteps: 25,
  outputContract: '', modelInstanceId: null, reasoningEffort: null,
  kind: 'standard', builtIn: false,
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((ok, fail) => { resolve = ok; reject = fail })
  return { promise, resolve, reject }
}

// Exercises the mounted hook and selector contract used by ChatInput. The
// write originates outside this consumer, as studio.manage does in Builder/Code.
function MountedSelector() {
  const { definitions } = useAgentDefinitions()
  const [selected, select] = useState('general')
  return definitions.length > 0 ? (
    <select aria-label="Invoke saved agent" value={selected} onChange={(event) => select(event.target.value)}>
      <option value="general">Chat</option>
      {definitions.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
    </select>
  ) : null
}

describe('mounted Agent definition consumers', () => {
  let changed: EventCallback<unknown>
  let stop: ReturnType<typeof vi.fn>
  let persisted: AgentDefinition[]

  beforeEach(() => {
    vi.clearAllMocks()
    persisted = []
    stop = vi.fn()
    vi.mocked(listen).mockImplementation(async (_event, handler) => {
      changed = handler as EventCallback<unknown>
      return stop
    })
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === 'agent_list_definitions') return [...persisted] as never
      throw new Error(`Unexpected command: ${command}`)
    })
  })

  function notify() {
    changed({ event: 'agent-definitions-changed', id: 1, payload: null })
  }

  it('reveals a native-saved definition without remount and preserves selection on updates', async () => {
    const view = render(<MountedSelector />)
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('agent_list_definitions'))
    expect(screen.queryByLabelText('Invoke saved agent')).toBeNull()
    expect(listen).toHaveBeenCalledWith('agent-definitions-changed', expect.any(Function))

    persisted = [definition]
    act(notify)
    const selector = await screen.findByLabelText('Invoke saved agent')
    fireEvent.change(selector, { target: { value: definition.id } })
    expect(selector).toHaveValue(definition.id)

    const unrelated = { ...definition, id: 'other', name: 'Other agent' }
    persisted = [{ ...definition, name: 'Updated reader', instructions: 'Use the updated document.' }, unrelated]
    act(notify)
    await screen.findByRole('option', { name: 'Updated reader' })
    expect(screen.getByLabelText('Invoke saved agent')).toBe(selector)
    expect(selector).toHaveValue(definition.id)
    expect(screen.getByRole('option', { name: 'Other agent' })).toHaveValue('other')
    persisted = [persisted[0]]
    act(notify)
    await waitFor(() => expect(screen.queryByRole('option', { name: 'Other agent' })).toBeNull())
    expect(selector).toHaveValue(definition.id)
    view.unmount()
    expect(stop).toHaveBeenCalledOnce()
  })

  it.each(['resolve', 'reject'] as const)('discards an obsolete list %s after a newer native change', async (completion) => {
    const old = deferred<AgentDefinition[]>()
    vi.mocked(invoke).mockImplementationOnce(() => old.promise as Promise<never>)
    const { result } = renderHook(() => useAgentDefinitions())
    await waitFor(() => expect(invoke).toHaveBeenCalledOnce())
    persisted = [{ ...definition, instructions: 'Latest definition' }]
    act(notify)
    await waitFor(() => expect(result.current.definitions).toEqual(persisted))
    await act(async () => {
      if (completion === 'resolve') old.resolve([])
      else old.reject(new Error('obsolete load failed'))
      await old.promise.catch(() => {})
    })
    expect(result.current.definitions).toEqual(persisted)
    expect(result.current.loading).toBe(false)
    expect(result.current.error).toBeNull()
  })

  it('loads changes made while native listener registration was pending', async () => {
    const registration = deferred<() => void>()
    vi.mocked(listen).mockImplementationOnce(() => registration.promise)
    const { result, unmount } = renderHook(() => useAgentDefinitions())
    expect(invoke).not.toHaveBeenCalled()
    persisted = [definition]
    await act(async () => { registration.resolve(stop); await registration.promise })
    await waitFor(() => expect(result.current.definitions).toEqual([definition]))
    unmount()
    expect(stop).toHaveBeenCalledOnce()
  })

  it('releases a late subscription after its consumer is disabled', async () => {
    const registration = deferred<() => void>()
    vi.mocked(listen).mockImplementationOnce(() => registration.promise)
    const { result, rerender } = renderHook(
      ({ enabled }) => useAgentDefinitions(enabled),
      { initialProps: { enabled: true } }
    )
    rerender({ enabled: false })
    await act(async () => { registration.resolve(stop); await registration.promise })
    expect(stop).toHaveBeenCalledOnce()
    expect(invoke).not.toHaveBeenCalled()
    expect(result.current.definitions).toEqual([])
    expect(result.current.loading).toBe(false)
    expect(result.current.error).toBeNull()
  })
})

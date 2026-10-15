import { act, renderHook, waitFor } from '@testing-library/react'
import { invoke } from '@tauri-apps/api/core'
import { listen, type EventCallback } from '@tauri-apps/api/event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useBundledResources } from './useBundledResources'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn() }))

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

describe('bundled resource preparation feedback', () => {
  let changed: EventCallback<unknown>
  let stop: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('IS_TAURI', true)
    stop = vi.fn()
    vi.mocked(listen).mockImplementation(async (_event, handler) => {
      changed = handler as EventCallback<unknown>
      return stop
    })
    vi.mocked(invoke).mockResolvedValue(false)
  })

  afterEach(() => vi.unstubAllGlobals())

  function notify() {
    changed({ event: 'bundled-resources-update', id: 1, payload: null })
  }

  it('subscribes before reading retained completion and discards an older pending reply', async () => {
    const registration = deferred<() => void>()
    const old = deferred<boolean>()
    vi.mocked(listen).mockImplementationOnce((_event, handler) => {
      changed = handler as EventCallback<unknown>
      return registration.promise
    })
    vi.mocked(invoke).mockImplementationOnce(() => old.promise as Promise<never>)
    const { result, unmount } = renderHook(() => useBundledResources())
    expect(result.current.ready).toBeNull()
    expect(invoke).not.toHaveBeenCalled()
    await act(async () => { registration.resolve(stop); await registration.promise })
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('bundled_resources_ready'))
    vi.mocked(invoke).mockResolvedValueOnce(true)
    act(notify)
    await waitFor(() => expect(result.current.ready).toBe(true))
    await act(async () => { old.resolve(false); await old.promise })
    expect(result.current).toEqual({ ready: true, error: '' })
    expect(listen).toHaveBeenCalledWith('bundled-resources-update', expect.any(Function))
    unmount()
    expect(stop).toHaveBeenCalledOnce()
  })

  it('shows pending preparation and the retained installation failure', async () => {
    const { result } = renderHook(() => useBundledResources())
    await waitFor(() => expect(result.current.ready).toBe(false))
    vi.mocked(invoke).mockRejectedValueOnce('runtime digest mismatch')
    act(notify)
    await waitFor(() => expect(result.current.error).toBe('runtime digest mismatch'))
    expect(result.current.ready).toBeNull()
  })

  it('makes no disabled calls and detaches a subscription that resolves after disabling', async () => {
    const registration = deferred<() => void>()
    vi.mocked(listen).mockImplementationOnce((_event, handler) => {
      changed = handler as EventCallback<unknown>
      return registration.promise
    })
    const { result, rerender } = renderHook(
      ({ enabled }) => useBundledResources(enabled),
      { initialProps: { enabled: false } }
    )
    expect(result.current.ready).toBe(true)
    expect(listen).not.toHaveBeenCalled()
    expect(invoke).not.toHaveBeenCalled()
    rerender({ enabled: true })
    rerender({ enabled: false })
    act(notify)
    await act(async () => { registration.resolve(stop); await registration.promise })
    expect(stop).toHaveBeenCalledOnce()
    expect(invoke).not.toHaveBeenCalled()
  })
})

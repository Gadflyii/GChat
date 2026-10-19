import { renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  listeners: [] as (() => void)[],
  gbot: vi.fn(),
  notify: vi.fn(),
}))
vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(async (_name: string, handler: () => void) => {
    mocks.listeners.push(handler)
    return () => undefined
  }),
}))
vi.mock('@/services/gbot', async () => ({
  ...(await vi.importActual<typeof import('@/services/gbot')>('@/services/gbot')),
  gbot: mocks.gbot,
}))
vi.mock('@/lib/notifications', () => ({ notifyThreadCompleted: mocks.notify }))

import { useGbotNotifications } from '../useGbotNotifications'
import { useThreadNotifications } from '../useThreadNotifications'

const task = (state: string) => ({
  id: 't1',
  identity: { workspace_id: 'w', session_id: 's' },
  state,
  messages: [{ role: 'user', content: 'Book the room' }],
  help_requests: [],
})
const serve = (state: string, approvals: unknown[] = []) =>
  mocks.gbot.mockImplementation(async (path: string) =>
    path === 'tasks' ? [task(state)] : approvals
  )
const fire = async () => {
  mocks.listeners.at(-1)!()
  await waitFor(() => expect(mocks.gbot).toHaveBeenCalled())
}

beforeEach(() => {
  vi.stubGlobal('IS_TAURI', true)
  mocks.listeners.length = 0
  mocks.gbot.mockReset()
  mocks.notify.mockReset()
  useThreadNotifications.setState({ globallyEnabled: true })
  vi.spyOn(document, 'hasFocus').mockReturnValue(false)
})
afterEach(() => vi.unstubAllGlobals())

describe('useGbotNotifications', () => {
  it('stays quiet until the service reports, then notifies on a finished task', async () => {
    renderHook(() => useGbotNotifications())
    await waitFor(() => expect(mocks.listeners).toHaveLength(1))
    expect(mocks.gbot).not.toHaveBeenCalled()
    serve('running')
    await fire()
    expect(mocks.notify).not.toHaveBeenCalled()
    mocks.gbot.mockClear()
    serve('completed')
    await fire()
    await waitFor(() =>
      expect(mocks.notify).toHaveBeenCalledExactlyOnceWith(
        'Gbot finished a task',
        'Book the room'
      )
    )
  })

  it('notifies for a new approval and honors the master switch', async () => {
    renderHook(() => useGbotNotifications())
    await waitFor(() => expect(mocks.listeners).toHaveLength(1))
    serve('running')
    await fire()
    useThreadNotifications.setState({ globallyEnabled: false })
    serve('running', [{ id: 'p', task_id: 't1', request: { operation: {} } }])
    await fire()
    await waitFor(() => expect(mocks.gbot).toHaveBeenCalledTimes(4))
    expect(mocks.notify).not.toHaveBeenCalled()
  })

  it('does nothing when the service is not connected', async () => {
    mocks.gbot.mockRejectedValue(new Error('Gbot service is not running'))
    renderHook(() => useGbotNotifications())
    await waitFor(() => expect(mocks.listeners).toHaveLength(1))
    await fire()
    expect(mocks.notify).not.toHaveBeenCalled()
  })
})

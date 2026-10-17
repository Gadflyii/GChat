import { mockIPC } from '@tauri-apps/api/mocks'
import { describe, expect, it, vi } from 'vitest'
import { stopCodeTerminals } from './tauri'

describe('Code workspace stop IPC', () => {
  it('requests the native all-Code stop without a single terminal id', async () => {
    const ipc = vi.fn(() => undefined)
    mockIPC(ipc)

    await expect(stopCodeTerminals()).resolves.toBeUndefined()

    expect(ipc).toHaveBeenCalledExactlyOnceWith('terminal_stop_code', {})
  })

  it('keeps native stop failures visible to the caller', async () => {
    mockIPC(() => Promise.reject('Could not stop workspace'))

    await expect(stopCodeTerminals()).rejects.toBe('Could not stop workspace')
  })
})

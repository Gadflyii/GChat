import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mockIPC } from '@tauri-apps/api/mocks'
import { TauriOpenerService } from '../opener/tauri'

describe('TauriOpenerService folder reveal', () => {
  const ipc = vi.fn()
  const opener = new TauriOpenerService()

  beforeEach(() => {
    ipc.mockReset()
    mockIPC(ipc)
  })

  it('hands the literal selected path to the runtime-safe native command', async () => {
    const path = "/private/log folder 'quoted' $(literal)/app.log"
    await expect(opener.revealItemInDir(path)).resolves.toBeUndefined()
    expect(ipc).toHaveBeenCalledWith('reveal_item_in_dir', { path })
  })

  it('preserves a file-manager error for the calling control', async () => {
    ipc.mockRejectedValue('No private file manager is available')
    await expect(opener.revealItemInDir('/private/logs')).rejects.toBe(
      'No private file manager is available'
    )
  })
})

import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock(
  '../../../src-tauri/plugins/tauri-plugin-rag/guest-js/index',
  () => ({})
)

import RagExtension from '../../../extensions/rag-extension/src/index'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.resetAllMocks()
})

describe('disabled embedding startup', () => {
  it('loads settings without probing the unavailable vector search feature', async () => {
    const status = vi.fn()
    const getExtension = vi.fn(() => ({ getStatus: status }))
    vi.stubGlobal('SETTINGS', [])
    vi.stubGlobal('window', {
      core: { extensionManager: { get: getExtension } },
    })
    const extension = new RagExtension('', '@gchat/rag-extension')
    let finishRegistration!: () => void
    vi.spyOn(extension, 'registerSettings').mockReturnValue(
      new Promise<void>((resolve) => {
        finishRegistration = resolve
      })
    )
    const getSetting = vi.spyOn(extension, 'getSetting')
      .mockImplementation(async (_key, fallback) => fallback)
    let loaded = false
    const loading = extension.onLoad().then(() => {
      loaded = true
    })
    await Promise.resolve()
    expect(loaded).toBe(false)
    finishRegistration()
    await loading
    expect(loaded).toBe(true)
    expect(getSetting).toHaveBeenCalledWith('enabled', true)
    expect(getExtension).not.toHaveBeenCalled()
    expect(status).not.toHaveBeenCalled()
  })
})

import { afterEach, describe, expect, it, vi } from 'vitest'

const settings = vi.hoisted(() => ({ register: vi.fn(), get: vi.fn() }))

vi.mock('@gchat/core', () => ({
  RAGExtension: class {
    registerSettings = settings.register
    getSetting = settings.get
  },
  ExtensionTypeEnum: { VectorDB: 'vector-db' },
}))
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
    let finishRegistration!: () => void
    settings.register.mockReturnValue(
      new Promise<void>((resolve) => {
        finishRegistration = resolve
      })
    )
    settings.get.mockImplementation(async (_key, fallback) => fallback)
    let loaded = false
    const loading = new RagExtension().onLoad().then(() => {
      loaded = true
    })
    await Promise.resolve()
    expect(loaded).toBe(false)
    finishRegistration()
    await loading
    expect(settings.get).toHaveBeenCalledWith('enabled', true)
    expect(getExtension).not.toHaveBeenCalled()
    expect(status).not.toHaveBeenCalled()
  })
})

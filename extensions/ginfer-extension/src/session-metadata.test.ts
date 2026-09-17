import { afterEach, describe, expect, it, vi } from 'vitest'
import { countTokens, loadedContext } from './session-metadata'

const session = { port: 12345, api_key: 'test-secret' }
afterEach(() => vi.unstubAllGlobals())

describe('session-scoped GInfer metadata', () => {
  it('uses the loaded model context regardless of local filename aliases', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: [
      { id: 'muse-glimmer-30b/nvfp4-dflash-nvfp4', max_model_len: 131072 },
    ] }))))
    expect(await loadedContext(session)).toBe(131072)
  })

  it('counts the rendered prompt using the supported endpoint', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response('{"input_tokens":42}'))
    vi.stubGlobal('fetch', fetcher)
    const messages = [{ role: 'user', content: 'Hello' }]
    expect(await countTokens(session, 'local-model', messages)).toBe(42)
    expect(fetcher.mock.calls[0][0]).toBe('http://127.0.0.1:12345/v1/chat/completions/count_tokens')
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({ model: 'local-model', messages, stream: false })
  })

  it('surfaces unavailable metadata and rejects invalid counts', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 503 })))
    await expect(loadedContext(session)).rejects.toThrow('HTTP 503')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{"input_tokens":null}')))
    await expect(countTokens(session, 'model', [])).rejects.toThrow('Invalid prompt-token count')
  })
})

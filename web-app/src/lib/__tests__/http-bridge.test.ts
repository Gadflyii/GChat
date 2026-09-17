import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fetch } from '@tauri-apps/plugin-http'
const invoke = vi.fn()
beforeEach(() => { Object.assign(window, { __TAURI_INTERNALS__: { invoke } }) })
afterEach(() => vi.resetAllMocks())

function responseChunks(chunks: string[]) {
  const data = chunks.map(text => new TextEncoder().encode(text))
  vi.mocked(invoke).mockImplementation(async (command) => {
    if (command === 'plugin:http|fetch') return 1 as never
    if (command === 'plugin:http|fetch_send') return {
      rid: 2, status: 200, statusText: 'OK', url: 'http://127.0.0.1:1234', headers: [],
    } as never
    if (command === 'plugin:http|fetch_read_body') {
      const chunk = data.shift()
      return (chunk ? new Uint8Array([...chunk, 0]).buffer : new Uint8Array([1]).buffer) as never
    }
    return undefined as never
  })
}

describe('native HTTP response-body protocol', () => {
  it('consumes returned IPC body bytes and EOF for prompt counts', async () => {
    responseChunks(['{"input_', 'tokens":69}'])
    const response = await fetch('http://127.0.0.1:1234/v1/chat/completions/count_tokens')
    expect(await response.json()).toEqual({ input_tokens: 69 })
  })

  it('delivers SSE incrementally and preserves UTF-8 bytes', async () => {
    responseChunks(['data: {"content":"café"}\n\n', 'data: [DONE]\n\n'])
    const response = await fetch('http://127.0.0.1:1234/v1/chat/completions')
    const reader = response.body!.getReader()
    expect(new TextDecoder().decode((await reader.read()).value)).toContain('café')
    expect(new TextDecoder().decode((await reader.read()).value)).toContain('[DONE]')
    expect((await reader.read()).done).toBe(true)
  })

  it('cancels a pending body through the native cancellation command', async () => {
    responseChunks([])
    const implementation = vi.mocked(invoke).getMockImplementation()!
    vi.mocked(invoke).mockImplementation((command, args) => command === 'plugin:http|fetch_read_body'
      ? new Promise(() => {}) : implementation(command, args))
    const response = await fetch('http://127.0.0.1:1234/v1/chat/completions')
    const reader = response.body!.getReader()
    const reading = reader.read()
    await reader.cancel()
    expect((await reading).done).toBe(true)
    expect(invoke).toHaveBeenCalledWith('plugin:http|fetch_cancel_body', { rid: 2 }, undefined)
  })
})

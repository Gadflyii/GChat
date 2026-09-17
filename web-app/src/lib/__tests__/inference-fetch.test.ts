import { afterEach, expect, it, vi } from 'vitest'
import { inferenceFetch } from '../inference-fetch'

afterEach(() => vi.useRealTimers())

it('aborts an idle native response and releases its reader', async () => {
  vi.useFakeTimers()
  let signal: AbortSignal | undefined
  const fetcher = vi.fn(async (_input, init) => {
    signal = init.signal
    return new Response(new ReadableStream({ start(controller) {
      signal!.addEventListener('abort', () => controller.error(signal!.reason))
    } }))
  })
  const response = await inferenceFetch(fetcher, 'http://localhost:1', {}, 100)
  const reading = response.text()
  const assertion = expect(reading).rejects.toThrow('timed out')
  await vi.advanceTimersByTimeAsync(101)
  await assertion
  expect(signal?.aborted).toBe(true)
})

it('propagates Stop while awaiting response headers', async () => {
  const abort = new AbortController()
  const fetcher = vi.fn((_input, init) => new Promise<Response>((_resolve, reject) => {
    init.signal.addEventListener('abort', () => reject(init.signal.reason))
  }))
  const pending = inferenceFetch(fetcher, 'http://localhost:1', { signal: abort.signal })
  abort.abort(new Error('Stopped'))
  await expect(pending).rejects.toThrow('Stopped')
})

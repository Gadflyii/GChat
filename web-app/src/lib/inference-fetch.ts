import { ttftMark } from './ttft-timing'

/** Bound inactivity without imposing a total generation deadline. */
export async function inferenceFetch(
  fetcher: typeof fetch,
  input: RequestInfo | URL,
  init?: RequestInit,
  idleMs = 30 * 60 * 1000
): Promise<Response> {
  const controller = new AbortController()
  const abort = () => controller.abort(init?.signal?.reason)
  if (init?.signal?.aborted) abort()
  else init?.signal?.addEventListener('abort', abort, { once: true })
  let timer: ReturnType<typeof setTimeout>
  const reset = () => {
    clearTimeout(timer)
    timer = setTimeout(() => controller.abort(new Error('Inference connection timed out waiting for data')), idleMs)
  }
  const cleanup = () => {
    clearTimeout(timer)
    init?.signal?.removeEventListener('abort', abort)
  }
  reset()
  try {
    ttftMark('epsilonInvoke')
    const response = await fetcher(input, { ...init, signal: controller.signal })
    if (!response.body) { cleanup(); return response }
    const reader = response.body.getReader()
    let first = true
    const body = new ReadableStream<Uint8Array>({
      async pull(stream) {
        try {
          const next = await reader.read()
          if (next.done) { cleanup(); reader.releaseLock(); stream.close() }
          else {
            if (first) { ttftMark('epsilonFirstChunk'); first = false }
            reset(); stream.enqueue(next.value)
          }
        } catch (error) { cleanup(); reader.releaseLock(); stream.error(error) }
      },
      async cancel(reason) {
        cleanup()
        controller.abort(reason)
        await reader.cancel(reason)
      },
    })
    return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers })
  } catch (error) { cleanup(); throw error }
}

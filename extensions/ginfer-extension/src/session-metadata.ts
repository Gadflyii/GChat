type Session = { port: number; api_key: string }

export async function loadedContext(session: Session): Promise<number | undefined> {
  const response = await fetch(`http://127.0.0.1:${session.port}/v1/models`, {
    headers: { Authorization: `Bearer ${session.api_key}` },
    signal: AbortSignal.timeout(10_000),
  })
  if (!response.ok) throw new Error(`Unable to read loaded context: HTTP ${response.status}`)
  const payload = await response.json() as { data?: Array<{ max_model_len?: number }> }
  // The connection is scoped to one engine session; its public ID may differ from the local filename.
  if (payload.data?.length !== 1) throw new Error('Expected one model on the local engine session')
  const value = Number(payload.data[0].max_model_len)
  return Number.isInteger(value) && value > 0 ? value : undefined
}

export async function countTokens(session: Session, model: string, messages: unknown[]): Promise<number> {
  const response = await fetch(`http://127.0.0.1:${session.port}/v1/chat/completions/count_tokens`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${session.api_key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, messages, stream: false }),
    signal: AbortSignal.timeout(30_000),
  })
  if (!response.ok) throw new Error(`Unable to count prompt tokens: HTTP ${response.status}`)
  const payload = await response.json() as { input_tokens?: unknown }
  if (!Number.isInteger(payload.input_tokens) || Number(payload.input_tokens) < 0) {
    throw new Error('Invalid prompt-token count from GInfer')
  }
  return Number(payload.input_tokens)
}

// Opt-in gate bridge to Chat's existing context policy, with one cache per task.
import { createInterface } from 'node:readline'
import { prepareGInferContextRequest, type GInferContextState } from '../../../web-app/src/lib/smart-context'

const state: GInferContextState = { lastCompaction: null }
const headers: Record<string, string> = { 'content-type': 'application/json' }
if (process.env.GBOT_MODEL_API_KEY) {
  headers.authorization = `Bearer ${process.env.GBOT_MODEL_API_KEY}`
}
for await (const line of createInterface({ input: process.stdin })) {
  try {
    const request = JSON.parse(line)
    let usage
    const prepared = await prepareGInferContextRequest(
      request.url, request.body, headers, fetch,
      {
        threadId: request.threadId,
        configuredContextTokens: request.contextTokens,
        state,
        onUsage: value => { usage = value },
      }
    )
    process.stdout.write(JSON.stringify({ ...prepared, usage }) + '\n')
  } catch (error) {
    process.stdout.write(JSON.stringify({ error: String(error) }) + '\n')
  }
}

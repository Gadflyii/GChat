import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  clearSmartContextCacheForTests,
  completeTurnStarts,
  ginferContextPolicyForModel,
  prepareGInferContextRequest,
  SmartContextError,
} from '../smart-context'

const completionUrl = 'http://localhost:8011/v1/chat/completions'
const headers = { Authorization: 'Bearer test' }

function messageText(body: Record<string, unknown>): string {
  return JSON.stringify(body.messages ?? [])
}

function scriptedFetch() {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const body = JSON.parse(String(init?.body ?? '{}')) as Record<
      string,
      unknown
    >
    if (url.endsWith('/count_tokens')) {
      const text = messageText(body)
      const isSummary = text.includes('loss-minimizing conversation checkpoints')
      const hasCheckpoint = text.includes('GChat conversation checkpoint')
      const hasOldHistory = text.includes('old objective')
      return new Response(
        JSON.stringify({
          object: 'chat.completion.token_count',
          input_tokens: isSummary
            ? 120
            : hasCheckpoint
              ? 220
              : hasOldHistory
                ? 4_900
                : 180,
        }),
        { status: 200 }
      )
    }
    return new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content:
                '## Objective\nKeep the old objective.\n## Pending work\nContinue safely.',
            },
          },
        ],
      }),
      { status: 200 }
    )
  })
}

function overflowingBody(tools = false): Record<string, unknown> {
  return {
    model: 'muse',
    max_tokens: 100,
    stream: true,
    ...(tools
      ? {
          tools: [
            {
              type: 'function',
              function: { name: 'read', parameters: { type: 'object' } },
            },
          ],
        }
      : {}),
    messages: [
      { role: 'user', content: 'old objective' },
      { role: 'assistant', content: 'old result' },
      { role: 'user', content: 'middle question' },
      { role: 'assistant', content: 'middle result' },
      { role: 'user', content: 'current request' },
    ],
  }
}

function toolResultBody(result: string): Record<string, unknown> {
  return {
    model: 'muse',
    max_tokens: 100,
    tools: [{ type: 'function', function: { name: 'crawl', parameters: {} } }],
    messages: [
      { role: 'user', content: 'Find the relevant source and answer the question.' },
      {
        role: 'assistant',
        tool_calls: [{ id: 'call-crawl-1', type: 'function', function: { name: 'crawl', arguments: '{"url":"https://example.com/a"}' } }],
      },
      { role: 'tool', tool_call_id: 'call-crawl-1', content: result },
    ],
  }
}

function toolSummaryFetch(options: { fail?: boolean; empty?: boolean } = {}) {
  const chunks: string[] = []
  const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = JSON.parse(String(init?.body)) as { messages: Array<{ content: string }> }
    if (String(input).endsWith('/count_tokens')) {
      return new Response(JSON.stringify({ input_tokens: Math.ceil(JSON.stringify(request.messages).length / 4) + 40 }), { status: 200 })
    }
    const prompt = request.messages.at(-1)?.content ?? ''
    chunks.push(prompt.split('Next result chunk:\n')[1] ?? '')
    if (options.fail) return new Response('summary unavailable', { status: 503 })
    return new Response(JSON.stringify({ choices: [{ message: { content: options.empty ? '' : 'Source https://example.com/a; finding 42.' } }] }), { status: 200 })
  })
  return { fetcher, chunks }
}

describe('smart GInfer context', () => {
  beforeEach(() => clearSmartContextCacheForTests())

  it('selects only complete user-turn boundaries', () => {
    expect(
      completeTurnStarts([
        { role: 'user' },
        { role: 'assistant', tool_calls: [{}] },
        { role: 'tool', tool_call_id: 'one' },
        { role: 'assistant' },
        { role: 'user' },
      ])
    ).toEqual([0, 4])
  })

  it('builds the policy from the current persisted model profile', () => {
    const state = { lastCompaction: null }
    expect(
      ginferContextPolicyForModel(
        'thread-a',
        'muse',
        [
          {
            id: 'muse',
            settings: {
              ctx_len: { controller_props: { value: 32_768, max: 131_072 } },
            },
          },
        ],
        [],
        state
      )
    ).toEqual({
      threadId: 'thread-a',
      configuredContextTokens: 32_768,
      state,
    })
  })

  it('compacts at the configured host context even below profile maximum', async () => {
    const prepared = await prepareGInferContextRequest(
      completionUrl,
      overflowingBody(),
      headers,
      scriptedFetch(),
      { threadId: 'thread-a', configuredContextTokens: 5_000 }
    )
    expect(prepared.report?.inputTokensAfter).toBe(220)
  })

  it('generates and reuses a structured checkpoint without mutating the transcript', async () => {
    const fetcher = scriptedFetch()
    const original = overflowingBody()
    const originalSnapshot = structuredClone(original)
    const reports: Array<{ reusedCheckpoint: boolean }> = []
    const policy = {
      threadId: 'thread-a',
      configuredContextTokens: 5_000,
      nativeContextTokens: 5_000,
      autoIncrease: true,
      onCompaction: (report: { reusedCheckpoint: boolean }) =>
        reports.push(report),
    }

    const first = await prepareGInferContextRequest(
      completionUrl,
      original,
      headers,
      fetcher,
      policy
    )
    expect(original).toEqual(originalSnapshot)
    expect(first.report).toMatchObject({
      summarizedMessages: 2,
      retainedMessages: 3,
      reusedCheckpoint: false,
    })
    expect(JSON.parse(first.body).messages[0].content).toContain(
      'GChat conversation checkpoint'
    )

    const second = await prepareGInferContextRequest(
      completionUrl,
      original,
      headers,
      fetcher,
      policy
    )
    expect(second.report?.reusedCheckpoint).toBe(true)
    expect(reports.map((report) => report.reusedCheckpoint)).toEqual([
      false,
      true,
    ])
    const summaryRequests = fetcher.mock.calls.filter(
      ([url]) => String(url) === completionUrl
    )
    expect(summaryRequests).toHaveLength(1)
  })

  it('folds a checkpoint into the retained user turn when tools are active', async () => {
    const prepared = await prepareGInferContextRequest(
      completionUrl,
      overflowingBody(true),
      headers,
      scriptedFetch(),
      {
        threadId: 'thread-tools',
        configuredContextTokens: 5_000,
        nativeContextTokens: 5_000,
        autoIncrease: false,
      }
    )
    const messages = JSON.parse(prepared.body).messages as Array<{
      role: string
      content: string
    }>
    expect(messages.some((message) => message.role === 'system')).toBe(false)
    expect(messages[0].role).toBe('user')
    expect(messages[0].content).toContain('GChat conversation checkpoint')
    expect(messages[0].content).toContain('middle question')
  })

  it('manually compacts older turns even when the full prompt still fits', async () => {
    const fetcher = scriptedFetch()
    const state = {
      lastCompaction: null,
      manualCompactionRequested: true,
      manualCompactionResult: null,
    }
    const policy = {
      threadId: 'thread-manual',
      configuredContextTokens: 16_000,
      nativeContextTokens: 16_000,
      autoIncrease: true,
      state,
    }

    const first = await prepareGInferContextRequest(
      completionUrl,
      overflowingBody(),
      headers,
      fetcher,
      policy
    )
    expect(state.manualCompactionResult).toMatchObject({
      status: 'compacted',
      report: {
        summarizedMessages: 2,
        retainedMessages: 3,
      },
    })
    expect(messageText(JSON.parse(first.body))).toContain(
      'GChat conversation checkpoint'
    )

    state.manualCompactionRequested = false
    state.manualCompactionResult = null
    const next = await prepareGInferContextRequest(
      completionUrl,
      overflowingBody(),
      headers,
      fetcher,
      policy
    )
    expect(next.report?.reusedCheckpoint).toBe(true)
    expect(messageText(JSON.parse(next.body))).toContain(
      'GChat conversation checkpoint'
    )
  })

  it('reports when a manual compact has fewer than three user turns', async () => {
    const state = {
      lastCompaction: null,
      manualCompactionRequested: true,
      manualCompactionResult: null,
    }
    const body = {
      model: 'muse',
      messages: [
        { role: 'user', content: 'first' },
        { role: 'assistant', content: 'answer' },
        { role: 'user', content: 'second' },
      ],
    }
    const prepared = await prepareGInferContextRequest(
      completionUrl,
      body,
      headers,
      scriptedFetch(),
      {
        threadId: 'thread-short',
        configuredContextTokens: 16_000,
        nativeContextTokens: 16_000,
        autoIncrease: true,
        state,
      }
    )
    expect(JSON.parse(prepared.body)).toEqual(body)
    expect(state.manualCompactionResult).toEqual({
      status: 'nothing_to_compact',
    })
  })

  it('refuses to split or silently truncate one oversized current turn', async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).endsWith('/count_tokens')) {
        return new Response(JSON.stringify({ input_tokens: 4_900 }), {
          status: 200,
        })
      }
      throw new Error('checkpoint generation must not run')
    })
    await expect(
      prepareGInferContextRequest(
        completionUrl,
        {
          model: 'muse',
          max_tokens: 100,
          messages: [{ role: 'user', content: 'one enormous attachment' }],
        },
        headers,
        fetcher,
        {
          threadId: 'thread-large',
          configuredContextTokens: 5_000,
          nativeContextTokens: 5_000,
          autoIncrease: false,
        }
      )
    ).rejects.toMatchObject<Partial<SmartContextError>>({
      code: 'context_turn_too_large',
    })
  })

  it('summarizes every chunk of an oversized current tool result and preserves call pairing', async () => {
    const result = `https://example.com/a\n${'finding 42. '.repeat(1_300)}`
    const original = toolResultBody(result)
    const snapshot = structuredClone(original)
    const { fetcher, chunks } = toolSummaryFetch()
    const usages: number[] = []
    const policy = {
      threadId: 'tool-chunks',
      configuredContextTokens: 2_000,
      onUsage: (usage: { inputTokens: number }) => usages.push(usage.inputTokens),
    }
    const prepared = await prepareGInferContextRequest(
      completionUrl, original, headers, fetcher, policy
    )
    const wire = JSON.parse(prepared.body) as { messages: Array<Record<string, unknown>> }
    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks.join('')).toBe(result)
    expect(wire.messages[0]).toEqual((original.messages as unknown[])[0])
    expect(wire.messages[1]).toEqual((original.messages as unknown[])[1])
    expect(wire.messages[2]).toMatchObject({
      role: 'tool',
      tool_call_id: 'call-crawl-1',
      content: expect.stringContaining('Source https://example.com/a'),
    })
    expect(original).toEqual(snapshot)
    expect(prepared.report?.summarizedMessages).toBe(1)
    expect(usages).toHaveLength(2)
    expect(usages[1]).toBeLessThanOrEqual(2_000 - 100 - 256)

    const again = await prepareGInferContextRequest(
      completionUrl, original, headers, fetcher, policy
    )
    expect(again.report?.reusedCheckpoint).toBe(true)
    expect(chunks.join('')).toBe(result)
  })

  it('leaves the original tool result intact and fails clearly when summarization fails', async () => {
    const original = toolResultBody('large source '.repeat(2_000))
    const snapshot = structuredClone(original)
    await expect(prepareGInferContextRequest(
      completionUrl, original, headers, toolSummaryFetch({ fail: true }).fetcher,
      { threadId: 'tool-failure', configuredContextTokens: 2_000 }
    )).rejects.toMatchObject<Partial<SmartContextError>>({
      code: 'context_checkpoint_failed',
      message: expect.stringContaining('summarize the tool result'),
    })
    expect(original).toEqual(snapshot)
  })

  it('reuses the current-turn summary when that result becomes older history', async () => {
    const result = 'https://example.com/a\n' + 'finding 42. '.repeat(1_300)
    const original = toolResultBody(result)
    const { fetcher } = toolSummaryFetch()
    const policy = { threadId: 'follow-up', configuredContextTokens: 2_000 }
    await prepareGInferContextRequest(completionUrl, original, headers, fetcher, policy)

    const followUp = structuredClone(original)
    ;(followUp.messages as unknown[]).push({ role: 'user', content: 'What did the source say?' })
    const snapshot = structuredClone(followUp)
    const callsBefore = fetcher.mock.calls.length
    const prepared = await prepareGInferContextRequest(
      completionUrl, followUp, headers, fetcher, policy
    )
    const newSummaryRequests = fetcher.mock.calls.slice(callsBefore)
      .filter(([url]) => String(url) === completionUrl)
      .map(([, init]) => JSON.parse(String(init?.body)) as { messages: Array<{ content: string }> })
    expect(newSummaryRequests).toHaveLength(0)
    expect(prepared.report?.inputTokensAfter).toBeLessThanOrEqual(2_000 - 100 - 256)
    expect(JSON.parse(prepared.body).messages[2].content).toContain('Source https://example.com/a')
    expect(JSON.parse(prepared.body).messages.at(-1).content).toContain('What did the source say?')
    expect(followUp).toEqual(snapshot)
  })

  it('recovers a historical oversized result after the in-memory cache is cleared', async () => {
    const result = 'https://example.com/a\n' + 'finding 42. '.repeat(1_300)
    const original = toolResultBody(result)
    const policy = { threadId: 'reopened-thread', configuredContextTokens: 2_000 }
    await prepareGInferContextRequest(
      completionUrl, original, headers, toolSummaryFetch().fetcher, policy
    )
    clearSmartContextCacheForTests()

    const followUp = structuredClone(original)
    ;(followUp.messages as unknown[]).push({ role: 'user', content: 'Continue from that source.' })
    const snapshot = structuredClone(followUp)
    const { fetcher } = toolSummaryFetch()
    const prepared = await prepareGInferContextRequest(
      completionUrl, followUp, headers, fetcher, policy
    )
    expect(fetcher.mock.calls.some(([url]) => String(url) === completionUrl)).toBe(true)
    expect(prepared.report?.inputTokensAfter).toBeLessThanOrEqual(2_000 - 100 - 256)
    expect(JSON.parse(prepared.body).messages[2]).toMatchObject({
      tool_call_id: 'call-crawl-1',
      content: expect.stringContaining('model-generated tool-result summary'),
    })
    expect(followUp).toEqual(snapshot)
  })

  it('uses bounded tool-result recovery for manual compaction of one oversized turn', async () => {
    const state = {
      lastCompaction: null,
      manualCompactionRequested: true,
      manualCompactionResult: null as null | { status: string },
    }
    const prepared = await prepareGInferContextRequest(
      completionUrl,
      toolResultBody('tool result '.repeat(1_300)),
      headers,
      toolSummaryFetch().fetcher,
      { threadId: 'manual-tool', configuredContextTokens: 2_000, state }
    )
    expect(state.manualCompactionResult?.status).toBe('compacted')
    expect(prepared.report?.inputTokensAfter).toBeLessThanOrEqual(2_000 - 100 - 256)
  })

  it('keeps separate call IDs when multiple results need recovery', async () => {
    const body = toolResultBody('first result '.repeat(900))
    const messages = body.messages as Array<Record<string, unknown>>
    ;(messages[1].tool_calls as Array<Record<string, unknown>>).push({
      id: 'call-crawl-2', type: 'function',
      function: { name: 'crawl', arguments: '{"url":"https://example.com/b"}' },
    })
    messages.push({ role: 'tool', tool_call_id: 'call-crawl-2', content: 'second result '.repeat(900) })
    const { fetcher } = toolSummaryFetch()
    const prepared = await prepareGInferContextRequest(
      completionUrl, body, headers, fetcher,
      { threadId: 'two-results', configuredContextTokens: 2_000 }
    )
    const wire = JSON.parse(prepared.body).messages as Array<Record<string, unknown>>
    expect(wire.slice(2).map((message) => message.tool_call_id)).toEqual([
      'call-crawl-1', 'call-crawl-2',
    ])
    expect(wire.slice(2).every((message) => String(message.content).includes('model-generated tool-result summary'))).toBe(true)
    expect(prepared.report?.inputTokensAfter).toBeLessThanOrEqual(2_000 - 100 - 256)
  })

  it('omits embedded media bytes from the tool-summary question', async () => {
    const body = toolResultBody('crawl result '.repeat(1_300))
    ;(body.messages as Array<Record<string, unknown>>)[0].content = [
      { type: 'text', text: 'Find this source.' },
      { type: 'image_url', image_url: { url: 'data:image/png;base64,PRIVATE_BYTES' } },
    ]
    const { fetcher } = toolSummaryFetch()
    await prepareGInferContextRequest(
      completionUrl, body, headers, fetcher,
      { threadId: 'media-question', configuredContextTokens: 2_000 }
    )
    const summaryRequests = fetcher.mock.calls
      .filter(([url]) => String(url) === completionUrl)
      .map(([, init]) => String(init?.body))
    expect(summaryRequests.length).toBeGreaterThan(0)
    expect(summaryRequests.every((request) => !request.includes('PRIVATE_BYTES'))).toBe(true)
  })
})

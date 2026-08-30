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
              auto_increase_ctx_len: {
                controller_props: { value: false },
              },
            },
          },
        ],
        [],
        state
      )
    ).toEqual({
      threadId: 'thread-a',
      configuredContextTokens: 32_768,
      nativeContextTokens: 131_072,
      autoIncrease: false,
      state,
    })
  })

  it('requests model growth before first-time compaction below native max', async () => {
    await expect(
      prepareGInferContextRequest(
        completionUrl,
        overflowingBody(),
        headers,
        scriptedFetch(),
        {
          threadId: 'thread-a',
          configuredContextTokens: 5_000,
          nativeContextTokens: 8_000,
          autoIncrease: true,
        }
      )
    ).rejects.toMatchObject<Partial<SmartContextError>>({
      code: 'context_growth_required',
    })
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
})

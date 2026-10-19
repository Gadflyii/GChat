import { ToolUIPart } from 'ai'
import type { AgentRunSummary } from '@/types/agent'
import type { SubAgentBrief, SubAgentResult } from '@/lib/sub-agents'

export type ToolPresentation =
  | {
      kind: 'generic'
      title: string
      subtitle?: string
      input?: unknown
      output?: unknown
      errorText?: string
    }
  | {
      kind: 'web_search_exa'
      title: string
      subtitle?: string
      query?: string
      results: Array<{
        title: string
        url?: string
        domain?: string
        author?: string
        published?: string
        highlights: string[]
      }>
      rawInput?: unknown
      rawOutput?: unknown
      errorText?: string
    }
  | {
      kind: 'web_fetch_exa'
      title: string
      subtitle?: string
      urls?: string[]
      pages: Array<{
        title: string
        url?: string
        domain?: string
        author?: string
        published?: string
        highlights: string[]
      }>
      rawInput?: unknown
      rawOutput?: unknown
      errorText?: string
    }

export type TraceBlock =
  | { kind: 'text'; key: string; text: string }
  | {
      kind: 'file'
      key: string
      url: string
      mediaType: string
      filename?: string
    }
  | {
      kind: 'audio'
      key: string
      url: string
      mediaType: string
      filename?: string
    }
  | {
      kind: 'reasoning'
      key: string
      streaming: boolean
      items: Array<{ key: string; text: string }>
    }
  | {
      kind: 'activity'
      key: string
      durationMs?: number
      tools: Array<{
        key: string
        toolName: string
        state: ToolUIPart['state']
        presentation: ToolPresentation
      }>
      agentSummary?: AgentRunSummary
    }
  | {
      kind: 'subagents'
      key: string
      /** The dispatch tool call; live worker state is keyed by it. */
      dispatchId: string
      state: ToolUIPart['state']
      briefs: SubAgentBrief[]
      results: SubAgentResult[]
      errorText?: string
    }

export type ParsedSearchItem = {
  title?: string
  url?: string
  published?: string
  author?: string
  highlights?: string[]
}

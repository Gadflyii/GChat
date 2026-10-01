import type { UIMessage } from '@ai-sdk/react'
import { lastAssistantMessageIsCompleteWithToolCalls } from 'ai'
import { useChatSessions } from '@/stores/chat-session-store'

export type ChatToolCall = {
  toolCallId: string
  toolName: string
  input: object
}

export type ChatToolOutput =
  | {
      tool: string
      toolCallId: string
      output: unknown
    }
  | {
      state: 'output-error'
      tool: string
      toolCallId: string
      errorText: string
    }

type ToolResult = {
  content?: unknown
  error?: unknown
}

type ExecuteChatToolCallsOptions = {
  toolCalls: readonly ChatToolCall[]
  signal: AbortSignal
  threadId: string
  ragToolNames: ReadonlySet<string>
  capabilityToolNames: ReadonlySet<string>
  callRagTool: (args: {
    toolName: string
    arguments: object
    threadId: string
    projectId?: string
    scope: 'project' | 'thread'
  }) => Promise<ToolResult>
  callCapability: (args: {
    toolName: string
    arguments: object
  }) => Promise<ToolResult>
  getProjectId: () => string | undefined
  processOutput: (content: unknown) => Promise<unknown>
  addToolOutput: (output: ChatToolOutput) => void | Promise<void>
  onError?: (error: unknown) => void
}

// Claim the completed response's calls before tool output can trigger the next
// response. A batch identity keeps an older completion from settling a newer turn.
export function executeClaimedChatToolBatch(
  options: Omit<ExecuteChatToolCallsOptions, 'toolCalls'>
): Promise<void> | undefined {
  const batch = useChatSessions.getState().claimToolBatch(options.threadId)
  if (!batch) return undefined

  return executeChatToolCalls({ ...options, toolCalls: batch.calls }).finally(
    () => useChatSessions.getState().endToolBatch(options.threadId, batch.id)
  )
}

export async function executeChatToolCalls({
  toolCalls,
  signal,
  threadId,
  ragToolNames,
  capabilityToolNames,
  callRagTool,
  callCapability,
  getProjectId,
  processOutput,
  addToolOutput,
  onError = (error) => console.error('Tool call error:', error),
}: ExecuteChatToolCallsOptions): Promise<void> {
  for (const toolCall of toolCalls) {
    if (signal.aborted) break

    let output: ChatToolOutput
    try {
      let result: ToolResult
      if (ragToolNames.has(toolCall.toolName)) {
        const projectId = getProjectId()
        result = await callRagTool({
          toolName: toolCall.toolName,
          arguments: toolCall.input,
          threadId,
          projectId,
          scope: projectId ? 'project' : 'thread',
        })
      } else if (capabilityToolNames.has(toolCall.toolName)) {
        result = await callCapability({
          toolName: toolCall.toolName,
          arguments: toolCall.input,
        })
      } else {
        result = {
          error: `Tool '${toolCall.toolName}' not found in any service`,
        }
      }
      if (signal.aborted) break

      if (result.error) {
        output = {
          state: 'output-error',
          tool: toolCall.toolName,
          toolCallId: toolCall.toolCallId,
          errorText: `Error: ${result.error}`,
        }
      } else {
        const content = await processOutput(result.content)
        if (signal.aborted) break
        output = {
          tool: toolCall.toolName,
          toolCallId: toolCall.toolCallId,
          output: content,
        }
      }
    } catch (error) {
      if (signal.aborted || (error as Error).name === 'AbortError') break
      onError(error)
      output = {
        state: 'output-error',
        tool: toolCall.toolName,
        toolCallId: toolCall.toolCallId,
        errorText: `Error: ${error instanceof Error ? error.message : String(error)}`,
      }
    }

    try {
      await addToolOutput(output)
    } catch (error) {
      if ((error as Error).name !== 'AbortError') onError(error)
      break
    }
  }
}

export function shouldSendToolFollowUp(
  messages: UIMessage[],
  controller: AbortController | null
): boolean {
  if (!controller || controller.signal.aborted) return false
  return lastAssistantMessageIsCompleteWithToolCalls({ messages })
}

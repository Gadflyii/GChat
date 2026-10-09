import type { UIMessage } from '@ai-sdk/react'
import { jsonSchema, type Tool } from 'ai'

import type { MCPTool } from '@/types/completion'

export function splitAnthropicSerialToolUse(
  messages: UIMessage[]
): UIMessage[] {
  return messages.flatMap((message) => {
    if (message.role !== 'assistant') return [message]

    const parts = Array.isArray(message.parts) ? message.parts : []
    if (parts.length === 0) return [message]

    const waves: (typeof parts)[] = []
    let currentWave: typeof parts = []
    let seenToolParts = false

    for (const part of parts) {
      if (part.type.startsWith('tool-')) {
        seenToolParts = true
        currentWave.push(part)
      } else if (seenToolParts) {
        waves.push(currentWave)
        currentWave = [part]
        seenToolParts = false
      } else {
        currentWave.push(part)
      }
    }
    if (currentWave.length > 0) waves.push(currentWave)

    if (waves.length <= 1) return [message]

    return waves.map((waveParts, index) => ({
      ...message,
      id: `${message.id}_w${index}`,
      parts: waveParts,
    }))
  })
}

export function buildToolsRecord(
  ragTools: readonly MCPTool[],
  mcpTools: readonly MCPTool[],
  disabledToolKeys: readonly string[]
): Record<string, Tool> {
  const disabled = new Set(disabledToolKeys)
  const toolsRecord: Record<string, Tool> = {}

  for (const tool of [...ragTools, ...mcpTools]) {
    const serverName = tool.server || 'unknown'
    if (disabled.has(`${serverName}::${tool.name}`)) continue

    toolsRecord[tool.name] = {
      description: tool.description,
      inputSchema: jsonSchema(tool.inputSchema),
    } as Tool
  }

  return Object.fromEntries(
    Object.entries(toolsRecord).sort(([a], [b]) => a.localeCompare(b))
  )
}

export function buildCapabilityDiscoveryTools(): Record<string, Tool> {
  return {
    gchat_capability_search: {
      description: 'Search enabled GChat native and connected MCP capabilities by name or purpose. Returns matching names and short descriptions.',
      inputSchema: jsonSchema({
        type: 'object', properties: { query: { type: 'string', minLength: 1 } },
        required: ['query'], additionalProperties: false,
      }),
    } as Tool,
    gchat_capability_read: {
      description: 'Read the exact argument schema for one enabled capability before calling it.',
      inputSchema: jsonSchema({
        type: 'object', properties: { name: { type: 'string', minLength: 1 } },
        required: ['name'], additionalProperties: false,
      }),
    } as Tool,
    gchat_capability_call: {
      description: 'Call one enabled GChat native or connected MCP capability by its exact name, with arguments matching its schema.',
      inputSchema: jsonSchema({
        type: 'object',
        properties: { name: { type: 'string' }, arguments: { type: 'object' } },
        required: ['name', 'arguments'],
        additionalProperties: false,
      }),
    } as Tool,
  }
}

export const CAPABILITY_DISCOVERY_TOOL_NAMES = new Set([
  'gchat_capability_search',
  'gchat_capability_read',
  'gchat_capability_call',
])

export function capabilitySearchResults(
  tools: readonly MCPTool[],
  disabledToolKeys: readonly string[],
  query: string
): Array<{ name: string; description: string }> {
  const needle = query.trim().toLocaleLowerCase()
  if (!needle) return []
  const disabled = new Set(disabledToolKeys)
  return tools
    .filter((tool) => !disabled.has(`${tool.server || 'unknown'}::${tool.name}`))
    .filter((tool) => `${tool.name}\n${tool.description}`.toLocaleLowerCase().includes(needle))
    .map(({ name, description }) => ({ name, description }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

export function capabilitySchema(
  tools: readonly MCPTool[],
  disabledToolKeys: readonly string[],
  name: string
): MCPTool | undefined {
  const disabled = new Set(disabledToolKeys)
  return tools.find((tool) => tool.name === name && !disabled.has(`${tool.server || 'unknown'}::${tool.name}`))
}

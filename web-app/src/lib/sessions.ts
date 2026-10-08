export type CodeSessionReference = {
  session_id: string
  directory: string
  title?: string
  executable?: string
}

export function getCodeSessionReference(thread?: Thread): CodeSessionReference | undefined {
  const code = thread?.metadata?.code as Partial<CodeSessionReference> | undefined
  if (thread?.metadata?.runtime !== 'code' || !code?.session_id || !code.directory) return undefined
  return code as CodeSessionReference
}

export function getSessionKind(thread: Thread, legacyAgentThreads: Record<string, boolean> = {}): 'chat' | 'code' | 'agent' {
  if (getCodeSessionReference(thread)) return 'code'
  return thread.metadata?.has_agent_activity || thread.metadata?.is_agent_thread || legacyAgentThreads[thread.id] ? 'agent' : 'chat'
}

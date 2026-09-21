export function canSelectChatAgentMode(
  initialMessage: boolean | undefined,
  projectId: string | undefined
): boolean {
  return Boolean(initialMessage && !projectId)
}

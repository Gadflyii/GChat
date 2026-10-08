import { IconCode, IconMessage, IconRobot } from '@tabler/icons-react'
import { getSessionKind } from '@/lib/sessions'
import { useConversationPolicy } from '@/hooks/useConversationPolicy'

export function SessionKindIcon({ thread }: { thread: Thread }) {
  const legacy = useConversationPolicy(state => state.legacyAgentThreads)
  const kind = getSessionKind(thread, legacy)
  const Icon = kind === 'code' ? IconCode : kind === 'agent' ? IconRobot : IconMessage
  return <Icon aria-label={kind === 'code' ? 'Code session' : kind === 'agent' ? 'Conversation with agent work' : 'Chat session'}
    title={kind === 'code' ? 'Code' : kind === 'agent' ? 'Agent work' : 'Chat'}
    className="size-3.5 shrink-0 text-muted-foreground" />
}

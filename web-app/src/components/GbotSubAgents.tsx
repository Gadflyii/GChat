import GbotHumanHelp from '@/components/GbotHumanHelp'
import { SubAgentCardView } from '@/containers/SubAgentCards'
import { gbotSubAgentPhase, gbotSubAgentsOf } from '@/lib/gbot-sub-agents'
import { presentGenericTool } from '@/lib/tools/presenters/generic'
import { messageText, type Approval, type Task } from '@/services/gbot'

export function GbotSubAgents({
  parent,
  tasks,
  approvals,
  busy,
  onStop,
  onAnswer,
}: {
  parent: Task
  tasks: readonly Task[]
  approvals: readonly Approval[]
  busy: boolean
  onStop: (id: string) => void
  onAnswer: (id: string, requestId: string, response: string | null) => Promise<void>
}) {
  const children = gbotSubAgentsOf(tasks, parent)
  if (!children.length) return null
  return (
    <section
      aria-label={children.length === 1 ? 'Sub-agent' : `${children.length} sub-agents`}
      className="space-y-2"
    >
      <p className="text-xs font-medium text-muted-foreground">
        {children.length === 1 ? '1 sub-agent' : `${children.length} sub-agents`}
      </p>
      {children.map((child) => {
        const phase = gbotSubAgentPhase(child, approvals.some((a) => a.task_id === child.id))
        const calls = [...(child.calls ?? []), ...(child.connector_calls ?? [])]
        const reply = [...child.messages].reverse().find((m) => m.role === 'assistant')
        return (
          <SubAgentCardView
            key={child.id}
            title={child.sub_agent!.title}
            task={messageText(child.messages.find((m) => m.role === 'user')?.content)}
            phase={phase}
            stepCount={calls.filter((call) => call.reply != null).length}
            steps={calls.map((call) =>
              presentGenericTool({
                toolName: call.name,
                state: call.reply == null ? 'input-available' : 'output-available',
              }).title
            )}
            result={phase === 'done' && reply ? messageText(reply.content) : undefined}
            error={
              phase === 'failed'
                ? 'This sub-agent stopped because a tool result is uncertain. Check the bot computer before continuing.'
                : phase === 'not_finished'
                  ? child.history?.at(-1)?.reason
                  : undefined
            }
            onStop={() => onStop(child.id)}
          >
            {child.help_requests
              ?.filter((request) => request.status === 'pending')
              .map((request) => (
                <div key={request.id} className="mt-2">
                  <GbotHumanHelp
                    request={request}
                    taskState={child.state}
                    busy={busy}
                    reply={(response) => onAnswer(child.id, request.id, response)}
                  />
                </div>
              ))}
          </SubAgentCardView>
        )
      })}
    </section>
  )
}

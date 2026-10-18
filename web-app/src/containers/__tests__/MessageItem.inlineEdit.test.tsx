import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { UIMessage } from 'ai'
import type { AgentRunRecord, AgentRunSummary } from '@/types/agent'
import { MessageItem } from '../MessageItem'
import { projectChatRunActivity } from '@/lib/agent-run-message'
import { convertThreadMessageToUIMessage } from '@/lib/messages'
import { seedServiceHub } from '@/test/service-hub'

vi.mock('@/i18n/react-i18next-compat', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

const modelState = vi.hoisted(() => ({
  selectedModel: { id: 'test-model' } as { id: string } | undefined,
}))
vi.mock('@/hooks/useModelProvider', () => ({
  useModelProvider: (selector: (s: unknown) => unknown) =>
    selector({ selectedModel: modelState.selectedModel }),
}))

vi.mock('@/hooks/useGeneralSetting', () => ({
  useGeneralSetting: (selector: (s: unknown) => unknown) =>
    selector({ disableReasoning: false }),
}))

vi.mock('react-textarea-autosize', async () => {
  const React = await import('react')
  type AutosizeProps = React.TextareaHTMLAttributes<HTMLTextAreaElement> & {
    minRows?: number
    maxRows?: number
  }
  return {
    default: React.forwardRef<HTMLTextAreaElement, AutosizeProps>(
      ({ minRows, maxRows, ...props }, ref) => {
        void minRows
        void maxRows
        return <textarea {...props} ref={ref} />
      }
    ),
  }
})

const userMessage: UIMessage = {
  id: 'm1',
  role: 'user',
  parts: [{ type: 'text', text: 'original text' }],
}

const onEdit = vi.fn()

const editButton = () =>
  screen.getByRole('button', { name: 'common:editMessage' })

const renderMessage = (message: UIMessage = userMessage) =>
  render(
    <MessageItem
      message={message}
      isFirstMessage
      isLastMessage
      status="ready"
      onEdit={onEdit}
    />
  )

beforeEach(() => {
  modelState.selectedModel = { id: 'test-model' }
  onEdit.mockClear()
  seedServiceHub()
})

describe('MessageItem inline editing', () => {
  it('explains why Edit is disabled when no model is selected', () => {
    modelState.selectedModel = undefined
    renderMessage()
    const edit = editButton()
    expect(edit).toBeDisabled()
    expect(edit).toHaveAttribute('title', 'common:editMessageNeedsModel')
  })

  it('replaces the message text in place instead of opening a dialog', () => {
    renderMessage()
    expect(screen.getByText('original text')).toBeInTheDocument()

    fireEvent.click(editButton())

    // The static transcript text is gone, replaced by an editable field — and
    // no modal shell was mounted over the thread.
    expect(
      screen.queryByText('original text', { selector: 'div' })
    ).not.toBeInTheDocument()
    expect(screen.getByTestId('inline-message-editor')).toHaveValue(
      'original text'
    )
    expect(document.querySelector('[role="dialog"]')).toBeNull()
  })

  it('hides the message action row while editing', () => {
    renderMessage()
    fireEvent.click(editButton())
    expect(
      screen.queryByRole('button', { name: 'common:editMessage' })
    ).not.toBeInTheDocument()
  })

  it('reports the edited text through onEdit and closes the editor', () => {
    renderMessage()
    fireEvent.click(editButton())

    const textarea = screen.getByTestId('inline-message-editor')
    fireEvent.change(textarea, { target: { value: 'rewritten text' } })
    fireEvent.keyDown(textarea, { key: 'Enter' })

    expect(onEdit).toHaveBeenCalledWith('m1', 'rewritten text')
    expect(screen.queryByTestId('inline-message-editor')).not.toBeInTheDocument()
  })

  it('restores the original text on cancel without calling onEdit', () => {
    renderMessage()
    fireEvent.click(editButton())

    const textarea = screen.getByTestId('inline-message-editor')
    fireEvent.change(textarea, { target: { value: 'discarded' } })
    fireEvent.keyDown(textarea, { key: 'Escape' })

    expect(onEdit).not.toHaveBeenCalled()
    expect(screen.getByText('original text')).toBeInTheDocument()
  })

  it('edits an assistant message in place too', () => {
    renderMessage({
      id: 'a1',
      role: 'assistant',
      parts: [{ type: 'text', text: 'assistant reply' }],
    })

    fireEvent.click(editButton())
    const textarea = screen.getByTestId('inline-message-editor')
    fireEvent.change(textarea, { target: { value: 'corrected reply' } })
    fireEvent.keyDown(textarea, { key: 'Enter' })

    expect(onEdit).toHaveBeenCalledWith('a1', 'corrected reply')
  })
})


describe('MessageItem agent outcome', () => {
  it('retains completed synthesis and explains an incomplete loop fallback after reload', () => {
    const summary: AgentRunSummary = {
      run_id: 'run', status: 'incomplete', finish_reason: 'loop_detected',
      stages: [], tools: [], loops: [],
    }
    const message: UIMessage = JSON.parse(JSON.stringify({
      id: 'agent-message', role: 'assistant', parts: [{ type: 'text', text: 'completed synthesis' }],
      metadata: { agent_run: summary },
    }))
    renderMessage(message)
    expect(screen.getByText('completed synthesis')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /activity.workedFor/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Run outcome' }))
    expect(screen.getByText(/A stage stopped after repeated tool calls made no progress/)).toBeInTheDocument()
    expect(screen.getByText('completed synthesis')).toBeInTheDocument()
  })
})

describe('MessageItem restored worker activity', () => {
  it('shows interruption for a saved uncollected spawn with no completed stage or finish reason', () => {
    const message = convertThreadMessageToUIMessage(JSON.parse(JSON.stringify({
      id: 'spawn-message', role: 'assistant',
      content: [
        {
          type: 'tool_call', tool_name: 'agent_spawn', tool_call_id: 'spawn-call',
          state: 'output-available', input: { task: 'Read the fixture' },
          output: {
            runId: 'worker', sessionId: 'worker-session', originSessionId: 'chat',
            parentRunId: 'parent-turn', status: 'running',
          },
        },
        { type: 'text', text: { value: 'Worker started: worker', annotations: [] } },
      ],
      metadata: { activityDurationMs: 384, finishReason: 'stop' },
    })))
    const record: AgentRunRecord = {
      schemaVersion: 3, id: 'record', runId: 'worker', sessionId: 'worker-session',
      originSessionId: 'chat', parentRunId: 'parent-turn', definitionId: 'general',
      definitionName: 'General Agent', kind: 'standard', userMessage: 'Read the fixture',
      status: 'incomplete', finishReason: '', startedAtMs: 1_000, finishedAtMs: 0,
      totalSteps: 0, finalReply: 'Completion was not recorded.',
      defaultModelInstanceId: 'selected-model', stages: [],
    }
    const projection = projectChatRunActivity([message], {}, [record])
    render(<MessageItem message={message} agentRuns={projection.byMessageId.get(message.id)} onCancelAgentRun={vi.fn()} isFirstMessage isLastMessage status="ready" />)

    expect(screen.getByText('Worker started: worker')).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Run interrupted' })).toHaveLength(1)
    expect(screen.queryByRole('button', { name: 'activity.workedFor' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'activity.working' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Stop worker' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Run interrupted' }))
    fireEvent.click(screen.getByRole('button', { name: 'Run outcome' }))
    expect(screen.getByText(/Completion was not recorded.*Pending actions were not restored/)).toBeInTheDocument()
  })

  it('renders two saved workers and keeps live cancellation attached to the correct run', () => {
    const runs: AgentRunSummary[] = ['Document worker', 'Math worker'].map((name, index) => ({
      run_id: `worker-${index}`, status: index ? 'finished' : 'running',
      definition: { id: `agent-${index}`, name, kind: 'standard', model_instance_id: 'qwen' },
      stages: [{ id: name, name, role: 'worker', status: index ? 'finished' : 'running', model_instance_id: 'qwen' }],
      tools: [], loops: [],
    }))
    const message: UIMessage = { id: 'two-workers', role: 'assistant', parts: [{ type: 'text', text: 'Both answers saved.' }], metadata: { agent_runs: runs } }
    const onCancel = vi.fn()
    const projection = projectChatRunActivity([message], {})
    const view = render(<MessageItem message={message} agentRuns={projection.byMessageId.get(message.id)} onCancelAgentRun={onCancel} isFirstMessage isLastMessage={false} status="ready" />)
    expect(screen.getByText('Both answers saved.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'activity.working' }))
    fireEvent.click(screen.getByRole('button', { name: 'activity.workedFor' }))
    expect(screen.getByRole('button', { name: 'Document worker · 1 stage' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Math worker · 1 stage' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Stop worker' }))
    expect(onCancel).toHaveBeenCalledWith('worker-0')
    runs[0] = { ...runs[0], status: 'finished' }
    view.rerender(<MessageItem message={message} agentRuns={projectChatRunActivity([message], {}).byMessageId.get(message.id)} onCancelAgentRun={onCancel} isFirstMessage isLastMessage={false} status="ready" />)
    expect(screen.queryByRole('button', { name: 'Stop worker' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'activity.working' })).not.toBeInTheDocument()
  })
})

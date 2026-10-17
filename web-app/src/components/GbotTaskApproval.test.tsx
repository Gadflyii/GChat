import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { toast } from 'sonner'
import GbotTaskApproval from './GbotTaskApproval'

vi.mock('sonner', () => ({ toast: { error: vi.fn() } }))

const approval = {
  id: 'permission-one',
  task_id: 'task-one',
  request: { operation: { kind: 'desktop_input' } },
}

it.each([
  {
    name: 'program execution',
    operation: {
      kind: 'exec',
      program: '/usr/bin/python3',
      args: ['report.py', '--output', 'report.txt'],
      cwd: '/home/bot/work',
      env: { REPORT_MODE: 'summary' },
    },
    summary: 'Run a program on the bot computer',
    target: '/usr/bin/python3',
  },
  {
    name: 'file reading',
    operation: {
      kind: 'read',
      path: '/home/bot/work/notes.txt',
      offset: 0,
      length: 4096,
    },
    summary: 'Read a file on the bot computer',
    target: '/home/bot/work/notes.txt',
  },
  {
    name: 'file writing',
    operation: {
      kind: 'write',
      path: '/home/bot/work/report.txt',
      offset: 0,
      data: [111, 107],
      truncate: true,
    },
    summary: 'Write to a file on the bot computer',
    target: '/home/bot/work/report.txt',
  },
  {
    name: 'desktop interaction',
    operation: {
      kind: 'desktop',
      tool: 'keyboard.type',
      arguments: { text: 'Draft report' },
    },
    summary: 'Use the bot desktop',
    target: 'keyboard.type',
  },
  {
    name: 'connected-account changes',
    operation: {
      name: 'microsoft.calendar.create',
      account_id: 'work-account',
      arguments: { subject: 'Project review', attendees: ['alex@example.test'] },
      write: true,
    },
    summary: 'Change data in a connected account',
    target: 'microsoft.calendar.create · Account: work-account',
  },
])(
  'explains $name before expandable complete details',
  ({ operation, summary, target }) => {
    const reply = vi.fn()
    const { container } = render(
      <GbotTaskApproval
        approval={{ ...approval, request: { operation } }}
        busy={false}
        reply={reply}
      />
    )

    expect(screen.getByText(summary)).toBeVisible()
    expect(screen.getByText(target, { exact: true })).toBeVisible()
    expect(
      screen.getByText(
        /Allow permits this action once\. Deny prevents this action\./
      )
    ).toBeVisible()
    const details = screen.getByText('Action details').closest('details')!
    expect(details).not.toHaveAttribute('open')
    const raw = container.querySelector('pre')!
    expect(raw.textContent).toBe(JSON.stringify(operation, null, 2))
    expect(raw).not.toBeVisible()
    fireEvent.click(screen.getByText('Action details'))
    expect(details).toHaveAttribute('open')
    expect(raw).toBeVisible()
    expect(screen.getByRole('button', { name: 'Allow', exact: true })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Deny', exact: true })).toBeEnabled()
    expect(reply).not.toHaveBeenCalled()
  }
)

it.each([
  {
    name: 'an unknown operation',
    operation: { kind: 'future_action', payload: { keep: ['all', 'details'] } },
    summary: 'Review this action before allowing it',
  },
  {
    name: 'a null operation',
    operation: null,
    summary: 'Review this action before allowing it',
  },
  {
    name: 'a malformed program target',
    operation: { kind: 'exec', program: { unexpected: true } },
    summary: 'Run a program on the bot computer',
  },
  {
    name: 'a malformed connected account',
    operation: { name: 'microsoft.calendar.create', account_id: 42, write: true },
    summary: 'Review this action before allowing it',
  },
])('retains a safe explicit decision for $name', ({ operation, summary }) => {
  const reply = vi.fn()
  const { container } = render(
    <GbotTaskApproval
      approval={{ ...approval, request: { operation } }}
      busy={false}
      reply={reply}
    />
  )
  expect(screen.getByText(summary)).toBeVisible()
  expect(container.querySelector('pre')?.textContent).toBe(
    JSON.stringify(operation, null, 2)
  )
  fireEvent.click(screen.getByText('Action details'))
  expect(container.querySelector('pre')).toBeVisible()
  expect(screen.getByRole('button', { name: 'Allow', exact: true })).toBeEnabled()
  expect(screen.getByRole('button', { name: 'Deny', exact: true })).toBeEnabled()
  expect(reply).not.toHaveBeenCalled()
})

it.each([
  { button: 'Allow', allow: true, pending: 'Allowing' },
  { button: 'Deny', allow: false, pending: 'Denying' },
])(
  'sends $button once and blocks an opposing pending reply',
  async ({ button, allow, pending }) => {
    let finish!: () => void
    const reply = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve
        })
    )
    render(<GbotTaskApproval approval={approval} busy={false} reply={reply} />)
    const allowButton = screen.getByRole('button', {
      name: 'Allow',
      exact: true,
    })
    const denyButton = screen.getByRole('button', { name: 'Deny', exact: true })
    const chosen = button === 'Allow' ? allowButton : denyButton
    const opposite = button === 'Allow' ? denyButton : allowButton
    act(() => {
      fireEvent.click(chosen)
      fireEvent.click(opposite)
      fireEvent.click(chosen)
    })
    expect(reply).toHaveBeenCalledExactlyOnceWith(allow)
    expect(screen.getByRole('article')).toHaveAttribute('aria-busy', 'true')
    expect(screen.getByRole('status')).toHaveTextContent(
      `${pending} this action…`
    )
    expect(screen.getByRole('button', { name: `${pending}…` })).toBeDisabled()
    expect(opposite).toBeDisabled()
    fireEvent.click(screen.getByText('Action details'))
    expect(screen.getByText(/desktop_input/)).toBeVisible()
    await act(async () => finish())
    await waitFor(() => expect(chosen).toBeEnabled())
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(screen.getByRole('article')).toHaveAttribute('aria-busy', 'false')
  }
)

it('retains a failed request for an explicit retry', async () => {
  const reply = vi
    .fn()
    .mockRejectedValueOnce(new Error('Permission reply failed'))
    .mockResolvedValueOnce(undefined)
  render(<GbotTaskApproval approval={approval} busy={false} reply={reply} />)
  const allow = screen.getByRole('button', { name: 'Allow', exact: true })
  fireEvent.click(allow)
  await waitFor(() => expect(allow).toBeEnabled())
  expect(toast.error).toHaveBeenCalledWith('Error: Permission reply failed')
  fireEvent.click(screen.getByText('Action details'))
  expect(screen.getByText(/desktop_input/)).toBeVisible()
  fireEvent.click(allow)
  await waitFor(() => expect(reply).toHaveBeenCalledTimes(2))
  expect(reply.mock.calls).toEqual([[true], [true]])
})

it('respects another pending action without submitting a permission reply', () => {
  const reply = vi.fn()
  render(<GbotTaskApproval approval={approval} busy reply={reply} />)
  const allow = screen.getByRole('button', { name: 'Allow', exact: true })
  const deny = screen.getByRole('button', { name: 'Deny', exact: true })
  fireEvent.click(allow)
  fireEvent.click(deny)
  expect(allow).toBeDisabled()
  expect(deny).toBeDisabled()
  expect(reply).not.toHaveBeenCalled()
  expect(screen.queryByRole('status')).not.toBeInTheDocument()
})

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { ComponentType } from 'react'

const mocks = vi.hoisted(() => ({ call: vi.fn(), listen: vi.fn() }))
vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: unknown) => ({ options }),
}))
vi.mock('@tauri-apps/api/event', () => ({ listen: mocks.listen }))
vi.mock('@/containers/HeaderPage', () => ({
  default: ({ children }: { children: React.ReactNode }) => (
    <header>{children}</header>
  ),
}))
vi.mock('@/services/gbot', async (original) => ({
  ...(await original<object>()),
  gbot: mocks.call,
}))

import { Route } from './index'
const Page = Route.options.component as ComponentType
afterEach(() => {
  cleanup()
  sessionStorage.clear()
  vi.clearAllMocks()
})

it('isolates bot assignments and approvals, and holds new tasks during takeover', async () => {
  const identity = { workspace_id: 'one', session_id: 'session' }
  let control = 'bot'
  let assignments: unknown[] = []
  mocks.listen.mockResolvedValue(() => {})
  mocks.call.mockImplementation(
    async (path: string, body: Record<string, unknown>) => {
      if (path === 'state')
        return {
          workspaces: [
            { id: 'one', name: 'Writer' },
            { id: 'two', name: 'Researcher' },
          ],
          live_sessions: [{ identity }],
          assignments,
          controls: [
            {
              identity,
              owner:
                control === 'bot'
                  ? null
                  : sessionStorage.getItem('gbot-control-owner'),
              state: control,
            },
          ],
        }
      if (path === 'tasks')
        return [
          {
            id: 'task',
            identity,
            state: 'paused',
            messages: [{ role: 'assistant', content: 'Saved result' }],
          },
        ]
      if (path === 'tasks/approvals')
        return [
          {
            id: 'approval',
            task_id: 'task',
            request: { operation: { kind: 'desktop_input' } },
          },
          {
            id: 'foreign',
            task_id: 'other-bot-task',
            request: { operation: { kind: 'file_remove' } },
          },
        ]
      if (path === 'assignments/save') {
        const { api_key: _secret, ...config } = body
        assignments = [{ ...config, credential_ref: 'vault-key' }]
      }
      if (path === 'control/take-over') control = 'human'
      return {}
    }
  )
  render(<Page />)
  await screen.findByText('Saved result')
  expect(screen.queryByText(/file_remove/)).not.toBeInTheDocument()
  fireEvent.change(screen.getByLabelText('GInfer API URL'), {
    target: { value: 'http://host/v1' },
  })
  fireEvent.change(screen.getByLabelText('Model ID'), {
    target: { value: 'qwen' },
  })
  fireEvent.change(screen.getByLabelText('Model context tokens'), {
    target: { value: '262144' },
  })
  fireEvent.change(screen.getByLabelText('API key'), {
    target: { value: 'bot-secret' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Researcher' }))
  expect(screen.getByLabelText('API key')).toHaveValue('')
  expect(screen.getByLabelText('Model ID')).toHaveValue('')
  expect(screen.queryByText('Saved result')).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Writer' }))
  expect(screen.getByLabelText('API key')).toHaveValue('bot-secret')
  fireEvent.click(screen.getByRole('button', { name: 'Save brain settings' }))
  await waitFor(() => expect(screen.getByLabelText('API key')).toHaveValue(''))
  expect(screen.getByLabelText('API key')).toHaveAttribute(
    'placeholder',
    'Saved in vault'
  )
  expect(screen.getByLabelText('Model ID')).toHaveValue('qwen')
  cleanup()
  render(<Page />)
  await screen.findByText('Saved result')
  expect(screen.getByLabelText('Model ID')).toHaveValue('qwen')
  expect(screen.getByLabelText('API key')).toHaveValue('')
  fireEvent.click(screen.getByRole('button', { name: 'Allow', exact: true }))
  await waitFor(() =>
    expect(mocks.call).toHaveBeenCalledWith('tasks/approval', {
      id: 'approval',
      allow: true,
    })
  )
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Take over' })).toBeEnabled()
  )
  fireEvent.click(screen.getByRole('button', { name: 'Take over' }))
  await screen.findByText('Bot paused · you have control')
  fireEvent.change(screen.getByLabelText('Bot task'), {
    target: { value: 'Next task' },
  })
  expect(
    screen.getByRole('button', { name: 'Run', exact: true })
  ).toBeDisabled()
  expect(
    screen.getByRole('button', { name: 'Resume', exact: true })
  ).toBeDisabled()
  expect(sessionStorage.getItem('gbot-control-owner')).toBeTruthy()
  expect(JSON.stringify(sessionStorage)).not.toContain('bot-secret')
})

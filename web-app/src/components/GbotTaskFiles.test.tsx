import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Task } from '@/services/gbot'

const api = vi.hoisted(() => ({ gbotTaskFile: vi.fn() }))
vi.mock('@/services/gbot', async () => ({
  ...(await vi.importActual<typeof import('@/services/gbot')>('@/services/gbot')),
  ...api,
}))

import { GbotTaskFiles } from './GbotTaskFiles'

const task = (outputs?: Task['outputs']): Task => ({
  id: 'task-1',
  identity: { workspace_id: 'w', session_id: 's' },
  state: 'completed',
  messages: [],
  help_requests: [],
  outputs,
})

beforeEach(() => api.gbotTaskFile.mockReset())

describe('Gbot task files', () => {
  it('shows nothing when the bot handed back no files', () => {
    const { container } = render(<GbotTaskFiles task={task()} />)
    expect(container).toBeEmptyDOMElement()
    const none = render(<GbotTaskFiles task={task([])} />)
    expect(none.container).toBeEmptyDOMElement()
  })

  it('lists each file with its size and saves or opens it on request', async () => {
    api.gbotTaskFile.mockResolvedValue('/home/me/report.csv')
    render(
      <GbotTaskFiles
        task={task([
          { id: 'f1', name: 'report.csv', bytes: 2048 },
          { id: 'f2', name: 'slides.pptx', bytes: 3 * 1024 * 1024 },
        ])}
      />
    )
    expect(screen.getByText('report.csv')).toBeVisible()
    expect(screen.getByText(/2 KB/)).toBeVisible()
    expect(screen.getByText(/3\.0 MB/)).toBeVisible()
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Save report.csv as' }))
    expect(api.gbotTaskFile).toHaveBeenCalledWith('task-1', 'f1', false)
    expect(await screen.findByRole('status')).toHaveTextContent('Saved report.csv.')
    await user.click(screen.getByRole('button', { name: 'Open slides.pptx' }))
    expect(api.gbotTaskFile).toHaveBeenLastCalledWith('task-1', 'f2', true)
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent('Opened slides.pptx.')
    )
  })

  it('stays quiet when the person cancels Save and explains a failure', async () => {
    const user = userEvent.setup()
    api.gbotTaskFile.mockResolvedValueOnce(null)
    render(<GbotTaskFiles task={task([{ id: 'f1', name: 'a.txt', bytes: 5 }])} />)
    await user.click(screen.getByRole('button', { name: 'Save a.txt as' }))
    await waitFor(() => expect(api.gbotTaskFile).toHaveBeenCalled())
    expect(screen.queryByRole('status')).toBeNull()
    api.gbotTaskFile.mockRejectedValueOnce(
      'No app is set up to open this kind of file. Use Save as instead.'
    )
    await user.click(screen.getByRole('button', { name: 'Open a.txt' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Use Save as instead')
  })
})

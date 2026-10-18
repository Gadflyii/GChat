import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import userEvent from '@testing-library/user-event'
import LanTools from './LanTools'
import { gbot } from '@/services/gbot'

vi.mock('@/services/gbot', () => ({ gbot: vi.fn() }))
afterEach(() => {
  cleanup()
  vi.resetAllMocks()
})

it('requires consent, stages a command and checks installation before proceeding', async () => {
  const ready = vi.fn()
  const busy = vi.fn()
  const api = vi
    .mocked(gbot)
    .mockResolvedValueOnce({
      installed: false,
      command: 'sudo -- sh "install.sh"',
      issue: null,
    })
    .mockResolvedValueOnce({ installed: true, command: null, issue: null })
  render(<LanTools workspaceId="bot" ready={ready} busy={busy} />)
  expect(screen.getByRole('button', { name: 'Prepare tools' })).toBeDisabled()
  expect(api).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('checkbox'))
  fireEvent.click(screen.getByRole('button', { name: 'Prepare tools' }))
  await screen.findByDisplayValue('sudo -- sh "install.sh"')
  expect(api).toHaveBeenCalledWith('workspaces/ssh/prepare', {
    workspace_id: 'bot',
    consent: true,
  })
  expect(ready).toHaveBeenLastCalledWith(false)
  expect(screen.queryByRole('status')).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Check tools' }))
  await screen.findByText(
    'Tools installed. Continue to connect and check the bot desktop.'
  )
  expect(
    screen.queryByRole('textbox', { name: 'Bot tools administrator command' })
  ).not.toBeInTheDocument()
  expect(ready).toHaveBeenLastCalledWith(true)
  expect(busy).toHaveBeenLastCalledWith(false)
})

it('hides the old administrator command while checking and replaces it with current instructions', async () => {
  let completeCheck!: (value: {
    installed: boolean
    command: string | null
    issue: null
  }) => void
  vi.mocked(gbot)
    .mockResolvedValueOnce({
      installed: false,
      command: 'sudo -- sh "old-install.sh"',
      issue: null,
    })
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          completeCheck = resolve
        })
    )
  render(<LanTools workspaceId="bot" ready={vi.fn()} busy={vi.fn()} />)
  fireEvent.click(screen.getByRole('checkbox'))
  fireEvent.click(screen.getByRole('button', { name: 'Prepare tools' }))
  await screen.findByDisplayValue('sudo -- sh "old-install.sh"')

  fireEvent.click(screen.getByRole('button', { name: 'Check tools' }))
  expect(
    screen.queryByRole('textbox', { name: 'Bot tools administrator command' })
  ).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Checking tools…' })).toBeDisabled()
  expect(screen.getByRole('button', { name: 'Prepare tools' })).toBeDisabled()
  expect(screen.getByRole('status')).toHaveTextContent(
    'Checking tools on the bot computer…'
  )

  completeCheck({
    installed: false,
    command: 'sudo -- sh "current-install.sh"',
    issue: null,
  })
  await screen.findByDisplayValue('sudo -- sh "current-install.sh"')
  expect(
    screen.queryByDisplayValue('sudo -- sh "old-install.sh"')
  ).not.toBeInTheDocument()
  expect(screen.queryByRole('status')).not.toBeInTheDocument()
})

it('announces preparation, blocks repeat requests and restores controls after failure', async () => {
  let failPreparation!: (cause: Error) => void
  const ready = vi.fn()
  const busy = vi.fn()
  const api = vi.mocked(gbot).mockImplementationOnce(
    () =>
      new Promise((_resolve, reject) => {
        failPreparation = reject
      })
  )
  render(<LanTools workspaceId="bot" ready={ready} busy={busy} />)
  fireEvent.click(screen.getByRole('checkbox'))
  const prepare = screen.getByRole('button', { name: 'Prepare tools' })
  fireEvent.click(prepare)
  fireEvent.click(prepare)
  expect(api).toHaveBeenCalledTimes(1)
  expect(api).toHaveBeenCalledWith('workspaces/ssh/prepare', {
    workspace_id: 'bot',
    consent: true,
  })
  expect(
    screen.getByRole('button', { name: 'Preparing tools…' })
  ).toBeDisabled()
  expect(screen.getByRole('button', { name: 'Check tools' })).toBeDisabled()
  expect(screen.getByRole('checkbox')).toBeDisabled()
  expect(screen.getByRole('status')).toHaveTextContent(
    'Preparing tools on the bot computer…'
  )
  expect(busy).toHaveBeenLastCalledWith(true)
  expect(ready).toHaveBeenLastCalledWith(false)

  failPreparation(new Error('SSH unavailable'))
  await screen.findByText(/GChat could not finish preparing the tools/)
  const details = screen.getByText('SSH unavailable').closest('details')
  expect(details).not.toHaveAttribute('open')
  expect(screen.queryByRole('status')).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Prepare tools' })).toBeEnabled()
  expect(screen.getByRole('button', { name: 'Check tools' })).toBeEnabled()
  expect(screen.getByRole('checkbox')).toBeEnabled()
  expect(busy).toHaveBeenLastCalledWith(false)
})

it.each(['archive', 'installer'])(
  'explains a failed %s upload and retries preparation only when requested',
  async (upload) => {
    const ready = vi.fn()
    const busy = vi.fn()
    const diagnostic = `Guest ${upload} upload failed: checksum mismatch`
    const api = vi
      .mocked(gbot)
      .mockResolvedValueOnce({
        installed: false,
        command: null,
        issue: diagnostic,
      })
      .mockRejectedValueOnce(new Error('SSH unavailable'))
      .mockResolvedValueOnce({ installed: true, command: null, issue: null })
    render(<LanTools workspaceId="bot" ready={ready} busy={busy} />)
    fireEvent.click(screen.getByRole('checkbox'))
    fireEvent.click(screen.getByRole('button', { name: 'Prepare tools' }))
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(
      'GChat could not finish preparing the tools.'
    )
    expect(alert).toHaveTextContent(
      'Check the computer’s connection and available disk space'
    )
    expect(alert).toHaveTextContent('choose Prepare tools to try again')
    expect(alert).toHaveTextContent(
      'If you already ran the installation command, choose Check tools first.'
    )
    const details = screen.getByText(diagnostic).closest('details')
    expect(details).not.toHaveAttribute('open')
    fireEvent.click(screen.getByText('Details'))
    expect(details).toHaveAttribute('open')
    expect(ready).toHaveBeenLastCalledWith(false)
    expect(busy).toHaveBeenLastCalledWith(false)
    expect(screen.getByRole('button', { name: 'Prepare tools' })).toBeEnabled()
    expect(api).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: 'Prepare tools' }))
    await screen.findByText('SSH unavailable')
    expect(screen.queryByText(diagnostic)).not.toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent(
      'GChat could not finish preparing the tools.'
    )
    expect(
      screen.getByText('SSH unavailable').closest('details')
    ).not.toHaveAttribute('open')
    expect(ready).toHaveBeenLastCalledWith(false)
    expect(api).toHaveBeenNthCalledWith(2, 'workspaces/ssh/prepare', {
      workspace_id: 'bot',
      consent: true,
    })
    fireEvent.click(screen.getByRole('button', { name: 'Check tools' }))
    await waitFor(() => expect(ready).toHaveBeenLastCalledWith(true))
    expect(api).toHaveBeenCalledTimes(3)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  }
)

it.each([new Error('SSH unavailable'), 'SSH transport closed'])(
  'explains a failed tool check and clears it only on an explicit retry (%s)',
  async (cause) => {
    const ready = vi.fn()
    const busy = vi.fn()
    const api = vi
      .mocked(gbot)
      .mockRejectedValueOnce(cause)
      .mockResolvedValueOnce({ installed: true, command: null, issue: null })
    render(<LanTools workspaceId="bot" ready={ready} busy={busy} />)
    fireEvent.click(screen.getByRole('button', { name: 'Check tools' }))
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('GChat could not check the tools.')
    expect(alert).toHaveTextContent(
      'Check the computer’s connection, then choose Check tools to try again.'
    )
    expect(
      screen
        .getByText(String(cause instanceof Error ? cause.message : cause))
        .closest('details')
    ).not.toHaveAttribute('open')
    expect(ready).toHaveBeenLastCalledWith(false)
    expect(busy).toHaveBeenLastCalledWith(false)
    expect(screen.getByRole('button', { name: 'Check tools' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Prepare tools' })).toBeDisabled()
    expect(api).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: 'Check tools' }))
    await waitFor(() => expect(ready).toHaveBeenLastCalledWith(true))
    expect(api).toHaveBeenNthCalledWith(2, 'workspaces/ssh/tools', {
      workspace_id: 'bot',
    })
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  }
)

it.each([
  'This setup supports a dedicated Debian 13 computer. Use an already prepared computer for another OS.',
  'A person may be using this desktop. Sign out of graphical sessions before preparing the bot computer.',
  'Gbot tools are not fully installed. For a dedicated Debian 13 computer, authorize installation and choose Prepare tools in GChat. Follow its installation instructions, including running the administrator command if shown, then choose Check tools.',
  'The bot desktop or media service is stopped. Re-run the installer and check again.',
])('keeps actionable tool instructions visible: %s', async (issue) => {
  vi.mocked(gbot).mockResolvedValueOnce({
    installed: false,
    command: null,
    issue,
  })
  const ready = vi.fn()
  render(<LanTools workspaceId="bot" ready={ready} busy={vi.fn()} />)
  fireEvent.click(screen.getByRole('button', { name: 'Check tools' }))
  expect(await screen.findByRole('alert')).toHaveTextContent(issue)
  expect(screen.getByText(issue).closest('details')).toBeNull()
  expect(ready).toHaveBeenLastCalledWith(false)
})

it.each([
  { action: 'check', issue: 'sh: 1: systemctl: not found', cloud: false },
  { action: 'check', issue: '', cloud: false },
  {
    action: 'prepare',
    issue: 'sudo: gbot-cloud-tools: command not found',
    cloud: true,
  },
  { action: 'prepare', issue: '', cloud: true },
])(
  'resolved tool failure recovery: $action with issue "$issue"',
  async ({ action, issue, cloud }) => {
    const user = userEvent.setup()
    const ready = vi.fn()
    const busy = vi.fn()
    const api = vi
      .mocked(gbot)
      .mockResolvedValueOnce({ installed: false, command: null, issue })
      .mockResolvedValueOnce({ installed: true, command: null, issue: null })
    render(
      <LanTools workspaceId="bot" ready={ready} busy={busy} cloud={cloud} />
    )
    const prepare = screen.getByRole('button', { name: 'Prepare tools' })
    expect(prepare).toBeDisabled()
    if (action === 'prepare') await user.click(screen.getByRole('checkbox'))
    const retry = screen.getByRole('button', {
      name: action === 'prepare' ? 'Prepare tools' : 'Check tools',
    })
    await user.click(retry)

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(
      action === 'prepare'
        ? 'GChat could not finish preparing the tools.'
        : 'GChat could not check the tools.'
    )
    expect(alert).toHaveTextContent(
      action === 'prepare'
        ? 'choose Prepare tools to try again'
        : 'choose Check tools to try again'
    )
    if (issue) {
      const details = screen.getByText(issue).closest('details')
      expect(details).not.toHaveAttribute('open')
      await user.click(screen.getByText('Details'))
      expect(details).toHaveAttribute('open')
    } else {
      expect(screen.queryByText('Details')).not.toBeInTheDocument()
    }
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(ready).toHaveBeenLastCalledWith(false)
    expect(busy).toHaveBeenLastCalledWith(false)
    expect(retry).toBeEnabled()
    expect(api).toHaveBeenCalledTimes(1)
    if (action === 'check') expect(prepare).toBeDisabled()

    await user.click(retry)
    await screen.findByText(
      'Tools installed. Continue to connect and check the bot desktop.'
    )
    expect(api).toHaveBeenCalledTimes(2)
    expect(api).toHaveBeenNthCalledWith(
      2,
      action === 'prepare' ? 'workspaces/ssh/prepare' : 'workspaces/ssh/tools',
      { workspace_id: 'bot', ...(action === 'prepare' ? { consent: true } : {}) }
    )
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(ready).toHaveBeenLastCalledWith(true)
    expect(busy).toHaveBeenLastCalledWith(false)
  }
)

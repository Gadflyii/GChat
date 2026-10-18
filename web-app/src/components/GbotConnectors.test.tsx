import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import GbotConnectors from './GbotConnectors'
import type { BotConnectors } from '@/services/gbot'

const { request } = vi.hoisted(() => ({ request: vi.fn() }))
vi.mock('@/services/gbot', () => ({ gbot: request }))

function account(
  id: string,
  displayName: string,
  provider: 'google' | 'microsoft' = 'google'
): BotConnectors['accounts'][number] {
  return {
    id,
    provider,
    display_name: displayName,
    email: `${id}@example.test`,
    services: ['mail'],
    access: 'read_only',
    granted_scopes: ['mail.read'],
    needs_reconnect: false,
  }
}

const google = account('personal', 'Personal Google')
const microsoft = account('work', 'Work Microsoft', 'microsoft')

function connectors(
  accountIds: string[] = [],
  accounts: BotConnectors['accounts'] = [google, microsoft]
): BotConnectors {
  return { account_ids: accountIds, accounts }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (cause: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function openPanel() {
  fireEvent.click(screen.getByText('Linked accounts'))
}

function mount(workspaceId = 'bot-one') {
  const view = render(<GbotConnectors workspaceId={workspaceId} />)
  openPanel()
  return view
}

beforeEach(() => {
  request.mockReset()
  request.mockResolvedValue(connectors())
})
afterEach(cleanup)

it.each([
  ['Error', new Error('Service unavailable')],
  ['native string', 'Service unavailable'],
])(
  'offers an accessible setup step and retries an initial account-list failure without linking accounts (%s)',
  async (_kind, cause) => {
    const retry = deferred<BotConnectors>()
    request.mockRejectedValueOnce(cause).mockReturnValueOnce(retry.promise)
    mount()

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(
      'Could not refresh linked accounts. Your selections are unchanged. Choose Refresh accounts to try again.'
    )
    const details = within(alert).getByText('Details').closest('details')
    expect(details).not.toHaveAttribute('open')
    expect(within(alert).getByText('Service unavailable')).not.toBeVisible()
    fireEvent.click(within(alert).getByText('Details'))
    expect(within(alert).getByText('Service unavailable')).toBeVisible()
    const refresh = screen.getByRole('button', { name: 'Refresh accounts' })
    expect(refresh).toHaveAccessibleDescription(
      /open Settings → Workspace connections, then refresh this list/
    )
    expect(
      screen.queryByRole('button', { name: 'Save linked accounts' })
    ).not.toBeInTheDocument()

    fireEvent.click(refresh)
    expect(screen.getByRole('status')).toHaveTextContent('Loading accounts…')
    expect(refresh).toBeDisabled()
    await act(async () => retry.resolve(connectors()))

    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('Accounts refreshed.')
    expect(screen.getByRole('checkbox', { name: /Personal Google/ })).not.toBeChecked()
    expect(screen.getByRole('checkbox', { name: /Work Microsoft/ })).not.toBeChecked()
    expect(request.mock.calls).toEqual([
      ['connectors/get', { workspace_id: 'bot-one' }],
      ['connectors/get', { workspace_id: 'bot-one' }],
    ])
  }
)

it('explains an empty list and refreshes newly connected account metadata without selecting it', async () => {
  request
    .mockResolvedValueOnce(connectors([], []))
    .mockResolvedValueOnce(connectors([], [google]))
  mount()

  expect(
    await screen.findByText('No accounts are connected to GChat yet.')
  ).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Refresh accounts' }))

  expect(
    await screen.findByRole('checkbox', { name: /Personal Google/ })
  ).not.toBeChecked()
  expect(
    screen.getByText(/Linking an account does not change its permissions/)
  ).toBeInTheDocument()
  expect(request.mock.calls.every(([route]) => route === 'connectors/get')).toBe(
    true
  )
})

it('reports a successful explicit save and serializes saves with account refresh', async () => {
  const saved = deferred<BotConnectors>()
  request
    .mockResolvedValueOnce(connectors())
    .mockReturnValueOnce(saved.promise)
  mount()
  fireEvent.click(
    await screen.findByRole('checkbox', { name: /Work Microsoft/ })
  )
  fireEvent.click(screen.getByRole('button', { name: 'Save linked accounts' }))

  expect(screen.getByRole('status')).toHaveTextContent('Saving linked accounts…')
  expect(screen.getByRole('button', { name: 'Saving…' })).toBeDisabled()
  const refresh = screen.getByRole('button', { name: 'Refresh accounts' })
  expect(refresh).toBeDisabled()
  expect(screen.getByRole('checkbox', { name: /Work Microsoft/ })).toBeDisabled()
  fireEvent.click(refresh)
  fireEvent.click(screen.getByRole('button', { name: 'Saving…' }))
  expect(request.mock.calls).toEqual([
    ['connectors/get', { workspace_id: 'bot-one' }],
    ['connectors/save', { workspace_id: 'bot-one', account_ids: ['work'] }],
  ])

  await act(async () => saved.resolve(connectors(['work'])))
  expect(screen.getByRole('status')).toHaveTextContent('Linked accounts saved.')
  expect(screen.getByRole('checkbox', { name: /Work Microsoft/ })).toBeChecked()
  expect(screen.getByRole('checkbox', { name: /Personal Google/ })).not.toBeChecked()
  expect(refresh).toBeEnabled()
})

it.each([
  ['Error', new Error('Service disconnected')],
  ['native string', 'Service disconnected'],
])(
  'keeps a failed save draft and lets the user retry the same explicit selection (%s)',
  async (_kind, cause) => {
    request
      .mockResolvedValueOnce(connectors())
      .mockRejectedValueOnce(cause)
      .mockResolvedValueOnce(connectors(['personal']))
    mount()
    fireEvent.click(
      await screen.findByRole('checkbox', { name: /Personal Google/ })
    )
    fireEvent.click(screen.getByRole('button', { name: 'Save linked accounts' }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(
      'Could not confirm whether linked accounts were saved. Your selections are kept. Choose Save linked accounts to try again.'
    )
    expect(
      within(alert).getByText('Details').closest('details')
    ).not.toHaveAttribute('open')
    expect(within(alert).getByText('Service disconnected')).not.toBeVisible()
    fireEvent.click(within(alert).getByText('Details'))
    expect(within(alert).getByText('Service disconnected')).toBeVisible()
    expect(screen.getByRole('checkbox', { name: /Personal Google/ })).toBeChecked()
    expect(screen.queryByText('Linked accounts saved.')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Save linked accounts' }))

    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent('Linked accounts saved.')
    )
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(request.mock.calls.slice(1)).toEqual([
      ['connectors/save', { workspace_id: 'bot-one', account_ids: ['personal'] }],
      ['connectors/save', { workspace_id: 'bot-one', account_ids: ['personal'] }],
    ])
  }
)

it('keeps failed Save feedback through a successful refresh until an explicit Save retry', async () => {
  const refreshed = deferred<BotConnectors>()
  const saved = deferred<BotConnectors>()
  request
    .mockResolvedValueOnce(connectors())
    .mockRejectedValueOnce(new Error('Save service unavailable'))
    .mockReturnValueOnce(refreshed.promise)
    .mockReturnValueOnce(saved.promise)
  mount()
  fireEvent.click(
    await screen.findByRole('checkbox', { name: /Personal Google/ })
  )
  fireEvent.click(screen.getByRole('button', { name: 'Save linked accounts' }))
  const failure =
    'Could not confirm whether linked accounts were saved. Your selections are kept. Choose Save linked accounts to try again.'
  expect(await screen.findByRole('alert')).toHaveTextContent(failure)

  fireEvent.click(screen.getByRole('button', { name: 'Refresh accounts' }))
  expect(screen.getByRole('alert')).toHaveTextContent(failure)
  expect(screen.getByRole('status')).toHaveTextContent('Refreshing accounts…')
  await act(async () => refreshed.resolve(connectors(['work'])))

  expect(screen.getByRole('alert')).toHaveTextContent(failure)
  expect(screen.getByRole('status')).toHaveTextContent(
    'Accounts refreshed. Your unsaved selections are unchanged.'
  )
  expect(screen.getByRole('checkbox', { name: /Personal Google/ })).toBeChecked()
  expect(screen.getByRole('checkbox', { name: /Work Microsoft/ })).not.toBeChecked()
  expect(request.mock.calls).toEqual([
    ['connectors/get', { workspace_id: 'bot-one' }],
    ['connectors/save', { workspace_id: 'bot-one', account_ids: ['personal'] }],
    ['connectors/get', { workspace_id: 'bot-one' }],
  ])

  fireEvent.click(screen.getByRole('button', { name: 'Save linked accounts' }))
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  expect(screen.getByRole('status')).toHaveTextContent('Saving linked accounts…')
  await act(async () => saved.resolve(connectors(['personal'])))
  expect(screen.getByRole('status')).toHaveTextContent('Linked accounts saved.')
  expect(request).toHaveBeenLastCalledWith('connectors/save', {
    workspace_id: 'bot-one',
    account_ids: ['personal'],
  })
})

it('keeps failed Save feedback separate from a failed refresh and its read-only retry', async () => {
  const refreshed = deferred<BotConnectors>()
  request
    .mockResolvedValueOnce(connectors())
    .mockRejectedValueOnce(new Error('Save service unavailable'))
    .mockRejectedValueOnce(new Error('Account list unavailable'))
    .mockReturnValueOnce(refreshed.promise)
  mount()
  fireEvent.click(
    await screen.findByRole('checkbox', { name: /Personal Google/ })
  )
  fireEvent.click(screen.getByRole('button', { name: 'Save linked accounts' }))
  const failure =
    'Could not confirm whether linked accounts were saved. Your selections are kept. Choose Save linked accounts to try again.'
  expect(await screen.findByRole('alert')).toHaveTextContent(failure)

  fireEvent.click(screen.getByRole('button', { name: 'Refresh accounts' }))
  await screen.findByText(
    'Could not refresh linked accounts. Your selections are unchanged. Choose Refresh accounts to try again.'
  )
  expect(screen.getAllByRole('alert')).toHaveLength(2)
  for (const alert of screen.getAllByRole('alert')) {
    expect(
      within(alert).getByText('Details').closest('details')
    ).not.toHaveAttribute('open')
  }
  expect(screen.getByText('Save service unavailable')).not.toBeVisible()
  expect(screen.getByText('Account list unavailable')).not.toBeVisible()
  expect(screen.getByText(failure)).toBeVisible()
  expect(screen.getByRole('checkbox', { name: /Personal Google/ })).toBeChecked()

  fireEvent.click(screen.getByRole('button', { name: 'Refresh accounts' }))
  expect(screen.getByRole('alert')).toHaveTextContent(failure)
  await act(async () => refreshed.resolve(connectors()))
  expect(screen.getByRole('alert')).toHaveTextContent(failure)
  expect(screen.getByRole('checkbox', { name: /Personal Google/ })).toBeChecked()
  expect(screen.queryByText('Linked accounts saved.')).not.toBeInTheDocument()
  expect(request.mock.calls).toEqual([
    ['connectors/get', { workspace_id: 'bot-one' }],
    ['connectors/save', { workspace_id: 'bot-one', account_ids: ['personal'] }],
    ['connectors/get', { workspace_id: 'bot-one' }],
    ['connectors/get', { workspace_id: 'bot-one' }],
  ])
})

it('refreshes account details without overwriting unsaved links or silently dropping a disconnected selection', async () => {
  const refreshed = deferred<BotConnectors>()
  const updatedGoogle = { ...google, display_name: 'Updated Google' }
  const added = account('added', 'New account')
  request
    .mockResolvedValueOnce(connectors(['personal']))
    .mockReturnValueOnce(refreshed.promise)
    .mockResolvedValueOnce(connectors(['work'], [updatedGoogle, added]))
  mount()
  fireEvent.click(
    await screen.findByRole('checkbox', { name: /Personal Google/ })
  )
  fireEvent.click(screen.getByRole('checkbox', { name: /Work Microsoft/ }))
  fireEvent.click(screen.getByRole('button', { name: 'Refresh accounts' }))

  expect(screen.getByRole('status')).toHaveTextContent('Refreshing accounts…')
  expect(screen.getByRole('button', { name: 'Save linked accounts' })).toBeDisabled()
  fireEvent.click(screen.getByRole('button', { name: 'Save linked accounts' }))
  expect(request).toHaveBeenCalledTimes(2)
  await act(async () =>
    refreshed.resolve(connectors(['personal'], [updatedGoogle, added]))
  )

  expect(screen.getByRole('status')).toHaveTextContent(
    'Accounts refreshed. Your unsaved selections are unchanged.'
  )
  expect(screen.getByRole('checkbox', { name: /Updated Google/ })).not.toBeChecked()
  expect(screen.getByRole('checkbox', { name: /New account/ })).not.toBeChecked()
  expect(
    screen.getByRole('checkbox', { name: 'Disconnected account (work)' })
  ).toBeChecked()
  fireEvent.click(screen.getByRole('button', { name: 'Save linked accounts' }))
  await waitFor(() =>
    expect(request).toHaveBeenLastCalledWith('connectors/save', {
      workspace_id: 'bot-one',
      account_ids: ['work'],
    })
  )
})

it('keeps the draft and loaded account details available when a manual refresh fails', async () => {
  request
    .mockResolvedValueOnce(connectors())
    .mockRejectedValueOnce(new Error('Account service unavailable'))
  mount()
  fireEvent.click(
    await screen.findByRole('checkbox', { name: /Personal Google/ })
  )
  fireEvent.click(screen.getByRole('button', { name: 'Refresh accounts' }))

  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Could not refresh linked accounts.'
  )
  expect(screen.getByRole('checkbox', { name: /Personal Google/ })).toBeChecked()
  expect(screen.getByRole('button', { name: 'Save linked accounts' })).toBeEnabled()
  expect(screen.getByRole('button', { name: 'Refresh accounts' })).toBeEnabled()
})

it('ignores a previous bot’s late load after switching workspace', async () => {
  const previous = deferred<BotConnectors>()
  request
    .mockReturnValueOnce(previous.promise)
    .mockResolvedValueOnce(connectors([], [microsoft]))
  const view = mount()
  expect(screen.getByRole('status')).toHaveTextContent('Loading accounts…')

  view.rerender(<GbotConnectors workspaceId="bot-two" />)
  openPanel()
  fireEvent.click(
    await screen.findByRole('checkbox', { name: /Work Microsoft/ })
  )
  await act(async () => previous.resolve(connectors(['personal'], [google])))

  expect(screen.queryByRole('checkbox', { name: /Personal Google/ })).toBeNull()
  expect(screen.getByRole('checkbox', { name: /Work Microsoft/ })).toBeChecked()
  expect(screen.queryByRole('status')).toBeNull()
  expect(request.mock.calls).toEqual([
    ['connectors/get', { workspace_id: 'bot-one' }],
    ['connectors/get', { workspace_id: 'bot-two' }],
  ])
})

it.each(['resolve', 'reject'] as const)(
  'ignores a previous bot’s late save %s and leaves the new bot draft independent',
  async (outcome) => {
    const previousSave = deferred<BotConnectors>()
    request
      .mockResolvedValueOnce(connectors([], [google]))
      .mockReturnValueOnce(previousSave.promise)
      .mockResolvedValueOnce(connectors([], [microsoft]))
      .mockResolvedValueOnce(connectors(['work'], [microsoft]))
    const view = mount()
    fireEvent.click(
      await screen.findByRole('checkbox', { name: /Personal Google/ })
    )
    fireEvent.click(screen.getByRole('button', { name: 'Save linked accounts' }))
    view.rerender(<GbotConnectors workspaceId="bot-two" />)
    openPanel()
    fireEvent.click(
      await screen.findByRole('checkbox', { name: /Work Microsoft/ })
    )

    await act(async () => {
      if (outcome === 'resolve') {
        previousSave.resolve(connectors(['personal'], [google]))
      } else {
        previousSave.reject(new Error('Previous bot disconnected'))
      }
    })
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.queryByRole('status')).toBeNull()
    expect(screen.queryByRole('checkbox', { name: /Personal Google/ })).toBeNull()
    expect(screen.getByRole('checkbox', { name: /Work Microsoft/ })).toBeChecked()
    fireEvent.click(screen.getByRole('button', { name: 'Save linked accounts' }))

    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent('Linked accounts saved.')
    )
    expect(request).toHaveBeenLastCalledWith('connectors/save', {
      workspace_id: 'bot-two',
      account_ids: ['work'],
    })
  }
)

it('handles a pending refresh failure after unmount without resurrecting its account list or requests', async () => {
  const pendingRefresh = deferred<BotConnectors>()
  request
    .mockResolvedValueOnce(connectors(['personal'], [google]))
    .mockReturnValueOnce(pendingRefresh.promise)
    .mockResolvedValueOnce(connectors([], [microsoft]))
  const previous = mount()
  await screen.findByRole('checkbox', { name: /Personal Google/ })
  fireEvent.click(screen.getByRole('button', { name: 'Refresh accounts' }))
  previous.unmount()
  mount('bot-two')
  await screen.findByRole('checkbox', { name: /Work Microsoft/ })

  await act(async () =>
    pendingRefresh.reject(new Error('Unmounted account request failed'))
  )

  expect(screen.queryByRole('alert')).toBeNull()
  expect(screen.queryByRole('checkbox', { name: /Personal Google/ })).toBeNull()
  expect(screen.getByRole('checkbox', { name: /Work Microsoft/ })).not.toBeChecked()
  expect(request).toHaveBeenCalledTimes(3)
})

it('disables Save linked accounts with a visible reason when no accounts exist', async () => {
  request.mockResolvedValue(connectors([], []))
  mount()
  const reason = await screen.findByText(/No accounts are connected to GChat yet/)
  const save = screen.getByRole('button', { name: 'Save linked accounts' })
  expect(save).toBeDisabled()
  expect(save).toHaveAccessibleDescription(/No accounts are connected to GChat yet/)
  expect(reason).toBeVisible()
})

it('keeps Save enabled to unlink a disconnected account when none are connected', async () => {
  request
    .mockResolvedValueOnce(connectors(['gone'], []))
    .mockResolvedValueOnce(connectors([], []))
  mount()
  const disconnected = await screen.findByRole('checkbox', {
    name: 'Disconnected account (gone)',
  })
  const save = screen.getByRole('button', { name: 'Save linked accounts' })
  expect(disconnected).toBeChecked()
  fireEvent.click(disconnected)
  expect(save).toBeEnabled()
  fireEvent.click(save)

  await waitFor(() =>
    expect(screen.getByRole('status')).toHaveTextContent('Linked accounts saved.')
  )
  expect(request).toHaveBeenLastCalledWith('connectors/save', {
    workspace_id: 'bot-one',
    account_ids: [],
  })
  expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
  expect(save).toBeDisabled()
})

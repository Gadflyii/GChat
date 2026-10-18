import { afterEach, expect, it, vi } from 'vitest'
import { useState } from 'react'
import userEvent from '@testing-library/user-event'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import GbotLanBot from './GbotLanBot'
import { ConfirmDialogHost } from '@/containers/dialogs/ConfirmDialogHost'
import { settleConfirm, useConfirmStore } from '@/lib/confirm'

const request = vi.hoisted(() => vi.fn())
vi.mock('@/services/gbot', () => ({ gbot: request }))

afterEach(() => {
  cleanup()
  settleConfirm(false)
  request.mockReset()
})

function mount(connected = false) {
  const perform = vi.fn(async (action: () => Promise<unknown>) => {
    await action()
  })
  const removed = vi.fn()
  render(
    <GbotLanBot
      id="bot-1"
      name="Writer"
      busy={false}
      connected={connected}
      perform={perform}
      removed={removed}
    />
  )
  return { perform, removed }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((done, fail) => {
    resolve = done
    reject = fail
  })
  return { promise, resolve, reject }
}

it('renames a saved LAN bot only with a changed, non-empty name', async () => {
  request.mockResolvedValue({})
  mount()
  fireEvent.click(screen.getByRole('button', { name: 'Rename bot' }))
  const save = screen.getByRole('button', { name: 'Save name' })
  expect(save).toBeDisabled()
  fireEvent.change(screen.getByLabelText('Bot name'), { target: { value: '  ' } })
  expect(save).toBeDisabled()
  fireEvent.change(screen.getByLabelText('Bot name'), { target: { value: ' Editor ' } })
  fireEvent.click(save)
  await waitFor(() =>
    expect(request).toHaveBeenCalledWith('workspaces/ssh/rename', {
      workspace_id: 'bot-1',
      name: 'Editor',
    })
  )
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Rename bot' })).toBeInTheDocument()
  )
})

it('restores LAN rename keyboard focus after Cancel without sending a request', async () => {
  const user = userEvent.setup()
  const perform = vi.fn(async (action: () => Promise<unknown>) => { await action() })
  const removed = vi.fn()
  render(
    <>
      <input aria-label="Another setting" autoFocus />
      <GbotLanBot
        id="bot-1"
        name="Writer"
        busy={false}
        connected={false}
        perform={perform}
        removed={removed}
      />
    </>
  )
  expect(screen.getByRole('textbox', { name: 'Another setting' })).toHaveFocus()
  await user.tab()
  expect(screen.getByRole('button', { name: 'Rename bot' })).toHaveFocus()
  await user.keyboard('{Enter}')
  const input = screen.getByLabelText('Bot name')
  expect(input).toHaveFocus()
  await user.clear(input)
  await user.keyboard('Discard this name')
  await user.tab()
  expect(screen.getByRole('button', { name: 'Save name' })).toHaveFocus()
  await user.tab()
  expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus()
  await user.keyboard('{Enter}')
  expect(screen.queryByRole('form', { name: 'Rename bot' })).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Rename bot' })).toHaveFocus()
  expect(request).not.toHaveBeenCalled()
  expect(perform).not.toHaveBeenCalled()
  expect(removed).not.toHaveBeenCalled()

  await user.keyboard('{Enter}')
  expect(screen.getByLabelText('Bot name')).toHaveFocus()
  expect(screen.getByLabelText('Bot name')).toHaveValue('Writer')
  expect(screen.getByRole('button', { name: 'Save name' })).toBeDisabled()
  expect(request).not.toHaveBeenCalled()
})

it.each([false, true])('settles LAN rename keyboard focus after refresh (focus moved: %s)', async (moveFocus) => {
  const user = userEvent.setup()
  const rename = deferred<void>()
  const refreshedName = deferred<string>()
  const refresh = vi.fn(() => refreshedName.promise)
  const removed = vi.fn()
  request.mockReturnValueOnce(rename.promise)
  function Parent() {
    const [busy, setBusy] = useState(false)
    const [name, setName] = useState('Writer')
    return (
      <>
        <input aria-label="Another setting" autoFocus />
        <p>Saved bot: {name}</p>
        <GbotLanBot
          id="bot-1"
          name={name}
          busy={busy}
          connected={false}
          perform={async (action) => {
            setBusy(true)
            try {
              await action()
            } finally {
              try {
                setName(await refresh())
              } finally {
                setBusy(false)
              }
            }
          }}
          removed={removed}
        />
      </>
    )
  }
  render(<Parent />)
  const other = screen.getByRole('textbox', { name: 'Another setting' })
  expect(other).toHaveFocus()
  await user.tab()
  await user.keyboard('{Enter}')
  const input = screen.getByLabelText('Bot name')
  expect(input).toHaveFocus()
  await user.clear(input)
  await user.keyboard('Editor')
  await user.tab()
  expect(screen.getByRole('button', { name: 'Save name' })).toHaveFocus()
  await user.keyboard('{Enter}')
  expect(request.mock.calls).toEqual([
    ['workspaces/ssh/rename', { workspace_id: 'bot-1', name: 'Editor' }],
  ])
  expect(input).toBeDisabled()
  await act(async () => rename.resolve())
  expect(refresh).toHaveBeenCalledTimes(1)
  expect(screen.queryByRole('form', { name: 'Rename bot' })).not.toBeInTheDocument()
  const opener = screen.getByRole('button', { name: 'Rename bot' })
  expect(opener).toBeDisabled()
  expect(opener).not.toHaveFocus()
  expect(screen.getByRole('status')).toHaveTextContent('Saving bot name…')
  if (moveFocus) {
    await user.tab()
    expect(other).toHaveFocus()
    await user.keyboard('Keep editing this setting')
  }
  await act(async () => refreshedName.resolve('Editor'))
  expect(opener).toBeEnabled()
  expect(screen.getByText('Saved bot: Editor')).toBeVisible()
  expect(screen.queryByRole('status')).not.toBeInTheDocument()
  expect(screen.queryByRole('form', { name: 'Rename bot' })).not.toBeInTheDocument()
  expect(request).toHaveBeenCalledTimes(1)
  expect(refresh).toHaveBeenCalledTimes(1)
  expect(removed).not.toHaveBeenCalled()
  if (moveFocus) {
    expect(other).toHaveFocus()
    expect(other).toHaveValue('Keep editing this setting')
  } else {
    expect(opener).toHaveFocus()
    await user.keyboard('{Enter}')
    expect(screen.getByLabelText('Bot name')).toHaveFocus()
    expect(screen.getByLabelText('Bot name')).toHaveValue('Editor')
    expect(screen.getByRole('button', { name: 'Save name' })).toBeDisabled()
    expect(request).toHaveBeenCalledTimes(1)
  }
})

it('keeps the submitted LAN bot name stable through Save and refresh, then permits a corrected retry', async () => {
  const user = userEvent.setup()
  const firstRename = deferred<void>()
  const retryRename = deferred<void>()
  const firstRefresh = deferred<string>()
  const retryRefresh = deferred<string>()
  const refresh = vi.fn()
    .mockReturnValueOnce(firstRefresh.promise)
    .mockReturnValueOnce(retryRefresh.promise)
  const failed = vi.fn()
  request.mockReturnValueOnce(firstRename.promise).mockReturnValueOnce(retryRename.promise)

  function Parent() {
    const [busy, setBusy] = useState(false)
    const [name, setName] = useState('Writer')
    const perform = async (action: () => Promise<unknown>) => {
      if (busy) return
      setBusy(true)
      try {
        await action()
      } catch (cause) {
        failed(cause)
      } finally {
        try {
          setName(await refresh())
        } finally {
          setBusy(false)
        }
      }
    }
    return (
      <GbotLanBot
        id="bot-1"
        name={name}
        busy={busy}
        connected={false}
        perform={perform}
        removed={vi.fn()}
      />
    )
  }
  render(<Parent />)
  await user.click(screen.getByRole('button', { name: 'Rename bot' }))
  const input = screen.getByLabelText('Bot name')
  await user.clear(input)
  await user.type(input, 'Editor')
  await user.click(screen.getByRole('button', { name: 'Save name' }))
  expect(request.mock.calls).toEqual([
    ['workspaces/ssh/rename', { workspace_id: 'bot-1', name: 'Editor' }],
  ])
  expect(screen.getByRole('button', { name: 'Saving name…' })).toBeDisabled()
  expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled()
  await user.type(input, ' Reviewer')
  expect(input).toHaveValue('Editor')
  expect(input).toBeDisabled()

  const failure = new Error('Saved name unavailable')
  await act(async () => firstRename.reject(failure))
  await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1))
  await user.type(input, ' Reviewer')
  expect(input).toHaveValue('Editor')
  expect(input).toBeDisabled()
  await act(async () => firstRefresh.resolve('Writer'))
  await waitFor(() => expect(input).toBeEnabled())
  expect(failed).toHaveBeenCalledExactlyOnceWith(failure)
  expect(input).toHaveValue('Editor')
  expect(screen.getByRole('button', { name: 'Save name' })).toBeEnabled()
  expect(screen.getByRole('button', { name: 'Cancel' })).toBeEnabled()
  expect(request).toHaveBeenCalledTimes(1)

  await user.clear(input)
  await user.type(input, 'Copy editor')
  await user.click(screen.getByRole('button', { name: 'Save name' }))
  expect(request.mock.calls).toEqual([
    ['workspaces/ssh/rename', { workspace_id: 'bot-1', name: 'Editor' }],
    ['workspaces/ssh/rename', { workspace_id: 'bot-1', name: 'Copy editor' }],
  ])
  await user.type(input, ' Reviewer')
  expect(input).toHaveValue('Copy editor')
  expect(input).toBeDisabled()
  await act(async () => retryRename.resolve())
  await waitFor(() => expect(refresh).toHaveBeenCalledTimes(2))
  expect(screen.queryByLabelText('Bot name')).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Rename bot' })).toBeDisabled()
  await act(async () => retryRefresh.resolve('Copy editor'))
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Rename bot' })).toBeEnabled()
  )
  await user.click(screen.getByRole('button', { name: 'Rename bot' }))
  expect(screen.getByLabelText('Bot name')).toHaveValue('Copy editor')
  expect(screen.getByRole('button', { name: 'Save name' })).toBeDisabled()
  expect(request).toHaveBeenCalledTimes(2)
})

it('submits a LAN rename once and keeps saving feedback through refresh and explicit retry', async () => {
  const user = userEvent.setup()
  const firstRename = deferred<void>()
  const retryRename = deferred<void>()
  const firstRefresh = deferred<string>()
  const retryRefresh = deferred<string>()
  const refresh = vi.fn()
    .mockReturnValueOnce(firstRefresh.promise)
    .mockReturnValueOnce(retryRefresh.promise)
  request.mockReturnValueOnce(firstRename.promise).mockReturnValueOnce(retryRename.promise)
  const perform = vi.fn()

  function Parent() {
    const [busy, setBusy] = useState(false)
    const [name, setName] = useState('Writer')
    return (
      <GbotLanBot
        id="bot-1"
        name={name}
        busy={busy}
        connected={false}
        perform={async (action) => {
          perform()
          setBusy(true)
          try {
            await action()
          } finally {
            try {
              setName(await refresh())
            } finally {
              setBusy(false)
            }
          }
        }}
        removed={vi.fn()}
      />
    )
  }
  render(<Parent />)
  await user.click(screen.getByRole('button', { name: 'Rename bot' }))
  const input = screen.getByLabelText('Bot name')
  await user.clear(input)
  await user.type(input, 'Editor')
  const form = screen.getByRole('form', { name: 'Rename bot' })
  act(() => {
    fireEvent.submit(form)
    fireEvent.submit(form)
  })
  expect(perform).toHaveBeenCalledTimes(1)
  expect(request.mock.calls).toEqual([
    ['workspaces/ssh/rename', { workspace_id: 'bot-1', name: 'Editor' }],
  ])
  expect(screen.getByRole('status')).toHaveTextContent('Saving bot name…')
  expect(screen.getByRole('button', { name: 'Saving name…' })).toBeDisabled()
  expect(input).toBeDisabled()
  expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled()
  await act(async () => firstRename.reject(new Error('Could not save name')))
  await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1))
  expect(screen.getByRole('status')).toHaveTextContent('Saving bot name…')
  expect(input).toBeDisabled()
  fireEvent.submit(form)
  expect(perform).toHaveBeenCalledTimes(1)
  await act(async () => firstRefresh.resolve('Writer'))
  expect(await screen.findByRole('alert')).toHaveTextContent('Could not save this bot’s name.')
  expect(input).toHaveValue('Editor')
  expect(screen.queryByRole('status')).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Save name' })).toBeEnabled()

  await user.click(screen.getByRole('button', { name: 'Save name' }))
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  expect(perform).toHaveBeenCalledTimes(2)
  expect(request.mock.calls).toEqual([
    ['workspaces/ssh/rename', { workspace_id: 'bot-1', name: 'Editor' }],
    ['workspaces/ssh/rename', { workspace_id: 'bot-1', name: 'Editor' }],
  ])
  await act(async () => retryRename.resolve())
  await waitFor(() => expect(refresh).toHaveBeenCalledTimes(2))
  expect(screen.queryByLabelText('Bot name')).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Rename bot' })).toBeDisabled()
  expect(screen.getByRole('status')).toHaveTextContent('Saving bot name…')
  await act(async () => retryRefresh.resolve('Editor'))
  expect(screen.queryByRole('status')).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Rename bot' }))
  expect(screen.getByLabelText('Bot name')).toHaveValue('Editor')
  expect(screen.getByRole('button', { name: 'Save name' })).toBeDisabled()
  expect(request).toHaveBeenCalledTimes(2)
})

it('removes only after the shared confirm dialog is accepted', async () => {
  request.mockResolvedValue({ removed: true })
  const { removed } = mount()
  fireEvent.click(screen.getByRole('button', { name: 'Remove bot' }))
  const pending = useConfirmStore.getState().pending
  expect(pending?.destructive).toBe(true)
  expect(pending?.message).toMatch(/computer itself is not changed/)
  expect(request).not.toHaveBeenCalled()
  act(() => settleConfirm(false))
  await Promise.resolve()
  expect(request).not.toHaveBeenCalled()

  fireEvent.click(screen.getByRole('button', { name: 'Remove bot' }))
  act(() => settleConfirm(true))
  await waitFor(() =>
    expect(request).toHaveBeenCalledWith('workspaces/ssh/remove', { workspace_id: 'bot-1' })
  )
  await waitFor(() => expect(removed).toHaveBeenCalled())
})

it('ignores a LAN removal confirmation after its bot panel is replaced', async () => {
  const user = userEvent.setup()
  const perform = vi.fn(async (action: () => Promise<unknown>) => { await action() })
  const removed = vi.fn()
  request.mockResolvedValue({ removed: true })
  const panel = (id: string, name: string) => (
    <>
      <GbotLanBot
        key={id}
        id={id}
        name={name}
        busy={false}
        connected={false}
        perform={perform}
        removed={() => removed(id)}
      />
      <ConfirmDialogHost />
    </>
  )
  const view = render(panel('bot-1', 'Writer'))
  await user.click(screen.getByRole('button', { name: 'Remove bot' }))
  expect(screen.getByRole('dialog')).toHaveAccessibleName('Remove Writer?')

  view.rerender(panel('bot-2', 'Researcher'))
  await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Remove bot' }))
  expect(request).not.toHaveBeenCalled()
  expect(perform).not.toHaveBeenCalled()
  expect(removed).not.toHaveBeenCalled()
  expect(screen.getByRole('button', { name: 'Remove bot' })).toBeEnabled()

  await user.click(screen.getByRole('button', { name: 'Remove bot' }))
  expect(screen.getByRole('dialog')).toHaveAccessibleName('Remove Researcher?')
  expect(request).not.toHaveBeenCalled()
  await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Remove bot' }))
  expect(request.mock.calls).toEqual([
    ['workspaces/ssh/remove', { workspace_id: 'bot-2' }],
  ])
  expect(removed).toHaveBeenCalledExactlyOnceWith('bot-2')
})

it('keeps the replacement bot selected when an earlier LAN removal finishes late', async () => {
  const user = userEvent.setup()
  const firstRemoval = deferred<{ removed: boolean }>()
  request.mockReturnValueOnce(firstRemoval.promise).mockResolvedValue({ removed: true })
  const removed = vi.fn()
  function Parent({ id, name }: { id: string; name: string }) {
    const [cleared, setCleared] = useState(false)
    return (
      <>
        <p>Selected bot: {cleared ? 'None' : name}</p>
        {!cleared && (
          <GbotLanBot
            key={id}
            id={id}
            name={name}
            busy={false}
            connected={false}
            perform={async (action) => { await action() }}
            removed={() => {
              removed(id)
              setCleared(true)
            }}
          />
        )}
        <ConfirmDialogHost />
      </>
    )
  }
  const view = render(<Parent id="bot-1" name="Writer" />)
  await user.click(screen.getByRole('button', { name: 'Remove bot' }))
  await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Remove bot' }))
  expect(request.mock.calls).toEqual([
    ['workspaces/ssh/remove', { workspace_id: 'bot-1' }],
  ])
  view.rerender(<Parent id="bot-2" name="Researcher" />)
  await act(async () => firstRemoval.resolve({ removed: true }))
  expect(removed).not.toHaveBeenCalled()
  expect(screen.getByText('Selected bot: Researcher')).toBeVisible()
  expect(screen.getByRole('button', { name: 'Remove bot' })).toBeEnabled()
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()

  await user.click(screen.getByRole('button', { name: 'Remove bot' }))
  expect(screen.getByRole('dialog')).toHaveAccessibleName('Remove Researcher?')
  expect(request).toHaveBeenCalledTimes(1)
  await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Remove bot' }))
  expect(request.mock.calls).toEqual([
    ['workspaces/ssh/remove', { workspace_id: 'bot-1' }],
    ['workspaces/ssh/remove', { workspace_id: 'bot-2' }],
  ])
  expect(removed).toHaveBeenCalledExactlyOnceWith('bot-2')
  expect(screen.getByText('Selected bot: None')).toBeVisible()
})

it('disables removal with a visible reason while connected', () => {
  mount(true)
  const remove = screen.getByRole('button', { name: 'Remove bot' })
  expect(remove).toBeDisabled()
  expect(remove).toHaveAccessibleDescription(/Disconnect this bot before removing it/)
})

it.each([
  ['Error', new Error('could not persist Gbot state')],
  ['native string', 'Gbot service request failed'],
])('keeps failed LAN rename feedback for a %s through refresh until retry succeeds', async (_kind, cause) => {
  const user = userEvent.setup()
  const firstRename = deferred<void>()
  const retryRename = deferred<void>()
  const firstRefresh = deferred<string>()
  const retryRefresh = deferred<string>()
  const refresh = vi.fn()
    .mockReturnValueOnce(firstRefresh.promise)
    .mockReturnValueOnce(retryRefresh.promise)
  const toastError = vi.fn()
  request.mockReturnValueOnce(firstRename.promise).mockReturnValueOnce(retryRename.promise)

  function Parent({ revision = 0 }: { revision?: number }) {
    const [busy, setBusy] = useState(false)
    const [name, setName] = useState('Writer')
    const perform = async (
      action: () => Promise<unknown>,
      propagateError = false
    ) => {
      setBusy(true)
      try {
        await action()
      } catch (failure) {
        if (propagateError) throw failure
        toastError(String(failure))
      } finally {
        try {
          setName(await refresh())
        } finally {
          setBusy(false)
        }
      }
    }
    return (
      <section aria-label={`Saved bot snapshot ${revision}`}>
        <GbotLanBot
          id="bot-1"
          name={name}
          busy={busy}
          connected={false}
          perform={perform}
          removed={vi.fn()}
        />
      </section>
    )
  }
  const view = render(<Parent />)
  await user.click(screen.getByRole('button', { name: 'Rename bot' }))
  const input = screen.getByLabelText('Bot name')
  await user.clear(input)
  await user.type(input, 'Editor')
  await user.click(screen.getByRole('button', { name: 'Save name' }))
  expect(input).toBeDisabled()
  expect(request.mock.calls).toEqual([
    ['workspaces/ssh/rename', { workspace_id: 'bot-1', name: 'Editor' }],
  ])
  await act(async () => firstRename.reject(cause))
  await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1))
  expect(input).toBeDisabled()
  await act(async () => firstRefresh.resolve('Writer'))
  const message = 'Could not save this bot’s name. Try Save name again.'
  const alert = await screen.findByRole('alert')
  expect(within(alert).getByText(message)).toBeVisible()
  const details = within(alert).getByText('Details').closest('details')
  expect(details).not.toHaveAttribute('open')
  expect(within(alert).getByText(cause instanceof Error ? cause.message : cause)).toBeInTheDocument()
  expect(input).toHaveValue('Editor')
  expect(input).toBeEnabled()
  expect(input).toHaveAccessibleDescription(/Could not save this bot’s name/)
  expect(toastError).not.toHaveBeenCalled()

  view.rerender(<Parent revision={1} />)
  expect(screen.getByRole('alert')).toHaveTextContent(message)
  expect(input).toHaveValue('Editor')
  expect(request).toHaveBeenCalledTimes(1)
  await user.click(screen.getByRole('button', { name: 'Save name' }))
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  expect(input).toBeDisabled()
  expect(request.mock.calls).toEqual([
    ['workspaces/ssh/rename', { workspace_id: 'bot-1', name: 'Editor' }],
    ['workspaces/ssh/rename', { workspace_id: 'bot-1', name: 'Editor' }],
  ])
  await act(async () => retryRename.resolve())
  await waitFor(() => expect(refresh).toHaveBeenCalledTimes(2))
  await act(async () => retryRefresh.resolve('Editor'))
  await user.click(screen.getByRole('button', { name: 'Rename bot' }))
  expect(screen.getByLabelText('Bot name')).toHaveValue('Editor')
  expect(screen.getByRole('button', { name: 'Save name' })).toBeDisabled()
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  expect(request).toHaveBeenCalledTimes(2)
})

it('clears failed LAN rename guidance when the user cancels the retained draft', async () => {
  const user = userEvent.setup()
  request.mockRejectedValue('Name was not saved')
  render(
    <GbotLanBot
      id="bot-1"
      name="Writer"
      busy={false}
      connected={false}
      perform={async (action) => {
        await action()
      }}
      removed={vi.fn()}
    />
  )
  await user.click(screen.getByRole('button', { name: 'Rename bot' }))
  await user.clear(screen.getByLabelText('Bot name'))
  await user.type(screen.getByLabelText('Bot name'), 'Editor')
  await user.click(screen.getByRole('button', { name: 'Save name' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Could not save this bot’s name.')
  await user.click(screen.getByRole('button', { name: 'Cancel' }))
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Rename bot' }))
  expect(screen.getByLabelText('Bot name')).toHaveValue('Writer')
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  expect(request).toHaveBeenCalledTimes(1)
})


it.each([
  ['Error', new Error('Finish its tasks, disable its schedules and unlink its accounts')],
  ['native string', 'Gbot service connection closed before a response'],
])('keeps failed LAN removal feedback for a %s until an explicitly reconfirmed retry', async (_kind, cause) => {
  const user = userEvent.setup()
  const firstRemoval = deferred<void>()
  const retryRemoval = deferred<void>()
  const firstRefresh = deferred<void>()
  const retryRefresh = deferred<void>()
  const refresh = vi.fn()
    .mockReturnValueOnce(firstRefresh.promise)
    .mockReturnValueOnce(retryRefresh.promise)
  const toastError = vi.fn()
  const removed = vi.fn()
  request.mockReturnValueOnce(firstRemoval.promise).mockReturnValueOnce(retryRemoval.promise)

  function Parent({ revision = 0 }: { revision?: number }) {
    const [busy, setBusy] = useState(false)
    const [selected, setSelected] = useState('Writer')
    const perform = async (
      action: () => Promise<unknown>,
      propagateError = false
    ) => {
      setBusy(true)
      try {
        await action()
      } catch (failure) {
        if (propagateError) throw failure
        toastError(String(failure))
      } finally {
        try {
          await refresh()
        } finally {
          setBusy(false)
        }
      }
    }
    return (
      <>
        <section aria-label={`Saved bot snapshot ${revision}`}>
          <p>Selected bot: {selected || 'None'}</p>
          {selected && (
            <GbotLanBot
              id="bot-1"
              name="Writer"
              busy={busy}
              connected={false}
              perform={perform}
              removed={() => {
                removed()
                setSelected('')
              }}
            />
          )}
          <p>Researcher is still saved</p>
        </section>
        <ConfirmDialogHost />
      </>
    )
  }
  const view = render(<Parent />)
  await user.click(screen.getByRole('button', { name: 'Remove bot' }))
  expect(request).not.toHaveBeenCalled()
  await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Remove bot' }))
  expect(request.mock.calls).toEqual([
    ['workspaces/ssh/remove', { workspace_id: 'bot-1' }],
  ])
  expect(screen.getByRole('button', { name: 'Remove bot' })).toBeDisabled()
  await act(async () => firstRemoval.reject(cause))
  await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1))
  expect(screen.getByRole('button', { name: 'Remove bot' })).toBeDisabled()
  await act(async () => firstRefresh.resolve())
  const alert = await screen.findByRole('alert')
  expect(alert).toHaveTextContent('Could not confirm this bot was removed.')
  expect(alert).toHaveTextContent('finish its tasks, turn off its schedules, unlink its accounts and disconnect it')
  expect(alert).toHaveTextContent('then try Remove bot again.')
  expect(within(alert).getByText('Details').closest('details')).not.toHaveAttribute('open')
  expect(within(alert).getByText(cause instanceof Error ? cause.message : cause)).toBeInTheDocument()
  expect(screen.getByText('Selected bot: Writer')).toBeVisible()
  expect(screen.getByRole('button', { name: 'Remove bot' })).toBeEnabled()
  expect(screen.getByRole('button', { name: 'Remove bot' })).toHaveAccessibleDescription(/Could not confirm/)
  expect(removed).not.toHaveBeenCalled()
  expect(toastError).not.toHaveBeenCalled()

  view.rerender(<Parent revision={1} />)
  expect(screen.getByRole('alert')).toHaveTextContent('Could not confirm this bot was removed.')
  expect(request).toHaveBeenCalledTimes(1)
  await user.click(screen.getByRole('button', { name: 'Remove bot' }))
  const cancelled = screen.getByRole('dialog')
  expect(within(cancelled).getByRole('button', { name: 'Cancel' })).toHaveFocus()
  await user.keyboard('{Escape}')
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  expect(request).toHaveBeenCalledTimes(1)
  expect(screen.getByRole('alert')).toHaveTextContent('Could not confirm this bot was removed.')
  expect(screen.getByText('Selected bot: Writer')).toBeVisible()

  await user.click(screen.getByRole('button', { name: 'Remove bot' }))
  expect(request).toHaveBeenCalledTimes(1)
  await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Remove bot' }))
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Remove bot' })).toBeDisabled()
  expect(request.mock.calls).toEqual([
    ['workspaces/ssh/remove', { workspace_id: 'bot-1' }],
    ['workspaces/ssh/remove', { workspace_id: 'bot-1' }],
  ])
  await act(async () => retryRemoval.resolve())
  await waitFor(() => expect(refresh).toHaveBeenCalledTimes(2))
  await act(async () => retryRefresh.resolve())
  expect(removed).toHaveBeenCalledTimes(1)
  expect(screen.getByText('Selected bot: None')).toBeVisible()
  expect(screen.getByText('Researcher is still saved')).toBeVisible()
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Remove bot' })).not.toBeInTheDocument()
  expect(request).toHaveBeenCalledTimes(2)
})

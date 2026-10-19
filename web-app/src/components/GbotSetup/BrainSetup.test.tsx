import { useState } from 'react'
import userEvent from '@testing-library/user-event'
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import {
  emptyPairedConnection,
  type Assignment,
  type SavedAssignment,
} from '@/services/gbot'
import { BrainSetup } from './BrainSetup'

const call = vi.hoisted(() => vi.fn())
vi.mock('@/services/gbot', async (original) => ({
  ...(await original<object>()),
  gbot: call,
}))
afterEach(() => {
  cleanup()
  call.mockReset()
})

const saved: SavedAssignment = {
  workspace_id: 'one',
  connection: { kind: 'endpoint', api_base: 'http://host/v1' },
  model: 'qwen',
  context_tokens: 262144,
  credential_ref: 'vault-key',
}

function deferred() {
  let resolve!: () => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<void>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}

function Setup({
  initial = {
    connection: { kind: 'endpoint', api_base: '' },
    model: '',
    context_tokens: 0,
  },
  configured,
  save,
  busy = false,
}: {
  initial?: Assignment
  configured?: SavedAssignment
  save: (value: Assignment) => Promise<void>
  busy?: boolean
}) {
  const [value, setValue] = useState(initial)
  return (
    <BrainSetup
      value={value}
      saved={configured}
      computerReady
      busy={busy}
      onChange={setValue}
      onCancel={() => {
        if (configured)
          setValue({
            connection: configured.connection,
            model: configured.model,
            context_tokens: configured.context_tokens,
          })
      }}
      onSave={() => save(value)}
    />
  )
}

it('offers the next setup step and saves only a complete model assignment', async () => {
  const save = vi.fn().mockResolvedValue(undefined)
  render(
    <>
      <input aria-label="Another setting" autoFocus />
      <Setup save={save} />
    </>
  )
  const other = screen.getByRole('textbox', { name: 'Another setting' })
  expect(other).toHaveFocus()
  expect(screen.getByRole('form', { name: 'Set up bot brain' })).toBeVisible()
  expect(screen.getByText('Next: choose a brain')).toBeVisible()
  expect(
    screen.queryByRole('button', { name: 'Cancel edits' })
  ).not.toBeInTheDocument()
  const submit = screen.getByRole('button', { name: 'Save brain settings' })
  expect(submit).toBeDisabled()
  fireEvent.change(screen.getByLabelText('GInfer API URL'), {
    target: { value: 'http://host/v1' },
  })
  fireEvent.change(screen.getByLabelText('Model ID'), {
    target: { value: saved.model },
  })
  fireEvent.change(screen.getByLabelText('Model context tokens'), {
    target: { value: '262144.5' },
  })
  expect(submit).toBeDisabled()
  fireEvent.change(screen.getByLabelText('Model context tokens'), {
    target: { value: '262144' },
  })
  fireEvent.click(submit)
  await waitFor(() =>
    expect(save).toHaveBeenCalledWith({
      connection: { kind: 'endpoint', api_base: 'http://host/v1' },
      model: saved.model,
      context_tokens: 262144,
    })
  )
  expect(other).toHaveFocus()
})

it('keeps the saved key when editing and removes it only by explicit choice', async () => {
  const save = vi.fn().mockResolvedValue(undefined)
  render(<Setup initial={saved} configured={saved} save={save} />)
  expect(screen.queryByRole('form')).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Edit brain' }))
  expect(screen.getByLabelText('API key')).toHaveValue('')
  expect(screen.getByLabelText('API key')).toHaveAttribute(
    'placeholder',
    'Saved in secure storage'
  )
  fireEvent.change(screen.getByLabelText('API key'), {
    target: { value: 'replacement' },
  })
  fireEvent.change(screen.getByLabelText('API key'), { target: { value: '' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save brain settings' }))
  await waitFor(() => expect(save.mock.calls[0][0].api_key).toBeUndefined())
  fireEvent.click(screen.getByRole('button', { name: 'Edit brain' }))
  fireEvent.click(screen.getByLabelText('Remove saved API key'))
  expect(screen.getByLabelText('API key')).toBeDisabled()
  fireEvent.click(screen.getByRole('button', { name: 'Save brain settings' }))
  await waitFor(() => expect(save.mock.calls[1][0].api_key).toBe(''))
})

it('returns brain edit keyboard focus after Cancel without saving a draft or key', async () => {
  const user = userEvent.setup()
  const save = vi.fn()
  render(
    <>
      <input aria-label="Another setting" autoFocus />
      <Setup initial={saved} configured={saved} save={save} />
    </>
  )
  expect(screen.getByRole('textbox', { name: 'Another setting' })).toHaveFocus()
  await user.tab()
  expect(screen.getByRole('button', { name: 'Edit brain' })).toHaveFocus()
  await user.keyboard('{Enter}')
  await user.click(screen.getByLabelText('API key'))
  await user.keyboard('replacement-key')
  const model = screen.getByLabelText('Model ID')
  await user.clear(model)
  await user.keyboard('unsaved-model')
  await user.tab()
  expect(screen.getByLabelText('Model context tokens')).toHaveFocus()
  await user.tab()
  expect(screen.getByRole('button', { name: 'Save brain settings' })).toHaveFocus()
  await user.tab()
  expect(screen.getByRole('button', { name: 'Cancel edits' })).toHaveFocus()
  await user.keyboard('{Enter}')

  expect(screen.queryByRole('form')).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Edit brain' })).toHaveFocus()
  expect(save).not.toHaveBeenCalled()
  expect(call).not.toHaveBeenCalled()
  await user.keyboard('{Enter}')
  expect(screen.getByLabelText('Model ID')).toHaveValue(saved.model)
  expect(screen.getByLabelText('API key')).toHaveValue('')
  expect(screen.getByLabelText('API key')).toHaveAttribute(
    'placeholder',
    'Saved in secure storage'
  )
  expect(screen.getByLabelText('Remove saved API key')).not.toBeChecked()
  expect(save).not.toHaveBeenCalled()
})

it.each([false, true])(
  'settles brain edit keyboard focus after successful Save and parent refresh (focus moved: %s)',
  async (moveFocus) => {
    const user = userEvent.setup()
    const pending = deferred()
    const save = vi.fn().mockReturnValue(pending.promise)
    const page = (busy = false, configured = saved) => (
      <>
        <input aria-label="Another setting" autoFocus />
        <Setup initial={saved} configured={configured} save={save} busy={busy} />
      </>
    )
    const view = render(page())
    const other = screen.getByRole('textbox', { name: 'Another setting' })
    expect(other).toHaveFocus()
    await user.tab()
    await user.keyboard('{Enter}')
    const model = screen.getByLabelText('Model ID')
    await user.clear(model)
    await user.keyboard('updated-model')
    await user.tab()
    await user.tab()
    expect(screen.getByRole('button', { name: 'Save brain settings' })).toHaveFocus()
    await user.keyboard('{Enter}')
    expect(save).toHaveBeenCalledExactlyOnceWith({ ...saved, model: 'updated-model' })
    expect(model).toBeDisabled()
    view.rerender(page(true))
    await act(async () => pending.resolve())
    expect(screen.queryByRole('form')).not.toBeInTheDocument()
    const opener = screen.getByRole('button', { name: 'Edit brain' })
    expect(opener).toBeDisabled()
    expect(opener).not.toHaveFocus()
    if (moveFocus) {
      await user.tab()
      expect(other).toHaveFocus()
      await user.keyboard('Continue another setting')
    }

    view.rerender(page(false, { ...saved, model: 'updated-model' }))
    expect(opener).toBeEnabled()
    expect(screen.getByText(/updated-model ·/)).toBeVisible()
    expect(screen.queryByRole('form')).not.toBeInTheDocument()
    expect(save).toHaveBeenCalledTimes(1)
    expect(call).not.toHaveBeenCalled()
    if (moveFocus) {
      expect(other).toHaveFocus()
      expect(other).toHaveValue('Continue another setting')
    } else {
      expect(opener).toHaveFocus()
      await user.keyboard('{Enter}')
      expect(screen.getByLabelText('Model ID')).toHaveValue('updated-model')
      expect(screen.getByLabelText('API key')).toHaveValue('')
      expect(save).toHaveBeenCalledTimes(1)
    }
  }
)

it('leaves brain edit keyboard focus return inactive after failed Save and retains the draft', async () => {
  const user = userEvent.setup()
  const pending = deferred()
  const save = vi.fn().mockReturnValue(pending.promise)
  render(
    <>
      <input aria-label="Another setting" autoFocus />
      <Setup initial={saved} configured={saved} save={save} />
    </>
  )
  await user.tab()
  await user.keyboard('{Enter}')
  await user.click(screen.getByLabelText('API key'))
  await user.keyboard('draft-key')
  const model = screen.getByLabelText('Model ID')
  await user.clear(model)
  await user.keyboard('draft-model')
  await user.tab()
  await user.tab()
  expect(screen.getByRole('button', { name: 'Save brain settings' })).toHaveFocus()
  await user.keyboard('{Enter}')
  await act(async () => pending.reject(new Error('Vault unavailable')))

  expect(screen.getByRole('form', { name: 'Set up bot brain' })).toBeVisible()
  expect(screen.queryByRole('button', { name: 'Edit brain' })).not.toBeInTheDocument()
  expect(model).toBeEnabled()
  expect(model).toHaveValue('draft-model')
  expect(screen.getByLabelText('API key')).toHaveValue('draft-key')
  expect(screen.getByLabelText('Remove saved API key')).not.toBeChecked()
  expect(screen.getByRole('button', { name: 'Save brain settings' })).toBeEnabled()
  expect(screen.getByRole('alert')).toHaveTextContent(/entries are still here/i)
  expect(save).toHaveBeenCalledExactlyOnceWith({
    ...saved,
    model: 'draft-model',
    api_key: 'draft-key',
  })
  expect(call).not.toHaveBeenCalled()
})

it('keeps failed setup visible with its inputs for retry', async () => {
  const first = deferred()
  const retry = deferred()
  const save = vi
    .fn()
    .mockReturnValueOnce(first.promise)
    .mockReturnValueOnce(retry.promise)
  render(<Setup initial={{ ...saved, api_key: 'private-key' }} save={save} />)
  fireEvent.click(screen.getByRole('button', { name: 'Save brain settings' }))
  expect(screen.getByRole('status')).toHaveTextContent('Saving brain settings…')
  expect(screen.getByLabelText('API key')).toBeDisabled()
  await act(async () => first.reject(new Error('Vault unavailable')))
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Vault unavailable'
  )
  expect(screen.queryByRole('status')).not.toBeInTheDocument()
  expect(screen.getByLabelText('API key')).toHaveValue('private-key')
  expect(screen.getByLabelText('API key')).toBeEnabled()
  expect(screen.queryByText('Brain configured')).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Save brain settings' }))
  expect(save).toHaveBeenCalledTimes(2)
  expect(save.mock.calls[1]).toEqual(save.mock.calls[0])
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  expect(screen.getByRole('status')).toHaveTextContent('Saving brain settings…')
  await act(async () => retry.resolve())
  expect(screen.queryByRole('status')).not.toBeInTheDocument()
  expect(
    screen.getByRole('button', { name: 'Save brain settings' })
  ).toBeEnabled()
})

it('discards unsaved brain settings and a replacement key without saving', async () => {
  const save = vi.fn().mockResolvedValue(undefined)
  render(<Setup initial={saved} configured={saved} save={save} />)
  fireEvent.click(screen.getByRole('button', { name: 'Edit brain' }))
  fireEvent.change(screen.getByLabelText('GInfer API URL'), {
    target: { value: 'http://another-host/v1' },
  })
  fireEvent.change(screen.getByLabelText('Model ID'), {
    target: { value: 'another-model' },
  })
  fireEvent.change(screen.getByLabelText('Model context tokens'), {
    target: { value: '131072' },
  })
  fireEvent.change(screen.getByLabelText('API key'), {
    target: { value: 'unsaved-key' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Cancel edits' }))
  expect(screen.getByText('Brain configured')).toBeVisible()
  expect(save).not.toHaveBeenCalled()
  expect(call).not.toHaveBeenCalled()

  fireEvent.click(screen.getByRole('button', { name: 'Edit brain' }))
  expect(screen.getByLabelText('GInfer API URL')).toHaveValue('http://host/v1')
  expect(screen.getByLabelText('Model ID')).toHaveValue(saved.model)
  expect(screen.getByLabelText('Model context tokens')).toHaveValue(262144)
  expect(screen.getByLabelText('API key')).toHaveValue('')
  expect(screen.getByLabelText('API key')).toHaveAttribute(
    'placeholder',
    'Saved in secure storage'
  )
  fireEvent.click(screen.getByRole('button', { name: 'Save brain settings' }))
  await waitFor(() =>
    expect(save).toHaveBeenCalledExactlyOnceWith({
      connection: saved.connection,
      model: saved.model,
      context_tokens: saved.context_tokens,
    })
  )
})

it('cancels key removal and clears a failed edit without changing the saved key', async () => {
  const save = vi.fn().mockRejectedValue(new Error('Vault unavailable'))
  render(<Setup initial={saved} configured={saved} save={save} />)
  fireEvent.click(screen.getByRole('button', { name: 'Edit brain' }))
  fireEvent.click(screen.getByLabelText('Remove saved API key'))
  fireEvent.click(screen.getByRole('button', { name: 'Save brain settings' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Vault unavailable')
  expect(save).toHaveBeenCalledExactlyOnceWith({ ...saved, api_key: '' })

  fireEvent.click(screen.getByRole('button', { name: 'Cancel edits' }))
  fireEvent.click(screen.getByRole('button', { name: 'Edit brain' }))
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  expect(screen.getByLabelText('Remove saved API key')).not.toBeChecked()
  expect(screen.getByLabelText('API key')).toBeEnabled()
  expect(screen.getByLabelText('API key')).toHaveValue('')
  expect(save).toHaveBeenCalledTimes(1)
})

it('saves only once and shows progress until the saved brain is confirmed', async () => {
  const pending = deferred()
  const save = vi.fn().mockReturnValue(pending.promise)
  render(<Setup initial={saved} configured={saved} save={save} />)
  fireEvent.click(screen.getByRole('button', { name: 'Edit brain' }))
  const form = screen.getByRole('form', { name: 'Set up bot brain' })
  act(() => {
    fireEvent.submit(form)
    fireEvent.submit(form)
  })
  expect(save).toHaveBeenCalledExactlyOnceWith(saved)
  expect(
    screen.getByRole('button', { name: 'Saving brain settings…' })
  ).toBeDisabled()
  expect(screen.getByRole('status')).toHaveTextContent('Saving brain settings…')
  expect(screen.getByLabelText('GInfer API URL')).toBeDisabled()
  expect(screen.getByLabelText('Model ID')).toBeDisabled()
  const cancel = screen.getByRole('button', { name: 'Cancel edits' })
  expect(cancel).toBeDisabled()
  fireEvent.click(cancel)
  expect(screen.queryByText('Brain configured')).not.toBeInTheDocument()
  fireEvent.submit(form)
  expect(save).toHaveBeenCalledTimes(1)
  await act(async () => pending.resolve())
  expect(screen.getByText('Brain configured')).toBeVisible()
  expect(screen.queryByRole('status')).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Edit brain' })).toBeEnabled()
})

it('disables the form without claiming to save during another page action', () => {
  const save = vi.fn()
  render(
    <BrainSetup
      value={saved}
      busy
      computerReady
      onChange={vi.fn()}
      onCancel={vi.fn()}
      onSave={save}
    />
  )
  expect(
    screen.getByRole('button', { name: 'Save brain settings' })
  ).toBeDisabled()
  expect(screen.queryByRole('status')).not.toBeInTheDocument()
  fireEvent.submit(screen.getByRole('form', { name: 'Set up bot brain' }))
  expect(save).not.toHaveBeenCalled()
})

const ready = {
  target: { host_id: 'host', instance_id: 'instance', session_id: 'session' },
  host_name: 'Server 2',
  model: 'qwen-smol',
  context_tokens: 262144,
}

it.each(['endpoint', 'paired_host'] as const)(
  'guides an explicit retry after a failed %s brain save without losing entries',
  async (kind) => {
    call.mockResolvedValue([ready])
    const configured: SavedAssignment =
      kind === 'endpoint'
        ? saved
        : {
            ...saved,
            connection: { kind: 'paired_host', target: ready.target },
            model: ready.model,
            credential_ref: null,
          }
    const initial: Assignment = {
      connection: configured.connection,
      model: configured.model,
      context_tokens: configured.context_tokens,
      ...(kind === 'endpoint' ? { api_key: 'draft-key' } : {}),
    }
    const first = deferred()
    const retry = deferred()
    const save = vi
      .fn()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(retry.promise)
    render(<Setup initial={initial} configured={configured} save={save} />)
    fireEvent.click(screen.getByRole('button', { name: 'Edit brain' }))
    const submit = screen.getByRole('button', { name: 'Save brain settings' })
    await waitFor(() => expect(submit).toBeEnabled())
    fireEvent.click(submit)
    await act(async () => first.reject(new Error('vault transport: code 53')))

    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent(/could not confirm.*brain settings.*saved/i)
    expect(alert).toHaveTextContent(/entries are still here/i)
    expect(alert).toHaveTextContent(/choose Save brain settings to try again/i)
    const details = within(alert).getByText('Details').closest('details')!
    expect(details).not.toHaveAttribute('open')
    expect(within(alert).getByText('vault transport: code 53')).not.toBeVisible()
    fireEvent.click(within(alert).getByText('Details'))
    expect(within(alert).getByText('vault transport: code 53')).toBeVisible()
    expect(screen.getByLabelText('Model ID')).toHaveValue(initial.model)
    expect(screen.getByLabelText('Model context tokens')).toHaveValue(262144)
    if (kind === 'endpoint') {
      expect(screen.getByLabelText('GInfer API URL')).toHaveValue('http://host/v1')
      expect(screen.getByLabelText('API key')).toHaveValue('draft-key')
    } else {
      fireEvent.click(screen.getByRole('button', { name: 'Refresh hosts' }))
      await waitFor(() => expect(submit).toBeEnabled())
      expect(screen.getByRole('alert')).toHaveTextContent(
        /choose Save brain settings to try again/i
      )
      expect(
        screen.getByRole('button', { name: 'Ready Host model' })
      ).toHaveTextContent(ready.model)
    }
    expect(save).toHaveBeenCalledExactlyOnceWith(initial)

    fireEvent.click(submit)
    expect(save).toHaveBeenCalledTimes(2)
    expect(save.mock.calls[1]).toEqual(save.mock.calls[0])
    await act(async () => retry.resolve())
    expect(screen.getByText('Brain configured')).toBeVisible()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(call.mock.calls).toEqual(
      kind === 'paired_host'
        ? [['assignments/models'], ['assignments/models']]
        : []
    )
  }
)

it.each(['initial check', 'refresh'])(
  'guides recovery from a failed Host %s without claiming no models are ready',
  async (stage) => {
    const failed = deferred()
    const recovered = deferred()
    if (stage === 'refresh') call.mockResolvedValueOnce([ready])
    call
      .mockReturnValueOnce(failed.promise.then(() => [ready]))
      .mockReturnValueOnce(recovered.promise.then(() => [ready]))
    const save = vi.fn()
    const initial: Assignment = {
      connection: { kind: 'paired_host', target: ready.target },
      model: ready.model,
      context_tokens: ready.context_tokens,
    }
    render(<Setup initial={initial} save={save} />)
    const submit = screen.getByRole('button', { name: 'Save brain settings' })
    const refresh = screen.getByRole('button', { name: 'Refresh hosts' })
    if (stage === 'refresh') {
      await waitFor(() => expect(submit).toBeEnabled())
      fireEvent.click(refresh)
    }
    await act(async () => failed.reject('Host RPC: connection reset'))

    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent(/could not check which Host models are ready/i)
    expect(alert).toHaveTextContent(/choose Refresh hosts to try again/i)
    expect(screen.queryByText(/No ready models/)).not.toBeInTheDocument()
    expect(
      screen.queryByText(/saved session is unavailable/)
    ).not.toBeInTheDocument()
    expect(submit).toBeDisabled()
    expect(refresh).toBeEnabled()
    expect(screen.getByLabelText('Model ID')).toHaveValue(initial.model)
    expect(screen.getByLabelText('Model context tokens')).toHaveValue(262144)
    const details = within(alert).getByText('Details').closest('details')!
    expect(details).not.toHaveAttribute('open')
    expect(within(alert).getByText('Host RPC: connection reset')).not.toBeVisible()
    fireEvent.click(within(alert).getByText('Details'))
    expect(within(alert).getByText('Host RPC: connection reset')).toBeVisible()
    expect(call).toHaveBeenCalledTimes(stage === 'refresh' ? 2 : 1)
    expect(save).not.toHaveBeenCalled()

    fireEvent.click(refresh)
    expect(refresh).toBeDisabled()
    expect(submit).toBeDisabled()
    await act(async () => recovered.resolve())
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(submit).toBeEnabled()
    expect(
      screen.getByRole('button', { name: 'Ready Host model' })
    ).toHaveTextContent(ready.model)
    expect(save).not.toHaveBeenCalled()
    expect(call.mock.calls).toEqual(
      Array.from({ length: stage === 'refresh' ? 3 : 2 }, () => [
        'assignments/models',
      ])
    )
  }
)

it('keeps a failed brain save visible while refreshing ready Hosts', async () => {
  const firstSave = deferred()
  const refresh = deferred()
  const retry = deferred()
  call
    .mockResolvedValueOnce([ready])
    .mockReturnValueOnce(refresh.promise.then(() => [ready]))
  const configured: SavedAssignment = {
    ...saved,
    connection: { kind: 'paired_host', target: ready.target },
    model: ready.model,
    context_tokens: ready.context_tokens,
    credential_ref: null,
  }
  const save = vi
    .fn()
    .mockReturnValueOnce(firstSave.promise)
    .mockReturnValueOnce(retry.promise)
  render(<Setup initial={configured} configured={configured} save={save} />)
  fireEvent.click(screen.getByRole('button', { name: 'Edit brain' }))
  const submit = screen.getByRole('button', { name: 'Save brain settings' })
  await waitFor(() => expect(submit).toBeEnabled())
  fireEvent.click(submit)
  await act(async () => firstSave.reject(new Error('Brain settings not saved')))
  expect(screen.getByRole('alert')).toHaveTextContent('Brain settings not saved')

  const reload = screen.getByRole('button', { name: 'Refresh hosts' })
  fireEvent.click(reload)
  expect(reload).toBeDisabled()
  expect(submit).toBeDisabled()
  expect(screen.getByRole('alert')).toHaveTextContent('Brain settings not saved')
  await act(async () => refresh.resolve())
  expect(reload).toBeEnabled()
  expect(submit).toBeEnabled()
  expect(screen.getByRole('alert')).toHaveTextContent('Brain settings not saved')
  expect(screen.getByRole('button', { name: 'Ready Host model' })).toHaveTextContent(
    ready.model
  )
  expect(screen.getByLabelText('Model ID')).toHaveValue(ready.model)
  expect(screen.getByLabelText('Model context tokens')).toHaveValue(262144)
  expect(screen.queryByText('Brain configured')).not.toBeInTheDocument()
  expect(save).toHaveBeenCalledTimes(1)
  expect(call.mock.calls).toEqual([
    ['assignments/models'],
    ['assignments/models'],
  ])

  fireEvent.click(submit)
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  expect(screen.getByRole('status')).toHaveTextContent('Saving brain settings…')
  expect(save).toHaveBeenCalledTimes(2)
  expect(save.mock.calls[1]).toEqual(save.mock.calls[0])
  await act(async () => retry.resolve())
  expect(screen.getByText('Brain configured')).toBeVisible()
})

it('keeps a failed brain save when Host discovery fails and recovers', async () => {
  const firstSave = deferred()
  const failedRefresh = deferred()
  const recoveredRefresh = deferred()
  const retry = deferred()
  call
    .mockResolvedValueOnce([ready])
    .mockReturnValueOnce(failedRefresh.promise.then(() => [ready]))
    .mockReturnValueOnce(recoveredRefresh.promise.then(() => [ready]))
  const initial: Assignment = {
    connection: { kind: 'paired_host', target: ready.target },
    model: ready.model,
    context_tokens: ready.context_tokens,
  }
  const save = vi
    .fn()
    .mockReturnValueOnce(firstSave.promise)
    .mockReturnValueOnce(retry.promise)
  render(<Setup initial={initial} save={save} />)
  const submit = screen.getByRole('button', { name: 'Save brain settings' })
  await waitFor(() => expect(submit).toBeEnabled())
  fireEvent.click(submit)
  await act(async () => firstSave.reject('Brain settings not saved'))
  expect(screen.getByRole('alert')).toHaveTextContent('Brain settings not saved')

  const reload = screen.getByRole('button', { name: 'Refresh hosts' })
  fireEvent.click(reload)
  await act(async () => failedRefresh.reject('Host discovery unavailable'))
  expect(screen.getAllByRole('alert').map((alert) => alert.textContent)).toEqual([
    expect.stringContaining('Host discovery unavailable'),
    expect.stringContaining('Brain settings not saved'),
  ])
  expect(submit).toBeDisabled()
  expect(screen.getByLabelText('Model ID')).toHaveValue(ready.model)
  expect(screen.getByLabelText('Model context tokens')).toHaveValue(262144)
  expect(save).toHaveBeenCalledExactlyOnceWith(initial)

  fireEvent.click(reload)
  expect(screen.getByRole('alert')).toHaveTextContent('Brain settings not saved')
  await act(async () => recoveredRefresh.resolve())
  expect(screen.getByRole('alert')).toHaveTextContent('Brain settings not saved')
  expect(submit).toBeEnabled()
  expect(save).toHaveBeenCalledTimes(1)
  expect(call.mock.calls).toEqual([
    ['assignments/models'],
    ['assignments/models'],
    ['assignments/models'],
  ])

  fireEvent.click(submit)
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  expect(save).toHaveBeenCalledTimes(2)
  expect(save.mock.calls[1]).toEqual(save.mock.calls[0])
  await act(async () => retry.resolve())
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
})

it('restores the exact saved Host session when connection edits are canceled', async () => {
  call.mockResolvedValue([ready])
  const configured: SavedAssignment = {
    ...saved,
    connection: { kind: 'paired_host', target: ready.target },
    model: ready.model,
    context_tokens: ready.context_tokens,
    credential_ref: null,
  }
  const save = vi.fn().mockResolvedValue(undefined)
  render(<Setup initial={configured} configured={configured} save={save} />)
  fireEvent.click(screen.getByRole('button', { name: 'Edit brain' }))
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Refresh hosts' })).toBeEnabled()
  )
  fireEvent.click(screen.getByLabelText('API endpoint'))
  fireEvent.change(screen.getByLabelText('GInfer API URL'), {
    target: { value: 'http://unsaved-host/v1' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Cancel edits' }))
  expect(save).not.toHaveBeenCalled()

  fireEvent.click(screen.getByRole('button', { name: 'Edit brain' }))
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'Save brain settings' })
    ).toBeEnabled()
  )
  expect(screen.getByLabelText('Paired GInfer Host')).toBeChecked()
  expect(
    screen.getByRole('button', { name: 'Ready Host model' })
  ).toHaveTextContent(ready.model)
  fireEvent.click(screen.getByRole('button', { name: 'Save brain settings' }))
  await waitFor(() =>
    expect(save).toHaveBeenCalledExactlyOnceWith({
      connection: configured.connection,
      model: configured.model,
      context_tokens: configured.context_tokens,
    })
  )
})

it('saves the ready Host session with its served model and context', async () => {
  call.mockResolvedValue([ready])
  const save = vi.fn().mockResolvedValue(undefined)
  const initial: Assignment = {
    connection: { kind: 'paired_host', target: ready.target },
    model: ready.model,
    context_tokens: ready.context_tokens,
  }
  render(
    <Setup
      initial={{
        connection: emptyPairedConnection,
        model: '',
        context_tokens: 0,
      }}
      save={save}
    />
  )
  const picker = screen.getByRole('button', { name: 'Ready Host model' })
  await waitFor(() => expect(picker).toBeEnabled())
  fireEvent.keyDown(picker, { key: 'ArrowDown' })
  fireEvent.click(
    await screen.findByRole('menuitem', { name: /Server 2 · qwen-smol/ })
  )
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'Save brain settings' })
    ).toBeEnabled()
  )
  expect(call).toHaveBeenCalledWith('assignments/models')
  expect(screen.getByLabelText('Model ID')).toHaveAttribute('readonly')
  expect(screen.getByLabelText('Model context tokens')).toHaveValue(262144)
  expect(screen.queryByLabelText('API key')).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Save brain settings' }))
  await waitFor(() => expect(save).toHaveBeenCalledWith(initial))
})
it('keeps an explicitly selected Muse 2-bit mix through refresh and saving', async () => {
  // Muse 2-bit mix: 9d4ca1b204b993e3a5dd9e52c8eda0d804801dd4ded664dd37b81641fcb44a2c.
  const mix = {
    ...ready,
    model: 'muse-glimmer-30b/smol-q2g64-mix-dflash-q4',
  }
  // Muse INT: 46b5d54ee64ccd278f2a1a4d2c6d5aa9fc9097e8db0c3d165179aee5f2cb5b66.
  const int = {
    ...ready,
    target: {
      ...ready.target,
      instance_id: 'integer',
      session_id: 'int-session',
    },
    model: 'muse-glimmer-30b/groupwise-int-dflash-q4',
  }
  call.mockResolvedValueOnce([mix, int]).mockResolvedValueOnce([int, mix])
  const save = vi.fn().mockResolvedValue(undefined)
  const initial: Assignment = {
    connection: { kind: 'paired_host', target: mix.target },
    model: mix.model,
    context_tokens: mix.context_tokens,
  }
  render(<Setup initial={initial} save={save} />)
  expect(
    screen.getByText(
      /For vision and Gbot, prefer Muse INT if it fits your GPU, or Qwen/
    )
  ).toHaveTextContent('Use at least 128K context.')
  const picker = screen.getByRole('button', { name: 'Ready Host model' })
  const refresh = screen.getByRole('button', { name: 'Refresh hosts' })
  await waitFor(() => expect(refresh).toBeEnabled())
  expect(picker).toHaveTextContent(mix.model)
  fireEvent.click(refresh)
  await waitFor(() => expect(call).toHaveBeenCalledTimes(2))
  await waitFor(() => expect(refresh).toBeEnabled())
  expect(picker).toHaveTextContent(mix.model)
  expect(screen.getByLabelText('Model ID')).toHaveValue(mix.model)
  expect(screen.getByLabelText('Model context tokens')).toHaveValue(262144)
  fireEvent.click(screen.getByRole('button', { name: 'Save brain settings' }))
  await waitFor(() => expect(save).toHaveBeenCalledWith(initial))
})
it('refuses a restarted Host session and keeps an empty selection incomplete', async () => {
  call.mockResolvedValue([
    { ...ready, target: { ...ready.target, session_id: 'new-session' } },
  ])
  const save = vi.fn()
  render(
    <Setup
      initial={{
        connection: { kind: 'paired_host', target: ready.target },
        model: ready.model,
        context_tokens: ready.context_tokens,
      }}
      save={save}
    />
  )
  expect(await screen.findByRole('status')).toHaveTextContent(
    'saved session is unavailable'
  )
  expect(
    screen.getByRole('button', { name: 'Save brain settings' })
  ).toBeDisabled()
  expect(save).not.toHaveBeenCalled()
  cleanup()
  render(
    <Setup
      initial={{
        connection: emptyPairedConnection,
        model: '',
        context_tokens: 0,
      }}
      save={save}
    />
  )
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Refresh hosts' })).toBeEnabled()
  )
  expect(
    screen.getByRole('button', { name: 'Save brain settings' })
  ).toBeDisabled()
})

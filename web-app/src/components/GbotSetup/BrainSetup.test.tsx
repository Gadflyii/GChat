import { useState } from 'react'
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
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
}: {
  initial?: Assignment
  configured?: SavedAssignment
  save: (value: Assignment) => Promise<void>
}) {
  const [value, setValue] = useState(initial)
  return (
    <BrainSetup
      value={value}
      saved={configured}
      computerReady
      busy={false}
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
  render(<Setup save={save} />)
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

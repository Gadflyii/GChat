import { useState } from 'react'
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { Assignment, SavedAssignment } from '@/services/gbot'
import { BrainSetup } from './BrainSetup'

afterEach(cleanup)

const saved: SavedAssignment = {
  workspace_id: 'one',
  api_base: 'http://host/v1',
  model: 'qwen',
  context_tokens: 262144,
  credential_ref: 'vault-key',
}

function Setup({
  initial = { api_base: '', model: '', context_tokens: 0 },
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
      onSave={() => save(value)}
    />
  )
}

it('offers the next setup step and saves only a complete model assignment', async () => {
  const save = vi.fn().mockResolvedValue(undefined)
  render(<Setup save={save} />)
  expect(screen.getByRole('form', { name: 'Set up bot brain' })).toBeVisible()
  expect(screen.getByText('Next: choose a brain')).toBeVisible()
  const submit = screen.getByRole('button', { name: 'Save brain settings' })
  expect(submit).toBeDisabled()
  fireEvent.change(screen.getByLabelText('GInfer API URL'), {
    target: { value: saved.api_base },
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
      api_base: saved.api_base,
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
    'Saved in vault'
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
  const save = vi
    .fn()
    .mockRejectedValueOnce(new Error('Vault unavailable'))
    .mockResolvedValue(undefined)
  render(<Setup initial={{ ...saved, api_key: 'private-key' }} save={save} />)
  fireEvent.click(screen.getByRole('button', { name: 'Save brain settings' }))
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Vault unavailable'
  )
  expect(screen.getByLabelText('API key')).toHaveValue('private-key')
  expect(screen.queryByText('Brain configured')).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Save brain settings' }))
  await waitFor(() => expect(save).toHaveBeenCalledTimes(2))
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
})

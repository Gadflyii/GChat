import { afterEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import GbotLanBot from './GbotLanBot'
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

it('disables removal with a visible reason while connected', () => {
  mount(true)
  const remove = screen.getByRole('button', { name: 'Remove bot' })
  expect(remove).toBeDisabled()
  expect(remove).toHaveAccessibleDescription(/Disconnect this bot before removing it/)
})

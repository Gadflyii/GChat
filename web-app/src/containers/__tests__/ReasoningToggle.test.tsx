import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest'
import ReasoningToggle from '../ReasoningToggle'
import { useGeneralSetting } from '@/hooks/useGeneralSetting'

beforeAll(() => {
  vi.stubGlobal('ResizeObserver', class {
    observe = vi.fn()
    unobserve = vi.fn()
    disconnect = vi.fn()
  })
})
afterAll(() => vi.unstubAllGlobals())
afterEach(cleanup)

it('selects effort and restores high when reasoning is re-enabled after Off', async () => {
  const user = userEvent.setup()
  useGeneralSetting.setState({ disableReasoning: false, reasoningBudget: 'high' })
  render(<ReasoningToggle />)
  const trigger = screen.getByRole('button', { name: 'Reasoning effort' })
  expect(trigger).toHaveTextContent('High')
  await user.click(trigger)
  expect(screen.getAllByRole('menuitemradio').map((item) => item.textContent)).toEqual([
    'Off', 'Low', 'Medium', 'High', 'Extra high', 'Model default',
  ])
  expect(screen.getByRole('menuitemradio', { name: 'High' })).toHaveAttribute('aria-checked', 'true')
  await user.click(screen.getByRole('menuitemradio', { name: 'Extra high' }))
  expect(useGeneralSetting.getState().reasoningBudget).toBe('xhigh')
  expect(trigger).toHaveTextContent('Extra high')
  await user.click(trigger)
  await user.click(screen.getByRole('menuitemradio', { name: 'Off' }))
  expect(useGeneralSetting.getState().disableReasoning).toBe(true)
  expect(useGeneralSetting.getState().reasoningBudget).toBe('off')
  expect(trigger).toHaveTextContent('Off')
  await user.click(screen.getByRole('button', { pressed: false }))
  expect(trigger).toHaveTextContent('High')
  expect(useGeneralSetting.getState().reasoningBudget).toBe('high')
  expect(useGeneralSetting.getState().disableReasoning).toBe(false)
})

it('supports keyboard selection and returns focus without changing effort on Escape', async () => {
  const user = userEvent.setup()
  useGeneralSetting.setState({ disableReasoning: false, reasoningBudget: 'high' })
  render(<ReasoningToggle />)
  const trigger = screen.getByRole('button', { name: 'Reasoning effort' })
  trigger.focus()
  await user.keyboard('{ArrowDown}')
  await waitFor(() => expect(screen.getByRole('menuitemradio', { name: 'Off' })).toHaveFocus())
  await user.keyboard('{End}{Enter}')
  expect(useGeneralSetting.getState().reasoningBudget).toBe('unlimited')
  expect(trigger).toHaveTextContent('Model default')
  await waitFor(() => expect(trigger).toHaveFocus())
  await user.keyboard('{ArrowDown}{Escape}')
  await waitFor(() => expect(trigger).toHaveFocus())
  expect(screen.queryByRole('menuitemradio')).not.toBeInTheDocument()
  expect(useGeneralSetting.getState().reasoningBudget).toBe('unlimited')
})

it('shows Off while disabled and selecting a level enables the same saved setting', async () => {
  const user = userEvent.setup()
  useGeneralSetting.setState({ disableReasoning: true, reasoningBudget: 'xhigh' })
  render(<ReasoningToggle />)
  const trigger = screen.getByRole('button', { name: 'Reasoning effort' })
  expect(trigger).toHaveTextContent('Off')
  expect(useGeneralSetting.getState().reasoningBudget).toBe('xhigh')
  await user.click(trigger)
  expect(screen.getByRole('menuitemradio', { name: 'Off' })).toHaveAttribute('aria-checked', 'true')
  await user.click(screen.getByRole('menuitemradio', { name: 'Low' }))
  expect(useGeneralSetting.getState().reasoningBudget).toBe('low')
  expect(useGeneralSetting.getState().disableReasoning).toBe(false)
  expect(trigger).toHaveTextContent('Low')
})

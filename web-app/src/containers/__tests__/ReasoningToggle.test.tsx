import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import ReasoningToggle from '../ReasoningToggle'
import { useGeneralSetting } from '@/hooks/useGeneralSetting'

afterEach(cleanup)

it('selects effort and restores high when reasoning is re-enabled after Off', () => {
  useGeneralSetting.setState({ disableReasoning: false, reasoningBudget: 'high' })
  render(<ReasoningToggle />)
  const select = screen.getByRole('combobox', { name: 'Reasoning effort' })
  expect(select).toHaveValue('high')
  fireEvent.change(select, { target: { value: 'xhigh' } })
  expect(useGeneralSetting.getState().reasoningBudget).toBe('xhigh')
  fireEvent.change(select, { target: { value: 'off' } })
  expect(useGeneralSetting.getState().disableReasoning).toBe(true)
  fireEvent.click(screen.getByRole('button'))
  expect(select).toHaveValue('high')
  expect(useGeneralSetting.getState().disableReasoning).toBe(false)
})

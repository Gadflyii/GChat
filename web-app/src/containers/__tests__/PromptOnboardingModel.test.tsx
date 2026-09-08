import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PromptOnboardingModel } from '../PromptOnboardingModel'
const mocks = vi.hoisted(() => ({ navigate: vi.fn(), pending: true, setPending: vi.fn((value: boolean) => { mocks.pending = value }) }))
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => mocks.navigate }))
vi.mock('@/hooks/useOnboardingModelReminder', () => ({ useOnboardingModelReminder: () => ({ setPending: mocks.setPending }) }))
describe('model reminder', () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.pending = true })
  it('opens the shared model manager without downloading an assumed package', () => {
    render(<PromptOnboardingModel />)
    expect(mocks.navigate).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Open Models' }))
    expect(mocks.navigate).toHaveBeenCalledWith({ to: '/hub/' })
    expect(mocks.setPending).toHaveBeenCalledWith(false)
    expect(mocks.pending).toBe(false)
  })
  it('dismisses without navigation', () => {
    render(<PromptOnboardingModel />)
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(mocks.setPending).toHaveBeenCalledWith(false)
    expect(mocks.navigate).not.toHaveBeenCalled()
    expect(mocks.pending).toBe(false)
  })
})

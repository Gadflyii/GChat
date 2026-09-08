import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import SetupScreen from '../SetupScreen'
import { localStorageKey } from '@/constants/localStorage'
const mocks = vi.hoisted(() => ({ navigate: vi.fn(), setLeftPanel: vi.fn(), setPending: vi.fn() }))
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => mocks.navigate }))
vi.mock('@/containers/HeaderPage', () => ({ default: () => <header /> }))
vi.mock('@/containers/EngineIntake', () => ({ EngineIntake: ({ onConnect }: { onConnect: () => void }) => <button onClick={onConnect}>Connect a network host</button> }))
vi.mock('@/hooks/useLeftPanel', () => ({ useLeftPanel: { getState: () => ({ setLeftPanel: mocks.setLeftPanel }) } }))
vi.mock('@/hooks/useOnboardingModelReminder', () => ({ useOnboardingModelReminderStore: { getState: () => ({ setPending: mocks.setPending }) } }))
describe('model intake', () => {
  beforeEach(() => { vi.clearAllMocks(); localStorage.clear() })
  it('offers one hardware-aware model path without starting downloads', () => {
    render(<SetupScreen />)
    expect(screen.getByText('Welcome to GChat')).toBeInTheDocument()
    expect(mocks.navigate).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Choose a model' }))
    expect(mocks.navigate).toHaveBeenCalledWith({ to: '/hub/', replace: true })
    expect(localStorage.getItem(localStorageKey.setupCompleted)).toBe('true')
    expect(mocks.setPending).toHaveBeenCalledWith(false)
  })
  it('opens LAN pairing independently of local GPU availability', () => {
    render(<SetupScreen />)
    fireEvent.click(screen.getByRole('button', { name: 'Connect a network host' }))
    expect(mocks.navigate).toHaveBeenCalledWith({ to: '/engines/', replace: true })
    expect(localStorage.getItem(localStorageKey.setupCompleted)).toBe('true')
  })
  it('allows an explicit exit without an automatic timeout or model load', () => {
    const skipped = vi.fn()
    render(<SetupScreen onSkipped={skipped} />)
    expect(skipped).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Continue without loading a model' }))
    expect(skipped).toHaveBeenCalledOnce()
    expect(localStorage.getItem(localStorageKey.setupCompleted)).toBe('true')
    expect(mocks.setLeftPanel).toHaveBeenCalledWith(true)
  })
})

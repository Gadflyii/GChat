import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import SetupScreen from '../SetupScreen'
import { localStorageKey } from '@/constants/localStorage'
import { useGeneralSetting } from '@/hooks/useGeneralSetting'
const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  setLeftPanel: vi.fn(),
  setPending: vi.fn(),
}))
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => mocks.navigate }))
vi.mock('@/containers/HeaderPage', () => ({ default: () => <header /> }))
vi.mock('@/containers/CredentialSetup', () => ({
  CredentialSetup: () => (
    <section aria-label="Secure storage setup">
      Protect your connections
    </section>
  ),
}))
vi.mock('../EngineFirstRun', () => ({
  EngineFirstRun: ({ onComplete }: { onComplete: () => void }) => (
    <button onClick={onComplete}>Finish shared local setup</button>
  ),
}))
vi.mock('@/containers/EngineIntake', () => ({
  EngineIntake: ({ onConnect }: { onConnect: () => void }) => (
    <button onClick={onConnect}>Connect a network host</button>
  ),
}))
vi.mock('@/hooks/useLeftPanel', () => ({
  useLeftPanel: { getState: () => ({ setLeftPanel: mocks.setLeftPanel }) },
}))
vi.mock('@/hooks/useOnboardingModelReminder', () => ({
  useOnboardingModelReminderStore: {
    getState: () => ({ setPending: mocks.setPending }),
  },
}))
describe('model intake', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    useGeneralSetting.setState({ gbotEnabled: false })
  })
  it('offers one hardware-aware model path without starting downloads', () => {
    render(<SetupScreen />)
    expect(screen.getByText('Welcome to GChat')).toBeInTheDocument()
    expect(
      screen.getByRole('region', { name: 'Secure storage setup' })
    ).toBeInTheDocument()
    expect(mocks.navigate).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Choose a model' }))
    expect(mocks.navigate).toHaveBeenCalledWith({ to: '/hub/', replace: true })
    expect(localStorage.getItem(localStorageKey.setupCompleted)).toBe('true')
    expect(mocks.setPending).toHaveBeenCalledWith(false)
    expect(useGeneralSetting.getState().gbotEnabled).toBe(false)
  })
  it('opens LAN pairing independently of local GPU availability', () => {
    render(<SetupScreen />)
    fireEvent.click(
      screen.getByRole('button', { name: 'Connect a network host' })
    )
    expect(mocks.navigate).toHaveBeenCalledWith({
      to: '/engines/',
      replace: true,
    })
    expect(localStorage.getItem(localStorageKey.setupCompleted)).toBe('true')
    expect(useGeneralSetting.getState().gbotEnabled).toBe(false)
  })
  it('finishes onboarding when the shared local setup is approved', () => {
    render(<SetupScreen />)
    fireEvent.click(
      screen.getByRole('button', { name: 'Finish shared local setup' })
    )
    expect(mocks.navigate).toHaveBeenCalledWith({
      to: '/engines/',
      replace: true,
    })
    expect(localStorage.getItem(localStorageKey.setupCompleted)).toBe('true')
  })
  it('allows an explicit exit without an automatic timeout or model load', () => {
    const skipped = vi.fn()
    render(<SetupScreen onSkipped={skipped} />)
    expect(skipped).not.toHaveBeenCalled()
    fireEvent.click(
      screen.getByRole('button', { name: 'Continue without loading a model' })
    )
    expect(skipped).toHaveBeenCalledOnce()
    expect(localStorage.getItem(localStorageKey.setupCompleted)).toBe('true')
    expect(mocks.setLeftPanel).toHaveBeenCalledWith(true)
    expect(useGeneralSetting.getState().gbotEnabled).toBe(false)
  })
  it('persists explicit Gbot opt-in and opens its guided setup', () => {
    const skipped = vi.fn()
    render(<SetupScreen onSkipped={skipped} />)
    expect(useGeneralSetting.getState().gbotEnabled).toBe(false)
    expect(mocks.navigate).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Enable Gbot' }))
    expect(useGeneralSetting.getState().gbotEnabled).toBe(true)
    expect(
      JSON.parse(localStorage.getItem(localStorageKey.settingGeneral)!)
    ).toMatchObject({ state: { gbotEnabled: true } })
    expect(mocks.navigate).toHaveBeenCalledWith({ to: '/gbot/', replace: true })
    expect(localStorage.getItem(localStorageKey.setupCompleted)).toBe('true')
    expect(mocks.setPending).toHaveBeenCalledWith(false)
    expect(skipped).not.toHaveBeenCalled()
  })
  it('continues setup when Gbot was already enabled', () => {
    useGeneralSetting.setState({ gbotEnabled: true })
    render(<SetupScreen />)
    fireEvent.click(screen.getByRole('button', { name: 'Continue Gbot setup' }))
    expect(mocks.navigate).toHaveBeenCalledWith({ to: '/gbot/', replace: true })
    expect(useGeneralSetting.getState().gbotEnabled).toBe(true)
  })
})

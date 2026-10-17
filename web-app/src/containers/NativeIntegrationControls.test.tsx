import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { NativeIntegrationControls } from './NativeIntegrationControls'
import { localStorageKey } from '@/constants/localStorage'
import { route } from '@/constants/routes'
import { useGeneralSetting } from '@/hooks/useGeneralSetting'
import { useCodeTerminalStore } from '@/stores/code-terminal-store'
import { useHermesAgentStore } from '@/stores/hermes-agent-store'

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  stopTerminal: vi.fn(() => Promise.resolve()),
}))

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => mocks.navigate,
  Link: ({
    children,
    to,
    className,
  }: {
    children: ReactNode
    to: string
    className?: string
  }) => <a href={to} className={className}>{children}</a>,
}))

vi.mock('@/services/terminal/tauri', () => ({
  stopTerminal: mocks.stopTerminal,
}))

describe('NativeIntegrationControls', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    useGeneralSetting.setState({ gbotEnabled: false })
    useCodeTerminalStore.setState({ enabled: false })
    useHermesAgentStore.setState({ enabled: false })
  })

  it('labels each switch with a visible action and explains its purpose and off behavior', () => {
    render(<NativeIntegrationControls />)

    for (const name of ['Gbot', 'OpenCode', 'Hermes']) {
      const control = screen.getByRole('switch', { name: `${name} integration` })
      expect(screen.getByText(`Enable ${name}`)).toBeVisible()
      expect(screen.getByLabelText(`Enable ${name}`)).toBe(control)
    }

    const gbot = screen.getByRole('switch', { name: 'Gbot integration' })
    expect(screen.getByText(/A persistent assistant/i)).toBeVisible()
    expect(gbot).toHaveAccessibleDescription(/persistent assistant.*computer workspace/i)
    expect(gbot).toHaveAccessibleDescription(/turning on opens Gbot/i)
    expect(gbot).toHaveAccessibleDescription(/disables sign-in startup/i)
    expect(gbot).toHaveAccessibleDescription(/running work continues/i)

    const code = screen.getByRole('switch', { name: 'OpenCode integration' })
    expect(screen.getByText(/A coding assistant/i)).toBeVisible()
    expect(code).toHaveAccessibleDescription(/coding assistant.*Code tab/i)
    expect(code).toHaveAccessibleDescription(/installing it if needed/i)
    expect(code).toHaveAccessibleDescription(/turning off hides Code/i)
    expect(code).toHaveAccessibleDescription(/use Stop in Code first/i)

    const hermes = screen.getByRole('switch', { name: 'Hermes integration' })
    expect(screen.getByText(/An assistant in GChat/i)).toBeVisible()
    expect(hermes).toHaveAccessibleDescription(/assistant.*built-in terminal/i)
    expect(hermes).toHaveAccessibleDescription(/installing it if needed/i)
    expect(hermes).toHaveAccessibleDescription(/turning off stops its terminal/i)
    expect(hermes).toHaveAccessibleDescription(/saved settings remain/i)
    expect(screen.getByRole('link', { name: /Hermes settings/i })).toHaveAttribute(
      'href',
      route.settings.hermes_agent
    )
  })

  it('shows saved integration choices without changing them or stopping terminals', () => {
    useCodeTerminalStore.setState({ enabled: true })
    useHermesAgentStore.setState({ enabled: true })
    render(<NativeIntegrationControls />)

    expect(screen.getByRole('switch', { name: 'Gbot integration' })).not.toBeChecked()
    expect(screen.getByRole('switch', { name: 'OpenCode integration' })).toBeChecked()
    expect(screen.getByRole('switch', { name: 'Hermes integration' })).toBeChecked()
    expect(useGeneralSetting.getState().gbotEnabled).toBe(false)
    expect(useCodeTerminalStore.getState().enabled).toBe(true)
    expect(useHermesAgentStore.getState().enabled).toBe(true)
    expect(mocks.navigate).not.toHaveBeenCalled()
    expect(mocks.stopTerminal).not.toHaveBeenCalled()
  })

  it('persists Gbot choices and opens its setup only when enabling it', async () => {
    const user = userEvent.setup()
    render(<NativeIntegrationControls />)
    const control = screen.getByRole('switch', { name: 'Gbot integration' })

    await user.click(control)

    expect(control).toBeChecked()
    expect(useGeneralSetting.getState().gbotEnabled).toBe(true)
    expect(JSON.parse(localStorage.getItem(localStorageKey.settingGeneral)!))
      .toMatchObject({ state: { gbotEnabled: true } })
    expect(mocks.navigate).toHaveBeenCalledExactlyOnceWith({ to: route.gbot.index })

    await user.click(control)

    expect(control).not.toBeChecked()
    expect(useGeneralSetting.getState().gbotEnabled).toBe(false)
    expect(JSON.parse(localStorage.getItem(localStorageKey.settingGeneral)!))
      .toMatchObject({ state: { gbotEnabled: false } })
    expect(mocks.navigate).toHaveBeenCalledOnce()
    expect(mocks.stopTerminal).not.toHaveBeenCalled()
  })

  it.each([
    {
      name: 'OpenCode',
      terminalId: 'code',
      store: useCodeTerminalStore,
      storageKey: localStorageKey.codeTerminal,
    },
    {
      name: 'Hermes',
      terminalId: 'hermes',
      store: useHermesAgentStore,
      storageKey: localStorageKey.hermesAgent,
    },
  ])('persists $name choices and stops its terminal only when disabling it', async ({
    name,
    terminalId,
    store,
    storageKey,
  }) => {
    const user = userEvent.setup()
    render(<NativeIntegrationControls />)
    const control = screen.getByRole('switch', { name: `${name} integration` })

    await user.click(control)

    expect(control).toBeChecked()
    expect(store.getState().enabled).toBe(true)
    expect(JSON.parse(localStorage.getItem(storageKey)!))
      .toMatchObject({ state: { enabled: true } })
    expect(mocks.stopTerminal).not.toHaveBeenCalled()

    await user.click(control)

    expect(control).not.toBeChecked()
    expect(store.getState().enabled).toBe(false)
    expect(JSON.parse(localStorage.getItem(storageKey)!))
      .toMatchObject({ state: { enabled: false } })
    expect(mocks.stopTerminal).toHaveBeenCalledExactlyOnceWith(terminalId)
    expect(mocks.navigate).not.toHaveBeenCalled()
  })
})

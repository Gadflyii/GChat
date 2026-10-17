import { act, render, screen, waitFor } from '@testing-library/react'
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
  stopCodeTerminals: vi.fn<() => Promise<void>>(),
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
  stopCodeTerminals: mocks.stopCodeTerminals,
}))

describe.each([false, true])('NativeIntegrationControls compact=%s', compact => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.stopCodeTerminals.mockReset().mockResolvedValue(undefined)
    localStorage.clear()
    useGeneralSetting.setState({ gbotEnabled: false })
    useCodeTerminalStore.setState({ enabled: false, disabling: false, workspace: undefined, selectedThreadId: undefined })
    useHermesAgentStore.setState({ enabled: false })
  })

  it('labels each switch with a visible action and explains its purpose and off behavior', () => {
    render(<NativeIntegrationControls compact={compact} />)

    if (compact) {
      act(() => screen.getByRole('button', { name: 'Show help' }).click())
    }

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
    expect(code).toHaveAccessibleDescription(/turning off stops all running Code workspaces and hides Code/i)
    expect(code).toHaveAccessibleDescription(/saved settings remain/i)

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
    render(<NativeIntegrationControls compact={compact} />)

    expect(screen.getByRole('switch', { name: 'Gbot integration' })).not.toBeChecked()
    expect(screen.getByRole('switch', { name: 'OpenCode integration' })).toBeChecked()
    expect(screen.getByRole('switch', { name: 'Hermes integration' })).toBeChecked()
    expect(useGeneralSetting.getState().gbotEnabled).toBe(false)
    expect(useCodeTerminalStore.getState().enabled).toBe(true)
    expect(useHermesAgentStore.getState().enabled).toBe(true)
    expect(mocks.navigate).not.toHaveBeenCalled()
    expect(mocks.stopTerminal).not.toHaveBeenCalled()
    expect(mocks.stopCodeTerminals).not.toHaveBeenCalled()
  })

  it('persists Gbot choices and opens its setup only when enabling it', async () => {
    const user = userEvent.setup()
    render(<NativeIntegrationControls compact={compact} />)
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

  it('enables OpenCode without stopping work or changing navigation', async () => {
    const user = userEvent.setup()
    render(<NativeIntegrationControls compact={compact} />)
    const control = screen.getByRole('switch', { name: 'OpenCode integration' })

    await user.click(control)

    expect(control).toBeChecked()
    expect(useCodeTerminalStore.getState().enabled).toBe(true)
    expect(useCodeTerminalStore.getState().disabling).toBe(false)
    expect(JSON.parse(localStorage.getItem(localStorageKey.codeTerminal)!))
      .toMatchObject({ state: { enabled: true } })
    expect(JSON.parse(localStorage.getItem(localStorageKey.codeTerminal)!).state)
      .not.toHaveProperty('disabling')
    expect(mocks.stopCodeTerminals).not.toHaveBeenCalled()
    expect(mocks.stopTerminal).not.toHaveBeenCalled()
    expect(mocks.navigate).not.toHaveBeenCalled()
  })

  it('keeps Code enabled while all workspace stops are pending, then persists off', async () => {
    let finishStop!: () => void
    mocks.stopCodeTerminals.mockReturnValue(new Promise<void>(resolve => {
      finishStop = resolve
    }))
    useCodeTerminalStore.setState({ enabled: true, workspace: '/saved/workspace', selectedThreadId: 'saved-thread' })
    useHermesAgentStore.setState({ enabled: true })
    const user = userEvent.setup()
    render(<NativeIntegrationControls compact={compact} />)
    const control = screen.getByRole('switch', { name: 'OpenCode integration' })

    await user.click(control)

    expect(mocks.stopCodeTerminals).toHaveBeenCalledExactlyOnceWith()
    expect(control).toBeChecked()
    expect(control).toBeDisabled()
    expect(control).toHaveAttribute('aria-busy', 'true')
    expect(screen.getByRole('status')).toHaveTextContent('Stopping all Code workspaces')
    expect(useCodeTerminalStore.getState().enabled).toBe(true)
    expect(useCodeTerminalStore.getState().disabling).toBe(true)
    expect(JSON.parse(localStorage.getItem(localStorageKey.codeTerminal)!))
      .toMatchObject({ state: { enabled: true } })
    expect(JSON.parse(localStorage.getItem(localStorageKey.codeTerminal)!).state)
      .not.toHaveProperty('disabling')

    await user.click(control)
    expect(mocks.stopCodeTerminals).toHaveBeenCalledOnce()

    await act(async () => finishStop())

    expect(control).not.toBeChecked()
    expect(control).toBeEnabled()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(useCodeTerminalStore.getState()).toMatchObject({
      enabled: false,
      disabling: false,
      workspace: '/saved/workspace',
      selectedThreadId: 'saved-thread',
    })
    expect(JSON.parse(localStorage.getItem(localStorageKey.codeTerminal)!))
      .toMatchObject({ state: { enabled: false, workspace: '/saved/workspace', selectedThreadId: 'saved-thread' } })
    expect(useHermesAgentStore.getState().enabled).toBe(true)
    expect(mocks.stopTerminal).not.toHaveBeenCalled()
    expect(mocks.navigate).not.toHaveBeenCalled()
  })

  it('retains enabled Code and shows an actionable stop failure, then permits retry', async () => {
    mocks.stopCodeTerminals.mockRejectedValueOnce(new Error('workspace shutdown failed'))
    useCodeTerminalStore.setState({ enabled: true })
    const user = userEvent.setup()
    render(<NativeIntegrationControls compact={compact} />)
    const control = screen.getByRole('switch', { name: 'OpenCode integration' })

    await user.click(control)

    expect(await screen.findByRole('alert')).toHaveTextContent('workspace shutdown failed')
    expect(screen.getByRole('alert')).toHaveTextContent('OpenCode is still enabled. Try turning it off again.')
    expect(control).toHaveAccessibleDescription(/workspace shutdown failed/)
    expect(control).toBeChecked()
    expect(control).toBeEnabled()
    expect(useCodeTerminalStore.getState().enabled).toBe(true)
    expect(useCodeTerminalStore.getState().disabling).toBe(false)
    expect(JSON.parse(localStorage.getItem(localStorageKey.codeTerminal)!))
      .toMatchObject({ state: { enabled: true } })

    await user.click(control)

    await waitFor(() => expect(control).not.toBeChecked())
    expect(mocks.stopCodeTerminals).toHaveBeenCalledTimes(2)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(useCodeTerminalStore.getState().enabled).toBe(false)
    expect(mocks.stopTerminal).not.toHaveBeenCalled()
  })

  it('persists Hermes choices and stops only its terminal when disabling it', async () => {
    const user = userEvent.setup()
    render(<NativeIntegrationControls compact={compact} />)
    const control = screen.getByRole('switch', { name: 'Hermes integration' })

    await user.click(control)

    expect(control).toBeChecked()
    expect(useHermesAgentStore.getState().enabled).toBe(true)
    expect(JSON.parse(localStorage.getItem(localStorageKey.hermesAgent)!))
      .toMatchObject({ state: { enabled: true } })
    expect(mocks.stopTerminal).not.toHaveBeenCalled()

    await user.click(control)

    expect(control).not.toBeChecked()
    expect(useHermesAgentStore.getState().enabled).toBe(false)
    expect(JSON.parse(localStorage.getItem(localStorageKey.hermesAgent)!))
      .toMatchObject({ state: { enabled: false } })
    expect(mocks.stopTerminal).toHaveBeenCalledExactlyOnceWith('hermes')
    expect(mocks.stopCodeTerminals).not.toHaveBeenCalled()
    expect(mocks.navigate).not.toHaveBeenCalled()
  })
})

describe('Settings sidebar tool help', () => {
  it('keeps the Hermes settings link on its own line and keyboard reachable with help hidden', async () => {
    const user = userEvent.setup()
    render(<NativeIntegrationControls compact />)
    const settings = screen.getByRole('link', { name: 'Hermes settings' })
    const hermes = screen.getByRole('switch', { name: 'Hermes integration' })

    expect(screen.getByText(/An assistant in GChat/i)).not.toBeVisible()
    expect(settings).toBeVisible()
    expect(settings).toHaveClass('block')
    expect(settings).toHaveAttribute('href', route.settings.hermes_agent)

    hermes.focus()
    await user.tab({ shift: true })
    expect(settings).toHaveFocus()
    await user.tab()
    expect(hermes).toHaveFocus()
  })

  it('keeps switches and the settings link available while descriptions open and close', async () => {
    const user = userEvent.setup()
    render(<NativeIntegrationControls compact />)
    const help = screen.getByRole('button', { name: 'Show help' })
    const description = screen.getByText(/A persistent assistant/i)

    expect(help).toHaveAttribute('aria-expanded', 'false')
    expect(description).not.toBeVisible()
    expect(screen.getByRole('link', { name: 'Hermes settings' })).toBeVisible()
    expect(screen.getAllByRole('switch')).toHaveLength(3)
    expect(screen.getByRole('switch', { name: 'Gbot integration' }))
      .toHaveAccessibleDescription(/running work continues/)

    help.focus()
    await user.keyboard('{Enter}')
    expect(help).toHaveAccessibleName('Hide help')
    expect(help).toHaveAttribute('aria-expanded', 'true')
    expect(description).toBeVisible()

    await user.keyboard(' ')
    expect(help).toHaveAccessibleName('Show help')
    expect(description).not.toBeVisible()
  })
})

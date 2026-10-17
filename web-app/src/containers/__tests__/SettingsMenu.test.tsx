import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import userEvent from '@testing-library/user-event'
import SettingsMenu from '../SettingsMenu'
import { useNavigate, useMatches } from '@tanstack/react-router'
import { useModelProvider } from '@/hooks/useModelProvider'

const integrationMocks = vi.hoisted(() => ({
  setOpenCodeEnabled: vi.fn(),
  setOpenCodeDisabling: vi.fn(),
  setHermesEnabled: vi.fn(),
  stopTerminal: vi.fn(() => Promise.resolve()),
  stopCodeTerminals: vi.fn(() => Promise.resolve()),
  gbotEnabled: false,
  setGbotEnabled: vi.fn(),
}))

// Mock global platform constants - simulate desktop (Tauri) environment
Object.defineProperty(global, 'IS_IOS', { value: false, writable: true })
Object.defineProperty(global, 'IS_ANDROID', { value: false, writable: true })
Object.defineProperty(global, 'IS_WEB_APP', { value: false, writable: true })

// Mock dependencies
vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, to, params, search, className }: any) => {
    const pathname = to.replace(
      /\$([^/]+)/g,
      (_match: string, key: string) => encodeURIComponent(params[key])
    )
    const query = search ? new URLSearchParams(search).toString() : ''
    return (
      <a href={`${pathname}${query ? `?${query}` : ''}`} className={className}>
        {children}
      </a>
    )
  },
  useMatches: vi.fn(),
  useNavigate: vi.fn(),
}))

vi.mock('@/i18n/react-i18next-compat', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}))

vi.mock('@/hooks/useGeneralSetting', () => ({
  useGeneralSetting: (selector: (state: unknown) => unknown) =>
    selector({ gbotEnabled: integrationMocks.gbotEnabled, setGbotEnabled: integrationMocks.setGbotEnabled }),
}))

vi.mock('@/hooks/useModelProvider', () => ({
  useModelProvider: vi.fn(() => ({
    providers: [
      {
        provider: 'openai',
        active: true,
        models: [],
      },
      {
        provider: 'ginfer',
        active: true,
        models: [],
      },
    ],
    addProvider: vi.fn(),
  })),
}))

vi.mock('@/stores/code-terminal-store', () => ({
  useCodeTerminalStore: Object.assign(
    (selector: (state: unknown) => unknown) => selector({
      enabled: true,
      disabling: false,
      setEnabled: integrationMocks.setOpenCodeEnabled,
      setDisabling: integrationMocks.setOpenCodeDisabling,
    }),
    { getState: () => ({ disabling: false }) }
  ),
}))

vi.mock('@/stores/hermes-agent-store', () => ({
  useHermesAgentStore: (selector: (state: unknown) => unknown) =>
    selector({ enabled: true, setEnabled: integrationMocks.setHermesEnabled }),
}))

vi.mock('@/services/terminal/tauri', () => ({
  stopTerminal: integrationMocks.stopTerminal,
  stopCodeTerminals: integrationMocks.stopCodeTerminals,
}))

vi.mock('@/containers/dialogs', () => ({
  AddProviderDialog: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
}))

vi.mock('@/lib/utils', () => ({
  cn: (...args: any[]) => args.filter(Boolean).join(' '),
  getProviderTitle: (provider: string) => provider,
  LOCAL_GINFER_PROVIDER: 'ginfer',
}))

vi.mock('@/containers/ProvidersAvatar', () => ({
  default: ({ provider }: { provider: any }) => (
    <div data-testid={`provider-avatar-${provider.provider}`}>
      {provider.provider}
    </div>
  ),
}))

describe('SettingsMenu', () => {
  const mockNavigate = vi.fn()
  const mockMatches = [
    {
      routeId: '/settings/general',
      params: {},
    },
  ]

  beforeEach(() => {
    vi.clearAllMocks()
    integrationMocks.gbotEnabled = false

    vi.mocked(useNavigate).mockReturnValue(mockNavigate)
    vi.mocked(useMatches).mockReturnValue(mockMatches)
    vi.mocked(useModelProvider).mockReturnValue({
      providers: [
        { provider: 'openai', active: true, models: [] },
        { provider: 'ginfer', active: true, models: [] },
      ],
      addProvider: vi.fn(),
    })
  })

  it('renders all menu items', () => {
    render(<SettingsMenu />)

    expect(screen.getByText('common:general')).toBeInTheDocument()
    expect(screen.getByText('common:attachments')).toBeInTheDocument()
    expect(screen.getByText('common:interface')).toBeInTheDocument()
    expect(screen.getByText('common:assistants')).toBeInTheDocument()
    expect(screen.queryByText('common:privacy')).not.toBeInTheDocument()
  })

  it('renders keyboard shortcuts and other settings', () => {
    render(<SettingsMenu />)
    expect(screen.getByText('common:keyboardShortcuts')).toBeInTheDocument()
    expect(screen.getByText('common:hardware')).toBeInTheDocument()
    expect(
      screen.queryByText('common:local_api_server')
    ).not.toBeInTheDocument()
    expect(screen.getByText('common:https_proxy')).toBeInTheDocument()
    expect(screen.getByText('common:mcp-servers')).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: 'Workspace connections' })
    ).toHaveAttribute('href', '/settings/workspace-connections')
  })

  it('shows the saved integration choices', () => {
    render(<SettingsMenu />)

    expect(
      screen.getByRole('switch', { name: 'OpenCode integration' })
    ).toBeChecked()
    expect(
      screen.getByRole('switch', { name: 'Hermes integration' })
    ).toBeChecked()
    expect(screen.getByRole('switch', { name: 'Gbot integration' })).not.toBeChecked()
    expect(integrationMocks.setGbotEnabled).not.toHaveBeenCalled()
    expect(mockNavigate).not.toHaveBeenCalled()
  })

  it('opens Gbot setup when enabled from native integrations', async () => {
    const user = userEvent.setup()
    render(<SettingsMenu />)
    await user.click(screen.getByRole('switch', { name: 'Gbot integration' }))
    expect(integrationMocks.setGbotEnabled).toHaveBeenCalledWith(true)
    expect(mockNavigate).toHaveBeenCalledWith({ to: '/gbot/' })
  })

  it('stays in Settings when Gbot is disabled', async () => {
    integrationMocks.gbotEnabled = true
    const user = userEvent.setup()
    render(<SettingsMenu />)
    await user.click(screen.getByRole('switch', { name: 'Gbot integration' }))
    expect(integrationMocks.setGbotEnabled).toHaveBeenCalledWith(false)
    expect(mockNavigate).not.toHaveBeenCalled()
  })

  it('persists a disabled integration and stops its managed terminal', async () => {
    const user = userEvent.setup()
    render(<SettingsMenu />)

    await user.click(screen.getByRole('switch', { name: 'Hermes integration' }))

    expect(integrationMocks.setHermesEnabled).toHaveBeenCalledWith(false)
    expect(integrationMocks.stopTerminal).toHaveBeenCalledWith('hermes')
  })

  it('shows provider expansion chevron when providers are active', () => {
    render(<SettingsMenu />)

    // There should be at least one button (the chevron)
    const chevronButtons = screen.getAllByRole('button')
    expect(chevronButtons.length).toBeGreaterThan(0)
  })

  it('shows expanded providers by default', () => {
    render(<SettingsMenu />)

    // Providers ARE expanded by default (expandedProviders starts as true)
    expect(screen.getByTestId('provider-avatar-openai')).toBeInTheDocument()
  })

  it('collapses disabled providers section when toggle is clicked', async () => {
    vi.mocked(useModelProvider).mockReturnValue({
      providers: [
        { provider: 'openai', active: true, models: [] },
        { provider: 'anthropic', active: false, models: [] },
      ],
      addProvider: vi.fn(),
    })

    const user = userEvent.setup()
    render(<SettingsMenu />)

    // Disabled section is expanded by default — anthropic is visible
    expect(screen.getByTestId('provider-avatar-anthropic')).toBeInTheDocument()

    // Click the toggle to collapse the disabled section
    const toggleButton = screen.getByText('common:hiddenProviders')
    await user.click(toggleButton)

    // After collapsing, anthropic should be hidden
    expect(
      screen.queryByTestId('provider-avatar-anthropic')
    ).not.toBeInTheDocument()
  })

  it('auto-expands providers when on provider route', () => {
    vi.mocked(useMatches).mockReturnValue([
      {
        routeId: '/settings/providers/$providerName',
        params: { providerName: 'openai' },
      },
    ])

    render(<SettingsMenu />)

    expect(screen.getByTestId('provider-avatar-openai')).toBeInTheDocument()
  })

  it('highlights active provider in submenu', () => {
    vi.mocked(useMatches).mockReturnValue([
      {
        routeId: '/settings/providers/$providerName',
        params: { providerName: 'openai' },
      },
    ])

    render(<SettingsMenu />)

    const openaiProvider = screen
      .getByTestId('provider-avatar-openai')
      .closest('a')
    expect(openaiProvider).toHaveClass('bg-foreground/20')
  })

  it('links each provider to its settings route', () => {
    render(<SettingsMenu />)

    const openaiProvider = screen
      .getByTestId('provider-avatar-openai')
      .closest('a')

    expect(openaiProvider).toHaveAttribute('href', '/settings/providers/openai')
  })

  it('hides ginfer during setup remote provider step', () => {
    vi.mocked(useMatches).mockReturnValue([
      {
        routeId: '/settings/providers/',
        params: {},
        search: { step: 'setup_remote_provider' },
      },
    ])

    render(<SettingsMenu />)

    // openai should be visible during remote provider setup
    expect(screen.getByTestId('provider-avatar-openai')).toBeInTheDocument()

    // ginfer should have 'hidden' class during setup_remote_provider step
    const localProvider = screen
      .getByTestId('provider-avatar-ginfer')
      .closest('a')
    expect(localProvider).toHaveClass('hidden')
  })

  it('lists the local engine first, then the rest by title', () => {
    vi.mocked(useModelProvider).mockReturnValue({
      providers: [
        { provider: 'openai', active: true, models: [] },
        { provider: 'ginfer', active: true, models: [] },
        { provider: 'anthropic', active: true, models: [] },
      ],
      addProvider: vi.fn(),
    })

    const { container } = render(<SettingsMenu />)

    const rendered = Array.from(
      container.querySelectorAll('[data-testid^="provider-avatar-"]')
    ).map((el) =>
      el.getAttribute('data-testid')?.replace('provider-avatar-', '')
    )
    // ginfer (local engine) leads; the rest sort by title, mocked to the id.
    expect(rendered).toEqual(['ginfer', 'anthropic', 'openai'])
  })

  it('marks the provider backing the selected model with a green dot', () => {
    vi.mocked(useModelProvider).mockReturnValue({
      providers: [
        { provider: 'openai', active: true, models: [] },
        { provider: 'ginfer', active: true, models: [] },
      ],
      selectedProvider: 'openai',
      addProvider: vi.fn(),
    })

    render(<SettingsMenu />)

    expect(screen.getByTestId('provider-active-dot-openai')).toBeInTheDocument()
    expect(
      screen.queryByTestId('provider-active-dot-ginfer')
    ).not.toBeInTheDocument()
  })

  it('shows no active dot when nothing is selected', () => {
    render(<SettingsMenu />)

    expect(
      screen.queryByTestId('provider-active-dot-openai')
    ).not.toBeInTheDocument()
  })

  it('shows inactive providers in disabled section', () => {
    vi.mocked(useModelProvider).mockReturnValue({
      providers: [
        { provider: 'openai', active: true, models: [] },
        { provider: 'anthropic', active: false, models: [] },
      ],
      addProvider: vi.fn(),
    })

    render(<SettingsMenu />)

    // Active provider shown normally
    expect(screen.getByTestId('provider-avatar-openai')).toBeInTheDocument()
    // Inactive provider shown in the disabled section (expanded by default)
    expect(screen.getByTestId('provider-avatar-anthropic')).toBeInTheDocument()
    // Disabled section label is shown
    expect(screen.getByText('common:hiddenProviders')).toBeInTheDocument()
  })
})

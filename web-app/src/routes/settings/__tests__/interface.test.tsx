import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { Route as InterfaceRoute } from '../interface'
import { toast } from 'sonner'

const { resetInterface } = vi.hoisted(() => ({
  resetInterface: vi.fn(),
}))

// Mock all the dependencies
vi.mock('@/containers/SettingsMenu', () => ({
  default: () => <div data-testid="settings-menu">Settings Menu</div>,
}))

vi.mock('@/containers/HeaderPage', () => ({
  default: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="header-page">{children}</div>
  ),
}))

vi.mock('@/containers/Card', () => ({
  Card: ({
    title,
    children,
  }: {
    title?: string
    children: React.ReactNode
  }) => (
    <div data-testid="card" data-title={title}>
      {title && <div data-testid="card-title">{title}</div>}
      {children}
    </div>
  ),
  CardItem: ({
    title,
    description,
    actions,
    className,
  }: {
    title?: string
    description?: string
    actions?: React.ReactNode
    className?: string
  }) => (
    <div data-testid="card-item" data-title={title} className={className}>
      {title && <div data-testid="card-item-title">{title}</div>}
      {description && (
        <div data-testid="card-item-description">{description}</div>
      )}
      {actions && <div data-testid="card-item-actions">{actions}</div>}
    </div>
  ),
}))

vi.mock('@/containers/ThemeSwitcher', () => ({
  ThemeSwitcher: () => <div data-testid="theme-switcher">Theme Switcher</div>,
}))

vi.mock('@/containers/FontSizeSwitcher', () => ({
  FontSizeSwitcher: () => (
    <div data-testid="font-size-switcher">Font Size Switcher</div>
  ),
}))

vi.mock('@/containers/AccentColorPicker', () => ({
  AccentColorPicker: () => (
    <div data-testid="accent-color-picker">Accent Color Picker</div>
  ),
}))

vi.mock('@/hooks/useInterfaceSettings', () => ({
  useInterfaceSettings: () => ({
    resetInterface,
  }),
}))

vi.mock('@/i18n/react-i18next-compat', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}))

vi.mock('@/components/ui/button', () => ({
  Button: ({
    children,
    onClick,
    ...props
  }: {
    children: React.ReactNode
    onClick?: () => void
    [key: string]: any
  }) => (
    <button data-testid="button" onClick={onClick} {...props}>
      {children}
    </button>
  ),
}))

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}))

vi.mock('@/constants/routes', () => ({
  route: {
    settings: {
      interface: '/settings/interface',
    },
  },
}))

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: (path: string) => (config: any) => ({
    ...config,
    component: config.component,
  }),
}))

describe('Interface Settings Route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetInterface.mockResolvedValue(undefined)
  })

  it('should render the interface settings page', () => {
    const Component = InterfaceRoute.component as React.ComponentType
    render(<Component />)

    expect(screen.getByTestId('header-page')).toBeInTheDocument()
    expect(screen.getByTestId('settings-menu')).toBeInTheDocument()
    expect(screen.getByText('common:settings')).toBeInTheDocument()
    expect(
      screen.getByText('Choose the theme and text size GChat uses.')
    ).toBeInTheDocument()
  })

  it('should render interface controls', () => {
    const Component = InterfaceRoute.component as React.ComponentType
    render(<Component />)

    expect(screen.getByTestId('theme-switcher')).toBeInTheDocument()
    expect(screen.getByTestId('font-size-switcher')).toBeInTheDocument()
    expect(screen.queryByTestId('accent-color-picker')).not.toBeInTheDocument()
  })

  it('should render reset interface button', () => {
    const Component = InterfaceRoute.component as React.ComponentType
    render(<Component />)

    const resetButtons = screen.getAllByTestId('button')
    expect(resetButtons.length).toBeGreaterThan(0)
  })

  it('shows Reset as an ordinary button, not a destructive one', () => {
    const Component = InterfaceRoute.component as React.ComponentType
    render(<Component />)

    expect(screen.getByText('common:reset')).toHaveAttribute(
      'variant',
      'outline'
    )
  })

  it('should render reset buttons', () => {
    const Component = InterfaceRoute.component as React.ComponentType
    render(<Component />)

    const resetButtons = screen.getAllByTestId('button')
    expect(resetButtons.length).toBeGreaterThan(0)

    // Check that buttons are clickable
    resetButtons.forEach((button) => {
      expect(button).toBeInTheDocument()
    })
  })

  it('should render reset functionality', async () => {
    const Component = InterfaceRoute.component as React.ComponentType
    render(<Component />)

    const resetButtons = screen.getAllByTestId('button')
    expect(resetButtons.length).toBeGreaterThan(0)

    // Verify buttons can be clicked without errors
    resetButtons.forEach((button) => {
      fireEvent.click(button)
      expect(button).toBeInTheDocument()
    })
    await waitFor(() => expect(toast.success).toHaveBeenCalled())
  })

  it('reports success only after reset completes and blocks another reset while pending', async () => {
    let finish!: () => void
    resetInterface.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        finish = resolve
      })
    )
    const Component = InterfaceRoute.component as React.ComponentType
    render(<Component />)
    const reset = screen.getByRole('button', { name: 'common:reset' })

    fireEvent.click(reset)
    expect(reset).toBeDisabled()
    expect(toast.success).not.toHaveBeenCalled()
    fireEvent.click(reset)
    expect(resetInterface).toHaveBeenCalledTimes(1)
    finish()

    await waitFor(() => expect(reset).toBeEnabled())
    expect(toast.success).toHaveBeenCalledWith(
      'settings:interface.resetInterfaceSuccess',
      expect.any(Object)
    )
  })

  it('shows a reset failure instead of claiming settings were restored', async () => {
    resetInterface.mockRejectedValueOnce(new Error('Window theme unavailable'))
    const Component = InterfaceRoute.component as React.ComponentType
    render(<Component />)
    const reset = screen.getByRole('button', { name: 'common:reset' })

    fireEvent.click(reset)

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        'settings:interface.resetInterfaceError'
      )
    )
    expect(reset).toBeEnabled()
    expect(toast.success).not.toHaveBeenCalled()
  })

  it('should render all card items with proper structure', () => {
    const Component = InterfaceRoute.component as React.ComponentType
    render(<Component />)

    const cardItems = screen.getAllByTestId('card-item')
    expect(cardItems.length).toBeGreaterThan(0)

    // Check that cards have proper structure
    const cards = screen.getAllByTestId('card')
    expect(cards.length).toBeGreaterThan(0)
  })

  it('should render the current interface setting rows', () => {
    const Component = InterfaceRoute.component as React.ComponentType
    render(<Component />)

    expect(screen.getByText('settings:interface.theme')).toBeInTheDocument()
    expect(screen.getByText('settings:interface.fontSize')).toBeInTheDocument()
    expect(
      screen.getByText('settings:interface.resetToDefault')
    ).toBeInTheDocument()
  })

  it('should render main layout structure', () => {
    const Component = InterfaceRoute.component as React.ComponentType
    render(<Component />)

    const headerPage = screen.getByTestId('header-page')
    expect(headerPage).toBeInTheDocument()

    const settingsMenu = screen.getByTestId('settings-menu')
    expect(settingsMenu).toBeInTheDocument()
  })
})

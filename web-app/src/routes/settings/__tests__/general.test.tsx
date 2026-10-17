import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { Route as GeneralRoute } from '../general'
import type { ServiceHub } from '@/services'
import { seedServiceHub } from '@/test/service-hub'
import { useConversationPolicy } from '@/hooks/useConversationPolicy'
import { toast } from 'sonner'

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

vi.mock('@/containers/LanguageSwitcher', () => ({
  default: () => <div data-testid="language-switcher">Language Switcher</div>,
}))

const mockSetPreloadModelOnStartup = vi.hoisted(() => vi.fn())
const mockNavigate = vi.hoisted(() => vi.fn())

vi.mock('@/hooks/useGeneralSetting', () => ({
  useGeneralSetting: () => ({
    spellCheckChatInput: true,
    setSpellCheckChatInput: vi.fn(),
    huggingfaceToken: 'test-token',
    setHuggingfaceToken: vi.fn(),
    preloadModelOnStartup: false,
    setPreloadModelOnStartup: mockSetPreloadModelOnStartup,
  }),
}))

// Create a controllable mock
const mockCheckForUpdate = vi.fn()
const mockOpenerOpen = vi.fn()
const mockRevealItemInDir = vi.fn()
const mockRelocateDataFolder = vi.fn()
const mockGetDataFolder = vi.fn()
const mockStopAllModels = vi.fn()
const mockEmitEvent = vi.fn()
const mockOpenDirectory = vi.fn()

vi.mock('@/hooks/useAppUpdater', () => ({
  useAppUpdater: () => ({
    checkForUpdate: mockCheckForUpdate,
  }),
}))

vi.mock('@/i18n/react-i18next-compat', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}))

vi.mock('@/components/ui/switch', () => ({
  Switch: ({
    checked,
    onCheckedChange,
    'aria-label': label,
  }: {
    checked: boolean
    onCheckedChange: (checked: boolean) => void
    'aria-label'?: string
  }) => (
    <input
      data-testid="switch"
      type="checkbox"
      checked={checked}
      aria-label={label}
      onChange={(e) => onCheckedChange(e.target.checked)}
    />
  ),
}))

vi.mock('@/components/ui/button', () => ({
  Button: ({
    children,
    onClick,
    disabled,
    ...props
  }: {
    children: React.ReactNode
    onClick?: () => void
    disabled?: boolean
    [key: string]: any
  }) => (
    <button
      data-testid="button"
      onClick={onClick}
      disabled={disabled}
      {...props}
    >
      {children}
    </button>
  ),
}))

vi.mock('@/components/ui/input', () => ({
  Input: ({
    value,
    onChange,
    placeholder,
  }: {
    value: string
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => void
    placeholder?: string
  }) => (
    <input
      data-testid="input"
      value={value}
      onChange={onChange}
      placeholder={placeholder}
    />
  ),
}))

vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="dialog">{children}</div>
  ),
  DialogClose: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="dialog-close">{children}</div>
  ),
  DialogContent: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="dialog-content">{children}</div>
  ),
  DialogDescription: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="dialog-description">{children}</div>
  ),
  DialogFooter: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="dialog-footer">{children}</div>
  ),
  DialogHeader: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="dialog-header">{children}</div>
  ),
  DialogTitle: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="dialog-title">{children}</div>
  ),
  DialogTrigger: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="dialog-trigger">{children}</div>
  ),
}))

vi.mock('@/services/app/web', () => ({
  WebAppService: vi.fn().mockImplementation(() => ({
    factoryReset: vi.fn(),
    getGchatDataFolder: vi.fn().mockResolvedValue('/test/data/folder'),
    relocateGchatDataFolder: vi.fn(),
  })),
}))

vi.mock('@/services/models/default', () => ({
  DefaultModelsService: vi.fn().mockImplementation(() => ({
    stopAllModels: vi.fn(),
  })),
}))

// Add tests for rfd dialog
// vi.mock('@tauri-apps/plugin-dialog', () => ({
//   open: vi.fn(),
// }))

vi.mock('@tauri-apps/plugin-opener', () => ({
  openUrl: vi.fn(),
  revealItemInDir: vi.fn(),
}))

vi.mock('@tauri-apps/api/webviewWindow', () => {
  const MockWebviewWindow = vi
    .fn()
    .mockImplementation((label: string, options: any) => ({
      once: vi.fn(),
      setFocus: vi.fn(),
    }))
  MockWebviewWindow.getByLabel = vi.fn().mockReturnValue(null)

  return {
    WebviewWindow: MockWebviewWindow,
  }
})

vi.mock('@tauri-apps/api/event', () => ({
  emit: vi.fn(),
}))

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  },
}))

vi.mock('@/lib/utils', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/utils')>()),
  isDev: vi.fn().mockReturnValue(false),
}))

vi.mock('@/constants/routes', () => ({
  route: {
    gbot: { index: '/gbot/' },
    settings: {
      general: '/settings/general',
    },
    appLogs: '/logs',
  },
}))

vi.mock('@/constants/windows', () => ({
  windowKey: {
    logsAppWindow: 'logs-app-window',
  },
}))

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => mockNavigate,
  createFileRoute: (path: string) => (config: any) => ({
    ...config,
    component: config.component,
  }),
}))

// Mock global variables
global.VERSION = '1.0.0'
global.IS_MACOS = false
global.IS_WINDOWS = true
global.AUTO_UPDATER_DISABLED = false
global.window = {
  ...global.window,
  core: {
    api: {
      relaunch: vi.fn(),
      getConnectedServers: vi.fn().mockResolvedValue([]),
    },
  },
}

// Mock navigator clipboard
Object.assign(navigator, {
  clipboard: {
    writeText: vi.fn(),
  },
})

describe('General Settings Route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useConversationPolicy.getState().setDefaultApprovalMode('manual')
    seedServiceHub({
      app: {
        factoryReset: vi.fn(),
        getGchatDataFolder: mockGetDataFolder,
        relocateGchatDataFolder: mockRelocateDataFolder,
      } as ReturnType<ServiceHub['app']>,
      models: {
        stopAllModels: mockStopAllModels,
      } as ReturnType<ServiceHub['models']>,
      dialog: {
        open: mockOpenDirectory,
      } as ReturnType<ServiceHub['dialog']>,
      events: {
        emit: mockEmitEvent,
      } as ReturnType<ServiceHub['events']>,
      window: {
        openLogsWindow: vi.fn(),
      } as ReturnType<ServiceHub['window']>,
      opener: {
        open: mockOpenerOpen,
        revealItemInDir: mockRevealItemInDir,
      } as ReturnType<ServiceHub['opener']>,
    })
    // Reset the mock to return a promise that resolves immediately by default
    mockCheckForUpdate.mockResolvedValue(null)
    mockOpenerOpen.mockResolvedValue(undefined)
    mockRevealItemInDir.mockResolvedValue(undefined)
    mockRelocateDataFolder.mockResolvedValue(undefined)
    mockGetDataFolder.mockResolvedValue('/test/data/folder')
    mockOpenDirectory.mockResolvedValue('/test/new-data')
  })

  it('should render the general settings page', async () => {
    const Component = GeneralRoute.component as React.ComponentType
    await act(async () => {
      render(<Component />)
    })

    expect(screen.getByTestId('header-page')).toBeInTheDocument()
    expect(screen.getByTestId('settings-menu')).toBeInTheDocument()
    expect(screen.getByText('common:settings')).toBeInTheDocument()
  })

  it('should render app version', async () => {
    const Component = GeneralRoute.component as React.ComponentType
    await act(async () => {
      render(<Component />)
    })

    expect(screen.getByText('v1.0.0')).toBeInTheDocument()
  })

  // TODO: This test is currently commented out due to missing implementation
  // it('should render language switcher', () => {
  //   const Component = GeneralRoute.component as React.ComponentType
  //   render(<Component />)

  //   expect(screen.getByTestId('language-switcher')).toBeInTheDocument()
  // })

  it('should render huggingface token input', async () => {
    const Component = GeneralRoute.component as React.ComponentType
    await act(async () => {
      render(<Component />)
    })

    const input = screen.getByTestId('input')
    expect(input).toBeInTheDocument()
    expect(input).toHaveValue('test-token')
  })

  it('should handle spell check toggle', async () => {
    const Component = GeneralRoute.component as React.ComponentType
    await act(async () => {
      render(<Component />)
    })

    const switches = screen.getAllByTestId('switch')
    expect(switches.length).toBeGreaterThan(0)

    // Test that switches are interactive
    await act(async () => {
      fireEvent.click(switches[0])
    })
    expect(switches[0]).toBeInTheDocument()
  })

  it('sets the approval default shared by Chat and Agent from General settings', async () => {
    const Component = GeneralRoute.component as React.ComponentType
    await act(async () => {
      render(<Component />)
    })

    const approvalItem = screen.getAllByTestId('card-item').find(
      (item) => item.getAttribute('data-title') === 'settings:chatBehavior.autoApproveTools'
    )
    const toggle = approvalItem?.querySelector<HTMLInputElement>('[data-testid="switch"]')
    expect(toggle).toBeTruthy()
    expect(toggle).not.toBeChecked()

    await act(async () => {
      fireEvent.click(toggle!)
    })
    expect(useConversationPolicy.getState().getApprovalMode('ordinary-chat')).toBe('skip')
  })

  it('renders the model preload toggle off, next to the startup settings', async () => {
    const Component = GeneralRoute.component as React.ComponentType
    await act(async () => {
      render(<Component />)
    })

    const item = screen
      .getAllByTestId('card-item')
      .find(
        (el) =>
          el.getAttribute('data-title') ===
          'settings:general.preloadModelOnStartup'
      )
    expect(item).toBeDefined()

    // It belongs to the General card, alongside "Launch at startup" — not to
    // the "Others" card it used to live in.
    expect(item?.closest('[data-testid="card"]')).toHaveAttribute(
      'data-title',
      'common:general'
    )

    const toggle = item?.querySelector(
      '[data-testid="switch"]'
    ) as HTMLInputElement
    expect(toggle).toBeDefined()
    expect(toggle.checked).toBe(false)

    await act(async () => {
      fireEvent.click(toggle)
    })
    expect(mockSetPreloadModelOnStartup).toHaveBeenCalledWith(true)
  })

  it('should handle huggingface token change', async () => {
    const Component = GeneralRoute.component as React.ComponentType
    await act(async () => {
      render(<Component />)
    })

    const input = screen.getByTestId('input')
    expect(input).toBeInTheDocument()

    // Test that input is interactive
    await act(async () => {
      fireEvent.change(input, { target: { value: 'new-token' } })
    })
    expect(input).toBeInTheDocument()
  })

  it('should handle check for updates', async () => {
    const Component = GeneralRoute.component as React.ComponentType
    await act(async () => {
      render(<Component />)
    })

    const buttons = screen.getAllByTestId('button')
    const checkUpdateButton = buttons.find((button) =>
      button.textContent?.includes('checkForUpdates')
    )

    if (checkUpdateButton) {
      expect(checkUpdateButton).toBeInTheDocument()
      await act(async () => {
        fireEvent.click(checkUpdateButton)
      })
      // Test that button is interactive
      expect(checkUpdateButton).toBeInTheDocument()
    }
  })

  it('should handle data folder display', async () => {
    const Component = GeneralRoute.component as React.ComponentType
    await act(async () => {
      render(<Component />)
    })

    // Test that component renders without errors
    expect(screen.getByTestId('header-page')).toBeInTheDocument()
    expect(screen.getByTestId('settings-menu')).toBeInTheDocument()
  })

  const openDataFolderConfirmation = async () => {
    const Component = GeneralRoute.component as React.ComponentType
    await act(async () => {
      render(<Component />)
    })
    await act(async () => {
      fireEvent.click(
        screen.getByRole('button', { name: 'settings:general.changeLocation' })
      )
    })
    return screen.getByRole('button', {
      name: 'settings:dialogs.changeDataFolder.changeLocation',
    })
  }

  it('awaits one native data move before changing the path or relaunching, without stopping active work', async () => {
    let finishMove!: () => void
    mockRelocateDataFolder.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishMove = resolve
        })
    )
    const confirm = await openDataFolderConfirmation()

    await act(async () => {
      fireEvent.click(confirm)
      fireEvent.click(confirm)
    })

    expect(mockRelocateDataFolder).toHaveBeenCalledExactlyOnceWith(
      '/test/new-data'
    )
    expect(mockStopAllModels).not.toHaveBeenCalled()
    expect(mockEmitEvent).not.toHaveBeenCalled()
    expect(window.core?.api?.relaunch).not.toHaveBeenCalled()
    expect(screen.getByTitle('/test/data/folder')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'common:loading' })).toBeDisabled()
    expect(
      screen.getByRole('button', {
        name: 'settings:dialogs.changeDataFolder.cancel',
      })
    ).toBeDisabled()
    expect(
      screen.getByRole('button', {
        name: 'settings:general.changeLocation',
      })
    ).toBeDisabled()

    await act(async () => {
      finishMove()
    })

    expect(screen.getByTitle('/test/new-data')).toBeInTheDocument()
    expect(window.core?.api?.relaunch).toHaveBeenCalledTimes(1)
    expect(
      screen.queryByText('settings:dialogs.changeDataFolder.title')
    ).not.toBeInTheDocument()
  })

  it.each([
    [
      'Host is busy: model load in progress',
      'Host is busy: model load in progress',
    ],
    [
      new Error('Failed to copy data: access denied'),
      'Failed to copy data: access denied',
    ],
  ])(
    'keeps the old data path and offers retry after native refusal: %s',
    async (failure, message) => {
      mockRelocateDataFolder.mockRejectedValueOnce(failure)
      const confirm = await openDataFolderConfirmation()

      await act(async () => {
        fireEvent.click(confirm)
      })

      expect(toast.error).toHaveBeenCalledWith(message)
      expect(screen.getByTitle('/test/data/folder')).toBeInTheDocument()
      expect(screen.queryByTitle('/test/new-data')).not.toBeInTheDocument()
      expect(window.core?.api?.relaunch).not.toHaveBeenCalled()
      expect(mockStopAllModels).not.toHaveBeenCalled()
      expect(mockEmitEvent).not.toHaveBeenCalled()
      expect(
        screen.getByRole('button', {
          name: 'settings:dialogs.changeDataFolder.changeLocation',
        })
      ).toBeEnabled()

      await act(async () => {
        fireEvent.click(confirm)
      })

      expect(mockRelocateDataFolder).toHaveBeenCalledTimes(2)
      expect(screen.getByTitle('/test/new-data')).toBeInTheDocument()
      expect(window.core?.api?.relaunch).toHaveBeenCalledTimes(1)
    }
  )

  it('shows the committed data path when the Host restart fails, without relaunching', async () => {
    const message =
      'Data moved to /test/new-data; Host restart failed: startup timed out'
    mockRelocateDataFolder.mockRejectedValueOnce(message)
    const confirm = await openDataFolderConfirmation()
    mockGetDataFolder.mockResolvedValue('/test/new-data')

    await act(async () => {
      fireEvent.click(confirm)
    })

    expect(mockGetDataFolder).toHaveBeenCalledTimes(2)
    expect(toast.error).toHaveBeenCalledExactlyOnceWith(message)
    expect(screen.getByTitle('/test/new-data')).toBeInTheDocument()
    expect(screen.queryByTitle('/test/data/folder')).not.toBeInTheDocument()
    expect(window.core?.api?.relaunch).not.toHaveBeenCalled()
    expect(mockStopAllModels).not.toHaveBeenCalled()
    expect(mockEmitEvent).not.toHaveBeenCalled()
    expect(
      screen.getByRole('button', {
        name: 'settings:dialogs.changeDataFolder.changeLocation',
      })
    ).toBeEnabled()
  })

  it('should handle copy to clipboard', async () => {
    const Component = GeneralRoute.component as React.ComponentType
    await act(async () => {
      render(<Component />)
    })

    // Test that component renders without errors
    expect(screen.getByTestId('header-page')).toBeInTheDocument()
    expect(screen.getByTestId('settings-menu')).toBeInTheDocument()
  })

  it('should handle factory reset dialog', async () => {
    const Component = GeneralRoute.component as React.ComponentType
    await act(async () => {
      render(<Component />)
    })

    expect(screen.getByTestId('dialog')).toBeInTheDocument()
    expect(screen.getByTestId('dialog-trigger')).toBeInTheDocument()
    expect(screen.getByTestId('dialog-content')).toBeInTheDocument()
  })

  it('should render external links', async () => {
    const Component = GeneralRoute.component as React.ComponentType
    await act(async () => {
      render(<Component />)
    })

    // Check for external links
    const links = screen.getAllByRole('link')
    expect(links.length).toBeGreaterThan(0)
  })

  it('should open the issues link through opener service', async () => {
    const Component = GeneralRoute.component as React.ComponentType
    await act(async () => {
      render(<Component />)
    })

    const issuesLink = screen.getByRole('link', { name: 'Open an issue' })

    await act(async () => {
      fireEvent.click(issuesLink)
    })

    expect(mockOpenerOpen).toHaveBeenCalledWith(
      'https://github.com/SectileLabs/gchat/issues'
    )
  })

  it('should handle logs window opening', async () => {
    const Component = GeneralRoute.component as React.ComponentType
    await act(async () => {
      render(<Component />)
    })

    const buttons = screen.getAllByTestId('button')
    const openLogsButton = buttons.find((button) =>
      button.textContent?.includes('openLogs')
    )

    if (openLogsButton) {
      expect(openLogsButton).toBeInTheDocument()
      // Test that button is interactive
      await act(async () => {
        fireEvent.click(openLogsButton)
      })
      expect(openLogsButton).toBeInTheDocument()
    }
  })

  it('should handle reveal logs folder', async () => {
    const Component = GeneralRoute.component as React.ComponentType
    await act(async () => {
      render(<Component />)
    })

    const buttons = screen.getAllByTestId('button')
    const revealLogsButton = buttons.find((button) =>
      button.textContent?.includes('showInFileExplorer')
    )

    if (revealLogsButton) {
      expect(revealLogsButton).toBeInTheDocument()
      // Test that button is interactive
      await act(async () => {
        fireEvent.click(revealLogsButton)
      })
      expect(revealLogsButton).toBeInTheDocument()
    }
  })

  it('should show correct file explorer text for Windows', async () => {
    global.IS_WINDOWS = true
    global.IS_MACOS = false

    const Component = GeneralRoute.component as React.ComponentType
    await act(async () => {
      render(<Component />)
    })

    expect(
      screen.getByText('settings:general.showInFileExplorer')
    ).toBeInTheDocument()
  })

  it('should disable check for updates button when checking', async () => {
    // Create a promise that we can control
    let resolveUpdate: (value: any) => void
    const updatePromise = new Promise((resolve) => {
      resolveUpdate = resolve
    })
    mockCheckForUpdate.mockReturnValue(updatePromise)

    const Component = GeneralRoute.component as React.ComponentType
    await act(async () => {
      render(<Component />)
    })

    const buttons = screen.getAllByTestId('button')
    const checkUpdateButton = buttons.find((button) =>
      button.textContent?.includes('checkForUpdates')
    )

    if (checkUpdateButton) {
      // Click the button but don't await it yet
      act(() => {
        fireEvent.click(checkUpdateButton)
      })

      // Now the button should be disabled while checking
      expect(checkUpdateButton).toBeDisabled()

      // Resolve the promise to finish the update check
      await act(async () => {
        resolveUpdate!(null)
        await updatePromise
      })

      // Button should be enabled again
      expect(checkUpdateButton).not.toBeDisabled()
    }
  })
})

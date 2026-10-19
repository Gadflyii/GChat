import { describe, it, expect, beforeEach, vi } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '@testing-library/jest-dom'
import type { ServiceHub } from '@/services'
import { seedServiceHub } from '@/test/service-hub'

const { hardwareFixture, defaultGpu } = vi.hoisted(() => {
  const defaultGpu = () => ({
    name: 'RTX 3080',
    total_memory: 10240,
    vendor: 'NVIDIA',
    uuid: 'gpu0-uuid',
    driver_version: '550.00',
    nvidia_info: { index: 0, compute_capability: '8.6' },
    vulkan_info: {
      index: 0,
      device_id: 900,
      device_type: 'discrete-gpu',
      api_version: '1.3',
    },
  })
  return { hardwareFixture: { gpus: [defaultGpu()], setHardwareData: vi.fn(), updateSystemUsage: vi.fn() }, defaultGpu }
})

const windowService = {
  openSystemMonitorWindow: vi.fn().mockResolvedValue(undefined),
}

const hardwareService = {
  getHardwareInfo: vi.fn().mockResolvedValue(null),
  getSystemUsage: vi.fn().mockResolvedValue(null),
  refreshHardwareInfo: vi.fn().mockResolvedValue(undefined),
}

// Mock all the dependencies with minimal implementation
vi.mock('@/containers/SettingsMenu', () => ({
  default: () => <div data-testid="settings-menu">Settings Menu</div>,
}))

vi.mock('@/containers/HeaderPage', () => ({
  default: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="header-page">{children}</div>
  ),
}))

vi.mock('@/components/ui/switch', () => ({
  Switch: ({ checked }: { checked: boolean }) => (
    <input data-testid="switch" type="checkbox" checked={checked} readOnly />
  ),
}))

vi.mock('@/i18n/react-i18next-compat', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

vi.mock('@/hooks/useHardware', () => ({
  useHardware: () => ({
    hardwareData: {
      os_type: 'windows',
      os_name: 'Windows 11',
      cpu: {
        name: 'Intel i7',
        arch: 'x64',
        core_count: 8,
        extensions: ['SSE'],
      },
      total_memory: 16384,
      gpus: hardwareFixture.gpus,
    },
    systemUsage: { cpu: 50, used_memory: 8192, total_memory: 16384, gpus: [] },
    setHardwareData: hardwareFixture.setHardwareData,
    updateSystemUsage: hardwareFixture.updateSystemUsage,
    pollingPaused: false,
  }),
}))

vi.mock('@/hooks/useModelProvider', () => ({
  useModelProvider: () => ({
    providers: [{ provider: 'llamacpp-upstream' }],
    getProviderByName: vi.fn(() => ({
      settings: [{ key: 'device', controller_props: { value: 'gpu0' } }],
    })),
  }),
}))

vi.mock('@/services/hardware', () => ({
  getHardwareInfo: vi.fn(() => Promise.resolve({})),
  getSystemUsage: vi.fn(() => Promise.resolve({})),
}))

vi.mock('@/services/models', () => ({ stopAllModels: vi.fn() }))
vi.mock('@/lib/utils', () => ({
  formatMegaBytes: (mb: number) => `${mb} MB`,
  cn: (...classes: any[]) => classes.filter(Boolean).join(' '),
  LOCAL_GINFER_PROVIDER: 'llamacpp-upstream',
}))
vi.mock('@/utils/number', () => ({ toNumber: (n: number) => n }))
vi.mock('@tauri-apps/api/webviewWindow', () => ({ WebviewWindow: vi.fn() }))
vi.mock('@/constants/routes', () => ({
  route: {
    settings: {
      hardware: '/settings/hardware',
    },
    systemMonitor: '/monitor',
  },
}))
vi.mock('@/constants/windows', () => ({
  windowKey: { systemMonitorWindow: 'monitor' },
}))
vi.mock('@tabler/icons-react', () => ({
  IconDeviceDesktopAnalytics: () => <div data-testid="icon" />,
}))

// Mock the route structure properly
vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (config: any) => config,
}))

// Mock platform utils to enable hardware monitoring
vi.mock('@/lib/platform/utils', () => ({
  isPlatformTauri: () => true,
  getUnavailableFeatureMessage: () => 'Feature not available',
}))

// Mock PlatformGuard to always render children
vi.mock('@/lib/platform/PlatformGuard', () => ({
  PlatformGuard: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
}))

global.IS_MACOS = false

// Import the actual component after all mocks are set up
import { Route } from '../hardware'
import { Route as MonitorRoute } from '../../system-monitor'

describe('Hardware Settings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    hardwareFixture.gpus = [defaultGpu()]
    seedServiceHub({
      hardware: hardwareService as ReturnType<ServiceHub['hardware']>,
      window: windowService as ReturnType<ServiceHub['window']>,
      models: {
        stopAllModels: vi.fn().mockResolvedValue(undefined),
        getActiveModels: vi.fn().mockResolvedValue([]),
      } as ReturnType<ServiceHub['models']>,
    })
    global.IS_MACOS = false
  })

  it('announces initial loading and the completed inventory', async () => {
    let finish!: (value: null) => void
    hardwareService.getHardwareInfo.mockReturnValueOnce(new Promise(resolve => { finish = resolve }))
    const Component = Route.component as React.ComponentType
    render(<Component />)

    const status = screen.getByRole('status')
    expect(status).toHaveAttribute('aria-live', 'polite')
    expect(status).toHaveAttribute('aria-atomic', 'true')
    expect(status).toHaveTextContent('Loading hardware information...')
    await act(async () => finish(null))
    expect(status).toHaveTextContent('Hardware information ready.')
  })

  it('exposes named numeric CPU and memory usage', async () => {
    const Component = Route.component as React.ComponentType
    render(<Component />)

    for (const name of ['CPU usage', 'Memory usage']) {
      const progress = await screen.findByRole('progressbar', { name })
      expect(progress).toHaveAttribute('aria-valuenow', '50')
      expect(progress).toHaveAttribute('aria-valuemin', '0')
      expect(progress).toHaveAttribute('aria-valuemax', '100')
    }
  })

  it('keeps Refresh hardware in keyboard order and focused through a pending refresh', async () => {
    const user = userEvent.setup()
    let finish!: () => void
    hardwareService.refreshHardwareInfo.mockReturnValueOnce(new Promise<void>(resolve => { finish = resolve }))
    const Component = Route.component as React.ComponentType
    render(<Component />)
    const refresh = await screen.findByRole('button', { name: 'Refresh hardware' })
    const monitor = screen.getByRole('button', { name: 'settings:hardware.systemMonitor' })

    await user.tab()
    expect(monitor).toHaveFocus()
    await user.tab()
    expect(refresh).toHaveFocus()
    await user.keyboard('{Enter}')
    expect(refresh).toHaveFocus()
    expect(refresh).toHaveAccessibleName('Refreshing…')
    expect(refresh).toHaveAttribute('aria-disabled', 'true')
    expect(screen.getByText('Intel i7')).toBeVisible()
    expect(screen.getByRole('status')).toHaveTextContent('Refreshing hardware information…')
    await user.keyboard('{Enter} ')
    expect(hardwareService.refreshHardwareInfo).toHaveBeenCalledTimes(1)

    await act(async () => finish())
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Hardware information refreshed.'))
    expect(refresh).toHaveAccessibleName('Refresh hardware')
    expect(refresh).toHaveAttribute('aria-disabled', 'false')
    expect(refresh).toHaveFocus()
    await user.tab({ shift: true })
    expect(monitor).toHaveFocus()
    await user.tab()
    expect(refresh).toHaveFocus()
  })

  it('announces a failed refresh and keeps the same keyboard retry', async () => {
    const user = userEvent.setup()
    hardwareService.refreshHardwareInfo.mockRejectedValueOnce(new Error('hardware unavailable'))
    const Component = Route.component as React.ComponentType
    render(<Component />)
    const refresh = await screen.findByRole('button', { name: 'Refresh hardware' })
    refresh.focus()
    await user.keyboard('{Enter}')

    expect(screen.getByRole('status')).toHaveTextContent('Hardware information could not be refreshed. Choose Refresh hardware to try again.')
    expect(refresh).toHaveFocus()
    expect(screen.getByText('Intel i7')).toBeVisible()
    await user.keyboard(' ')
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Hardware information refreshed.'))
    expect(hardwareService.refreshHardwareInfo).toHaveBeenCalledTimes(2)
    expect(refresh).toHaveFocus()
  })

  it('announces a System Monitor error and leaves its keyboard retry focused', async () => {
    const user = userEvent.setup()
    windowService.openSystemMonitorWindow.mockRejectedValueOnce(new Error('window unavailable'))
    const Component = Route.component as React.ComponentType
    render(<Component />)
    await screen.findByRole('button', { name: 'Refresh hardware' })
    const monitor = screen.getByRole('button', { name: 'settings:hardware.systemMonitor' })
    monitor.focus()
    await user.keyboard('{Enter}')

    expect(screen.getByRole('status')).toHaveTextContent('System Monitor could not open. Try opening System Monitor again.')
    expect(monitor).toHaveFocus()
    await user.keyboard('{Enter}')
    expect(windowService.openSystemMonitorWindow).toHaveBeenCalledTimes(2)
  })

  it('announces initial read failure and offers Refresh hardware', async () => {
    hardwareService.getHardwareInfo.mockRejectedValueOnce(new Error('hardware unavailable'))
    const Component = Route.component as React.ComponentType
    render(<Component />)

    await screen.findByRole('button', { name: 'Refresh hardware' })
    expect(screen.getByRole('status')).toHaveTextContent('Hardware information could not be fully loaded. Choose Refresh hardware to try again.')
  })

  it('renders hardware settings page', async () => {
    const Component = Route.component as React.ComponentType
    render(<Component />)

    await waitFor(() => {
      expect(
        screen.queryByText('Loading hardware information...')
      ).not.toBeInTheDocument()
    })
    expect(screen.getByTestId('header-page')).toBeInTheDocument()
    expect(screen.getByTestId('settings-menu')).toBeInTheDocument()
  })

  it('displays OS information', async () => {
    const Component = Route.component as React.ComponentType
    render(<Component />)

    await waitFor(() => {
      expect(screen.getByText('settings:hardware.os')).toBeInTheDocument()
      expect(screen.getByText('windows')).toBeInTheDocument()
    })
  })

  it('displays CPU information', async () => {
    const Component = Route.component as React.ComponentType
    render(<Component />)

    await waitFor(() => {
      expect(screen.getByText('settings:hardware.cpu')).toBeInTheDocument()
      expect(screen.getByText('Intel i7')).toBeInTheDocument()
    })
  })

  it('displays memory information', async () => {
    const Component = Route.component as React.ComponentType
    render(<Component />)

    await waitFor(() => {
      expect(screen.getByText('settings:hardware.memory')).toBeInTheDocument()
    })
  })

  it('displays GPU devices on non-macOS', async () => {
    global.IS_MACOS = false
    const Component = Route.component as React.ComponentType
    render(<Component />)

    await waitFor(() => {
      expect(screen.getByText('settings:hardware.gpus')).toBeInTheDocument()
      expect(screen.getByText('RTX 3080')).toBeInTheDocument()
    })
  })

  it.each([
    ['Hardware Settings', Route.component],
    ['System Monitor', MonitorRoute.component],
  ])('shows both identical physical cards in %s', async (_name, component) => {
    const name = 'NVIDIA RTX PRO 6000 Blackwell Workstation Edition'
    hardwareFixture.gpus = [
      '5268c64e-5bc4-4be1-ed12-e731c3de56cf',
      'bb41307d-6d91-5de3-9e23-a4aec948c49c',
    ].map((uuid, index) => ({
      ...defaultGpu(),
      name,
      total_memory: 97887,
      uuid,
      nvidia_info: { index, compute_capability: '12.0' },
      vulkan_info: { ...defaultGpu().vulkan_info, index },
    }))

    const Component = component as React.ComponentType
    render(<Component />)

    await waitFor(() => {
      expect(screen.getAllByText(name)).toHaveLength(2)
      expect(screen.getAllByText('97887 MB')).toHaveLength(2)
    })
  })

  it('hides GPU devices on macOS', async () => {
    global.IS_MACOS = true
    const Component = Route.component as React.ComponentType
    render(<Component />)

    await waitFor(() => {
      expect(screen.queryByText('settings:hardware.gpus')).not.toBeInTheDocument()
    })
  })
})

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CodeTerminalHost } from '@/containers/CodeTerminalHost'

const mocks = vi.hoisted(() => ({
  terminalConstructed: vi.fn(),
  attachTerminal: vi.fn(),
  spawnTerminal: vi.fn(),
  provisionOpenCode: vi.fn(),
  setTerminalFlow: vi.fn(),
  writeTerminal: vi.fn(),
  resizeTerminal: vi.fn(),
  stopTerminal: vi.fn(),
  getTerminalStatus: vi.fn(),
}))

vi.mock('@xterm/xterm', () => ({
  Terminal: class MockTerminal {
    rows = 24
    cols = 80
    options: Record<string, unknown>

    constructor(options: Record<string, unknown>) {
      this.options = options
      mocks.terminalConstructed()
    }

    loadAddon() {}
    open() {}
    reset() {}
    write(_data: Uint8Array, callback?: () => void) {
      callback?.()
    }
    resize(cols: number, rows: number) {
      this.cols = cols
      this.rows = rows
    }
    focus() {}
    dispose() {}
    onData() {
      return { dispose: vi.fn() }
    }
    onBinary() {
      return { dispose: vi.fn() }
    }
    onResize() {
      return { dispose: vi.fn() }
    }
  },
}))

vi.mock('@xterm/addon-fit', () => ({
  FitAddon: class MockFitAddon {
    proposeDimensions() {
      return { rows: 24, cols: 80 }
    }
  },
}))

vi.mock('@/services/terminal/tauri', () => ({
  attachTerminal: mocks.attachTerminal,
  spawnTerminal: mocks.spawnTerminal,
  provisionOpenCode: mocks.provisionOpenCode,
  setTerminalFlow: mocks.setTerminalFlow,
  writeTerminal: mocks.writeTerminal,
  resizeTerminal: mocks.resizeTerminal,
  stopTerminal: mocks.stopTerminal,
  getTerminalStatus: mocks.getTerminalStatus,
  base64ToBytes: vi.fn(() => new Uint8Array()),
  terminalBinaryStringToBytes: vi.fn(() => new Uint8Array()),
}))

vi.mock('@gchat/core', () => ({
  getJanDataFolderPath: vi.fn().mockResolvedValue('/data'),
}))

vi.mock('@/hooks/useServiceHub', () => ({
  useServiceHub: () => ({
    path: () => ({
      join: (...parts: string[]) => Promise.resolve(parts.join('/')),
    }),
  }),
}))

vi.mock('@/hooks/useHardware', () => {
  const state = {
    hardwareReady: true,
    hardwareData: {
      os_type: 'linux',
      os_name: 'Linux',
      total_memory: 64,
      cpu: {
        arch: 'x86_64',
        core_count: 8,
        extensions: [],
        name: 'CPU',
        usage: 0,
      },
      gpus: [
        {
          name: 'RTX 5090',
          total_memory: 32,
          vendor: 'NVIDIA',
          uuid: 'gpu-1',
          driver_version: '590',
          nvidia_info: { index: 0, compute_capability: '12.0' },
          vulkan_info: {
            index: 0,
            device_id: 0,
            device_type: 'discrete',
            api_version: '1.3',
          },
        },
      ],
    },
  }
  return {
    useHardware: (selector: (value: typeof state) => unknown) => selector(state),
  }
})

const runtimeState = vi.hoisted(() => ({ activeModels: ['qwen'] as string[] }))

vi.mock('@/hooks/useAppState', () => ({
  useAppState: (selector: (value: typeof runtimeState) => unknown) =>
    selector(runtimeState),
}))

vi.mock('@/hooks/useLocalApiServer', () => ({
  useLocalApiServer: () => ({
    serverHost: '127.0.0.1',
    serverPort: 1337,
    apiPrefix: '/v1',
    apiKey: 'gchat',
    defaultModelLocalApiServer: null,
  }),
}))

vi.mock('@/hooks/useProxyConfig', () => ({
  useProxyConfig: {
    getState: () => ({
      proxyEnabled: false,
      proxyUrl: '',
      proxyUsername: '',
      proxyPassword: '',
      noProxy: '',
    }),
  },
}))

vi.mock('@/hooks/useTheme', () => {
  const state = { isDark: true }
  const useTheme = Object.assign(
    (selector: (value: typeof state) => unknown) => selector(state),
    { getState: () => state }
  )
  return { useTheme }
})
vi.mock('@/stores/code-terminal-store', () => ({
  useCodeTerminalStore: (selector: (state: unknown) => unknown) =>
    selector({ workspace: undefined, setWorkspace: vi.fn() }),
}))
vi.mock('@/stores/launch-settings-store', () => ({
  useLaunchSettings: (selector: (state: unknown) => unknown) =>
    selector({ customPaths: {} }),
}))
vi.mock('@/lib/platform/utils', () => ({
  isPlatformTauri: () => true,
  isIOS: () => false,
  isAndroid: () => false,
}))
vi.mock('@/i18n/react-i18next-compat', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))
vi.mock('@/containers/HeaderPage', () => ({
  default: ({ children }: { children: React.ReactNode }) => <header>{children}</header>,
}))
vi.mock('@/containers/AgentWorkspaceSelect', () => ({
  AgentWorkspaceSelect: () => <button>workspace</button>,
}))
vi.mock('@/components/ui/button', () => ({
  Button: ({
    children,
    asChild: _asChild,
    variant: _variant,
    size: _size,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement> & {
    asChild?: boolean
    variant?: string
    size?: string
  }) => <button {...props}>{children}</button>,
}))
describe('CodeTerminalHost', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    runtimeState.activeModels = ['qwen']
    mocks.writeTerminal.mockResolvedValue(undefined)
    mocks.attachTerminal.mockResolvedValue({
      phase: 'idle',
      generation: 0,
      replayComplete: true,
    })
    mocks.provisionOpenCode.mockResolvedValue({
      ready: true,
      installed: true,
      configured: true,
      viaWsl: false,
      configPath: '/home/user/.config/opencode/opencode.json',
    })
    mocks.spawnTerminal.mockResolvedValue({
      phase: 'running',
      generation: 1,
      cwd: '/data/agent-workspace',
      launch: 'open_code',
      replayComplete: true,
    })
  })

  it('attaches before auto-start and preserves one xterm across navigation', async () => {
    const { rerender } = render(<CodeTerminalHost visible={false} />)

    await waitFor(() => expect(mocks.spawnTerminal).toHaveBeenCalledTimes(1))
    expect(mocks.attachTerminal).toHaveBeenCalledTimes(1)
    expect(mocks.provisionOpenCode).toHaveBeenCalledTimes(1)
    expect(mocks.terminalConstructed).toHaveBeenCalledTimes(1)
    expect(mocks.attachTerminal.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.spawnTerminal.mock.invocationCallOrder[0]
    )

    rerender(<CodeTerminalHost visible />)

    expect(mocks.terminalConstructed).toHaveBeenCalledTimes(1)
    expect(mocks.attachTerminal).toHaveBeenCalledTimes(1)
    expect(mocks.provisionOpenCode).toHaveBeenCalledTimes(1)
    expect(mocks.spawnTerminal).toHaveBeenCalledTimes(1)
  })

  it('toggles the OpenCode token sidebar through its native keybinding', async () => {
    render(<CodeTerminalHost visible />)

    const toggle = await screen.findByRole('button', {
      name: 'code:toggleTokenSidebar',
    })
    expect(toggle).toBeEnabled()
    expect(toggle).toHaveAttribute('title', 'code:toggleTokenSidebar')
    fireEvent.click(toggle)

    expect(mocks.writeTerminal).toHaveBeenCalledWith(
      1,
      Uint8Array.of(0x18, 0x62)
    )
  })

  it('installs in the background and waits for a model before configuring', async () => {
    runtimeState.activeModels = []
    mocks.provisionOpenCode.mockResolvedValue({
      ready: false,
      installed: true,
      configured: false,
      viaWsl: false,
      configPath: '/home/user/.config/opencode/opencode.jsonc',
      reason: 'missing_configuration',
    })

    render(<CodeTerminalHost visible />)

    expect(await screen.findByText('code:modelUnavailable')).toBeInTheDocument()
    expect(mocks.provisionOpenCode).toHaveBeenCalledWith(
      expect.objectContaining({
        apiUrl: 'http://127.0.0.1:1337/v1',
        model: undefined,
      }),
      expect.any(Function)
    )
    expect(mocks.spawnTerminal).not.toHaveBeenCalled()
  })
})

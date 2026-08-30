import { render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { HermesTerminalHost } from '@/containers/HermesTerminalHost'

const mocks = vi.hoisted(() => ({
  terminalConstructed: vi.fn(),
  attachTerminal: vi.fn(),
  provisionHermes: vi.fn(),
  spawnTerminal: vi.fn(),
  setTerminalFlow: vi.fn(),
  writeTerminal: vi.fn(),
  resizeTerminal: vi.fn(),
  stopTerminal: vi.fn(),
  getTerminalStatus: vi.fn(),
}))

const hermesState = vi.hoisted(() => ({
  enabled: true,
  model: 'qwen',
  workspace: undefined as string | undefined,
  setWorkspace: vi.fn(),
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
  provisionHermes: mocks.provisionHermes,
  spawnTerminal: mocks.spawnTerminal,
  setTerminalFlow: mocks.setTerminalFlow,
  writeTerminal: mocks.writeTerminal,
  resizeTerminal: mocks.resizeTerminal,
  stopTerminal: mocks.stopTerminal,
  getTerminalStatus: mocks.getTerminalStatus,
  base64ToBytes: vi.fn(() => new Uint8Array()),
  terminalBinaryStringToBytes: vi.fn(() => new Uint8Array()),
}))

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children }: { children: React.ReactNode }) => <>{children}</>,
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

vi.mock('@/hooks/useAppState', () => ({
  useAppState: (selector: (state: { activeModels: string[] }) => unknown) =>
    selector({ activeModels: ['qwen'] }),
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

vi.mock('@/stores/hermes-agent-store', () => ({
  useHermesAgentStore: (selector: (state: typeof hermesState) => unknown) =>
    selector(hermesState),
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

vi.mock('@/containers/HeaderPage', () => ({
  default: ({ children }: { children: React.ReactNode }) => <header>{children}</header>,
}))

vi.mock('@/containers/AgentWorkspaceSelect', () => ({
  AgentWorkspaceSelect: () => <button>workspace</button>,
}))

vi.mock('@/components/ui/button', () => ({
  Button: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...props}>{children}</button>
  ),
}))

describe('HermesTerminalHost', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    hermesState.enabled = true
    hermesState.model = 'qwen'
    hermesState.workspace = undefined
    mocks.attachTerminal.mockResolvedValue({
      phase: 'idle',
      generation: 0,
      replayComplete: true,
    })
    mocks.provisionHermes.mockResolvedValue({
      ready: true,
      installed: true,
      configured: true,
      viaWsl: false,
      configPath: '/home/user/.hermes/config.yaml',
    })
    mocks.spawnTerminal.mockResolvedValue({
      phase: 'running',
      generation: 1,
      cwd: '/data/agent-workspace',
      launch: 'hermes',
      replayComplete: true,
    })
  })

  it('starts a separate themed Hermes TUI when its tab is first opened', async () => {
    const { rerender } = render(<HermesTerminalHost visible={false} />)

    await waitFor(() => expect(mocks.attachTerminal).toHaveBeenCalledWith('hermes', expect.any(Function)))
    expect(mocks.provisionHermes).not.toHaveBeenCalled()
    expect(mocks.spawnTerminal).not.toHaveBeenCalled()

    rerender(<HermesTerminalHost visible />)

    await waitFor(() => expect(mocks.spawnTerminal).toHaveBeenCalledTimes(1))
    await waitFor(() =>
      expect(screen.getByLabelText('Hermes is running')).toBeInTheDocument()
    )
    expect(mocks.spawnTerminal).toHaveBeenCalledWith({
      terminalId: 'hermes',
      cwd: '/data/agent-workspace',
      rows: 24,
      cols: 80,
      launch: 'hermes',
      executable: undefined,
      appearance: 'dark',
    })
  })
})

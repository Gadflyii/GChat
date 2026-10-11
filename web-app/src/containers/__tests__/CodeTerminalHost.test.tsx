import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from '@testing-library/react'
import { useThreads } from '@/hooks/useThreads'
import { useCodeTerminalStore } from '@/stores/code-terminal-store'
import { useConversationPolicy } from '@/hooks/useConversationPolicy'
import { useToolAvailable } from '@/hooks/useToolAvailable'
import { CodeTerminalHost } from '@/containers/CodeTerminalHost'
import type { TerminalSpawnRequest, TerminalStatus } from '@/types/terminal'

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
  updateCode: vi.fn(),
  selectCodeSession: vi.fn(),
  resolveCodeWorkspace: vi.fn(),
  newCodeSession: vi.fn(),
  updateCodeBridgePolicy: vi.fn(),
  listen: vi.fn(),
  navigate: vi.fn(),
}))

vi.mock('@tanstack/react-router', () => ({
  useLocation: () => '/code',
  useSearch: () => ({}),
  useNavigate: () => mocks.navigate,
}))

vi.mock('@xterm/xterm', () => ({
  Terminal: class MockTerminal {
    rows = 24
    cols = 80
    options: Record<string, unknown>
    private output?: HTMLPreElement

    constructor(options: Record<string, unknown>) {
      this.options = options
      mocks.terminalConstructed()
    }

    loadAddon() {}
    open(container: HTMLElement) {
      this.output = document.createElement('pre')
      this.output.setAttribute('role', 'log')
      container.appendChild(this.output)
    }
    reset() {
      if (this.output) this.output.textContent = ''
    }
    write(data: Uint8Array, callback?: () => void) {
      if (this.output) this.output.textContent += new TextDecoder().decode(data)
      callback?.()
    }
    resize(cols: number, rows: number) {
      this.cols = cols
      this.rows = rows
    }
    focus() {}
    dispose() {
      this.output?.remove()
    }
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
  updateCode: mocks.updateCode,
  base64ToBytes: vi.fn((data: string) => Uint8Array.from(atob(data), character => character.charCodeAt(0))),
  terminalBinaryStringToBytes: vi.fn(() => new Uint8Array()),
}))

vi.mock('@gchat/core', () => ({
  getJanDataFolderPath: vi.fn().mockResolvedValue('/data'),
}))

vi.mock('@/hooks/useServiceHub', () => {
  const hub = {
    path: () => ({
      join: (...parts: string[]) => Promise.resolve(parts.join('/')),
    }),
    events: () => ({ listen: mocks.listen }),
  }
  return { useServiceHub: () => hub }
})

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
vi.mock('@/hooks/useThreads', async () => {
  const { create } = await import('zustand')
  return { useThreads: create<any>((set) => ({
    threads: {},
    setThreads: (rows: Thread[]) => set({ threads: Object.fromEntries(rows.map(row => [row.id, row])) }),
  })) }
})
vi.mock('@/services/terminal/code-sessions', () => ({
  selectCodeSession: mocks.selectCodeSession,
  resolveCodeWorkspace: mocks.resolveCodeWorkspace,
  newCodeSession: mocks.newCodeSession,
  updateCodeBridgePolicy: mocks.updateCodeBridgePolicy,
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
vi.mock('@/containers/CodeBridgePanel', () => ({
  CodeBridgePanel: () => <button>GChat tools</button>,
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
function codeThread(id: string, directory = '/project'): Thread {
  return { id: `code-${id}`, title: 'Saved coding task', updated: 1,
    metadata: { runtime: 'code', code: { session_id: id, directory } } }
}

function sendRuntimeOutput(terminalId: string, text: string) {
  const attached = mocks.attachTerminal.mock.calls.find(([id]) => id === terminalId)
  if (!attached) throw new Error(`Workspace terminal is not attached: ${terminalId}`)
  attached[1]({ type: 'output', generation: 1, sequence: 2, data: btoa(text) })
}

describe('CodeTerminalHost', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useCodeTerminalStore.setState({ enabled: true, workspace: undefined, selectedThreadId: undefined })
    useThreads.setState({ threads: {} })
    useConversationPolicy.getState().clearAll()
    useToolAvailable.setState({ disabledTools: {}, defaultDisabledTools: [] })
    mocks.listen.mockResolvedValue(vi.fn())
    mocks.resolveCodeWorkspace.mockImplementation(async directory => directory ?? '/data/agent-workspace')
    mocks.selectCodeSession.mockResolvedValue(undefined)
    mocks.newCodeSession.mockResolvedValue(undefined)
    mocks.updateCodeBridgePolicy.mockResolvedValue(undefined)
    runtimeState.activeModels = ['qwen']
    mocks.writeTerminal.mockResolvedValue(undefined)
    mocks.attachTerminal.mockResolvedValue({
      phase: 'idle',
      generation: 0,
      sequence: 0,
      replayComplete: true,
    })
    mocks.provisionOpenCode.mockResolvedValue({
      ready: true,
      installed: true,
      configured: true,
      viaWsl: false,
      configPath: '/home/user/.config/opencode/opencode.json',
    })
    mocks.spawnTerminal.mockImplementation(async (request: TerminalSpawnRequest) => ({
      phase: 'running',
      generation: mocks.spawnTerminal.mock.calls.filter(([call]) => call.terminalId === request.terminalId).length,
      sequence: 1,
      cwd: request.cwd,
      launch: 'open_code',
      replayComplete: true,
    }))
  })

  it('starts only on Code entry, attaches before launch and retains live output across navigation', async () => {
    const { rerender } = render(<CodeTerminalHost visible={false} />)

    await act(async () => {})
    expect(mocks.spawnTerminal).not.toHaveBeenCalled()
    expect(mocks.terminalConstructed).not.toHaveBeenCalled()
    await act(async () => { rerender(<CodeTerminalHost visible />) })
    await waitFor(() => expect(mocks.spawnTerminal).toHaveBeenCalledTimes(1))
    expect(mocks.attachTerminal).toHaveBeenCalledTimes(1)
    expect(mocks.provisionOpenCode).toHaveBeenCalledTimes(1)
    expect(mocks.terminalConstructed).toHaveBeenCalledTimes(1)
    expect(mocks.attachTerminal.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.spawnTerminal.mock.invocationCallOrder[0]
    )
    const pane = screen.getByTestId('code-terminal')
    act(() => sendRuntimeOutput('code:/data/agent-workspace', 'The running task is waiting for input.'))
    expect(within(pane).getByRole('log')).toHaveTextContent('The running task is waiting for input.')

    await act(async () => { rerender(<CodeTerminalHost visible={false} />) })
    await act(async () => { rerender(<CodeTerminalHost visible />) })

    expect(mocks.terminalConstructed).toHaveBeenCalledTimes(1)
    expect(mocks.attachTerminal).toHaveBeenCalledTimes(1)
    expect(mocks.provisionOpenCode).toHaveBeenCalledTimes(1)
    expect(mocks.spawnTerminal).toHaveBeenCalledTimes(1)
    expect(screen.getByTestId('code-terminal')).toBe(pane)
    expect(within(pane).getByRole('log')).toHaveTextContent('The running task is waiting for input.')
    expect(screen.getByLabelText('code:status.running')).toBeInTheDocument()
  })

  it('updates Code in the background with confirmation and returns to the TUI', async () => {
    mocks.stopTerminal.mockResolvedValue({ phase: 'exited', generation: 1, sequence: 3, replayComplete: true })
    mocks.getTerminalStatus.mockResolvedValue({ phase: 'exited', generation: 1, sequence: 3, replayComplete: true })
    let finishUpdate!: (value: { logPath: string }) => void
    mocks.updateCode.mockImplementation((_path, progress) => {
      progress('Downloading and installing updates')
      return new Promise(resolve => { finishUpdate = resolve })
    })
    render(<CodeTerminalHost visible />)
    await waitFor(() => expect(mocks.spawnTerminal).toHaveBeenCalledTimes(1))
    fireEvent.click(screen.getByRole('button', { name: 'Update Code' }))
    expect(mocks.stopTerminal).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Stop and update' }))
    await waitFor(() => expect(screen.getByText('Downloading and installing updates')).toBeInTheDocument())
    expect(screen.getByRole('button', { name: 'Open Code' })).toBeDisabled()
    expect(mocks.spawnTerminal).toHaveBeenCalledTimes(1)
    finishUpdate({ logPath: '/code/gchat-update.log' })
    await waitFor(() => expect(screen.getByText('Update Successful')).toBeInTheDocument())
    expect(screen.queryByText('Diagnostics')).not.toBeInTheDocument()
    expect(screen.queryByText(/theme will be applied/)).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Open Code' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Update Code' })).toBeInTheDocument())
    expect(mocks.spawnTerminal).toHaveBeenCalledTimes(2)
  })

  it.each(['before', 'after'])('settles Stop when exit arrives %s its command reply and restarts with live output', async (order) => {
    let finishStop!: (status: TerminalStatus) => void
    const stopping: TerminalStatus = { phase: 'stopping', generation: 1, sequence: 3, replayComplete: true }
    mocks.stopTerminal.mockImplementation(() => new Promise<TerminalStatus>(resolve => { finishStop = resolve }))
    mocks.getTerminalStatus.mockResolvedValue({ phase: 'exited', generation: 1, sequence: 4, exitCode: 1, replayComplete: true })
    render(<CodeTerminalHost visible />)
    await waitFor(() => expect(screen.getByLabelText('code:status.running')).toBeInTheDocument())
    const onEvent = mocks.attachTerminal.mock.calls[0][1]
    act(() => onEvent({ type: 'output', generation: 1, sequence: 2, data: btoa('Initial output') }))
    fireEvent.click(screen.getByRole('button', { name: 'code:stop' }))

    if (order === 'after') {
      await act(async () => { finishStop(stopping) })
      expect(screen.getByLabelText('code:status.stopping')).toBeInTheDocument()
    }
    act(() => onEvent({ type: 'exited', generation: 1, sequence: 4, status: { phase: 'exited', generation: 1, sequence: 4, exitCode: 1, cwd: '/data/agent-workspace', replayComplete: true } }))
    if (order === 'before') await act(async () => { finishStop(stopping) })

    expect(screen.getByLabelText('code:status.exited')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'code:stop' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'code:restart' })).toBeEnabled()
    fireEvent.click(screen.getByRole('button', { name: 'code:restart' }))
    await waitFor(() => expect(screen.getByLabelText('code:status.running')).toBeInTheDocument())

    // The generation-2 spawn reply arrives before its Started/output events.
    act(() => {
      onEvent({ type: 'started', generation: 2, sequence: 1, status: { phase: 'running', generation: 2, sequence: 1, cwd: '/data/agent-workspace', launch: 'open_code', replayComplete: true } })
      onEvent({ type: 'output', generation: 2, sequence: 2, data: btoa('Restarted output') })
      onEvent({ type: 'exited', generation: 1, sequence: 5, status: { phase: 'exited', generation: 1, sequence: 5, exitCode: 1, cwd: '/data/agent-workspace', replayComplete: true } })
    })
    expect(screen.getByRole('log')).toHaveTextContent('Restarted output')
    expect(screen.getByRole('log')).not.toHaveTextContent('Initial output')
    expect(screen.getByLabelText('code:status.running')).toBeInTheDocument()
  })

  it('keeps a failed live Stop running and permits a successful retry', async () => {
    mocks.stopTerminal
      .mockRejectedValueOnce(new Error('Could not stop Code terminal: Access is denied. (os error 5)'))
      .mockResolvedValueOnce({ phase: 'stopping', generation: 1, sequence: 3, replayComplete: true })
    render(<CodeTerminalHost visible />)
    await waitFor(() => expect(screen.getByLabelText('code:status.running')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'code:stop' }))
    await screen.findByText('Error: Could not stop Code terminal: Access is denied. (os error 5)')
    expect(screen.getByLabelText('code:status.running')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'code:stop' })).toBeEnabled()
    expect(screen.queryByRole('button', { name: 'code:restart' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'code:stop' }))
    await waitFor(() => expect(screen.getByLabelText('code:status.stopping')).toBeInTheDocument())
    act(() => mocks.attachTerminal.mock.calls[0][1]({ type: 'exited', generation: 1, sequence: 4, status: { phase: 'exited', generation: 1, sequence: 4, exitCode: 1, cwd: '/data/agent-workspace', replayComplete: true } }))
    expect(screen.getByRole('button', { name: 'code:restart' })).toBeEnabled()
  })

  it('renders replay output even when a newer attach snapshot arrives first', async () => {
    mocks.attachTerminal.mockResolvedValue({ phase: 'running', generation: 1, sequence: 7, replayComplete: true })
    render(<CodeTerminalHost visible />)
    await waitFor(() => expect(screen.getByLabelText('code:status.running')).toBeInTheDocument())
    act(() => {
      const onEvent = mocks.attachTerminal.mock.calls[0][1]
      onEvent({ type: 'started', generation: 1, sequence: 1, status: { phase: 'running', generation: 1, sequence: 1, cwd: '/data/agent-workspace', launch: 'open_code', replayComplete: true } })
      onEvent({ type: 'output', generation: 1, sequence: 2, data: btoa('Retained screen') })
      onEvent({ type: 'output', generation: 1, sequence: 2, data: btoa('Duplicate output') })
    })
    expect(screen.getByRole('log')).toHaveTextContent('Retained screen')
    expect(screen.getByRole('log')).not.toHaveTextContent('Duplicate output')
    expect(screen.getByLabelText('code:status.running')).toBeInTheDocument()
    expect(mocks.spawnTerminal).not.toHaveBeenCalled()
  })

  it.each(['before', 'after'])('rebuilds a replaced terminal view when the attach snapshot arrives %s replay', async (order) => {
    const snapshot: TerminalStatus = { phase: 'running', generation: 1, sequence: 4, replayComplete: true }
    mocks.attachTerminal.mockResolvedValue(snapshot)
    const mounted = render(<CodeTerminalHost visible />)
    await screen.findByLabelText('code:status.running')
    const previousChannel = mocks.attachTerminal.mock.calls[0][1]
    const previousScreen = screen.getByRole('log')
    act(() => previousChannel({ type: 'output', generation: 1, sequence: 2, data: btoa('Old renderer') }))
    mounted.unmount()

    let finishAttach!: (status: TerminalStatus) => void
    mocks.attachTerminal.mockImplementation(() => new Promise<TerminalStatus>(resolve => { finishAttach = resolve }))
    const replacement = render(<CodeTerminalHost visible />)
    await waitFor(() => expect(mocks.attachTerminal).toHaveBeenCalledTimes(2))
    const onEvent = mocks.attachTerminal.mock.calls[1][1]
    const chunks = ['\x1b[2J\x1b[H', 'Retained task\r\n', '\x1b[3;7HWaiting for input']
    const replay = () => {
      onEvent({ type: 'started', generation: 1, sequence: 1, status: { ...snapshot, sequence: 1 } })
      chunks.forEach((text, index) => onEvent({ type: 'output', generation: 1, sequence: index + 2, data: btoa(text) }))
    }
    if (order === 'before') await act(async () => { finishAttach(snapshot) })
    act(replay)
    if (order === 'after') await act(async () => { finishAttach(snapshot) })
    const currentScreen = screen.getByRole('log')
    expect(currentScreen).not.toBe(previousScreen)
    expect(currentScreen.textContent).toBe(chunks.join(''))
    expect(mocks.terminalConstructed).toHaveBeenCalledTimes(2)
    expect(mocks.spawnTerminal).not.toHaveBeenCalled()

    // Repeated history must not reset or duplicate the current xterm screen.
    act(() => {
      replay()
      previousChannel({ type: 'output', generation: 1, sequence: 5, data: btoa('Disposed channel') })
      onEvent({ type: 'output', generation: 1, sequence: 5, data: btoa('\r\nLive continuation') })
    })
    expect(currentScreen.textContent).toBe(chunks.join('') + '\r\nLive continuation')
    await act(async () => { replacement.rerender(<CodeTerminalHost visible={false} />) })
    await act(async () => { replacement.rerender(<CodeTerminalHost visible />) })
    expect(screen.getByRole('log')).toBe(currentScreen)
    expect(mocks.attachTerminal).toHaveBeenCalledTimes(2)
  })

  it.each(['before', 'after'])('keeps unavailable history truthful when the attach snapshot arrives %s its event', async (order) => {
    const snapshot: TerminalStatus = { phase: 'running', generation: 1, sequence: 7, replayComplete: false }
    let finishAttach!: (status: TerminalStatus) => void
    mocks.attachTerminal.mockImplementation(() => new Promise<TerminalStatus>(resolve => { finishAttach = resolve }))
    const mounted = render(<CodeTerminalHost visible />)
    await waitFor(() => expect(mocks.attachTerminal).toHaveBeenCalledTimes(1))
    const onEvent = mocks.attachTerminal.mock.calls[0][1]
    if (order === 'before') await act(async () => { finishAttach(snapshot) })
    act(() => onEvent({ type: 'replay_unavailable', generation: 1, sequence: 7 }))
    if (order === 'after') await act(async () => { finishAttach(snapshot) })
    expect(screen.getByText('code:replayUnavailable')).toBeInTheDocument()
    expect(screen.getByLabelText('code:status.running')).toBeInTheDocument()
    act(() => onEvent({ type: 'error', generation: 1, sequence: 8, message: 'Same-generation status', status: { ...snapshot, sequence: 8 } }))
    expect(screen.getByText('code:replayUnavailable')).toBeInTheDocument()
    expect(mocks.spawnTerminal).not.toHaveBeenCalled()
    mounted.unmount()

    render(<CodeTerminalHost visible />)
    await waitFor(() => expect(mocks.attachTerminal).toHaveBeenCalledTimes(2))
    act(() => mocks.attachTerminal.mock.calls[1][1]({ type: 'replay_unavailable', generation: 1, sequence: 9 }))
    await act(async () => { finishAttach({ ...snapshot, sequence: 9 }) })
    expect(screen.getByText('code:replayUnavailable')).toBeInTheDocument()
    expect(screen.getByLabelText('code:status.running')).toBeInTheDocument()
    expect(screen.getByRole('log').textContent).toBe('')
    expect(mocks.spawnTerminal).not.toHaveBeenCalled()
  })

  it('ignores an old-generation attach reply after a new generation starts', async () => {
    let finishAttach!: (status: TerminalStatus) => void
    mocks.attachTerminal.mockImplementation(() => new Promise<TerminalStatus>(resolve => { finishAttach = resolve }))
    render(<CodeTerminalHost visible />)
    await waitFor(() => expect(mocks.attachTerminal).toHaveBeenCalledTimes(1))
    act(() => mocks.attachTerminal.mock.calls[0][1]({
      type: 'started', generation: 2, sequence: 1, status: { phase: 'running', generation: 2, sequence: 1, cwd: '/data/agent-workspace', launch: 'open_code', replayComplete: true },
    }))
    await act(async () => {
      finishAttach({ phase: 'stopping', generation: 1, sequence: 100, replayComplete: true })
    })
    expect(screen.getByLabelText('code:status.running')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'code:stop' })).toBeEnabled()
    expect(mocks.spawnTerminal).not.toHaveBeenCalled()
  })

  it.each(['running', 'exited'] as const)('uses the native %s status accompanying an error', async (phase) => {
    render(<CodeTerminalHost visible />)
    await waitFor(() => expect(screen.getByLabelText('code:status.running')).toBeInTheDocument())
    act(() => mocks.attachTerminal.mock.calls[0][1]({
      type: 'error', generation: 1, sequence: 2, message: 'Native terminal error',
      status: { phase, generation: 1, sequence: 2, replayComplete: true },
    }))
    expect(screen.getByText('Native terminal error')).toBeInTheDocument()
    expect(screen.getByLabelText(`code:status.${phase}`)).toBeInTheDocument()
    if (phase === 'running') expect(screen.getByRole('button', { name: 'code:stop' })).toBeEnabled()
    else expect(screen.getByRole('button', { name: 'code:restart' })).toBeEnabled()
  })

  it('shows an update failure with retry instead of an updater terminal', async () => {
    mocks.stopTerminal.mockResolvedValue({ phase: 'exited', generation: 1, sequence: 3, replayComplete: true })
    mocks.getTerminalStatus.mockResolvedValue({ phase: 'exited', generation: 1, sequence: 3, replayComplete: true })
    mocks.updateCode.mockRejectedValue(new Error('Code did not reach the requested version.'))
    render(<CodeTerminalHost visible />)
    await waitFor(() => expect(mocks.spawnTerminal).toHaveBeenCalledTimes(1))
    fireEvent.click(screen.getByRole('button', { name: 'Update Code' }))
    fireEvent.click(screen.getByRole('button', { name: 'Stop and update' }))
    await waitFor(() => expect(screen.getByText('Update needs attention')).toBeInTheDocument())
    expect(screen.getByRole('button', { name: 'Retry update' })).toBeEnabled()
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
      'code:/data/agent-workspace',
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
  it('restores a saved session and workspace after the host is recreated', async () => {
    const row = codeThread('ses_saved')
    useThreads.setState({ threads: { [row.id]: row } })
    useCodeTerminalStore.setState({ selectedThreadId: row.id })
    const mounted = render(<CodeTerminalHost visible />)
    await waitFor(() => expect(mocks.spawnTerminal).toHaveBeenCalledTimes(1))
    expect(mocks.spawnTerminal).toHaveBeenCalledWith(expect.objectContaining({
      terminalId: 'code:/project', cwd: '/project', codeSessionId: 'ses_saved',
      bridgePolicy: expect.objectContaining({ origin_session_id: row.id }),
    }))
    mounted.unmount()
    mocks.attachTerminal.mockResolvedValue({ phase: 'idle', generation: 0, sequence: 0, replayComplete: true })
    render(<CodeTerminalHost visible />)
    await waitFor(() => expect(mocks.spawnTerminal).toHaveBeenCalledTimes(2))
    expect(mocks.spawnTerminal.mock.calls[1][0].codeSessionId).toBe('ses_saved')
  })

  it('switches saved sessions in one workspace through the stock API without restarting', async () => {
    const first = codeThread('ses_first')
    const second = codeThread('ses_second')
    useThreads.setState({ threads: { [first.id]: first, [second.id]: second } })
    useCodeTerminalStore.setState({ selectedThreadId: first.id })
    render(<CodeTerminalHost visible />)
    await waitFor(() => expect(mocks.spawnTerminal).toHaveBeenCalledTimes(1))
    const pane = screen.getByTestId('code-terminal')
    act(() => sendRuntimeOutput('code:/project', 'Background task is still running.'))
    act(() => useCodeTerminalStore.getState().setSelectedThreadId(second.id))
    await waitFor(() => expect(mocks.selectCodeSession).toHaveBeenCalledWith('code:/project', 'ses_second'))
    expect(mocks.spawnTerminal).toHaveBeenCalledTimes(1)
    expect(mocks.stopTerminal).not.toHaveBeenCalled()
    expect(mocks.terminalConstructed).toHaveBeenCalledTimes(1)
    expect(screen.getByTestId('code-terminal')).toBe(pane)
    expect(within(pane).getByRole('log')).toHaveTextContent('Background task is still running.')
    expect(screen.getByLabelText('code:status.running')).toBeInTheDocument()
  })

  it('retains live workspace terminals while selecting sessions in another workspace', async () => {
    const first = codeThread('ses_first', '/first')
    const second = codeThread('ses_second', '/second')
    useThreads.setState({ threads: { [first.id]: first, [second.id]: second } })
    useCodeTerminalStore.setState({ selectedThreadId: first.id })
    render(<CodeTerminalHost visible />)
    await waitFor(() => expect(mocks.spawnTerminal).toHaveBeenCalledTimes(1))
    const firstPane = screen.getByTestId('code-terminal')
    act(() => sendRuntimeOutput('code:/first', 'First workspace task is active.'))
    act(() => useCodeTerminalStore.getState().setSelectedThreadId(second.id))
    await waitFor(() => expect(mocks.spawnTerminal).toHaveBeenCalledTimes(2))
    const secondPane = screen.getAllByTestId('code-terminal').find(pane => pane !== firstPane)!
    act(() => sendRuntimeOutput('code:/second', 'Second workspace task is active.'))
    expect(within(firstPane).queryByRole('log')).toBeNull()
    expect(screen.getByRole('log')).toHaveTextContent('Second workspace task is active.')
    expect(within(firstPane).getByRole('log', { hidden: true })).toHaveTextContent('First workspace task is active.')
    act(() => useCodeTerminalStore.getState().setSelectedThreadId(first.id))
    await act(async () => {})
    expect(mocks.spawnTerminal).toHaveBeenCalledTimes(2)
    expect(mocks.stopTerminal).not.toHaveBeenCalled()
    expect(mocks.terminalConstructed).toHaveBeenCalledTimes(2)
    expect(screen.getAllByTestId('code-terminal')).toContain(firstPane)
    expect(screen.getAllByTestId('code-terminal')).toContain(secondPane)
    expect(screen.getAllByTestId('code-terminal')).toHaveLength(2)
    expect(screen.getByRole('log')).toHaveTextContent('First workspace task is active.')
    expect(within(secondPane).queryByRole('log')).toBeNull()
    expect(within(firstPane).getByRole('log', { hidden: true })).toHaveTextContent('First workspace task is active.')
    expect(within(secondPane).getByRole('log', { hidden: true })).toHaveTextContent('Second workspace task is active.')
  })

  it('registers stock picker selection in the shared index and persisted selection', async () => {
    render(<CodeTerminalHost visible />)
    await waitFor(() => expect(mocks.spawnTerminal).toHaveBeenCalledTimes(1))
    const callback = mocks.listen.mock.calls[0][1]
    const row = codeThread('ses_picked', '/data/agent-workspace')
    act(() => callback({ payload: { kind: 'selected', terminalId: 'code:/data/agent-workspace', thread: row } }))
    expect(useThreads.getState().threads[row.id].metadata?.runtime).toBe('code')
    expect(useCodeTerminalStore.getState().selectedThreadId).toBe(row.id)
    expect(mocks.spawnTerminal).toHaveBeenCalledTimes(1)
  })

  it('syncs each saved origin policy and updates background workspace permissions', async () => {
    const first = codeThread('ses_first', '/first')
    const background = codeThread('ses_background', '/first')
    const second = codeThread('ses_second', '/second')
    useThreads.setState({ threads: { [first.id]: first, [background.id]: background, [second.id]: second } })
    useConversationPolicy.getState().setApprovalMode(first.id, 'skip')
    useConversationPolicy.getState().addExternalRoot(background.id, {
      rootId: 'documents', path: '/documents', name: 'Documents', canEdit: false,
    })
    useToolAvailable.getState().setToolDisabledForThread(background.id, 'native', 'os.fs.write_file', false)
    useCodeTerminalStore.setState({ selectedThreadId: first.id })
    render(<CodeTerminalHost visible />)
    await waitFor(() => expect(mocks.updateCodeBridgePolicy).toHaveBeenCalledWith('code:/first', {
      origin_session_id: background.id, auto_approve: false,
      disabled_tools: ['native::os.fs.write_file'],
      external_roots: [{ path: '/documents', can_edit: false }],
    }))
    expect(mocks.updateCodeBridgePolicy).toHaveBeenCalledWith('code:/first', expect.objectContaining({
      origin_session_id: first.id, auto_approve: true,
    }))
    const firstPane = screen.getByTestId('code-terminal')
    act(() => sendRuntimeOutput('code:/first', 'Background session remains active.'))
    act(() => useCodeTerminalStore.getState().setSelectedThreadId(second.id))
    await waitFor(() => expect(mocks.spawnTerminal).toHaveBeenCalledTimes(2))
    act(() => useConversationPolicy.getState().setExternalRootPermission(background.id, 'documents', true))
    await waitFor(() => expect(mocks.updateCodeBridgePolicy).toHaveBeenCalledWith('code:/first', expect.objectContaining({
      origin_session_id: background.id, external_roots: [{ path: '/documents', can_edit: true }],
    })))
    expect(mocks.stopTerminal).not.toHaveBeenCalled()
    expect(within(firstPane).queryByRole('log')).toBeNull()
    expect(within(firstPane).getByRole('log', { hidden: true })).toHaveTextContent('Background session remains active.')
    expect(screen.getAllByLabelText('code:status.running')).toHaveLength(2)
  })

})

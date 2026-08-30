import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  base64ToBytes,
  bytesToBase64,
  provisionHermes,
  provisionOpenCode,
  terminalBinaryStringToBytes,
} from './tauri'

const mocks = vi.hoisted(() => ({ invoke: vi.fn() }))

vi.mock('@tauri-apps/api/core', () => ({
  Channel: class MockChannel {
    onmessage?: (value: unknown) => void
  },
  invoke: mocks.invoke,
}))

const missingReadiness = {
  ready: false,
  installed: false,
  configured: false,
  viaWsl: false,
  configPath: 'C:\\Users\\test\\.config\\opencode\\opencode.jsonc',
  reason: 'not_installed',
}

const unconfiguredReadiness = {
  ...missingReadiness,
  installed: true,
  reason: 'missing_configuration',
}

const readyReadiness = {
  ...unconfiguredReadiness,
  ready: true,
  configured: true,
  reason: undefined,
}

beforeEach(() => {
  mocks.invoke.mockReset()
})

describe('terminal byte transport', () => {
  it('round trips arbitrary PTY bytes through base64', () => {
    const input = new Uint8Array([0, 1, 27, 127, 128, 255])
    expect(base64ToBytes(bytesToBase64(input))).toEqual(input)
  })

  it('preserves xterm binary input code units as bytes', () => {
    expect(terminalBinaryStringToBytes(String.fromCharCode(0, 127, 255))).toEqual(
      new Uint8Array([0, 127, 255])
    )
  })
})

describe('OpenCode provisioning', () => {
  it('installs, configures, verifies, and reports each phase', async () => {
    const readiness = [missingReadiness, unconfiguredReadiness, readyReadiness]
    mocks.invoke.mockImplementation((command: string) => {
      if (command === 'opencode_readiness')
        return Promise.resolve(readiness.shift())
      return Promise.resolve()
    })
    const phases: string[] = []

    await expect(
      provisionOpenCode(
        {
          apiUrl: 'http://127.0.0.1:1337/v1',
          model: 'qwen',
          apiKey: 'gchat',
        },
        (phase) => phases.push(phase)
      )
    ).resolves.toEqual(readyReadiness)

    expect(phases).toEqual(['checking', 'installing', 'configuring'])
    expect(mocks.invoke.mock.calls.map(([command]) => command)).toEqual([
      'opencode_readiness',
      'install_agent',
      'opencode_readiness',
      'configure_opencode',
      'opencode_readiness',
    ])
    expect(mocks.invoke).toHaveBeenCalledWith('install_agent', {
      agentId: 'opencode',
      proxy: undefined,
    })
  })

  it('installs immediately and waits for a model before configuring', async () => {
    const readiness = [missingReadiness, unconfiguredReadiness]
    mocks.invoke.mockImplementation((command: string) => {
      if (command === 'opencode_readiness')
        return Promise.resolve(readiness.shift())
      return Promise.resolve()
    })

    await expect(
      provisionOpenCode({ apiUrl: 'http://127.0.0.1:1337/v1' })
    ).resolves.toEqual(unconfiguredReadiness)
    expect(mocks.invoke.mock.calls.map(([command]) => command)).not.toContain(
      'configure_opencode'
    )
  })

  it('replaces a WSL-only OpenCode with a native executable', async () => {
    const readiness = [
      {
        ...missingReadiness,
        installed: true,
        viaWsl: true,
        reason: 'wsl_only',
      },
      readyReadiness,
      readyReadiness,
    ]
    mocks.invoke.mockImplementation((command: string) => {
      if (command === 'opencode_readiness')
        return Promise.resolve(readiness.shift())
      return Promise.resolve()
    })

    await expect(
      provisionOpenCode({
        apiUrl: 'http://127.0.0.1:1337/v1',
        model: 'qwen',
      })
    ).resolves.toEqual(readyReadiness)
    expect(mocks.invoke.mock.calls.map(([command]) => command)).toEqual([
      'opencode_readiness',
      'install_agent',
      'opencode_readiness',
      'configure_opencode',
      'opencode_readiness',
    ])
  })

  it('refreshes a ready provider so live model limits do not go stale', async () => {
    mocks.invoke.mockImplementation((command: string) =>
      Promise.resolve(
        command === 'opencode_readiness' ? readyReadiness : undefined
      )
    )

    await expect(
      provisionOpenCode({
        apiUrl: 'http://127.0.0.1:1337/v1',
        model: 'qwen',
      })
    ).resolves.toEqual(readyReadiness)

    expect(mocks.invoke.mock.calls.map(([command]) => command)).toEqual([
      'opencode_readiness',
      'configure_opencode',
      'opencode_readiness',
    ])
  })

  it('shares one installer across StrictMode bootstrap effects', async () => {
    let resolveReadiness: ((value: typeof readyReadiness) => void) | undefined
    let readinessCalls = 0
    mocks.invoke.mockImplementation((command: string) => {
      if (command !== 'opencode_readiness') return Promise.resolve()
      readinessCalls += 1
      if (readinessCalls > 1) return Promise.resolve(readyReadiness)
      return (
        new Promise((resolve) => {
          resolveReadiness = resolve
        })
      )
    })
    const request = {
      apiUrl: 'http://127.0.0.1:1337/v1',
      model: 'qwen',
    }

    const first = provisionOpenCode(request)
    const second = provisionOpenCode(request)
    expect(second).toBe(first)
    expect(mocks.invoke).toHaveBeenCalledTimes(1)

    resolveReadiness?.(readyReadiness)
    await expect(first).resolves.toEqual(readyReadiness)
  })
})

describe('Hermes provisioning', () => {
  it('installs, configures, and verifies the native Hermes integration', async () => {
    const readiness = [
      {
        ...missingReadiness,
        configPath: 'C:\\Users\\test\\AppData\\Local\\hermes\\config.yaml',
      },
      {
        ...unconfiguredReadiness,
        configPath: 'C:\\Users\\test\\AppData\\Local\\hermes\\config.yaml',
      },
      {
        ...readyReadiness,
        configPath: 'C:\\Users\\test\\AppData\\Local\\hermes\\config.yaml',
      },
    ]
    mocks.invoke.mockImplementation((command: string) => {
      if (command === 'hermes_readiness') {
        return Promise.resolve(readiness.shift())
      }
      return Promise.resolve()
    })
    const phases: string[] = []

    await expect(
      provisionHermes(
        {
          apiUrl: 'http://127.0.0.1:1337/v1',
          model: 'qwen',
          apiKey: 'gchat',
          contextLength: 65_536,
        },
        (phase) => phases.push(phase)
      )
    ).resolves.toMatchObject({ ready: true })

    expect(phases).toEqual(['checking', 'installing', 'configuring'])
    expect(mocks.invoke.mock.calls.map(([command]) => command)).toEqual([
      'hermes_readiness',
      'install_agent',
      'hermes_readiness',
      'configure_hermes_agent',
      'hermes_readiness',
    ])
    expect(mocks.invoke).toHaveBeenCalledWith('configure_hermes_agent', {
      apiUrl: 'http://127.0.0.1:1337/v1',
      model: 'qwen',
      apiKey: 'gchat',
      contextLength: 65_536,
    })
  })
})

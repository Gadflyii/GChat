import { render, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { EmbeddedIntegrationProvisioner } from '@/containers/EmbeddedIntegrationProvisioner'

const testState = vi.hoisted(() => ({
  openCodeEnabled: true,
  hermesEnabled: true,
  calls: [] as Array<{ integration: string; model?: string }>,
}))

vi.mock('@/lib/platform/utils', () => ({
  isPlatformTauri: () => true,
  isIOS: () => false,
  isAndroid: () => false,
}))

vi.mock('@/hooks/useAppState', () => ({
  useAppState: (selector: (state: unknown) => unknown) =>
    selector({ activeModels: ['qwen'] }),
}))

vi.mock('@/hooks/useLocalApiServer', () => ({
  useLocalApiServer: () => ({
    serverHost: '0.0.0.0',
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

vi.mock('@/stores/code-terminal-store', () => ({
  useCodeTerminalStore: (selector: (state: unknown) => unknown) =>
    selector({ enabled: testState.openCodeEnabled }),
}))

vi.mock('@/stores/hermes-agent-store', () => ({
  useHermesAgentStore: (selector: (state: unknown) => unknown) =>
    selector({ enabled: testState.hermesEnabled, model: null }),
}))

vi.mock('@/stores/launch-settings-store', () => ({
  useLaunchSettings: (selector: (state: unknown) => unknown) =>
    selector({ customPaths: {} }),
}))

vi.mock('@/services/terminal/tauri', () => ({
  provisionOpenCode: (request: { model?: string }) => {
    testState.calls.push({ integration: 'opencode', model: request.model })
    return Promise.resolve({ ready: true })
  },
  provisionHermes: (request: { model?: string }) => {
    testState.calls.push({ integration: 'hermes', model: request.model })
    return Promise.resolve({ ready: true })
  },
}))

describe('EmbeddedIntegrationProvisioner', () => {
  beforeEach(() => {
    testState.openCodeEnabled = true
    testState.hermesEnabled = true
    testState.calls = []
  })

  it('provisions both default integrations in sequence without opening a tab', async () => {
    render(<EmbeddedIntegrationProvisioner />)

    await waitFor(() => {
      expect(testState.calls).toEqual([
        { integration: 'opencode', model: 'qwen' },
        { integration: 'hermes', model: 'qwen' },
      ])
    })
  })

  it('does not provision integrations disabled in Settings', async () => {
    testState.openCodeEnabled = false
    testState.hermesEnabled = false
    render(<EmbeddedIntegrationProvisioner />)

    await waitFor(() => expect(testState.calls).toEqual([]))
  })
})

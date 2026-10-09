import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ServiceHub } from '@/services'
import { ensureRemoteProviderReady } from './ensureRemoteProviderReady'
import { ensureLocalApiServerRunning } from './ensureLocalApiServerRunning'
import { useAppState } from '@/hooks/useAppState'
import { useLocalApiServer } from '@/hooks/useLocalApiServer'

const { registerRemoteProvider } = vi.hoisted(
  () => ({
    registerRemoteProvider: vi.fn(),
  })
)

vi.mock('@/utils/registerRemoteProvider', () => ({
  isLocalProvider: (provider: string) =>
    ['llamacpp', 'llamacpp-upstream', 'mlx', 'foundation-models'].includes(
      provider
    ),
  isKeylessRemoteProvider: (provider: ModelProvider) =>
    provider.base_url?.startsWith('http://localhost') ?? false,
  registerRemoteProvider,
}))

const provider = {
  provider: 'openai',
  base_url: 'https://api.openai.com/v1',
  api_key: 'test-key',
  models: [{ id: 'gpt-test' }],
} as ModelProvider

function serviceHubWithStatus(running: boolean): Pick<ServiceHub, 'app'> {
  return {
    app: () =>
      ({
        getServerStatus: vi.fn().mockResolvedValue(running),
      }) as ReturnType<ServiceHub['app']>,
  }
}

describe('ensureRemoteProviderReady', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useAppState.setState({ serverStatus: 'stopped', pendingModelStops: 0, intentionallyStoppedModels: new Set() })
    useLocalApiServer.setState({ serverHost: '127.0.0.1', serverPort: 1337,
      apiPrefix: '/v1', apiKey: '', trustedHosts: [], corsEnabled: true,
      verboseLogs: false, proxyTimeout: 600 })
    registerRemoteProvider.mockResolvedValue(true)
    window.core = {
      api: {
        startServer: vi.fn().mockResolvedValue(1337),
      },
    } as typeof window.core
  })

  it('registers a remote provider without restarting a running proxy', async () => {
    await ensureRemoteProviderReady(provider, serviceHubWithStatus(true))

    expect(registerRemoteProvider).toHaveBeenCalledWith(provider)
    expect(window.core?.api?.startServer).not.toHaveBeenCalled()
    expect(useAppState.getState().serverStatus).toBe('running')
  })

  it('starts the proxy before resolving when it is stopped', async () => {
    await ensureRemoteProviderReady(provider, serviceHubWithStatus(false))

    expect(window.core?.api?.startServer).toHaveBeenCalledWith({
      host: '127.0.0.1',
      port: 1337,
      prefix: '/v1',
      apiKey: '',
      trustedHosts: [],
      isCorsEnabled: true,
      isVerboseEnabled: false,
      proxyTimeout: 600,
    })
    expect(useAppState.getState().serverStatus).toBe('running')
  })

  it('shares one native start between persisted Host-provider readiness and the Ready-edge intake', async () => {
    let releaseStart: (port: number) => void = () => {}
    vi.mocked(window.core!.api!.startServer).mockImplementation(() =>
      new Promise<number>(resolve => { releaseStart = resolve }))
    const services = serviceHubWithStatus(false)
    const selectedHostProvider = { ...provider, provider: 'ginfer-lan',
      base_url: 'http://localhost:1337/v1', api_key: '', models: [{ id: 'ginfer/local/instance' }] } as ModelProvider
    const hydration = ensureRemoteProviderReady(selectedHostProvider, services)
    const readyEdge = ensureLocalApiServerRunning(services)
    await vi.waitFor(() => expect(registerRemoteProvider).toHaveBeenCalledWith(selectedHostProvider))
    await vi.waitFor(() => expect(window.core!.api!.startServer).toHaveBeenCalledOnce())
    releaseStart(1444)
    await Promise.all([hydration, readyEdge])
    expect(window.core!.api!.startServer).toHaveBeenCalledOnce()
    expect(useAppState.getState().serverStatus).toBe('running')
    expect(useLocalApiServer.getState().serverPort).toBe(1444)
  })

  it('rejects a remote provider without a base URL before registration', async () => {
    await expect(
      ensureRemoteProviderReady(
        { ...provider, base_url: '' },
        serviceHubWithStatus(false)
      )
    ).rejects.toThrow('has no configured base URL')

    expect(registerRemoteProvider).not.toHaveBeenCalled()
  })
})

import { describe, expect, it, vi } from 'vitest'
import { useLocalApiServer } from '@/hooks/useLocalApiServer'
import { useEngineHosts } from '@/stores/engine-hosts-store'
import { engineCommand } from '@/services/engines'

const providers = vi.hoisted(() => ({
  getProviderByName: vi.fn(() => ({ provider: 'ginfer-lan' })),
  updateProvider: vi.fn(),
}))
vi.mock('@/hooks/useModelProvider', () => ({
  useModelProvider: { getState: () => providers },
}))
vi.mock('@/services/engines', async (original) => ({
  ...(await original<object>()),
  engineCommand: vi.fn(),
}))

describe('LAN facade address projection', () => {
  it('does not republish an unchanged provider projection during capacity refresh', async () => {
    const settings = useLocalApiServer.getState()
    const existing = {
      provider: 'ginfer-lan',
      active: true,
      settings: [],
      models: [],
      base_url: `http://127.0.0.1:${settings.serverPort}/${settings.apiPrefix.replace(/^\/+|\/+$/g, '')}`,
      api_key: settings.apiKey,
    }
    providers.getProviderByName.mockReturnValue(existing)
    providers.updateProvider.mockClear()
    vi.mocked(engineCommand).mockResolvedValue({
      registered: [],
      discovered: [],
    })
    await useEngineHosts.getState().refresh()
    expect(useEngineHosts.getState().refreshing).toBe(false)
    expect(useEngineHosts.getState().hosts).toEqual([])
    expect(providers.updateProvider).not.toHaveBeenCalled()
  })
  it('updates existing model routes immediately when the facade assigns a port or changes credentials', () => {
    useLocalApiServer.setState({
      serverPort: 14567,
      apiPrefix: '/v1/',
      apiKey: 'local-test-key',
    })
    expect(providers.updateProvider).toHaveBeenLastCalledWith('ginfer-lan', {
      base_url: 'http://127.0.0.1:14567/v1',
      api_key: 'local-test-key',
    })
  })
})

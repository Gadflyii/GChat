import { describe, expect, it, vi } from 'vitest'
import { useLocalApiServer } from '@/hooks/useLocalApiServer'
import '@/stores/engine-hosts-store'

const providers = vi.hoisted(() => ({
  getProviderByName: vi.fn(() => ({ provider: 'ginfer-lan' })),
  updateProvider: vi.fn(),
}))
vi.mock('@/hooks/useModelProvider', () => ({ useModelProvider: { getState: () => providers } }))

describe('LAN facade address projection', () => {
  it('updates existing model routes immediately when the facade assigns a port or changes credentials', () => {
    useLocalApiServer.setState({ serverPort: 14567, apiPrefix: '/v1/', apiKey: 'local-test-key' })
    expect(providers.updateProvider).toHaveBeenLastCalledWith('ginfer-lan', {
      base_url: 'http://127.0.0.1:14567/v1', api_key: 'local-test-key',
    })
  })
})

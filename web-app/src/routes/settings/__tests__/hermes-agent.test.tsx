import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { Route as HermesRoute } from '../hermes-agent'

const mocks = vi.hoisted(() => ({
  toastError: vi.fn(),
  toastInfo: vi.fn(),
  toastSuccess: vi.fn(),
  startServer: vi.fn(),
  getActiveModels: vi.fn(),
  invoke: vi.fn(),
  getModelToStart: vi.fn(),
}))

vi.mock('sonner', () => ({
  toast: { error: mocks.toastError, info: mocks.toastInfo, success: mocks.toastSuccess },
}))
vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke }))
vi.mock('@/services/terminal/tauri', () => ({ stopTerminal: vi.fn() }))
vi.mock('@/utils/getModelToStart', () => ({ getModelToStart: mocks.getModelToStart }))
vi.mock('@/utils/activeModelsSync', () => ({ syncActiveModelsFromEngines: vi.fn() }))
vi.mock('@/containers/HeaderPage', () => ({ default: () => null }))
vi.mock('@/containers/SettingsMenu', () => ({ default: () => null }))
vi.mock('@/containers/ProvidersAvatar', () => ({ default: () => null }))
vi.mock('@/containers/Capabilities', () => ({ default: () => null }))
vi.mock('@/i18n/react-i18next-compat', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))
vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (config: Record<string, unknown>) => ({ ...config }),
}))
vi.mock('@/hooks/useLocalApiServer', () => ({
  useLocalApiServer: () => ({
    corsEnabled: true,
    verboseLogs: false,
    serverHost: '127.0.0.1',
    serverPort: 1337,
    setServerPort: vi.fn(),
    apiPrefix: '/v1',
    apiKey: '',
    trustedHosts: [],
    proxyTimeout: 600,
    setLastServerModels: vi.fn(),
  }),
}))
vi.mock('@/hooks/useHermesAgentModel', () => ({
  useHermesAgentModel: () => ({
    config: { model: '', enabled: false },
    setModel: vi.fn(),
    setEnabled: vi.fn(),
    clearModel: vi.fn(),
  }),
}))
vi.mock('@/hooks/useAppState', () => ({
  useAppState: () => ({ serverStatus: 'stopped', setServerStatus: vi.fn() }),
}))
vi.mock('@/hooks/useModelProvider', () => ({
  useModelProvider: () => ({
    providers: [],
    selectedModel: undefined,
    selectedProvider: undefined,
    getProviderByName: vi.fn(),
  }),
}))
vi.mock('@/hooks/useServiceHub', () => ({
  useServiceHub: () => ({
    models: () => ({ getActiveModels: mocks.getActiveModels }),
  }),
}))

describe('Hermes Agent settings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getActiveModels.mockResolvedValue([])
    mocks.getModelToStart.mockReturnValue(null)
    window.core = { api: { startServer: mocks.startServer } } as never
  })

  it('does not start the local server when Save is chosen with no model to use', async () => {
    const Component = (HermesRoute as unknown as { component: React.ComponentType }).component
    render(<Component />)

    fireEvent.click(screen.getByRole('button', { name: /Save connection/ }))

    await waitFor(() =>
      expect(mocks.toastError).toHaveBeenCalledWith(
        'Choose a model, then select Save connection again.'
      )
    )
    expect(mocks.startServer).not.toHaveBeenCalled()
    expect(mocks.toastInfo).not.toHaveBeenCalled()
    expect(mocks.invoke).not.toHaveBeenCalled()
  })
})

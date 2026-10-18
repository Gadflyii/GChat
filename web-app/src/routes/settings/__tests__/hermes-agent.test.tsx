import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { Route as HermesRoute } from '../hermes-agent'
import type { AgentModelInstance } from '@/types/agent'

const mocks = vi.hoisted(() => ({
  toastError: vi.fn(), toastInfo: vi.fn(), toastSuccess: vi.fn(),
  startServer: vi.fn(), getActiveModels: vi.fn(), startModel: vi.fn(),
  invoke: vi.fn(), getModelToStart: vi.fn(), listInstances: vi.fn(),
  setModel: vi.fn(), setEnabled: vi.fn(), setServerPort: vi.fn(),
  initialModel: '', providers: [] as ModelProvider[], serverStatus: 'stopped',
}))

vi.mock('sonner', () => ({
  toast: { error: mocks.toastError, info: mocks.toastInfo, success: mocks.toastSuccess },
}))
vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke }))
vi.mock('@/services/agent/definitions', () => ({ listAgentModelInstances: mocks.listInstances }))
vi.mock('@/lib/utils', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/utils')>(),
  isLocalProvider: (provider: string) => provider === 'ginfer',
}))
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
    corsEnabled: true, verboseLogs: false, serverHost: '127.0.0.1',
    serverPort: 1337, setServerPort: mocks.setServerPort, apiPrefix: '/v1',
    apiKey: '', trustedHosts: [], proxyTimeout: 600, setLastServerModels: vi.fn(),
  }),
}))
vi.mock('@/hooks/useHermesAgentModel', async () => {
  const { useState, useCallback } = await import('react')
  return {
    useHermesAgentModel: () => {
      const [model, updateModel] = useState(mocks.initialModel)
      const setModel = useCallback((next: string) => {
        mocks.setModel(next)
        updateModel(next)
      }, [])
      return {
        config: { model, enabled: false }, setModel,
        setEnabled: mocks.setEnabled, clearModel: vi.fn(),
      }
    },
  }
})
vi.mock('@/hooks/useAppState', () => ({
  useAppState: () => ({ serverStatus: mocks.serverStatus, setServerStatus: vi.fn() }),
}))
vi.mock('@/hooks/useModelProvider', () => ({
  useModelProvider: () => ({
    providers: mocks.providers, selectedModel: undefined,
    selectedProvider: undefined, getProviderByName: vi.fn(),
  }),
}))
vi.mock('@/hooks/useServiceHub', () => ({
  useServiceHub: () => ({
    models: () => ({ getActiveModels: mocks.getActiveModels, startModel: mocks.startModel }),
  }),
}))

const ready: AgentModelInstance = {
  id: 'ginfer/host-one/instance-one', modelId: 'qwen3.8-27b',
  hostName: 'Private Host', port: null, maxContext: 262144, aliases: [],
}
const imported: ModelProvider = {
  provider: 'ginfer', active: true, models: [{ id: 'imported-qwen' }], settings: [],
} as ModelProvider
const Component = (HermesRoute as unknown as { component: React.ComponentType }).component

async function save() {
  fireEvent.click(screen.getByRole('button', { name: 'Save connection' }))
  await waitFor(() => expect(screen.getByRole('button', { name: 'Save connection' })).toBeEnabled())
}

describe('Hermes Agent settings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.initialModel = ''
    mocks.providers = []
    mocks.serverStatus = 'stopped'
    mocks.getActiveModels.mockResolvedValue([])
    mocks.getModelToStart.mockReturnValue(null)
    mocks.listInstances.mockResolvedValue([])
    mocks.startModel.mockResolvedValue(undefined)
    mocks.startServer.mockResolvedValue(1337)
    mocks.invoke.mockResolvedValue(undefined)
    window.core = { api: { startServer: mocks.startServer } } as never
  })

  it('does not start the local server when Save is chosen with no model to use', async () => {
    render(<Component />)
    await save()
    expect(screen.getByRole('button', { name: 'Save connection' })).toBeEnabled()
    expect(screen.queryByText('Connection details (advanced)')).not.toBeInTheDocument()
    expect(mocks.toastError).toHaveBeenCalledWith('Choose a model, then select Save connection again.')
    expect(mocks.startServer).not.toHaveBeenCalled()
    expect(mocks.toastInfo).not.toHaveBeenCalled()
    expect(mocks.invoke).not.toHaveBeenCalled()
  })

  it('offers a Ready Host without an API key or plugin attachment and saves its exact alias and live context', async () => {
    mocks.initialModel = 'imported-qwen'
    mocks.providers = [imported, {
      provider: 'ginfer-lan', active: true, api_key: '', settings: [],
      models: [{ id: ready.id, displayName: 'Qwen Ready on Private Host' }],
    } as ModelProvider]
    mocks.listInstances.mockResolvedValue([ready])
    render(<Component />)
    fireEvent.click(screen.getByRole('button', { name: /Local.*imported-qwen/ }))
    fireEvent.click(await screen.findByText('Qwen Ready on Private Host'))
    await save()
    expect(screen.getByText('262144')).toBeInTheDocument()
    expect(screen.getByText(ready.id)).toBeInTheDocument()
    expect(mocks.startModel).not.toHaveBeenCalled()
    expect(mocks.invoke).toHaveBeenCalledWith('configure_hermes_agent', {
      apiUrl: 'http://127.0.0.1:1337/v1', model: ready.id,
      apiKey: undefined, contextLength: 262144,
    })
    expect(mocks.setModel).toHaveBeenLastCalledWith(ready.id)
    expect(mocks.setEnabled).toHaveBeenCalledWith(true)
  })

  it('retains a confirmed imported alias as the exact Ready instance', async () => {
    mocks.initialModel = 'imported-qwen'
    mocks.providers = [imported]
    mocks.listInstances.mockResolvedValue([{ ...ready, aliases: ['imported-qwen'] }])
    render(<Component />)
    await save()
    expect(screen.getByRole('button', { name: /Ready.*qwen3.8-27b/ })).toBeEnabled()
    expect(screen.getByText(ready.id)).toBeInTheDocument()
    expect(mocks.startModel).not.toHaveBeenCalled()
    expect(mocks.invoke).toHaveBeenCalledWith('configure_hermes_agent', expect.objectContaining({ model: ready.id }))
    expect(mocks.setModel).toHaveBeenCalledWith(ready.id)
  })

  it('does not substitute an unrelated Ready Host and permits retry after automatic startup fails', async () => {
    mocks.initialModel = 'imported-qwen'
    mocks.providers = [imported]
    mocks.listInstances.mockResolvedValue([ready])
    mocks.startModel.mockRejectedValue(new Error('No tested settings are available'))
    render(<Component />)
    await save()
    expect(screen.getByRole('button', { name: /Local.*imported-qwen/ })).toBeEnabled()
    expect(screen.queryByText('Connection details (advanced)')).not.toBeInTheDocument()
    expect(mocks.startModel).toHaveBeenCalledWith(imported, 'imported-qwen', true)
    expect(mocks.invoke).not.toHaveBeenCalled()
    expect(mocks.toastError).toHaveBeenCalledWith('Could not save the Hermes Agent connection', {
      description: 'No tested settings are available',
    })
    await save()
    expect(mocks.startModel).toHaveBeenCalledTimes(2)
  })

  it('uses the actual Ready context after a qualified automatic start', async () => {
    mocks.initialModel = 'imported-qwen'
    mocks.providers = [imported]
    mocks.listInstances.mockResolvedValueOnce([]).mockResolvedValueOnce([])
      .mockResolvedValue([{ ...ready, aliases: ['imported-qwen'] }])
    render(<Component />)
    await save()
    expect(screen.getByText('262144')).toBeInTheDocument()
    expect(mocks.startModel).toHaveBeenCalledWith(imported, 'imported-qwen', true)
    expect(mocks.invoke).toHaveBeenCalledWith('configure_hermes_agent', expect.objectContaining({
      model: ready.id, contextLength: 262144,
    }))
  })

  it('holds Save, selection and Clear until configuration finishes and prevents duplicate Save', async () => {
    mocks.initialModel = ready.id
    mocks.listInstances.mockResolvedValue([ready])
    let finish!: () => void
    mocks.invoke.mockReturnValueOnce(new Promise<void>((resolve) => { finish = resolve }))
    render(<Component />)
    await screen.findByRole('button', { name: /Ready.*qwen3.8-27b/ })
    const button = screen.getByRole('button', { name: 'Save connection' })
    fireEvent.click(button)
    fireEvent.click(button)
    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledOnce())
    expect(screen.getByRole('button', { name: 'Saving connection…' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Clear connection' })).toBeDisabled()
    expect(screen.getByRole('button', { name: /Ready.*qwen3.8-27b/ })).toBeDisabled()
    finish()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save connection' })).toBeEnabled())
  })

  it('requires an exact choice when a model alias matches multiple Ready instances', async () => {
    mocks.initialModel = 'imported-qwen'
    mocks.providers = [imported]
    mocks.listInstances.mockResolvedValue([
      { ...ready, aliases: ['imported-qwen'] },
      { ...ready, id: 'ginfer/host-two/instance-two', aliases: ['imported-qwen'] },
    ])
    render(<Component />)
    await save()
    expect(screen.getByRole('button', { name: /Local.*imported-qwen/ })).toBeEnabled()
    expect(screen.queryByText('Connection details (advanced)')).not.toBeInTheDocument()
    expect(mocks.toastError).toHaveBeenCalledWith('Could not save the Hermes Agent connection', {
      description: expect.stringContaining('multiple Ready instances'),
    })
    expect(mocks.startModel).not.toHaveBeenCalled()
    expect(mocks.invoke).not.toHaveBeenCalled()
  })

  it.each([32768, undefined])('rejects insufficient or unknown live context (%s) without advertising a larger value', async (maxContext) => {
    mocks.initialModel = ready.id
    mocks.listInstances.mockResolvedValue([{ ...ready, maxContext }])
    render(<Component />)
    await save()
    expect(screen.queryByText('Connection details (advanced)')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save connection' })).toBeEnabled()
    expect(mocks.toastError).toHaveBeenCalledWith('Could not save the Hermes Agent connection', {
      description: expect.stringContaining('at least 65,536 conversation tokens'),
    })
    expect(mocks.startModel).not.toHaveBeenCalled()
    expect(mocks.startServer).not.toHaveBeenCalled()
    expect(mocks.invoke).not.toHaveBeenCalled()
  })

  it('refreshes readiness on Save and does not restart a selected Host that stopped after selection', async () => {
    mocks.initialModel = ready.id
    mocks.listInstances.mockResolvedValueOnce([ready]).mockResolvedValue([])
    render(<Component />)
    await screen.findByRole('button', { name: /Ready.*qwen3.8-27b/ })
    await save()
    expect(screen.getByRole('button', { name: 'Choose a model' })).toBeEnabled()
    expect(screen.queryByText('Connection details (advanced)')).not.toBeInTheDocument()
    expect(mocks.toastError).toHaveBeenCalledWith('Could not save the Hermes Agent connection', {
      description: expect.stringContaining('no longer Ready'),
    })
    expect(mocks.startModel).not.toHaveBeenCalled()
    expect(mocks.invoke).not.toHaveBeenCalled()
  })

  it('uses the assigned API port and recovers from a failed configuration write', async () => {
    mocks.initialModel = ready.id
    mocks.listInstances.mockResolvedValue([ready])
    mocks.startServer.mockResolvedValue(1444)
    mocks.invoke.mockRejectedValueOnce(new Error('Config write failed'))
    render(<Component />)
    await save()
    expect(screen.queryByText('Connection details (advanced)')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save connection' })).toBeEnabled()
    expect(mocks.setEnabled).not.toHaveBeenCalled()
    await save()
    expect(screen.getByText('http://127.0.0.1:1444/v1')).toBeInTheDocument()
    expect(mocks.invoke).toHaveBeenLastCalledWith('configure_hermes_agent', {
      apiUrl: 'http://127.0.0.1:1444/v1', model: ready.id,
      apiKey: undefined, contextLength: 262144,
    })
    expect(mocks.setServerPort).toHaveBeenCalledWith(1444)
    expect(mocks.setEnabled).toHaveBeenCalledWith(true)
  })
})

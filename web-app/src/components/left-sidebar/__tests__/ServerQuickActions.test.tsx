import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { toast } from 'sonner'
import { useAppState } from '@/hooks/useAppState'
import { useModelProvider } from '@/hooks/useModelProvider'
import { useLocalApiServer } from '@/hooks/useLocalApiServer'
import type { ModelsService } from '@/services/models/types'
import type { AppService } from '@/services/app/types'
import { resetServiceHubStore, seedServiceHub } from '@/test/service-hub'
import { ServerQuickActions } from '../ServerQuickActions'
import { shouldAttemptAutoStart, switchToModel } from '@/utils/switchModel'

const models = vi.hoisted(() => ({
  stopModel: vi.fn(),
  startModel: vi.fn(),
  getActiveModels: vi.fn(),
  stopAllModels: vi.fn(),
}))

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), dismiss: vi.fn() },
}))

vi.mock('@/components/ui/dropdown-menu', () => ({
  DropdownMenu: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuItem: ({ children, onSelect }: { children: React.ReactNode; onSelect: () => void }) => (
    <button onClick={onSelect}>{children}</button>
  ),
}))

vi.mock('@/components/ui/sidebar', () => ({
  SidebarMenuItem: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SidebarMenuButton: ({ children, disabled }: { children: React.ReactNode; disabled: boolean }) => (
    <button disabled={disabled}>{children}</button>
  ),
}))

describe('sidebar server shortcut', () => {
  const stopServer = vi.fn()
  const startServer = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    seedServiceHub({ models: models as unknown as ModelsService })
    window.core = { api: { stopServer, startServer } } as typeof window.core
    stopServer.mockResolvedValue(undefined)
    startServer.mockResolvedValue(1337)
    models.stopModel.mockResolvedValue({ success: true })
    models.startModel.mockResolvedValue(undefined)
    models.stopAllModels.mockResolvedValue(undefined)
    models.getActiveModels.mockResolvedValue(['other-model'])
    useModelProvider.setState({
      selectedProvider: 'ginfer',
      selectedModel: { id: 'shortcut-model' } as Model,
      providers: [{
        provider: 'ginfer',
        models: [{ id: 'shortcut-model' }, { id: 'other-model' }, { id: 'switch-model' }, { id: 'later-model' }],
      }] as ModelProvider[],
    })
    useAppState.setState({
      serverStatus: 'running',
      activeModels: ['shortcut-model', 'other-model'],
      intentionallyStoppedModels: new Set(),
      pendingModelStops: 0,
    })
    useLocalApiServer.setState({
      defaultModelLocalApiServer: { model: 'shortcut-model', provider: 'ginfer' },
    })
  })

  afterEach(() => {
    cleanup()
    resetServiceHubStore()
  })

  it('stops the API and only the shortcut model, then refreshes loaded models', async () => {
    render(<ServerQuickActions />)
    fireEvent.click(screen.getByRole('button', { name: /Stop server/ }))

    await waitFor(() => expect(models.getActiveModels).toHaveBeenCalledOnce())
    expect(stopServer).toHaveBeenCalledOnce()
    expect(models.stopModel).toHaveBeenCalledExactlyOnceWith('shortcut-model', 'ginfer')
    expect(stopServer.mock.invocationCallOrder[0]).toBeLessThan(
      models.stopModel.mock.invocationCallOrder[0]
    )
    expect(useAppState.getState().serverStatus).toBe('stopped')
    expect(useAppState.getState().activeModels).toEqual(['other-model'])
    expect(shouldAttemptAutoStart('ginfer', 'shortcut-model')).toBe(false)
    expect(shouldAttemptAutoStart('ginfer', 'other-model')).toBe(true)
    expect(toast.success).toHaveBeenCalledWith('Local API Server and model stopped')
  })

  it('reports an unload failure while keeping the API stopped and refreshed state', async () => {
    models.stopModel.mockResolvedValue({ success: false, error: 'Host refused unload' })
    models.getActiveModels.mockResolvedValue(['shortcut-model', 'other-model'])
    render(<ServerQuickActions />)
    fireEvent.click(screen.getByRole('button', { name: /Stop server/ }))

    await waitFor(() => expect(toast.error).toHaveBeenCalled())
    expect(useAppState.getState().serverStatus).toBe('stopped')
    expect(useAppState.getState().activeModels).toEqual(['shortcut-model', 'other-model'])
    expect(toast.error).toHaveBeenCalledWith(
      'Local API Server stopped, but the model could not be unloaded',
      expect.objectContaining({ description: expect.stringContaining('Host refused unload') })
    )
    expect(toast.success).not.toHaveBeenCalled()
    expect(shouldAttemptAutoStart('ginfer', 'shortcut-model')).toBe(false)
  })

  it('offers Stop model when the API is already stopped', async () => {
    useAppState.setState({ serverStatus: 'stopped' })
    render(<ServerQuickActions />)
    expect(screen.getByText('Model loaded')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Start server/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Reload model/ })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Stop model/ }))

    await waitFor(() => expect(models.stopModel).toHaveBeenCalledOnce())
    expect(stopServer).not.toHaveBeenCalled()
    expect(models.stopModel).toHaveBeenCalledWith('shortcut-model', 'ginfer')
    expect(useAppState.getState().activeModels).toEqual(['other-model'])
    expect(toast.success).toHaveBeenCalledWith('Model stopped')
    expect(shouldAttemptAutoStart('ginfer', 'shortcut-model')).toBe(false)
  })

  it('does not unload a model when API shutdown fails', async () => {
    stopServer.mockRejectedValue(new Error('port shutdown failed'))
    render(<ServerQuickActions />)
    fireEvent.click(screen.getByRole('button', { name: /Stop server/ }))

    await waitFor(() => expect(toast.error).toHaveBeenCalled())
    expect(useAppState.getState().serverStatus).toBe('running')
    expect(models.stopModel).not.toHaveBeenCalled()
    expect(models.getActiveModels).not.toHaveBeenCalled()
    expect(shouldAttemptAutoStart('ginfer', 'shortcut-model')).toBe(true)
  })

  it('lets explicit Start reload the stopped model and resume automatic recovery', async () => {
    useAppState.setState({ serverStatus: 'stopped', activeModels: [] })
    useAppState.getState().setIntentionalModelStop('ginfer', 'shortcut-model', true)
    models.getActiveModels.mockResolvedValueOnce([]).mockResolvedValue(['shortcut-model'])
    render(<ServerQuickActions />)
    fireEvent.click(screen.getByRole('button', { name: /Start server/ }))

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Local API Server started'))
    expect(models.startModel).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'ginfer' }), 'shortcut-model', true
    )
    expect(startServer).toHaveBeenCalledOnce()
    expect(useAppState.getState().serverStatus).toBe('running')
    expect(shouldAttemptAutoStart('ginfer', 'shortcut-model')).toBe(true)
  })

  it('stops the resolved model after an in-flight switch and lets a later explicit switch start', async () => {
    let releaseProbe: (running: boolean) => void = () => {}
    const getServerStatus = vi.fn()
      .mockImplementationOnce(() => new Promise<boolean>((resolve) => {
        releaseProbe = resolve
      }))
      .mockResolvedValue(false)
    let loaded = ['shortcut-model']
    models.getActiveModels.mockImplementation(async () => [...loaded])
    models.stopAllModels.mockImplementation(async () => { loaded = [] })
    models.startModel.mockImplementation(async (_provider: ModelProvider, id: string) => {
      loaded = [id]
    })
    models.stopModel.mockImplementation(async (id: string) => {
      loaded = loaded.filter((model) => model !== id)
      return { success: true }
    })
    const serviceHub = seedServiceHub({
      models: models as unknown as ModelsService,
      app: { getServerStatus } as unknown as AppService,
    })
    render(<ServerQuickActions />)

    const firstSwitch = switchToModel({
      modelId: 'switch-model', providerName: 'ginfer', serviceHub,
    })
    await waitFor(() => expect(getServerStatus).toHaveBeenCalledOnce())
    fireEvent.click(screen.getByRole('button', { name: /Stop server/ }))
    expect(useAppState.getState().pendingModelStops).toBe(1)
    expect(shouldAttemptAutoStart('ginfer', 'switch-model')).toBe(false)

    const laterSwitch = switchToModel({
      modelId: 'later-model', providerName: 'ginfer', serviceHub,
    })
    releaseProbe(false)
    await Promise.all([firstSwitch, laterSwitch])
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Local API Server and model stopped'))

    expect(models.stopModel).toHaveBeenCalledExactlyOnceWith('switch-model', 'ginfer')
    expect(models.startModel.mock.calls.map(([, id]) => id)).toEqual(['switch-model', 'later-model'])
    expect(models.stopModel.mock.invocationCallOrder[0]).toBeGreaterThan(
      models.startModel.mock.invocationCallOrder[0]
    )
    expect(models.stopModel.mock.invocationCallOrder[0]).toBeLessThan(
      models.startModel.mock.invocationCallOrder[1]
    )
    expect(useAppState.getState().pendingModelStops).toBe(0)
    expect(shouldAttemptAutoStart('ginfer', 'switch-model')).toBe(false)
    expect(shouldAttemptAutoStart('ginfer', 'later-model')).toBe(true)
  })
})

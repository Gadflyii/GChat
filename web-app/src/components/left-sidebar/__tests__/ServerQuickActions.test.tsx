import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { toast } from 'sonner'
import { useAppState } from '@/hooks/useAppState'
import { useModelProvider } from '@/hooks/useModelProvider'
import type { ModelsService } from '@/services/models/types'
import { resetServiceHubStore, seedServiceHub } from '@/test/service-hub'
import { ServerQuickActions } from '../ServerQuickActions'

const models = vi.hoisted(() => ({
  stopModel: vi.fn(),
  getActiveModels: vi.fn(),
}))

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
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

  beforeEach(() => {
    vi.clearAllMocks()
    seedServiceHub({ models: models as unknown as ModelsService })
    window.core = { api: { stopServer } } as typeof window.core
    stopServer.mockResolvedValue(undefined)
    models.stopModel.mockResolvedValue({ success: true })
    models.getActiveModels.mockResolvedValue(['other-model'])
    useModelProvider.setState({
      providers: [{
        provider: 'ginfer',
        models: [{ id: 'shortcut-model' }, { id: 'other-model' }],
      }] as ModelProvider[],
    })
    useAppState.setState({
      serverStatus: 'running',
      activeModels: ['shortcut-model', 'other-model'],
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
  })

  it('does not unload a model when API shutdown fails', async () => {
    stopServer.mockRejectedValue(new Error('port shutdown failed'))
    render(<ServerQuickActions />)
    fireEvent.click(screen.getByRole('button', { name: /Stop server/ }))

    await waitFor(() => expect(toast.error).toHaveBeenCalled())
    expect(useAppState.getState().serverStatus).toBe('running')
    expect(models.stopModel).not.toHaveBeenCalled()
    expect(models.getActiveModels).not.toHaveBeenCalled()
  })
})

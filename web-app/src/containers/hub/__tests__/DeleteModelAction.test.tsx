import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useAppState } from '@/hooks/useAppState'
import { useFavoriteModel } from '@/hooks/useFavoriteModel'
import { useModelProvider } from '@/hooks/useModelProvider'
import type { ModelsService } from '@/services/models/types'
import type { ProvidersService } from '@/services/providers/types'
import { seedServiceHub } from '@/test/service-hub'

vi.mock('@/i18n/react-i18next-compat', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { modelId?: string }) =>
      key === 'common:deleteModel.title' && options?.modelId
        ? `${key}:${options.modelId}`
        : key,
  }),
}))

const toastSuccess = vi.fn()
const toastError = vi.fn()
vi.mock('sonner', () => ({
  toast: {
    success: (...args: unknown[]) => toastSuccess(...args),
    error: (...args: unknown[]) => toastError(...args),
  },
}))

import { DeleteModelAction } from '../DeleteModelAction'

const deleteModel = vi.fn()
const stopModel = vi.fn()
const getProviders = vi.fn()

const llamacpp = (ids: string[]): ModelProvider =>
  ({
    active: true,
    provider: 'llamacpp',
    persist: true,
    settings: [],
    models: ids.map((id) => ({ id })),
  }) as ModelProvider

const openConfirm = async () => {
  const user = userEvent.setup()
  await user.click(
    screen.getByRole('button', { name: 'common:deleteModel.delete' })
  )
  const confirm = await screen.findAllByRole('button', {
    name: 'common:deleteModel.delete',
  })
  return { user, confirm: confirm[confirm.length - 1] }
}

describe('DeleteModelAction', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    deleteModel.mockResolvedValue(undefined)
    stopModel.mockResolvedValue(undefined)
    getProviders.mockResolvedValue([llamacpp([])])
    seedServiceHub({
      models: { deleteModel, stopModel } as unknown as ModelsService,
      providers: { getProviders } as unknown as ProvidersService,
    })
    useModelProvider.setState({
      providers: [llamacpp(['Qwen3-4B-Q4_K_M'])],
      deletedModels: [],
    })
    useFavoriteModel.setState({
      favoriteModels: [{ id: 'Qwen3-4B-Q4_K_M' } as Model],
    })
    useAppState.setState({ activeModels: [] })
  })

  it('only deletes after the confirmation is accepted', async () => {
    render(<DeleteModelAction modelId="Qwen3-4B-Q4_K_M" provider="llamacpp" />)

    expect(deleteModel).not.toHaveBeenCalled()

    const { user, confirm } = await openConfirm()
    await user.click(confirm)

    await waitFor(() =>
      expect(deleteModel).toHaveBeenCalledWith('Qwen3-4B-Q4_K_M', 'llamacpp')
    )
  })

  it('names the model by its readable label, not its package hash, in the confirmation', async () => {
    const hash = 'a'.repeat(64)
    render(
      <DeleteModelAction modelId={hash} label="Qwen 27B 2-bit mix" provider="llamacpp" />
    )
    await openConfirm()
    expect(
      screen.getByText('common:deleteModel.title:Qwen 27B 2-bit mix')
    ).toBeInTheDocument()
    expect(screen.queryByText(new RegExp(hash))).not.toBeInTheDocument()
  })

  it('explains that removing an external model leaves the original file in place', async () => {
    render(<DeleteModelAction modelId="external-model" label="My model" provider="ginfer" externalReference />)
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Remove from Models' }))
    expect(screen.getByText('Remove My model from Models?')).toBeInTheDocument()
    expect(screen.getByText('The original model file will remain in place. Only its Models entry will be removed.')).toBeInTheDocument()
    await user.click(screen.getAllByRole('button', { name: 'Remove from Models' }).at(-1)!)
    await waitFor(() => expect(deleteModel).toHaveBeenCalledWith('external-model', 'ginfer'))
    expect(toastSuccess).toHaveBeenCalledWith('Model removed', expect.objectContaining({ description: 'Removed from Models. The original file remains in place.' }))
  })

  it('drops the model from the provider list and from favorites', async () => {
    const onDeleted = vi.fn()
    render(
      <DeleteModelAction
        modelId="Qwen3-4B-Q4_K_M"
        provider="llamacpp"
        onDeleted={onDeleted}
      />
    )

    const { user, confirm } = await openConfirm()
    await user.click(confirm)

    await waitFor(() => expect(onDeleted).toHaveBeenCalled())
    await waitFor(() =>
      expect(
        useModelProvider
          .getState()
          .providers.flatMap((provider) => provider.models)
      ).toHaveLength(0)
    )
    expect(useFavoriteModel.getState().favoriteModels).toHaveLength(0)
    expect(toastSuccess).toHaveBeenCalledWith('Model deleted', expect.any(Object))
  })

  it('preserves a running model when the backend refuses removal', async () => {
    useAppState.setState({ activeModels: ['Qwen3-4B-Q4_K_M'] })
    deleteModel.mockRejectedValue(new Error('Stop this model before deleting its files.'))
    render(<DeleteModelAction modelId="Qwen3-4B-Q4_K_M" provider="llamacpp" />)

    const { user, confirm } = await openConfirm()
    await user.click(confirm)

    await waitFor(() => expect(toastError).toHaveBeenCalled())
    expect(stopModel).not.toHaveBeenCalled()
    expect(useAppState.getState().activeModels).toEqual(['Qwen3-4B-Q4_K_M'])
    expect(useModelProvider.getState().providers[0].models.map(m => m.id)).toEqual(['Qwen3-4B-Q4_K_M'])
  })

  it('keeps the model listed and reports the failure when the engine refuses', async () => {
    deleteModel.mockRejectedValue(new Error('Model does not exist'))
    render(<DeleteModelAction modelId="Qwen3-4B-Q4_K_M" provider="llamacpp" />)

    const { user, confirm } = await openConfirm()
    await user.click(confirm)

    await waitFor(() => expect(toastError).toHaveBeenCalled())
    expect(screen.getByRole('alert')).toHaveTextContent('Could not delete this model. Stop it if it is running, then try again.')
    expect(screen.getByText('Model does not exist')).not.toBeVisible()
    await user.click(screen.getByText('Technical details'))
    expect(screen.getByText('Model does not exist')).toBeVisible()
    expect(getProviders).not.toHaveBeenCalled()
    expect(
      useModelProvider.getState().providers[0].models.map((m) => m.id)
    ).toEqual(['Qwen3-4B-Q4_K_M'])
  })
})

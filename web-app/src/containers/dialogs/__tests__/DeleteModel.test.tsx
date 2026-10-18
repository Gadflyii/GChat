import {
  act,
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TranslationContext } from '@/i18n/context'
import i18n from '@/i18n/setup'
import { useFavoriteModel } from '@/hooks/useFavoriteModel'
import { useModelProvider } from '@/hooks/useModelProvider'
import type { ModelsService } from '@/services/models/types'
import type { ProvidersService } from '@/services/providers/types'
import { resetServiceHubStore, seedServiceHub } from '@/test/service-hub'
import { DialogDeleteModel } from '../DeleteModel'

const mocks = vi.hoisted(() => ({
  deleteModel: vi.fn(),
  getProviders: vi.fn(),
  stopModel: vi.fn(),
  startModel: vi.fn(),
  warning: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
}))

vi.mock('sonner', () => ({
  toast: { success: mocks.success, error: mocks.error, warning: mocks.warning },
}))

const provider: ModelProvider = {
  provider: 'ginfer',
  active: true,
  persist: true,
  settings: [],
  models: [{ id: 'model-first' }, { id: 'model-selected' }],
}

function modelDeletion(selectedProvider = provider, modelId?: string) {
  return (
    <TranslationContext.Provider value={{ t: i18n.t, i18n }}>
      <DialogDeleteModel provider={selectedProvider} modelId={modelId} />
    </TranslationContext.Provider>
  )
}

function deferred<T = void>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((done, fail) => {
    resolve = done
    reject = fail
  })
  return { promise, resolve, reject }
}

beforeEach(async () => {
  vi.resetAllMocks()
  mocks.deleteModel.mockResolvedValue(undefined)
  mocks.getProviders.mockResolvedValue([{ ...provider, models: [] }])
  mocks.stopModel.mockResolvedValue(undefined)
  mocks.startModel.mockResolvedValue(undefined)
  seedServiceHub({
    models: {
      deleteModel: mocks.deleteModel,
      stopModel: mocks.stopModel,
      startModel: mocks.startModel,
    } as unknown as ModelsService,
    providers: { getProviders: mocks.getProviders } as unknown as ProvidersService,
  })
  useModelProvider.setState({
    providers: [provider],
    deletedModels: [],
    selectedProvider: 'ginfer',
    selectedModel: { id: 'model-selected' } as Model,
  })
  useFavoriteModel.setState({ favoriteModels: [{ id: 'model-selected' } as Model] })
  await i18n.changeLanguage('en')
})

afterEach(() => {
  cleanup()
  resetServiceHubStore()
  vi.restoreAllMocks()
})

describe('DialogDeleteModel deletion result', () => {
  it.each(['click', 'Enter', 'Space'] as const)(
    'opens through native trigger %s and lets Enter on Cancel close safely',
    async (activation) => {
      const user = userEvent.setup()
      render(modelDeletion(provider, 'model-selected'))
      const trigger = screen.getByRole('button', { name: 'Delete' })

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      if (activation === 'click') {
        await user.click(trigger)
      } else {
        trigger.focus()
        await user.keyboard(activation === 'Enter' ? '{Enter}' : ' ')
      }

      const dialog = screen.getByRole('dialog', {
        name: 'Delete Model: model-selected',
      })
      await waitFor(() =>
        expect(within(dialog).getByRole('button', { name: 'Cancel' })).toHaveFocus()
      )
      expect(mocks.deleteModel).not.toHaveBeenCalled()

      await user.keyboard('{Enter}')

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      expect(mocks.deleteModel).not.toHaveBeenCalled()
      expect(mocks.success).not.toHaveBeenCalled()
    }
  )

  it.each(['click', 'Enter', 'Space'] as const)(
    'deletes the selected model once through native %s and closes after success',
    async (activation) => {
      const deletion = deferred()
      mocks.deleteModel.mockReturnValue(deletion.promise)
      const user = userEvent.setup()
      render(modelDeletion(provider, 'model-selected'))
      await user.click(screen.getByRole('button', { name: 'Delete' }))
      const dialog = screen.getByRole('dialog')
      const remove = within(dialog).getByRole('button', { name: 'Delete' })

      if (activation === 'click') {
        await user.click(remove)
      } else {
        remove.focus()
        await user.keyboard(activation === 'Enter' ? '{Enter}' : ' ')
      }

      expect(mocks.deleteModel).toHaveBeenCalledExactlyOnceWith(
        'model-selected',
        'ginfer'
      )
      expect(dialog).toBeInTheDocument()
      expect(mocks.success).not.toHaveBeenCalled()

      await act(async () => {
        deletion.resolve()
        await deletion.promise
      })

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      expect(mocks.deleteModel).toHaveBeenCalledOnce()
      expect(mocks.success).toHaveBeenCalledExactlyOnceWith(
        'Delete Model: model-selected',
        {
          id: 'delete-model-model-selected',
          description: 'Model model-selected has been permanently deleted.',
        }
      )
      expect(mocks.error).not.toHaveBeenCalled()
    }
  )

  it('guards repeated native clicks before the pending controls render', async () => {
    const deletion = deferred()
    mocks.deleteModel.mockReturnValue(deletion.promise)
    const user = userEvent.setup()
    render(modelDeletion(provider, 'model-selected'))
    await user.click(screen.getByRole('button', { name: 'Delete' }))
    const remove = within(screen.getByRole('dialog')).getByRole('button', {
      name: 'Delete',
    })

    act(() => {
      remove.click()
      remove.click()
      remove.click()
    })

    expect(mocks.deleteModel).toHaveBeenCalledExactlyOnceWith(
      'model-selected',
      'ginfer'
    )
    expect(remove).toBeDisabled()

    await act(async () => {
      deletion.resolve()
      await deletion.promise
    })

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(mocks.deleteModel).toHaveBeenCalledOnce()
  })

  it('shows pending state and blocks repeated activation and dismissal', async () => {
    const deletion = deferred()
    mocks.deleteModel.mockReturnValue(deletion.promise)
    const user = userEvent.setup()
    render(modelDeletion(provider, 'model-selected'))
    await user.click(screen.getByRole('button', { name: 'Delete' }))
    const dialog = screen.getByRole('dialog')
    const remove = within(dialog).getByRole('button', { name: 'Delete' })
    const cancel = within(dialog).getByRole('button', { name: 'Cancel' })
    await user.click(remove)

    expect(dialog).toHaveAttribute('aria-busy', 'true')
    expect(remove).toBeDisabled()
    expect(remove).toHaveAttribute('aria-busy', 'true')
    expect(remove).toHaveTextContent('Loading...')
    expect(cancel).toBeDisabled()
    expect(within(dialog).queryByRole('button', { name: 'Close' })).not.toBeInTheDocument()

    await user.dblClick(remove)
    await user.keyboard('{Enter} {Escape}')
    await user.click(cancel)

    expect(mocks.deleteModel).toHaveBeenCalledOnce()
    expect(dialog).toBeInTheDocument()
    expect(mocks.success).not.toHaveBeenCalled()

    await act(async () => {
      deletion.resolve()
      await deletion.promise
    })

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(mocks.deleteModel).toHaveBeenCalledOnce()
  })

  it('keeps a failed deletion open with its error and permits a successful retry', async () => {
    const first = deferred()
    const retry = deferred()
    mocks.deleteModel
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(retry.promise)
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const user = userEvent.setup()
    render(modelDeletion(provider, 'model-selected'))
    await user.click(screen.getByRole('button', { name: 'Delete' }))
    const dialog = screen.getByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }))

    await act(async () => {
      first.reject(new Error('Model files could not be removed'))
      await first.promise.catch(() => undefined)
    })

    expect(dialog).toBeInTheDocument()
    expect(within(dialog).getByRole('alert')).toHaveTextContent(
      'Model files could not be removed'
    )
    expect(within(dialog).getByRole('button', { name: 'Delete' })).toBeEnabled()
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toBeEnabled()
    expect(mocks.deleteModel).toHaveBeenCalledOnce()
    expect(mocks.error).toHaveBeenCalledOnce()
    expect(mocks.success).not.toHaveBeenCalled()
    expect(mocks.warning).not.toHaveBeenCalled()
    expect(mocks.getProviders).not.toHaveBeenCalled()
    expect(useModelProvider.getState().providers[0].models.map(model => model.id)).toEqual(['model-first', 'model-selected'])
    expect(useModelProvider.getState().selectedModel?.id).toBe('model-selected')
    expect(useFavoriteModel.getState().favoriteModels.map(model => model.id)).toEqual(['model-selected'])

    await user.click(within(dialog).getByRole('button', { name: 'Delete' }))

    expect(mocks.deleteModel).toHaveBeenCalledTimes(2)
    expect(mocks.deleteModel).toHaveBeenNthCalledWith(
      2,
      'model-selected',
      'ginfer'
    )
    expect(within(dialog).queryByRole('alert')).not.toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Delete' })).toBeDisabled()

    await act(async () => {
      retry.resolve()
      await retry.promise
    })

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(mocks.deleteModel).toHaveBeenCalledTimes(2)
    expect(mocks.success).toHaveBeenCalledOnce()
  })

  it('keeps accepted deletion recoverable after Settings unmounts without replaying it on failed or successful reads', async () => {
    const deletion = deferred()
    const initialRead = deferred<ModelProvider[]>()
    const failedRetry = deferred<ModelProvider[]>()
    const successfulRetry = deferred<ModelProvider[]>()
    mocks.deleteModel.mockReturnValueOnce(deletion.promise)
    mocks.getProviders
      .mockReturnValueOnce(initialRead.promise)
      .mockReturnValueOnce(failedRetry.promise)
      .mockReturnValueOnce(successfulRetry.promise)
    const user = userEvent.setup()
    const settings = render(modelDeletion(provider, 'model-selected'))
    await user.click(screen.getByRole('button', { name: 'Delete' }))
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete' }))

    await act(async () => {
      deletion.resolve()
      await deletion.promise
    })

    expect(mocks.getProviders).toHaveBeenCalledOnce()
    expect(useModelProvider.getState().providers[0].models.map(model => model.id)).toEqual(['model-first'])
    expect(useFavoriteModel.getState().favoriteModels).toHaveLength(0)
    expect(useModelProvider.getState().selectedModel).toBeNull()
    expect(screen.getByRole('dialog')).toHaveAttribute('aria-busy', 'true')
    await act(async () => {
      initialRead.reject(new Error('Provider inventory unavailable at /models/catalog.json'))
      await initialRead.promise.catch(() => undefined)
    })

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(mocks.deleteModel).toHaveBeenCalledExactlyOnceWith('model-selected', 'ginfer')
    expect(mocks.error).not.toHaveBeenCalled()
    expect(mocks.success).not.toHaveBeenCalled()
    expect(mocks.warning).toHaveBeenCalledExactlyOnceWith('Delete Model: model-selected', {
      id: 'delete-model-model-selected',
      duration: Infinity,
      description: expect.anything(),
    })

    settings.unmount()
    render(mocks.warning.mock.calls[0][1].description)
    expect(screen.getByText('Model model-selected has been permanently deleted.')).toBeVisible()
    expect(screen.getByText('The model list could not be refreshed. Choose Refresh model list to try again.')).toBeVisible()
    const details = screen.getByText('Technical details').closest('details')
    expect(details).not.toHaveAttribute('open')
    expect(screen.getByText('Provider inventory unavailable at /models/catalog.json')).not.toBeVisible()
    const refresh = screen.getByRole('button', { name: 'Refresh model list' })
    act(() => {
      refresh.click()
      refresh.click()
    })

    expect(mocks.getProviders).toHaveBeenCalledTimes(2)
    expect(refresh).toBeDisabled()
    expect(refresh).toHaveTextContent('Refreshing model list…')
    await act(async () => {
      failedRetry.reject(new Error('Provider inventory is still unavailable'))
      await failedRetry.promise.catch(() => undefined)
    })

    expect(refresh).toBeEnabled()
    expect(details).not.toHaveAttribute('open')
    expect(screen.getByText('Provider inventory is still unavailable')).not.toBeVisible()
    expect(mocks.success).not.toHaveBeenCalled()
    expect(useModelProvider.getState().selectedModel).toBeNull()
    await user.click(refresh)
    expect(mocks.getProviders).toHaveBeenCalledTimes(3)
    await act(async () => {
      successfulRetry.resolve([provider])
      await successfulRetry.promise
    })

    expect(mocks.success).toHaveBeenCalledExactlyOnceWith('Delete Model: model-selected', {
      id: 'delete-model-model-selected',
      description: 'Model model-selected has been permanently deleted. The model list is up to date.',
    })
    expect(useModelProvider.getState().providers[0].models.map(model => model.id)).toEqual(['model-first'])
    expect(useModelProvider.getState().selectedModel).toBeNull()
    expect(useFavoriteModel.getState().favoriteModels).toHaveLength(0)
    expect(mocks.deleteModel).toHaveBeenCalledOnce()
    expect(mocks.stopModel).not.toHaveBeenCalled()
    expect(mocks.startModel).not.toHaveBeenCalled()
    expect(mocks.error).not.toHaveBeenCalled()
  })

  it('uses the first provider model only when no model ID was supplied', async () => {
    mocks.getProviders.mockResolvedValueOnce([provider])
    const user = userEvent.setup()
    render(modelDeletion())
    await user.click(screen.getByRole('button', { name: 'Delete' }))
    const dialog = screen.getByRole('dialog', {
      name: 'Delete Model: model-first',
    })
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }))

    expect(mocks.deleteModel).toHaveBeenCalledExactlyOnceWith(
      'model-first',
      'ginfer'
    )
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(useModelProvider.getState().selectedModel?.id).toBe('model-selected')
    expect(useFavoriteModel.getState().favoriteModels.map(model => model.id)).toEqual(['model-selected'])
  })

  it('keeps an in-flight deletion result bound to the submitted model and provider', async () => {
    const deletion = deferred()
    mocks.deleteModel.mockReturnValue(deletion.promise)
    const user = userEvent.setup()
    const { rerender } = render(modelDeletion(provider, 'model-selected'))
    await user.click(screen.getByRole('button', { name: 'Delete' }))
    await user.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete' })
    )

    rerender(
      modelDeletion({ ...provider, provider: 'another-provider' }, 'model-first')
    )

    expect(mocks.deleteModel).toHaveBeenCalledExactlyOnceWith(
      'model-selected',
      'ginfer'
    )

    await act(async () => {
      deletion.resolve()
      await deletion.promise
    })

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(mocks.success).toHaveBeenCalledExactlyOnceWith(
      'Delete Model: model-selected',
      {
        id: 'delete-model-model-selected',
        description: 'Model model-selected has been permanently deleted.',
      }
    )
  })
})

import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useRef } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useAppState } from '@/hooks/useAppState'
import { useFavoriteModel } from '@/hooks/useFavoriteModel'
import { useModelProvider } from '@/hooks/useModelProvider'
import type { ModelsService } from '@/services/models/types'
import type { PathService } from '@/services/path/types'
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
const toastWarning = vi.fn()
vi.mock('sonner', () => ({
  toast: {
    success: (...args: unknown[]) => toastSuccess(...args),
    error: (...args: unknown[]) => toastError(...args),
    warning: (...args: unknown[]) => toastWarning(...args),
  },
}))

import { DeleteModelAction } from '../DeleteModelAction'

const deleteModel = vi.fn()
const stopModel = vi.fn()
const startModel = vi.fn()
const getProviders = vi.fn()

function deferred<T = void>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((done, fail) => {
    resolve = done
    reject = fail
  })
  return { promise, resolve, reject }
}

const ginferProvider = (ids: string[]): ModelProvider =>
  ({
    active: true,
    provider: 'ginfer',
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
    deleteModel.mockReset().mockResolvedValue(undefined)
    stopModel.mockReset().mockResolvedValue(undefined)
    startModel.mockReset().mockResolvedValue(undefined)
    getProviders.mockReset().mockResolvedValue([ginferProvider([])])
    seedServiceHub({
      models: { deleteModel, stopModel, startModel } as unknown as ModelsService,
      providers: { getProviders } as unknown as ProvidersService,
      path: { sep: () => '/' } as PathService,
    })
    useModelProvider.setState({
      providers: [ginferProvider(['Qwen3-4B-Q4_K_M'])],
      inventoryRevision: 0, modelMutations: {},
      selectedProvider: 'ginfer',
      selectedModel: { id: 'Qwen3-4B-Q4_K_M' } as Model,
    })
    useFavoriteModel.setState({
      favoriteModels: [{ id: 'Qwen3-4B-Q4_K_M' } as Model],
    })
    useAppState.setState({ activeModels: [] })
  })

  it('only deletes after the confirmation is accepted', async () => {
    render(<DeleteModelAction modelId="Qwen3-4B-Q4_K_M" provider="ginfer" />)

    expect(deleteModel).not.toHaveBeenCalled()

    const { user, confirm } = await openConfirm()
    await user.click(confirm)

    await waitFor(() =>
      expect(deleteModel).toHaveBeenCalledWith('Qwen3-4B-Q4_K_M', 'ginfer')
    )
  })

  it('focuses Cancel so Enter dismisses the confirmation without deleting the model', async () => {
    render(<DeleteModelAction modelId="Qwen3-4B-Q4_K_M" provider="ginfer" />)

    const { user } = await openConfirm()
    const cancel = screen.getByRole('button', { name: 'common:deleteModel.cancel' })
    await waitFor(() => expect(cancel).toHaveFocus())
    await user.keyboard('{Enter}')

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'common:deleteModel.delete' })).toHaveFocus()
    expect(deleteModel).not.toHaveBeenCalled()
    expect(getProviders).not.toHaveBeenCalled()
    expect(useModelProvider.getState().providers[0].models.map(model => model.id)).toEqual(['Qwen3-4B-Q4_K_M'])
  })

  it('announces pending deletion and permits an explicit retry after rejection', async () => {
    const first = deferred()
    const retry = deferred()
    const onDeleted = vi.fn()
    deleteModel.mockReturnValueOnce(first.promise).mockReturnValueOnce(retry.promise)
    render(<DeleteModelAction modelId="Qwen3-4B-Q4_K_M" provider="ginfer" onDeleted={onDeleted} />)
    const trigger = screen.getByRole('button', { name: 'common:deleteModel.delete' })
    const { user, confirm } = await openConfirm()
    const dialog = screen.getByRole('dialog')
    await user.click(confirm)

    expect(within(dialog).getByRole('status')).toHaveTextContent('Deleting model… You can close this dialog while the request finishes.')
    expect(confirm).toBeDisabled()
    expect(confirm).toHaveTextContent('Deleting model…')
    expect(trigger).toBeEnabled()
    expect(within(dialog).getAllByRole('button', { name: 'Close' })).toHaveLength(2)
    expect(dialog).toBeInTheDocument()
    expect(deleteModel).toHaveBeenCalledExactlyOnceWith('Qwen3-4B-Q4_K_M', 'ginfer')
    expect(onDeleted).not.toHaveBeenCalled()
    expect(getProviders).not.toHaveBeenCalled()

    await act(async () => {
      first.reject(new Error('Model files are busy at /models/qwen.ginfer'))
      await first.promise.catch(() => undefined)
    })

    expect(dialog).toBeInTheDocument()
    expect(dialog).not.toHaveAttribute('aria-busy', 'true')
    expect(screen.getByRole('alert')).toHaveTextContent('Could not delete this model. Stop it if it is running, then try again.')
    const details = screen.getByText('Technical details').closest('details')
    expect(details).not.toHaveAttribute('open')
    expect(details).toHaveTextContent('Model files are busy at /models/qwen.ginfer')
    expect(screen.getByText('Model files are busy at /models/qwen.ginfer')).not.toBeVisible()
    expect(within(dialog).getByRole('button', { name: 'Close' })).toBeEnabled()
    expect(within(dialog).getByRole('button', { name: 'common:deleteModel.cancel' })).toBeEnabled()
    expect(useModelProvider.getState().providers[0].models.map(model => model.id)).toEqual(['Qwen3-4B-Q4_K_M'])
    expect(useFavoriteModel.getState().favoriteModels).toHaveLength(1)
    expect(useModelProvider.getState().selectedModel?.id).toBe('Qwen3-4B-Q4_K_M')
    expect(getProviders).not.toHaveBeenCalled()

    await user.click(within(dialog).getByRole('button', { name: 'common:deleteModel.delete' }))
    expect(deleteModel).toHaveBeenCalledTimes(2)
    expect(deleteModel).toHaveBeenLastCalledWith('Qwen3-4B-Q4_K_M', 'ginfer')
    expect(dialog).toBeInTheDocument()
    expect(within(dialog).getByRole('status')).toHaveTextContent('Deleting model…')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    await act(async () => {
      retry.resolve()
      await retry.promise
    })

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(onDeleted).toHaveBeenCalledOnce()
    expect(getProviders).toHaveBeenCalledOnce()
    expect(deleteModel).toHaveBeenCalledTimes(2)
    expect(toastSuccess).toHaveBeenCalledWith('Model deleted', expect.any(Object))
  })

  it('allows Escape while deletion is pending, returns focus and prevents a second request after reopening', async () => {
    const deletion = deferred()
    deleteModel.mockReturnValue(deletion.promise)
    render(<DeleteModelAction modelId="Qwen3-4B-Q4_K_M" provider="ginfer" />)
    const { user, confirm } = await openConfirm()
    await user.click(confirm)
    await user.tab()
    expect(screen.getByRole('dialog')).toContainElement(document.activeElement as HTMLElement)
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    const trigger = screen.getByRole('button', { name: 'common:deleteModel.delete' })
    expect(trigger).toHaveFocus()
    await user.keyboard('{Enter}')
    expect(screen.getByRole('button', { name: 'Deleting model…' })).toBeDisabled()
    expect(deleteModel).toHaveBeenCalledOnce()
    await user.keyboard('{Escape}')
    await act(async () => { deletion.resolve(); await deletion.promise })
    expect(deleteModel).toHaveBeenCalledOnce()
    expect(getProviders).toHaveBeenCalledOnce()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })

  it('returns keyboard focus to the page when accepted deletion removes the trigger row', async () => {
    function ModelList() {
      const models = useModelProvider(state => state.providers[0]?.models ?? [])
      const returnFocusRef = useRef<HTMLButtonElement>(null)
      return <><button ref={returnFocusRef}>Refresh installed models</button>{models.map(model =>
        <DeleteModelAction key={model.id} modelId={model.id} provider="ginfer" returnFocusRef={returnFocusRef} />)}</>
    }
    render(<ModelList />)
    const user = userEvent.setup()
    await user.tab()
    await user.tab()
    expect(screen.getByRole('button', { name: 'common:deleteModel.delete' })).toHaveFocus()
    await user.keyboard('{Enter}')
    await waitFor(() => expect(screen.getByRole('button', { name: 'common:deleteModel.cancel' })).toHaveFocus())
    await user.tab()
    await user.keyboard('{Enter}')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    await waitFor(() => expect(screen.getByRole('button', { name: 'Refresh installed models' })).toHaveFocus())
    expect(deleteModel).toHaveBeenCalledOnce()
  })

  it('guards same-turn duplicate deletion and closes only after the request succeeds', async () => {
    const deletion = deferred()
    deleteModel.mockReturnValue(deletion.promise)
    render(<DeleteModelAction modelId="Qwen3-4B-Q4_K_M" provider="ginfer" />)
    const { confirm } = await openConfirm()

    act(() => {
      confirm.click()
      confirm.click()
    })

    expect(deleteModel).toHaveBeenCalledExactlyOnceWith('Qwen3-4B-Q4_K_M', 'ginfer')
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(getProviders).not.toHaveBeenCalled()
    expect(useModelProvider.getState().providers[0].models.map(model => model.id)).toEqual(['Qwen3-4B-Q4_K_M'])
    await act(async () => {
      deletion.resolve()
      await deletion.promise
    })

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(deleteModel).toHaveBeenCalledOnce()
    expect(getProviders).toHaveBeenCalledOnce()
  })

  it('names the model by its readable label, not its package hash, in the confirmation', async () => {
    const hash = 'a'.repeat(64)
    render(
      <DeleteModelAction modelId={hash} label="Qwen 27B 2-bit mix" provider="ginfer" />
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
        provider="ginfer"
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

  it.each([false, true])(
    'preserves accepted deletion and read-only inventory recovery after the row unmounts (external reference: %s)',
    async (externalReference) => {
      const modelId = 'Qwen3-4B-Q4_K_M'
      const deletion = deferred()
      const initialRead = deferred<ModelProvider[]>()
      const failedRetry = deferred<ModelProvider[]>()
      const successfulRetry = deferred<ModelProvider[]>()
      const onDeleted = vi.fn()
      const modelProvider = { ...ginferProvider([modelId]), provider: 'ginfer' }
      useModelProvider.setState({
        providers: [modelProvider],
        selectedProvider: 'ginfer',
      })
      deleteModel.mockReturnValueOnce(deletion.promise)
      getProviders
        .mockReturnValueOnce(initialRead.promise)
        .mockReturnValueOnce(failedRetry.promise)
        .mockReturnValueOnce(successfulRetry.promise)
      const row = render(<DeleteModelAction modelId={modelId} provider="ginfer" externalReference={externalReference} onDeleted={onDeleted} />)
      const user = userEvent.setup()
      const deleteLabel = externalReference ? 'Remove from Models' : 'common:deleteModel.delete'
      await user.click(screen.getByRole('button', { name: deleteLabel }))
      await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: deleteLabel }))

      await act(async () => {
        deletion.resolve()
        await deletion.promise
      })

      expect(getProviders).toHaveBeenCalledOnce()
      expect(screen.getByRole('dialog')).toHaveAttribute('aria-busy', 'true')
      expect(useModelProvider.getState().providers[0].models).toHaveLength(0)
      expect(useFavoriteModel.getState().favoriteModels).toHaveLength(0)
      expect(useModelProvider.getState().selectedModel).toBeNull()
      expect(onDeleted).not.toHaveBeenCalled()
      await act(async () => {
        initialRead.reject(new Error('Provider inventory failed at /models/catalog.json'))
        await initialRead.promise.catch(() => undefined)
      })

      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
      expect(deleteModel).toHaveBeenCalledExactlyOnceWith(modelId, 'ginfer')
      expect(onDeleted).toHaveBeenCalledOnce()
      expect(toastError).not.toHaveBeenCalled()
      expect(toastSuccess).not.toHaveBeenCalled()
      const title = externalReference ? 'Model removed' : 'Model deleted'
      const description = externalReference
        ? 'Removed from Models. The original file remains in place.'
        : 'common:deleteModel.success'
      expect(toastWarning).toHaveBeenCalledExactlyOnceWith(title, {
        id: `delete-model-${modelId}`,
        duration: Infinity,
        description: expect.anything(),
      })

      // The global notification survives removal of the model row itself.
      row.unmount()
      render(toastWarning.mock.calls[0][1].description)
      expect(screen.getByText(description)).toBeVisible()
      expect(screen.getByText('The model list could not be refreshed. Choose Refresh model list to try again.')).toBeVisible()
      const details = screen.getByText('Technical details').closest('details')
      expect(details).not.toHaveAttribute('open')
      expect(screen.getByText('Provider inventory failed at /models/catalog.json')).not.toBeVisible()
      const refresh = screen.getByRole('button', { name: 'Refresh model list' })
      act(() => {
        refresh.click()
        refresh.click()
      })

      expect(getProviders).toHaveBeenCalledTimes(2)
      expect(refresh).toBeDisabled()
      expect(refresh).toHaveTextContent('Refreshing model list…')
      await act(async () => {
        failedRetry.reject(new Error('Provider inventory is still offline'))
        await failedRetry.promise.catch(() => undefined)
      })

      expect(refresh).toBeEnabled()
      expect(details).not.toHaveAttribute('open')
      expect(screen.getByText('Provider inventory is still offline')).not.toBeVisible()
      expect(screen.queryByText('Provider inventory failed at /models/catalog.json')).not.toBeInTheDocument()
      expect(toastSuccess).not.toHaveBeenCalled()
      expect(useModelProvider.getState().providers[0].models).toHaveLength(0)
      expect(useModelProvider.getState().selectedModel).toBeNull()
      await user.click(refresh)
      expect(getProviders).toHaveBeenCalledTimes(3)
      await act(async () => {
        // A stale response must not resurrect the accepted-deleted model.
        successfulRetry.resolve([{ ...modelProvider, models: [{ id: modelId }, { id: 'fresh-model' }] }])
        await successfulRetry.promise
      })

      expect(toastSuccess).toHaveBeenCalledExactlyOnceWith(title, {
        id: `delete-model-${modelId}`,
        description: `${description} The model list is up to date.`,
      })
      expect(useModelProvider.getState().providers[0].models.map(model => model.id)).toEqual(['fresh-model'])
      expect(useFavoriteModel.getState().favoriteModels).toHaveLength(0)
      expect(useModelProvider.getState().selectedModel).toBeNull()
      expect(deleteModel).toHaveBeenCalledOnce()
      expect(onDeleted).toHaveBeenCalledOnce()
      expect(stopModel).not.toHaveBeenCalled()
      expect(startModel).not.toHaveBeenCalled()
      expect(toastError).not.toHaveBeenCalled()
    }
  )

  it.each(['pending', 'failed', 'acknowledged'] as const)(
    'keeps both accepted deletions absent when an older recovery lands while the second inventory read is %s',
    async (secondReadState) => {
      const firstId = 'model-a'
      const secondId = 'model-b'
      const retainedModel = {
        id: 'retained-model',
        displayName: 'My retained model',
        settings: { temperature: { controller_props: { value: 0.35 } } },
      } as Model
      const provider = {
        ...ginferProvider([firstId, secondId]),
        provider: 'ginfer',
        models: [{ id: firstId }, { id: secondId }, retainedModel],
        api_key: 'retained-key',
        base_url: 'http://localhost:1337/v1',
      } as ModelProvider
      const staleInventory = [{
        ...provider,
        models: [
          { id: firstId },
          { id: secondId },
          { ...retainedModel, settings: { temperature: { controller_props: { value: 0.7 } } } },
        ],
      }] as ModelProvider[]
      const firstInitialRead = deferred<ModelProvider[]>()
      const firstRecovery = deferred<ModelProvider[]>()
      const secondInitialRead = deferred<ModelProvider[]>()
      const firstDeleted = vi.fn()
      const secondDeleted = vi.fn()
      seedServiceHub({
        models: { deleteModel, stopModel, startModel } as unknown as ModelsService,
        providers: { getProviders } as unknown as ProvidersService,
        path: { sep: () => '/' } as PathService,
      })
      useModelProvider.setState({
        providers: [provider],
        inventoryRevision: 0, modelMutations: {},
        selectedProvider: 'ginfer',
        selectedModel: retainedModel,
      })
      getProviders
        .mockReturnValueOnce(firstInitialRead.promise)
        .mockReturnValueOnce(firstRecovery.promise)
        .mockReturnValueOnce(secondInitialRead.promise)
      const firstRow = render(<DeleteModelAction modelId={firstId} provider="ginfer" onDeleted={firstDeleted} />)
      const { user, confirm } = await openConfirm()
      await user.click(confirm)
      await waitFor(() => expect(getProviders).toHaveBeenCalledOnce())
      await act(async () => {
        firstInitialRead.reject(new Error('First inventory read is offline'))
        await firstInitialRead.promise.catch(() => undefined)
      })
      await waitFor(() => expect(firstDeleted).toHaveBeenCalledOnce())
      firstRow.unmount()
      const notice = render(toastWarning.mock.calls[0][1].description)
      const refresh = within(notice.container).getByRole('button', { name: 'Refresh model list' })
      act(() => {
        refresh.click()
        refresh.click()
      })
      expect(getProviders).toHaveBeenCalledTimes(2)
      expect(refresh).toBeDisabled()

      // B is accepted after A's recovery has already requested its older inventory.
      const secondRow = render(<DeleteModelAction modelId={secondId} provider="ginfer" onDeleted={secondDeleted} />)
      await user.click(screen.getByRole('button', { name: 'common:deleteModel.delete' }))
      await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'common:deleteModel.delete' }))
      await waitFor(() => expect(getProviders).toHaveBeenCalledTimes(3))
      expect(useModelProvider.getState().providers[0].models.map(model => model.id)).toEqual(['retained-model'])
      if (secondReadState === 'acknowledged') {
        await act(async () => {
          secondInitialRead.resolve([{ ...provider, models: [retainedModel] }])
          await secondInitialRead.promise
        })
        await waitFor(() => expect(secondDeleted).toHaveBeenCalledOnce())
        secondRow.unmount()
        expect(toastSuccess).toHaveBeenCalledExactlyOnceWith('Model deleted', {
          id: `delete-model-${secondId}`,
          description: 'common:deleteModel.success',
        })
      } else if (secondReadState === 'failed') {
        await act(async () => {
          secondInitialRead.reject(new Error('Second inventory read is offline'))
          await secondInitialRead.promise.catch(() => undefined)
        })
        await waitFor(() => expect(secondDeleted).toHaveBeenCalledOnce())
        secondRow.unmount()
        expect(toastWarning).toHaveBeenCalledTimes(2)
      } else {
        expect(screen.getByRole('dialog')).toHaveAttribute('aria-busy', 'true')
        expect(secondDeleted).not.toHaveBeenCalled()
      }

      await act(async () => {
        // Both deleted IDs are present, and persist:true replaces the model list.
        firstRecovery.resolve(staleInventory)
        await firstRecovery.promise
      })

      // No later inventory may hide resurrection by A's older response.
      const state = useModelProvider.getState()
      expect(state.providers[0].persist).toBe(true)
      expect(state.providers[0].models).toEqual([retainedModel])
      expect(state.providers[0]).toMatchObject({ api_key: 'retained-key', base_url: 'http://localhost:1337/v1' })
      expect(state.selectedModel).toEqual(retainedModel)
      expect(toastSuccess).toHaveBeenLastCalledWith('Model deleted', {
        id: `delete-model-${firstId}`,
        description: 'common:deleteModel.success The model list is up to date.',
      })
      expect(toastSuccess).toHaveBeenCalledTimes(secondReadState === 'acknowledged' ? 2 : 1)
      expect(deleteModel.mock.calls).toEqual([[firstId, 'ginfer'], [secondId, 'ginfer']])
      expect(getProviders).toHaveBeenCalledTimes(3)
      expect(stopModel).not.toHaveBeenCalled()
      expect(startModel).not.toHaveBeenCalled()
      expect(toastError).not.toHaveBeenCalled()

      if (secondReadState === 'pending') {
        await act(async () => {
          secondInitialRead.reject(new Error('Second inventory read is offline'))
          await secondInitialRead.promise.catch(() => undefined)
        })
        await waitFor(() => expect(secondDeleted).toHaveBeenCalledOnce())
        expect(useModelProvider.getState().providers[0].models).toEqual([retainedModel])
      }
    }
  )

  it.each([
    { order: 'B acknowledged before A read', returned: 'omitted', originalRead: 'acknowledged' },
    { order: 'B acknowledged before A read', returned: 'stale', originalRead: 'acknowledged' },
    { order: 'B re-added before A deletion', returned: 'current', originalRead: 'acknowledged' },
    { order: 'B re-added before A deletion', returned: 'current', originalRead: 'failed' },
    { order: 'B deleted during A read', returned: 'omitted', originalRead: 'acknowledged' },
    { order: 'B deleted during A read', returned: 'stale', originalRead: 'acknowledged' },
  ])(
    'preserves a selected re-add across $order and a $returned response (B read: $originalRead)',
    async ({ order, returned, originalRead }) => {
      const firstId = 'model-a'
      const secondId = 'model-b'
      const retainedModel = {
        id: 'retained-model', displayName: 'Keep this model',
        settings: { temperature: { controller_props: { value: 0.35 } } },
      } as Model
      const originalSecond = {
        id: secondId, displayName: 'Original B', path: '/models/original-b.ginfer',
        settings: { temperature: { controller_props: { value: 0.9 } } },
      } as Model
      const readdedModel = {
        id: secondId,
        displayName: 'My re-added model',
        path: '/models/re-added-b.ginfer',
        settings: { temperature: { controller_props: { value: 0.25 } } },
      } as Model
      const provider = {
        ...ginferProvider([firstId, secondId]),
        provider: 'ginfer',
        models: [{ id: firstId }, originalSecond, retainedModel],
        api_key: 'retained-key',
        base_url: 'http://localhost:1337/v1',
      } as ModelProvider
      const secondRead = deferred<ModelProvider[]>()
      const firstRead = deferred<ModelProvider[]>()
      const firstRecovery = deferred<ModelProvider[]>()
      const secondDeleted = vi.fn()
      const firstDeleted = vi.fn()
      seedServiceHub({
        models: { deleteModel, stopModel, startModel } as unknown as ModelsService,
        providers: { getProviders } as unknown as ProvidersService,
        path: { sep: () => '/' } as PathService,
      })
      useModelProvider.setState({
        providers: [provider], inventoryRevision: 0, modelMutations: {}, selectedProvider: 'ginfer', selectedModel: retainedModel,
      })
      const user = userEvent.setup()
      const deleteRow = async (id: string, read: Promise<ModelProvider[]>, onDeleted: () => void) => {
        const reads = getProviders.mock.calls.length
        getProviders.mockReturnValueOnce(read)
        const row = render(<DeleteModelAction modelId={id} provider="ginfer" onDeleted={onDeleted} />)
        const { confirm } = await openConfirm()
        await user.click(confirm)
        await waitFor(() => expect(getProviders).toHaveBeenCalledTimes(reads + 1))
        return row
      }
      const deleteSecond = async () => {
        const row = await deleteRow(secondId, secondRead.promise, secondDeleted)
        expect(useModelProvider.getState().providers[0].models.some(model => model.id === secondId)).toBe(false)
        await act(async () => {
          if (originalRead === 'failed') {
            secondRead.reject(new Error('The removed model inventory is unavailable'))
            await secondRead.promise.catch(() => undefined)
          } else {
            secondRead.resolve([{ ...provider, models: useModelProvider.getState().providers[0].models }])
            await secondRead.promise
          }
        })
        await waitFor(() => expect(secondDeleted).toHaveBeenCalledOnce())
        row.unmount()
      }
      const readdSecond = () => act(() => {
        const otherModels = useModelProvider.getState().providers[0].models.filter(model => model.id !== secondId)
        useModelProvider.getState().setProviders([{ ...provider, models: [...otherModels, readdedModel] }])
        useModelProvider.getState().selectModelProvider('ginfer', secondId)
      })

      if (order !== 'B deleted during A read') await deleteSecond()
      if (order === 'B re-added before A deletion') readdSecond()
      const firstRow = await deleteRow(firstId, firstRead.promise, firstDeleted)
      if (order !== 'B re-added before A deletion') {
        await act(async () => {
          firstRead.reject(new Error('First inventory read is offline'))
          await firstRead.promise.catch(() => undefined)
        })
        await waitFor(() => expect(firstDeleted).toHaveBeenCalledOnce())
        firstRow.unmount()
        const notice = render(toastWarning.mock.calls.at(-1)![1].description)
        getProviders.mockReturnValueOnce(firstRecovery.promise)
        await user.click(within(notice.container).getByRole('button', { name: 'Refresh model list' }))
        expect(within(notice.container).getByRole('button', { name: 'Refreshing model list…' })).toBeDisabled()
        if (order === 'B deleted during A read') await deleteSecond()
        // In particular, B's earlier clean acknowledgement must not let this
        // older A read erase B when the re-add lands after the read began.
        readdSecond()
      }
      const acceptedReadd = useModelProvider.getState().selectedModel
      expect(acceptedReadd).toMatchObject(readdedModel)
      const pendingRead = order === 'B re-added before A deletion' ? firstRead : firstRecovery
      await act(async () => {
        pendingRead.resolve([{
          ...provider,
          models: [{ id: firstId }, ...(returned === 'omitted' ? [] : [returned === 'stale' ? originalSecond : readdedModel]), retainedModel],
        }])
        await pendingRead.promise
      })

      await waitFor(() => expect(firstDeleted).toHaveBeenCalledOnce())
      expect(toastSuccess).toHaveBeenLastCalledWith('Model deleted', {
        id: `delete-model-${firstId}`,
        description: order === 'B re-added before A deletion' ? 'common:deleteModel.success' : 'common:deleteModel.success The model list is up to date.',
      })
      const state = useModelProvider.getState()
      expect(state.providers[0].models).toHaveLength(2)
      expect(state.providers[0].models.find(model => model.id === secondId)).toEqual(acceptedReadd)
      expect(state.providers[0].models.find(model => model.id === 'retained-model')).toEqual(retainedModel)
      expect(state.providers[0].models.some(model => model.id === firstId)).toBe(false)
      expect(state.providers[0]).toMatchObject({ persist: true, api_key: 'retained-key', base_url: 'http://localhost:1337/v1' })
      expect(state.selectedModel).toEqual(acceptedReadd)
      expect(getProviders).toHaveBeenCalledTimes(order === 'B re-added before A deletion' ? 2 : 3)
      expect(deleteModel.mock.calls).toEqual(order === 'B deleted during A read'
        ? [[firstId, 'ginfer'], [secondId, 'ginfer']]
        : [[secondId, 'ginfer'], [firstId, 'ginfer']])
      expect(toastWarning).toHaveBeenCalledTimes(order === 'B re-added before A deletion' ? (originalRead === 'failed' ? 1 : 0) : 1)
      expect(stopModel).not.toHaveBeenCalled()
      expect(startModel).not.toHaveBeenCalled()
      expect(toastError).not.toHaveBeenCalled()
    }
  )

  it('preserves a running model when the backend refuses removal', async () => {
    useAppState.setState({ activeModels: ['Qwen3-4B-Q4_K_M'] })
    deleteModel.mockRejectedValue(new Error('Stop this model before deleting its files.'))
    render(<DeleteModelAction modelId="Qwen3-4B-Q4_K_M" provider="ginfer" />)

    const { user, confirm } = await openConfirm()
    await user.click(confirm)

    await waitFor(() => expect(toastError).toHaveBeenCalled())
    expect(stopModel).not.toHaveBeenCalled()
    expect(useAppState.getState().activeModels).toEqual(['Qwen3-4B-Q4_K_M'])
    expect(useModelProvider.getState().providers[0].models.map(m => m.id)).toEqual(['Qwen3-4B-Q4_K_M'])
    expect(useModelProvider.getState().selectedModel?.id).toBe('Qwen3-4B-Q4_K_M')
  })

  it('keeps the model listed and reports the failure when the engine refuses', async () => {
    deleteModel.mockRejectedValue(new Error('Model does not exist'))
    render(<DeleteModelAction modelId="Qwen3-4B-Q4_K_M" provider="ginfer" />)

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

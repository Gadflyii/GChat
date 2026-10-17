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
import { resetServiceHubStore, seedServiceHub } from '@/test/service-hub'
import { DialogDeleteModel } from '../DeleteModel'

const mocks = vi.hoisted(() => ({
  deleteLocalModel: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
}))

vi.mock('@/lib/model-deletion', () => ({
  deleteLocalModel: mocks.deleteLocalModel,
}))
vi.mock('sonner', () => ({
  toast: { success: mocks.success, error: mocks.error },
}))

const provider: ModelProvider = {
  provider: 'ginfer',
  active: true,
  settings: [],
  models: [{ id: 'model-first' }, { id: 'model-selected' }],
}

let serviceHub: ReturnType<typeof seedServiceHub>

function modelDeletion(selectedProvider = provider, modelId?: string) {
  return (
    <TranslationContext.Provider value={{ t: i18n.t, i18n }}>
      <DialogDeleteModel provider={selectedProvider} modelId={modelId} />
    </TranslationContext.Provider>
  )
}

function deferred() {
  let resolve!: () => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<void>((done, fail) => {
    resolve = done
    reject = fail
  })
  return { promise, resolve, reject }
}

beforeEach(async () => {
  vi.resetAllMocks()
  serviceHub = seedServiceHub()
  mocks.deleteLocalModel.mockResolvedValue(undefined)
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
      expect(mocks.deleteLocalModel).not.toHaveBeenCalled()

      await user.keyboard('{Enter}')

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      expect(mocks.deleteLocalModel).not.toHaveBeenCalled()
      expect(mocks.success).not.toHaveBeenCalled()
    }
  )

  it.each(['click', 'Enter', 'Space'] as const)(
    'deletes the selected model once through native %s and closes after success',
    async (activation) => {
      const deletion = deferred()
      mocks.deleteLocalModel.mockReturnValue(deletion.promise)
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

      expect(mocks.deleteLocalModel).toHaveBeenCalledExactlyOnceWith(
        serviceHub,
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
      expect(mocks.deleteLocalModel).toHaveBeenCalledOnce()
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
    mocks.deleteLocalModel.mockReturnValue(deletion.promise)
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

    expect(mocks.deleteLocalModel).toHaveBeenCalledExactlyOnceWith(
      serviceHub,
      'model-selected',
      'ginfer'
    )
    expect(remove).toBeDisabled()

    await act(async () => {
      deletion.resolve()
      await deletion.promise
    })

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(mocks.deleteLocalModel).toHaveBeenCalledOnce()
  })

  it('shows pending state and blocks repeated activation and dismissal', async () => {
    const deletion = deferred()
    mocks.deleteLocalModel.mockReturnValue(deletion.promise)
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

    expect(mocks.deleteLocalModel).toHaveBeenCalledOnce()
    expect(dialog).toBeInTheDocument()
    expect(mocks.success).not.toHaveBeenCalled()

    await act(async () => {
      deletion.resolve()
      await deletion.promise
    })

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(mocks.deleteLocalModel).toHaveBeenCalledOnce()
  })

  it('keeps a failed deletion open with its error and permits a successful retry', async () => {
    const first = deferred()
    const retry = deferred()
    mocks.deleteLocalModel
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
    expect(mocks.deleteLocalModel).toHaveBeenCalledOnce()
    expect(mocks.error).toHaveBeenCalledOnce()
    expect(mocks.success).not.toHaveBeenCalled()

    await user.click(within(dialog).getByRole('button', { name: 'Delete' }))

    expect(mocks.deleteLocalModel).toHaveBeenCalledTimes(2)
    expect(mocks.deleteLocalModel).toHaveBeenNthCalledWith(
      2,
      serviceHub,
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
    expect(mocks.deleteLocalModel).toHaveBeenCalledTimes(2)
    expect(mocks.success).toHaveBeenCalledOnce()
  })

  it('uses the first provider model only when no model ID was supplied', async () => {
    const user = userEvent.setup()
    render(modelDeletion())
    await user.click(screen.getByRole('button', { name: 'Delete' }))
    const dialog = screen.getByRole('dialog', {
      name: 'Delete Model: model-first',
    })
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }))

    expect(mocks.deleteLocalModel).toHaveBeenCalledExactlyOnceWith(
      serviceHub,
      'model-first',
      'ginfer'
    )
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('keeps an in-flight deletion result bound to the submitted model and provider', async () => {
    const deletion = deferred()
    mocks.deleteLocalModel.mockReturnValue(deletion.promise)
    const user = userEvent.setup()
    const { rerender } = render(modelDeletion(provider, 'model-selected'))
    await user.click(screen.getByRole('button', { name: 'Delete' }))
    await user.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete' })
    )

    rerender(
      modelDeletion({ ...provider, provider: 'another-provider' }, 'model-first')
    )

    expect(mocks.deleteLocalModel).toHaveBeenCalledExactlyOnceWith(
      serviceHub,
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

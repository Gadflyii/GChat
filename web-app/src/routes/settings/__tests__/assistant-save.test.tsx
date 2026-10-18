import type { ComponentType, ReactNode } from 'react'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAssistant } from '@/hooks/useAssistant'
import { TranslationContext } from '@/i18n/context'
import i18n from '@/i18n/setup'
import type { AssistantsService } from '@/services/assistants/types'
import { seedServiceHub } from '@/test/service-hub'
import { Route } from '../assistant'

const mocks = vi.hoisted(() => ({
  createAssistant: vi.fn(),
  deleteAssistant: vi.fn(),
}))

vi.mock('@/hooks/useTheme', () => ({
  useTheme: () => ({ isDark: false }),
}))
vi.mock('@/containers/SettingsMenu', () => ({ default: () => null }))
vi.mock('@/containers/HeaderPage', () => ({
  default: ({ children }: { children: ReactNode }) => <header>{children}</header>,
}))
vi.mock('@/containers/dialogs', async () => {
  const { DeleteAssistantDialog } = await import('@/containers/dialogs/DeleteAssistantDialog')
  return { DeleteAssistantDialog }
})

const emptyGuidance = 'You have no assistants. Add an assistant to save your own instructions for new chats. You can still chat without one.'

function existingAssistant(): Assistant {
  return {
    id: 'assistant-1',
    name: 'Research helper',
    description: 'Existing description',
    instructions: 'Existing instructions',
    avatar: '🔬',
    created_at: 0,
    parameters: { temperature: 0.2, top_k: 7, top_p: 0.6 },
    sampling_overridden: true,
  }
}

function renderPage() {
  const Page = Route.options.component as ComponentType
  return render(
    <TranslationContext.Provider value={{ t: i18n.t, i18n }}>
      <Page />
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
  vi.stubGlobal('IS_MACOS', false)
  await i18n.changeLanguage('en')
  mocks.createAssistant.mockResolvedValue(undefined)
  mocks.deleteAssistant.mockResolvedValue(undefined)
  seedServiceHub({
    assistants: {
      createAssistant: mocks.createAssistant,
      deleteAssistant: mocks.deleteAssistant,
    } as unknown as AssistantsService,
  })
  const assistant = existingAssistant()
  useAssistant.setState({
    assistants: [assistant],
    currentAssistant: assistant,
    defaultAssistantId: assistant.id,
    pendingAssistant: undefined,
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('Assistant settings persistence', () => {
  it.each(['add', 'edit'] as const)(
    'awaits %s persistence, retains rejected drafts, and closes only after a successful retry',
    async (operation) => {
      const first = deferred()
      const retry = deferred()
      const persist = mocks.createAssistant
      persist.mockReturnValueOnce(first.promise).mockReturnValueOnce(retry.promise)
      const user = userEvent.setup()
      renderPage()

      if (operation === 'add') {
        await user.click(screen.getByRole('button', { name: 'Add Assistant' }))
      } else {
        await user.click(screen.getByTitle('Edit Assistant'))
      }

      const name = screen.getByRole('textbox', { name: 'Name' })
      const description = screen.getByRole('textbox', { name: 'Description (optional)' })
      const instructions = screen.getByRole('textbox', { name: 'System prompt' })
      fireEvent.change(name, { target: { value: 'Unsaved assistant draft' } })
      fireEvent.change(description, { target: { value: 'Unsaved description' } })
      fireEvent.change(instructions, { target: { value: 'Unsaved instructions' } })
      await user.click(screen.getByRole('button', { name: 'Save' }))

      expect(persist).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
        name: 'Unsaved assistant draft',
        description: 'Unsaved description',
        instructions: 'Unsaved instructions',
        ...(operation === 'edit' ? { id: 'assistant-1' } : {}),
      }))
      expect(mocks.deleteAssistant).not.toHaveBeenCalled()
      expect(useAssistant.getState().assistants).toEqual([existingAssistant()])
      expect(screen.getByRole('dialog')).toBeInTheDocument()
      expect(name).toBeDisabled()

      await act(async () => {
        first.reject(new Error('Assistant persistence failed'))
        await first.promise.catch(() => undefined)
      })

      expect(screen.getByRole('alert')).toHaveTextContent('Assistant persistence failed')
      expect(name).toHaveValue('Unsaved assistant draft')
      expect(description).toHaveValue('Unsaved description')
      expect(instructions).toHaveValue('Unsaved instructions')
      expect(name).toBeEnabled()
      expect(useAssistant.getState().assistants).toEqual([existingAssistant()])
      await user.click(screen.getByRole('button', { name: 'Save' }))
      expect(persist).toHaveBeenCalledTimes(2)
      expect(persist.mock.calls[1][0]).toEqual(persist.mock.calls[0][0])
      expect(screen.getByRole('dialog')).toBeInTheDocument()
      expect(name).toBeDisabled()

      await act(async () => {
        retry.resolve()
        await retry.promise
      })

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      expect(mocks.deleteAssistant).not.toHaveBeenCalled()
      const saved = persist.mock.calls[1][0]
      expect(useAssistant.getState().assistants).toEqual(
        operation === 'add' ? [existingAssistant(), saved] : [saved]
      )
    }
  )

  it('explains deleting the last assistant and recovers when an assistant is added', async () => {
    const user = userEvent.setup()
    renderPage()

    await user.click(screen.getByTitle('Delete Assistant'))
    const confirmation = screen.getByRole('dialog', { name: 'Delete Assistant' })
    expect(within(confirmation).getByText('Are you sure you want to delete this assistant? This action cannot be undone.')).toBeInTheDocument()
    expect(mocks.deleteAssistant).not.toHaveBeenCalled()
    await user.click(within(confirmation).getByRole('button', { name: 'Delete' }))

    expect(await screen.findByText(emptyGuidance)).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(mocks.deleteAssistant).toHaveBeenCalledExactlyOnceWith(existingAssistant())
    expect(screen.getByRole('button', { name: 'No assistant' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Add Assistant' })).toBeEnabled()

    await user.click(screen.getByRole('button', { name: 'Add Assistant' }))
    await user.type(screen.getByRole('textbox', { name: 'Name' }), 'Writing helper')
    await user.type(screen.getByRole('textbox', { name: 'System prompt' }), 'Help me write clearly.')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.queryByText(emptyGuidance)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'No assistant' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Writing helper' })).toBeEnabled()
    expect(mocks.createAssistant).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      name: 'Writing helper',
      instructions: 'Help me write clearly.',
    }))
  })

  it('shows the first available assistant for a missing default and allows choosing another', async () => {
    useAssistant.setState({
      assistants: [existingAssistant(), {
        ...existingAssistant(),
        id: 'assistant-2',
        name: 'Writing helper',
        created_at: 1,
      }],
      defaultAssistantId: 'deleted-assistant',
    })
    const user = userEvent.setup()
    renderPage()

    const selector = screen.getByRole('button', { name: 'Research helper' })
    expect(selector).toBeEnabled()
    expect(screen.queryByText(emptyGuidance)).not.toBeInTheDocument()
    await user.click(selector)
    await user.click(screen.getByRole('menuitem', { name: 'Writing helper' }))

    expect(screen.getByRole('button', { name: 'Writing helper' })).toBeEnabled()
    expect(useAssistant.getState().defaultAssistantId).toBe('assistant-2')
  })
})

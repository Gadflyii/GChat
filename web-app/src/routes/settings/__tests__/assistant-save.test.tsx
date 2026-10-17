import type { ComponentType, ReactNode } from 'react'
import { act, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Route } from '../assistant'

const mocks = vi.hoisted(() => ({
  addAssistant: vi.fn(),
  updateAssistant: vi.fn(),
  deleteAssistant: vi.fn(),
  setDefaultAssistant: vi.fn(),
  assistants: [{
    id: 'assistant-1',
    name: 'Research helper',
    description: 'Existing description',
    instructions: 'Existing instructions',
    avatar: '🔬',
    created_at: 0,
    parameters: { temperature: 0.2, top_k: 7, top_p: 0.6 },
    sampling_overridden: true,
  }],
}))

vi.mock('@/hooks/useAssistant', () => ({
  useAssistant: () => ({
    assistants: mocks.assistants,
    addAssistant: mocks.addAssistant,
    updateAssistant: mocks.updateAssistant,
    deleteAssistant: mocks.deleteAssistant,
    setDefaultAssistant: mocks.setDefaultAssistant,
    defaultAssistantId: 'assistant-1',
  }),
  defaultAssistant: {
    parameters: { temperature: 0.7, top_k: 20, top_p: 0.8, repeat_penalty: 1.12 },
  },
}))
vi.mock('@/i18n/react-i18next-compat', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))
vi.mock('@/hooks/useTheme', () => ({
  useTheme: () => ({ isDark: false }),
}))
vi.mock('@/containers/SettingsMenu', () => ({ default: () => null }))
vi.mock('@/containers/HeaderPage', () => ({
  default: ({ children }: { children: ReactNode }) => <header>{children}</header>,
}))
vi.mock('@/containers/dialogs', () => ({ DeleteAssistantDialog: () => null }))

function deferred() {
  let resolve!: () => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<void>((done, fail) => {
    resolve = done
    reject = fail
  })
  return { promise, resolve, reject }
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.stubGlobal('IS_MACOS', false)
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
      const persist = operation === 'add' ? mocks.addAssistant : mocks.updateAssistant
      const other = operation === 'add' ? mocks.updateAssistant : mocks.addAssistant
      persist.mockReturnValueOnce(first.promise).mockReturnValueOnce(retry.promise)
      const user = userEvent.setup()
      const Page = Route.options.component as ComponentType
      render(<Page />)

      if (operation === 'add') {
        await user.click(screen.getByRole('button', { name: 'assistants:addAssistant' }))
      } else {
        await user.click(screen.getByTitle('assistants:editAssistant'))
      }

      const name = screen.getByRole('textbox', { name: 'common:name' })
      const description = screen.getByRole('textbox', { name: 'assistants:description' })
      const instructions = screen.getByRole('textbox', { name: 'assistants:instructions' })
      fireEvent.change(name, { target: { value: 'Unsaved assistant draft' } })
      fireEvent.change(description, { target: { value: 'Unsaved description' } })
      fireEvent.change(instructions, { target: { value: 'Unsaved instructions' } })
      await user.click(screen.getByRole('button', { name: 'assistants:save' }))

      expect(persist).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
        name: 'Unsaved assistant draft',
        description: 'Unsaved description',
        instructions: 'Unsaved instructions',
        ...(operation === 'edit' ? { id: 'assistant-1' } : {}),
      }))
      expect(other).not.toHaveBeenCalled()
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
      await user.click(screen.getByRole('button', { name: 'assistants:save' }))
      expect(persist).toHaveBeenCalledTimes(2)
      expect(persist.mock.calls[1][0]).toEqual(persist.mock.calls[0][0])
      expect(screen.getByRole('dialog')).toBeInTheDocument()
      expect(name).toBeDisabled()

      await act(async () => {
        retry.resolve()
        await retry.promise
      })

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      expect(other).not.toHaveBeenCalled()
    }
  )
})

import { useState } from 'react'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { defaultAssistant } from '@/hooks/useAssistant'
import AddEditAssistant from '../AddEditAssistant'

const mocks = vi.hoisted(() => ({
  save: vi.fn(),
  onOpenChange: vi.fn(),
}))

vi.mock('@/i18n/react-i18next-compat', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))
vi.mock('@/hooks/useTheme', () => ({
  useTheme: () => ({ isDark: false }),
}))
vi.mock('@/hooks/useAssistant', () => ({
  defaultAssistant: {
    parameters: { temperature: 0.7, top_k: 20, top_p: 0.8, repeat_penalty: 1.12 },
  },
}))

const existingAssistant: Assistant = {
  id: 'assistant-1',
  name: 'Research helper',
  description: 'Existing description',
  instructions: 'Existing instructions',
  avatar: '🔬',
  created_at: 0,
  parameters: { temperature: 0.2, top_k: 7, top_p: 0.6, custom_sampler: 'retained' },
  sampling_overridden: true,
}

function AssistantDialog({ editing = false }: { editing?: boolean }) {
  const [open, setOpen] = useState(true)
  return (
    <>
      <button onClick={() => setOpen(true)}>Open assistant dialog</button>
      <AddEditAssistant
        open={open}
        onOpenChange={(nextOpen) => {
          mocks.onOpenChange(nextOpen)
          setOpen(nextOpen)
        }}
        editingKey={editing ? existingAssistant.id : null}
        initialData={editing ? { ...existingAssistant } : undefined}
        onSave={mocks.save}
      />
    </>
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

function fillDraft() {
  fireEvent.change(screen.getByRole('textbox', { name: 'common:name' }), {
    target: { value: 'New research helper' },
  })
  fireEvent.change(screen.getByRole('textbox', { name: 'assistants:description' }), {
    target: { value: 'Draft description' },
  })
  fireEvent.change(screen.getByRole('textbox', { name: 'assistants:instructions' }), {
    target: { value: 'Draft instructions' },
  })
}

beforeEach(() => {
  vi.resetAllMocks()
})

describe('AddEditAssistant save results', () => {
  it.each(['click', 'Enter'] as const)(
    'awaits %s submission before closing and clearing a new assistant',
    async (activation) => {
      const save = deferred()
      mocks.save.mockReturnValue(save.promise)
      const user = userEvent.setup()
      render(<AssistantDialog />)
      fillDraft()
      const name = screen.getByRole('textbox', { name: 'common:name' })
      const submit = screen.getByRole('button', { name: 'assistants:save' })

      if (activation === 'click') {
        await user.click(submit)
      } else {
        await user.click(name)
        await user.keyboard('{Enter}')
      }

      expect(mocks.save).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
        name: 'New research helper',
        description: 'Draft description',
        instructions: 'Draft instructions',
        parameters: defaultAssistant.parameters,
      }))
      expect(mocks.save.mock.calls[0][0].parameters).not.toBe(defaultAssistant.parameters)
      expect(name).toHaveValue('New research helper')
      expect(name).toBeDisabled()
      expect(screen.getByRole('textbox', { name: 'assistants:description' })).toBeDisabled()
      expect(screen.getByRole('textbox', { name: 'assistants:instructions' })).toBeDisabled()
      expect(screen.getByRole('button', { name: 'assistants:emoji' })).toBeDisabled()
      expect(screen.getByRole('dialog')).toHaveAttribute('aria-busy', 'true')
      expect(submit).toBeDisabled()
      expect(submit).toHaveAttribute('aria-busy', 'true')
      expect(submit).toHaveTextContent('loading')
      expect(mocks.onOpenChange).not.toHaveBeenCalled()

      await act(async () => {
        save.resolve()
        await save.promise
      })

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      expect(mocks.onOpenChange).toHaveBeenCalledExactlyOnceWith(false)
      await user.click(screen.getByRole('button', { name: 'Open assistant dialog' }))
      expect(screen.getByRole('textbox', { name: 'common:name' })).toHaveValue('')
      expect(screen.getByRole('textbox', { name: 'assistants:description' })).toHaveValue('')
      expect(screen.getByRole('textbox', { name: 'assistants:instructions' })).toHaveValue('')
    }
  )

  it('guards same-turn duplicate activation and pending dismissal', async () => {
    const save = deferred()
    mocks.save.mockReturnValue(save.promise)
    const user = userEvent.setup()
    render(<AssistantDialog />)
    fillDraft()
    const dialog = screen.getByRole('dialog')
    const submit = within(dialog).getByRole('button', { name: 'assistants:save' })

    act(() => {
      submit.click()
      submit.click()
      fireEvent.submit(submit.closest('form')!)
    })
    await user.keyboard('{Enter}{Escape}')
    fireEvent.pointerDown(document.querySelector('[data-slot="dialog-overlay"]')!, {
      button: 0,
      ctrlKey: false,
    })

    expect(mocks.save).toHaveBeenCalledOnce()
    expect(dialog).toBeInTheDocument()
    expect(within(dialog).queryByRole('button', { name: 'Close' })).not.toBeInTheDocument()
    expect(mocks.onOpenChange).not.toHaveBeenCalled()

    await act(async () => {
      save.resolve()
      await save.promise
    })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(mocks.save).toHaveBeenCalledOnce()
  })

  it('retains an edited draft and its sampling values after rejection and retries it', async () => {
    const first = deferred()
    const retry = deferred()
    mocks.save.mockReturnValueOnce(first.promise).mockReturnValueOnce(retry.promise)
    const user = userEvent.setup()
    const view = render(<AssistantDialog editing />)
    fillDraft()
    await user.click(screen.getByRole('button', { name: 'assistants:save' }))
    const expected = {
      ...existingAssistant,
      name: 'New research helper',
      description: 'Draft description',
      instructions: 'Draft instructions',
    }
    expect(mocks.save).toHaveBeenCalledExactlyOnceWith(expected)

    await act(async () => {
      first.reject(new Error('Assistant storage unavailable'))
      await first.promise.catch(() => undefined)
    })
    view.rerender(<AssistantDialog editing />)

    expect(screen.getByRole('alert')).toHaveTextContent('Assistant storage unavailable')
    expect(screen.getByRole('textbox', { name: 'common:name' })).toHaveValue(expected.name)
    expect(screen.getByRole('textbox', { name: 'assistants:description' })).toHaveValue(expected.description)
    expect(screen.getByRole('textbox', { name: 'assistants:instructions' })).toHaveValue(expected.instructions)
    expect(screen.getByRole('textbox', { name: 'common:name' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'assistants:emoji' })).toHaveTextContent('🔬')
    expect(screen.getByRole('button', { name: 'assistants:save' })).toBeEnabled()
    expect(mocks.onOpenChange).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'assistants:save' }))

    expect(mocks.save).toHaveBeenCalledTimes(2)
    expect(mocks.save).toHaveBeenNthCalledWith(2, expected)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    await act(async () => {
      retry.resolve()
      await retry.promise
    })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(mocks.onOpenChange).toHaveBeenCalledExactlyOnceWith(false)
  })

  it('retains a new assistant identity across a failed save and retry', async () => {
    mocks.save.mockRejectedValueOnce(new Error('Save failed'))
    const user = userEvent.setup()
    render(<AssistantDialog />)
    fillDraft()
    await user.click(screen.getByRole('button', { name: 'assistants:save' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Save failed')
    const firstAssistant = mocks.save.mock.calls[0][0]

    await user.click(screen.getByRole('button', { name: 'assistants:save' }))

    expect(mocks.save).toHaveBeenNthCalledWith(2, firstAssistant)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('shows a synchronous failure and allows the draft to be dismissed', async () => {
    mocks.save.mockImplementation(() => {
      throw new Error('Cannot save assistant')
    })
    const user = userEvent.setup()
    render(<AssistantDialog editing />)
    fillDraft()
    await user.click(screen.getByRole('button', { name: 'assistants:save' }))

    expect(screen.getByRole('alert')).toHaveTextContent('Cannot save assistant')
    expect(screen.getByRole('textbox', { name: 'common:name' })).toHaveValue('New research helper')
    await user.click(screen.getByRole('button', { name: 'Close' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Open assistant dialog' }))
    expect(screen.getByRole('textbox', { name: 'common:name' })).toHaveValue(existingAssistant.name)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('keeps required-name validation without starting a save', async () => {
    const user = userEvent.setup()
    render(<AssistantDialog />)
    fireEvent.change(screen.getByRole('textbox', { name: 'common:name' }), {
      target: { value: '   ' },
    })
    await user.click(screen.getByRole('button', { name: 'assistants:save' }))

    expect(screen.getByText('assistants:nameRequired')).toBeInTheDocument()
    expect(mocks.save).not.toHaveBeenCalled()
    expect(mocks.onOpenChange).not.toHaveBeenCalled()
  })
})

import { useState } from 'react'
import { act, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import AddProjectDialog from '../AddProjectDialog'

const mocks = vi.hoisted(() => ({
  save: vi.fn(),
  onOpenChange: vi.fn(),
  addAssistant: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
  warning: vi.fn(),
  folders: [{ id: 'project-1', name: 'Research' }],
  assistants: [
    { id: 'assistant-1', name: 'Research helper' },
    { id: 'assistant-2', name: 'Writing helper' },
  ],
}))

vi.mock('@/i18n/react-i18next-compat', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))
vi.mock('@/hooks/useThreadManagement', () => ({
  useThreadManagement: () => ({ folders: mocks.folders }),
}))
vi.mock('@/hooks/useAssistant', () => ({
  defaultAssistant: { parameters: { temperature: 0.7 } },
  useAssistant: () => ({
    assistants: mocks.assistants,
    addAssistant: mocks.addAssistant,
  }),
}))
vi.mock('@/hooks/useTheme', () => ({
  useTheme: () => ({ isDark: false }),
}))
vi.mock('sonner', () => ({
  toast: {
    success: mocks.success,
    error: mocks.error,
    warning: mocks.warning,
  },
}))

const nameLabel = 'projects.addProjectDialog.nameLabel'
const createLabel = 'projects.addProjectDialog.createButton'
const updateLabel = 'projects.addProjectDialog.updateButton'
const selectAssistantLabel = 'projects.addProjectDialog.selectAssistant'

function ProjectDialog({ editing = false }: { editing?: boolean }) {
  const [open, setOpen] = useState(true)
  return (
    <>
      <button onClick={() => setOpen(true)}>Open project dialog</button>
      <AddProjectDialog
        open={open}
        onOpenChange={(nextOpen) => {
          mocks.onOpenChange(nextOpen)
          setOpen(nextOpen)
        }}
        editingKey={editing ? 'project-1' : null}
        initialData={editing ? {
          id: 'project-1',
          name: 'Research',
          updated_at: 1,
          assistantId: 'assistant-1',
        } : undefined}
        onSave={async (name, assistantId) => {
          await mocks.save(name, assistantId)
          setOpen(false)
        }}
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

beforeEach(() => {
  vi.resetAllMocks()
})

describe('AddProjectDialog async saving', () => {
  it.each(['click', 'Enter'] as const)(
    'waits for creation through %s before clearing the draft or reporting success',
    async (activation) => {
      const save = deferred()
      mocks.save.mockReturnValue(save.promise)
      const user = userEvent.setup()
      render(<ProjectDialog />)
      const input = screen.getByRole('textbox', { name: nameLabel })
      fireEvent.change(input, { target: { value: '  New project  ' } })
      const create = screen.getByRole('button', { name: createLabel })

      if (activation === 'click') {
        await user.click(create)
      } else {
        await user.click(input)
        await user.keyboard('{Enter}')
      }

      expect(mocks.save).toHaveBeenCalledExactlyOnceWith('New project', undefined)
      expect(input).toHaveValue('  New project  ')
      expect(input).toBeDisabled()
      expect(create).toBeDisabled()
      expect(create).toHaveAttribute('aria-busy', 'true')
      expect(create).toHaveTextContent('loading')
      expect(screen.getByRole('dialog')).toHaveAttribute('aria-busy', 'true')
      expect(screen.getByRole('button', { name: selectAssistantLabel })).toBeDisabled()
      expect(mocks.success).not.toHaveBeenCalled()
      expect(mocks.onOpenChange).not.toHaveBeenCalled()

      await act(async () => {
        save.resolve()
        await save.promise
      })

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      expect(mocks.success).toHaveBeenCalledExactlyOnceWith(
        'projects.addProjectDialog.createSuccess'
      )
      expect(mocks.error).not.toHaveBeenCalled()
    }
  )

  it('awaits an assistant-only edit without treating the current project name as a duplicate', async () => {
    const save = deferred()
    mocks.save.mockReturnValue(save.promise)
    const user = userEvent.setup()
    render(<ProjectDialog editing />)
    expect(screen.getByRole('button', { name: updateLabel })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Research helper' }))
    await user.click(screen.getByRole('menuitem', { name: 'Writing helper' }))
    await user.click(screen.getByRole('button', { name: updateLabel }))

    expect(mocks.save).toHaveBeenCalledExactlyOnceWith('Research', 'assistant-2')
    expect(screen.getByRole('textbox', { name: nameLabel })).toHaveValue('Research')
    expect(screen.getByRole('button', { name: 'Writing helper' })).toBeDisabled()
    expect(mocks.success).not.toHaveBeenCalled()
    expect(mocks.warning).not.toHaveBeenCalled()

    await act(async () => {
      save.resolve()
      await save.promise
    })

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(mocks.success).toHaveBeenCalledExactlyOnceWith(
      'projects.addProjectDialog.updateSuccess'
    )
  })

  it('guards repeated submission in the same event turn and blocks pending dismissal', async () => {
    const save = deferred()
    mocks.save.mockReturnValue(save.promise)
    const user = userEvent.setup()
    render(<ProjectDialog />)
    const input = screen.getByRole('textbox', { name: nameLabel })
    fireEvent.change(input, { target: { value: 'New project' } })
    const create = screen.getByRole('button', { name: createLabel })

    act(() => {
      create.click()
      create.click()
      fireEvent.submit(input.closest('form')!)
    })
    await user.keyboard('{Enter}{Escape}')
    await user.click(screen.getByRole('button', { name: 'cancel' }))

    expect(mocks.save).toHaveBeenCalledExactlyOnceWith('New project', undefined)
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'cancel' })).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'Close' })).not.toBeInTheDocument()
    expect(mocks.onOpenChange).not.toHaveBeenCalled()
    expect(mocks.success).not.toHaveBeenCalled()

    await act(async () => {
      save.resolve()
      await save.promise
    })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('retains the failed name and assistant across parent rerenders and retries the same draft', async () => {
    const save = deferred()
    mocks.save.mockReturnValueOnce(save.promise)
    const user = userEvent.setup()
    const view = render(<ProjectDialog editing />)
    const input = screen.getByRole('textbox', { name: nameLabel })
    fireEvent.change(input, { target: { value: '  Revised project  ' } })
    await user.click(screen.getByRole('button', { name: 'Research helper' }))
    await user.click(screen.getByRole('menuitem', { name: 'Writing helper' }))
    await user.click(screen.getByRole('button', { name: updateLabel }))

    await act(async () => {
      save.reject(new Error('Project storage unavailable'))
      await save.promise.catch(() => undefined)
    })
    view.rerender(<ProjectDialog editing />)

    expect(input).toHaveValue('  Revised project  ')
    expect(input).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Writing helper' })).toBeEnabled()
    expect(screen.getByRole('alert')).toHaveTextContent('Project storage unavailable')
    expect(screen.getByRole('button', { name: updateLabel })).toBeEnabled()
    expect(mocks.error).toHaveBeenCalledExactlyOnceWith('Error: Project storage unavailable')
    expect(mocks.success).not.toHaveBeenCalled()
    expect(mocks.onOpenChange).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: updateLabel }))

    expect(mocks.save).toHaveBeenCalledTimes(2)
    expect(mocks.save).toHaveBeenNthCalledWith(2, 'Revised project', 'assistant-2')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(mocks.success).toHaveBeenCalledExactlyOnceWith('projects.addProjectDialog.updateSuccess')
  })

  it('shows synchronous save failures without losing the create draft', async () => {
    mocks.save.mockImplementation(() => {
      throw new Error('Cannot save project')
    })
    const user = userEvent.setup()
    render(<ProjectDialog />)
    const input = screen.getByRole('textbox', { name: nameLabel })
    fireEvent.change(input, { target: { value: 'New project' } })
    await user.click(screen.getByRole('button', { name: createLabel }))

    expect(input).toHaveValue('New project')
    expect(input).toBeEnabled()
    expect(screen.getByRole('alert')).toHaveTextContent('Cannot save project')
    expect(screen.getByRole('button', { name: createLabel })).toBeEnabled()
    expect(mocks.success).not.toHaveBeenCalled()
  })

  it('supports successful synchronous callbacks without taking over caller-owned closing', async () => {
    const user = userEvent.setup()
    render(<AddProjectDialog open onOpenChange={mocks.onOpenChange} editingKey={null} onSave={mocks.save} />)
    const input = screen.getByRole('textbox', { name: nameLabel })
    fireEvent.change(input, { target: { value: 'New project' } })
    await user.click(screen.getByRole('button', { name: createLabel }))

    expect(mocks.save).toHaveBeenCalledExactlyOnceWith('New project', undefined)
    expect(mocks.success).toHaveBeenCalledExactlyOnceWith('projects.addProjectDialog.createSuccess')
    expect(input).toHaveValue('')
    expect(mocks.onOpenChange).not.toHaveBeenCalled()
  })

  it('keeps case-insensitive duplicate validation without starting a save', async () => {
    const user = userEvent.setup()
    render(<ProjectDialog />)
    const input = screen.getByRole('textbox', { name: nameLabel })
    fireEvent.change(input, { target: { value: '  RESEARCH  ' } })
    await user.click(screen.getByRole('button', { name: createLabel }))

    expect(mocks.save).not.toHaveBeenCalled()
    expect(mocks.warning).toHaveBeenCalledExactlyOnceWith('projects.addProjectDialog.alreadyExists')
    expect(input).toHaveValue('  RESEARCH  ')
    expect(mocks.success).not.toHaveBeenCalled()
  })

  it.each([
    { editing: false, name: '   ', label: createLabel },
    { editing: true, name: 'Research', label: updateLabel },
  ])('does not submit an empty or unchanged draft ($name)', async ({ editing, name, label }) => {
    const user = userEvent.setup()
    render(<ProjectDialog editing={editing} />)
    const input = screen.getByRole('textbox', { name: nameLabel })
    fireEvent.change(input, { target: { value: name } })
    await user.click(input)
    await user.keyboard('{Enter}')
    fireEvent.submit(input.closest('form')!)

    expect(screen.getByRole('button', { name: label })).toBeDisabled()
    expect(mocks.save).not.toHaveBeenCalled()
    expect(mocks.success).not.toHaveBeenCalled()
  })

  it('lets Cancel discard a failed draft and clears the error when reopened', async () => {
    mocks.save.mockRejectedValueOnce(new Error('Project save failed'))
    const user = userEvent.setup()
    render(<ProjectDialog editing />)
    fireEvent.change(screen.getByRole('textbox', { name: nameLabel }), {
      target: { value: 'Revised project' },
    })
    await user.click(screen.getByRole('button', { name: updateLabel }))
    expect(screen.getByRole('alert')).toHaveTextContent('Project save failed')
    await user.click(screen.getByRole('button', { name: 'cancel' }))

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(mocks.onOpenChange).toHaveBeenCalledExactlyOnceWith(false)
    await user.click(screen.getByRole('button', { name: 'Open project dialog' }))

    expect(screen.getByRole('textbox', { name: nameLabel })).toHaveValue('Research')
    expect(screen.getByRole('button', { name: 'Research helper' })).toBeEnabled()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(mocks.save).toHaveBeenCalledTimes(1)
  })
})


describe('AddProjectDialog nested assistant saving', () => {
  it('waits for assistant storage and retains a rejected draft before selecting the retry', async () => {
    const first = deferred()
    const retry = deferred()
    mocks.addAssistant.mockReturnValueOnce(first.promise).mockReturnValueOnce(retry.promise)
    const user = userEvent.setup()
    render(<ProjectDialog />)
    fireEvent.change(screen.getByRole('textbox', { name: nameLabel }), {
      target: { value: 'New project' },
    })
    await user.click(screen.getByRole('button', { name: selectAssistantLabel }))
    await user.click(screen.getByRole('menuitem', { name: 'projects.addProjectDialog.addAssistant' }))
    const name = screen.getByRole('textbox', { name: 'common:name' })
    fireEvent.change(name, { target: { value: 'New assistant' } })
    await user.click(screen.getByRole('button', { name: 'assistants:save' }))

    expect(mocks.addAssistant).toHaveBeenCalledOnce()
    expect(name).toBeDisabled()
    expect(name).toHaveValue('New assistant')
    expect(mocks.save).not.toHaveBeenCalled()
    const assistant = mocks.addAssistant.mock.calls[0][0]

    await act(async () => {
      first.reject(new Error('Assistant disk unavailable'))
      await first.promise.catch(() => undefined)
    })
    expect(screen.getByRole('alert')).toHaveTextContent('Assistant disk unavailable')
    expect(name).toHaveValue('New assistant')
    expect(name).toBeEnabled()
    await user.click(screen.getByRole('button', { name: 'assistants:save' }))
    expect(mocks.addAssistant).toHaveBeenNthCalledWith(2, assistant)
    expect(mocks.save).not.toHaveBeenCalled()

    await act(async () => {
      retry.resolve()
      await retry.promise
    })
    expect(screen.queryByRole('textbox', { name: 'common:name' })).not.toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: nameLabel })).toHaveValue('New project')
    await user.click(screen.getByRole('button', { name: createLabel }))
    expect(mocks.save).toHaveBeenCalledExactlyOnceWith('New project', assistant.id)
  })
})

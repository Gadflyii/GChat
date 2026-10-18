import { useState } from 'react'
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  AgentSkillDetail,
  UpdateAgentSkillRequest,
} from '@/services/agent/skills'
import { AgentSkillEditDialog } from '../AgentSkillEditDialog'
import { ConfirmDialogHost } from '../dialogs/ConfirmDialogHost'
import { settleConfirm } from '@/lib/confirm'

const mocks = vi.hoisted(() => ({ update: vi.fn(), error: vi.fn() }))

vi.mock('@/i18n/react-i18next-compat', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))
vi.mock('sonner', () => ({ toast: { error: mocks.error } }))

const skill: AgentSkillDetail = {
  name: 'weekly-notes',
  description: 'Original weekly summary',
  body: 'Read the original instructions.',
  version: '1.0.0',
  requiresTools: [],
  requiresScripts: [],
  dangerous: false,
  platforms: ['linux'],
  enabled: true,
  compatible: true,
  reserved: false,
  unavailableReasons: [],
  error: null,
}

const request: UpdateAgentSkillRequest = {
  name: skill.name,
  description: 'Updated weekly summary',
  instructions: 'Read project changes.\nReport important updates.',
}

function SkillEditing() {
  const [open, setOpen] = useState(true)
  const [updates, setUpdates] = useState<UpdateAgentSkillRequest[]>([])
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Edit skill
      </button>
      <AgentSkillEditDialog
        skill={skill}
        open={open}
        onOpenChange={setOpen}
        onUpdate={async (update) => {
          await mocks.update(update)
          setUpdates((saved) => [...saved, update])
        }}
      />
      <ConfirmDialogHost />
      <output aria-label="Saved skill updates">{JSON.stringify(updates)}</output>
    </>
  )
}

function enterDraft() {
  fireEvent.change(screen.getByLabelText('common:description'), {
    target: { value: `  ${request.description}  ` },
  })
  fireEvent.change(screen.getByLabelText('common:instructions'), {
    target: { value: `  ${request.instructions}  ` },
  })
}

function expectDraft() {
  expect(screen.getByLabelText('common:skillName')).toHaveValue(skill.name)
  expect(screen.getByLabelText('common:description')).toHaveValue(
    `  ${request.description}  `
  )
  expect(screen.getByLabelText('common:instructions')).toHaveValue(
    `  ${request.instructions}  `
  )
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((done, fail) => {
    resolve = done
    reject = fail
  })
  return { promise, resolve, reject }
}

afterEach(() => {
  cleanup()
  settleConfirm(false)
})
beforeEach(() => {
  vi.resetAllMocks()
  mocks.update.mockResolvedValue(undefined)
})

describe('Agent skill edit lifetime', () => {
  it('blocks Escape and Close while saving and closes only after the update succeeds', async () => {
    const save = deferred<void>()
    mocks.update.mockReturnValueOnce(save.promise)
    render(<SkillEditing />)
    enterDraft()
    fireEvent.click(screen.getByRole('button', { name: 'common:save' }))

    const saving = screen.getByRole('button', { name: 'common:savingSkill' })
    expect(saving).toBeDisabled()
    expect(saving).toHaveAttribute('aria-busy', 'true')
    expect(screen.getByRole('button', { name: 'common:cancel' })).toBeDisabled()
    expect(screen.getByLabelText('common:description')).toBeDisabled()
    expect(screen.getByLabelText('common:instructions')).toBeDisabled()
    fireEvent.keyDown(screen.getByRole('dialog'), {
      key: 'Escape',
      code: 'Escape',
    })
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expectDraft()
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expectDraft()
    expect(screen.getByLabelText('Saved skill updates')).toHaveTextContent('[]')
    expect(saving).toHaveAccessibleName('common:savingSkill')
    expect(saving).toHaveAttribute('aria-busy', 'true')

    await act(async () => {
      save.resolve(undefined)
      await save.promise
    })

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Saved skill updates').textContent).toBe(
      JSON.stringify([request])
    )
    expect(mocks.update).toHaveBeenCalledExactlyOnceWith(request)
    expect(mocks.error).not.toHaveBeenCalled()
  })

  it('applies one update when Save is clicked twice in the same turn', async () => {
    const save = deferred<void>()
    mocks.update.mockReturnValue(save.promise)
    render(<SkillEditing />)
    enterDraft()
    const saveButton = screen.getByRole('button', { name: 'common:save' })

    act(() => {
      saveButton.click()
      saveButton.click()
    })

    expect(saveButton).toBeDisabled()
    expect(saveButton).toHaveAccessibleName('common:savingSkill')
    expect(saveButton).toHaveAttribute('aria-busy', 'true')
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByLabelText('Saved skill updates')).toHaveTextContent('[]')
    expect(mocks.update).toHaveBeenCalledExactlyOnceWith(request)

    await act(async () => {
      save.resolve(undefined)
      await save.promise
    })

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Saved skill updates').textContent).toBe(
      JSON.stringify([request])
    )
    expect(mocks.update).toHaveBeenCalledOnce()
  })

  it('preserves the draft after a failed update and allows a successful retry', async () => {
    const failedSave = deferred<void>()
    const retry = deferred<void>()
    mocks.update
      .mockReturnValueOnce(failedSave.promise)
      .mockReturnValueOnce(retry.promise)
    render(<SkillEditing />)
    enterDraft()
    fireEvent.click(screen.getByRole('button', { name: 'common:save' }))
    expect(
      screen.getByRole('button', { name: 'common:savingSkill' })
    ).toHaveAttribute('aria-busy', 'true')
    expectDraft()

    await act(async () => {
      failedSave.reject(new Error('Could not update the skill file'))
      await failedSave.promise.catch(() => undefined)
    })

    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expectDraft()
    expect(screen.getByLabelText('common:skillName')).toBeDisabled()
    expect(screen.getByLabelText('common:description')).toBeEnabled()
    expect(screen.getByLabelText('common:instructions')).toBeEnabled()
    expect(screen.getByRole('button', { name: 'common:save' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'common:save' })).toHaveAttribute(
      'aria-busy',
      'false'
    )
    expect(
      screen.queryByRole('button', { name: 'common:savingSkill' })
    ).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'common:cancel' })).toBeEnabled()
    expect(screen.getByLabelText('Saved skill updates')).toHaveTextContent('[]')
    expect(mocks.error).toHaveBeenCalledWith(
      expect.stringContaining('Could not update the skill file')
    )

    fireEvent.click(screen.getByRole('button', { name: 'common:save' }))
    const saving = screen.getByRole('button', { name: 'common:savingSkill' })
    expect(saving).toBeDisabled()
    expect(saving).toHaveAttribute('aria-busy', 'true')
    expectDraft()
    expect(screen.getByLabelText('Saved skill updates')).toHaveTextContent('[]')

    await act(async () => {
      retry.resolve(undefined)
      await retry.promise
    })

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Saved skill updates').textContent).toBe(
      JSON.stringify([request])
    )
    expect(mocks.update).toHaveBeenNthCalledWith(2, request)
    expect(mocks.error).toHaveBeenCalledOnce()
  })

  it.each(['Escape', 'Close', 'Cancel'])(
    'protects unsaved edits on %s until the user explicitly discards them',
    async (dismissal) => {
      const user = userEvent.setup()
      render(<SkillEditing />)
      enterDraft()
      expectDraft()

      const instructions = screen.getByLabelText('common:instructions')
      instructions.focus()
      const dismiss = async () => {
        if (dismissal === 'Escape') await user.keyboard('{Escape}')
        else {
          await user.click(
            screen.getByRole('button', {
              name: dismissal === 'Cancel' ? 'common:cancel' : 'Close',
            })
          )
        }
      }
      await dismiss()
      const keepEditing = screen.getByRole('button', { name: 'Keep editing' })
      await waitFor(() => expect(keepEditing).toHaveFocus())
      expect(
        screen.getByRole('dialog', { name: 'Discard unsaved skill changes?' })
      ).toBeInTheDocument()
      expect(mocks.update).not.toHaveBeenCalled()
      // Enter defaults to keeping the draft, including the keyboard Escape path.
      await user.keyboard('{Enter}')
      await waitFor(() =>
        expect(
          screen.queryByRole('dialog', {
            name: 'Discard unsaved skill changes?',
          })
        ).not.toBeInTheDocument()
      )
      expectDraft()
      if (dismissal === 'Escape') {
        await waitFor(() => expect(instructions).toHaveFocus())
      }

      await dismiss()
      await user.click(screen.getByRole('button', { name: 'Discard changes' }))

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      expect(screen.getByLabelText('Saved skill updates')).toHaveTextContent('[]')
      expect(mocks.update).not.toHaveBeenCalled()

      fireEvent.click(screen.getByRole('button', { name: 'Edit skill' }))

      expect(screen.getByRole('dialog')).toBeInTheDocument()
      expect(screen.getByLabelText('common:skillName')).toHaveValue(skill.name)
      expect(screen.getByLabelText('common:skillName')).toBeDisabled()
      expect(screen.getByLabelText('common:description')).toHaveValue(
        skill.description
      )
      expect(screen.getByLabelText('common:instructions')).toHaveValue(skill.body)
      expect(screen.getByLabelText('common:description')).toBeEnabled()
      expect(screen.getByRole('button', { name: 'common:save' })).toBeEnabled()
      expect(screen.getByRole('button', { name: 'common:save' })).toHaveAttribute(
        'aria-busy',
        'false'
      )
      expect(mocks.error).not.toHaveBeenCalled()
    }
  )

  it('closes an unchanged editor without asking to discard changes', async () => {
    const user = userEvent.setup()
    render(<SkillEditing />)
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(mocks.update).not.toHaveBeenCalled()
  })
})

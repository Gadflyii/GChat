import { useState } from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  AgentSkillDetail,
  UpdateAgentSkillRequest,
} from '@/services/agent/skills'
import { AgentSkillEditDialog } from '../AgentSkillEditDialog'

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

afterEach(cleanup)
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

    expect(screen.getByRole('button', { name: 'common:save' })).toBeDisabled()
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
    expect(screen.getByRole('button', { name: 'common:cancel' })).toBeEnabled()
    expect(screen.getByLabelText('Saved skill updates')).toHaveTextContent('[]')
    expect(mocks.error).toHaveBeenCalledWith(
      expect.stringContaining('Could not update the skill file')
    )

    fireEvent.click(screen.getByRole('button', { name: 'common:save' }))
    expect(screen.getByRole('button', { name: 'common:save' })).toBeDisabled()
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

  it('discards an idle draft on Cancel and restores the original fields on reopen', () => {
    render(<SkillEditing />)
    enterDraft()
    expectDraft()

    fireEvent.click(screen.getByRole('button', { name: 'common:cancel' }))

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
    expect(mocks.error).not.toHaveBeenCalled()
  })
})

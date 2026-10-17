import { useState } from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CreateAgentSkillRequest } from '@/services/agent/skills'
import { AgentSkillCreateDialog } from '../AgentSkillCreateDialog'

const mocks = vi.hoisted(() => ({ create: vi.fn(), error: vi.fn() }))

vi.mock('@/i18n/react-i18next-compat', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))
vi.mock('sonner', () => ({ toast: { error: mocks.error } }))

const request = {
  name: 'weekly-notes',
  description: 'Weekly summary',
  instructions: 'Read project changes.',
}

function SkillCreation() {
  const [open, setOpen] = useState(true)
  const [created, setCreated] = useState<CreateAgentSkillRequest[]>([])
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        New skill
      </button>
      <AgentSkillCreateDialog
        open={open}
        onOpenChange={setOpen}
        onCreate={async (skill) => {
          await mocks.create(skill)
          setCreated((skills) => [...skills, skill])
        }}
      />
      <output aria-label="Created skills">{JSON.stringify(created)}</output>
    </>
  )
}

function enterDraft() {
  fireEvent.change(screen.getByLabelText('common:skillName'), {
    target: { value: 'Weekly Notes' },
  })
  fireEvent.change(screen.getByLabelText('common:description'), {
    target: { value: '  Weekly summary  ' },
  })
  fireEvent.change(screen.getByLabelText('common:instructions'), {
    target: { value: '  Read project changes.  ' },
  })
}

function expectDraft() {
  expect(screen.getByLabelText('common:skillName')).toHaveValue('weekly-notes')
  expect(screen.getByLabelText('common:description')).toHaveValue(
    '  Weekly summary  '
  )
  expect(screen.getByLabelText('common:instructions')).toHaveValue(
    '  Read project changes.  '
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
  mocks.create.mockResolvedValue(undefined)
})

describe('Agent skill creation lifetime', () => {
  it('blocks Escape and Close while saving, preserves the draft, and closes after creation finishes', async () => {
    const save = deferred<void>()
    mocks.create.mockReturnValueOnce(save.promise)
    render(<SkillCreation />)
    enterDraft()
    fireEvent.click(screen.getByRole('button', { name: 'common:create' }))

    const creating = screen.getByRole('button', { name: 'common:creatingSkill' })
    expect(creating).toBeDisabled()
    expect(creating).toHaveAttribute('aria-busy', 'true')
    expect(screen.getByRole('button', { name: 'common:cancel' })).toBeDisabled()
    expect(screen.getByLabelText('common:skillName')).toBeDisabled()
    fireEvent.keyDown(screen.getByRole('dialog'), {
      key: 'Escape',
      code: 'Escape',
    })
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expectDraft()
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expectDraft()
    expect(screen.getByLabelText('Created skills')).toHaveTextContent('[]')
    expect(creating).toHaveAccessibleName('common:creatingSkill')
    expect(creating).toHaveAttribute('aria-busy', 'true')

    await act(async () => {
      save.resolve(undefined)
      await save.promise
    })

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Created skills').textContent).toBe(
      JSON.stringify([request])
    )
    expect(mocks.create).toHaveBeenCalledExactlyOnceWith(request)
    expect(mocks.error).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'New skill' }))
    expect(screen.getByLabelText('common:skillName')).toHaveValue('')
    expect(screen.getByLabelText('common:description')).toHaveValue('')
    expect(screen.getByLabelText('common:instructions')).toHaveValue('')
    expect(screen.getByRole('button', { name: 'common:create' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'common:create' })).toHaveAttribute(
      'aria-busy',
      'false'
    )
  })

  it('creates one skill when Create is clicked twice in the same turn', async () => {
    const save = deferred<void>()
    mocks.create.mockReturnValue(save.promise)
    render(<SkillCreation />)
    enterDraft()
    const create = screen.getByRole('button', { name: 'common:create' })

    act(() => {
      create.click()
      create.click()
    })

    expect(create).toBeDisabled()
    expect(create).toHaveAccessibleName('common:creatingSkill')
    expect(create).toHaveAttribute('aria-busy', 'true')
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByLabelText('Created skills')).toHaveTextContent('[]')
    expect(mocks.create).toHaveBeenCalledExactlyOnceWith(request)

    await act(async () => {
      save.resolve(undefined)
      await save.promise
    })

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Created skills').textContent).toBe(
      JSON.stringify([request])
    )
    expect(mocks.create).toHaveBeenCalledOnce()
  })

  it('preserves a rejected draft and allows the same skill to be retried successfully', async () => {
    const failedSave = deferred<void>()
    const retry = deferred<void>()
    mocks.create
      .mockReturnValueOnce(failedSave.promise)
      .mockReturnValueOnce(retry.promise)
    render(<SkillCreation />)
    enterDraft()
    fireEvent.click(screen.getByRole('button', { name: 'common:create' }))
    expect(
      screen.getByRole('button', { name: 'common:creatingSkill' })
    ).toHaveAttribute('aria-busy', 'true')
    expectDraft()

    await act(async () => {
      failedSave.reject(new Error('Could not write the skill file'))
      await failedSave.promise.catch(() => undefined)
    })

    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expectDraft()
    expect(screen.getByLabelText('common:skillName')).toBeEnabled()
    expect(screen.getByRole('button', { name: 'common:create' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'common:create' })).toHaveAttribute(
      'aria-busy',
      'false'
    )
    expect(
      screen.queryByRole('button', { name: 'common:creatingSkill' })
    ).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'common:cancel' })).toBeEnabled()
    expect(screen.getByLabelText('Created skills')).toHaveTextContent('[]')
    expect(mocks.error).toHaveBeenCalledWith(
      expect.stringContaining('Could not write the skill file')
    )

    fireEvent.click(screen.getByRole('button', { name: 'common:create' }))
    const creating = screen.getByRole('button', { name: 'common:creatingSkill' })
    expect(creating).toBeDisabled()
    expect(creating).toHaveAttribute('aria-busy', 'true')
    expectDraft()
    expect(screen.getByLabelText('Created skills')).toHaveTextContent('[]')

    await act(async () => {
      retry.resolve(undefined)
      await retry.promise
    })

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Created skills').textContent).toBe(
      JSON.stringify([request])
    )
    expect(mocks.create).toHaveBeenNthCalledWith(2, request)
    expect(mocks.error).toHaveBeenCalledOnce()
  })

  it('resets an idle draft when cancelled and reopens an empty editor', () => {
    render(<SkillCreation />)
    enterDraft()
    expect(screen.getByRole('button', { name: 'common:create' })).toBeEnabled()

    fireEvent.click(screen.getByRole('button', { name: 'common:cancel' }))

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Created skills')).toHaveTextContent('[]')
    expect(mocks.create).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'New skill' }))

    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByLabelText('common:skillName')).toHaveValue('')
    expect(screen.getByLabelText('common:description')).toHaveValue('')
    expect(screen.getByLabelText('common:instructions')).toHaveValue('')
    expect(screen.getByLabelText('common:skillName')).toBeEnabled()
    expect(screen.getByRole('button', { name: 'common:create' })).toBeDisabled()
    expect(mocks.error).not.toHaveBeenCalled()
  })
})

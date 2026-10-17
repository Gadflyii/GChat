import { useState } from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AgentSkillUploadDialog } from '../AgentSkillUploadDialog'

const mocks = vi.hoisted(() => ({
  pick: vi.fn(),
  importSkill: vi.fn(),
  error: vi.fn(),
  dragDrop: vi.fn(),
}))

vi.mock('@/hooks/useServiceHub', () => ({
  useServiceHub: () => ({ dialog: () => ({ open: mocks.pick }) }),
}))
vi.mock('@/containers/chatInput/useTauriDragDrop', () => ({
  useTauriDragDrop: mocks.dragDrop,
}))
vi.mock('@/i18n/react-i18next-compat', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))
vi.mock('sonner', () => ({ toast: { error: mocks.error } }))

type NativeDropOptions = {
  enabled: boolean
  onDrop: (paths: string[]) => void
}

function latestNativeDrop() {
  return mocks.dragDrop.mock.lastCall?.[0] as NativeDropOptions
}

function SkillImport() {
  const [open, setOpen] = useState(true)
  const [imported, setImported] = useState<string[]>([])
  return (
    <>
      <AgentSkillUploadDialog
        open={open}
        onOpenChange={setOpen}
        onUpload={async (path) => {
          await mocks.importSkill(path)
          setImported((skills) => [...skills, path])
        }}
      />
      <output aria-label="Imported skills">
        {imported.length > 0 ? imported.join(', ') : 'No skills imported'}
      </output>
    </>
  )
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

afterEach(cleanup)
beforeEach(() => {
  vi.resetAllMocks()
  mocks.pick.mockResolvedValue(null)
  mocks.importSkill.mockResolvedValue(undefined)
})

describe('Agent skill import feedback', () => {
  it('blocks duplicate clicks and a native drop while choosing, then closes only after the one import finishes', async () => {
    const selection = deferred<string | null>()
    const imported = deferred<void>()
    mocks.pick.mockReturnValueOnce(selection.promise)
    mocks.importSkill.mockReturnValueOnce(imported.promise)
    render(<SkillImport />)
    const button = screen.getByRole('button', {
      name: 'common:dropSkillToUpload',
    })
    const nativeDrop = latestNativeDrop()
    expect(nativeDrop.enabled).toBe(true)

    act(() => {
      fireEvent.click(button)
      nativeDrop.onDrop(['/skills/racing-drop.skill'])
    })

    expect(button).toBeDisabled()
    expect(button).toHaveAttribute('aria-busy', 'true')
    expect(button).toHaveTextContent('common:choosingSkill')
    expect(latestNativeDrop().enabled).toBe(false)
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByLabelText('Imported skills')).toHaveTextContent(
      'No skills imported'
    )
    fireEvent.click(button)
    act(() => nativeDrop.onDrop(['/skills/late-drop.skill']))
    expect(mocks.pick).toHaveBeenCalledOnce()
    expect(mocks.importSkill).not.toHaveBeenCalled()

    await act(async () => {
      selection.resolve('/skills/chosen.skill')
      await selection.promise
    })

    expect(button).toBeDisabled()
    expect(button).toHaveAttribute('aria-busy', 'true')
    expect(button).toHaveTextContent('common:uploadingSkill')
    expect(latestNativeDrop().enabled).toBe(false)
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByLabelText('Imported skills')).toHaveTextContent(
      'No skills imported'
    )
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    act(() => nativeDrop.onDrop(['/skills/another-drop.skill']))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(mocks.importSkill).toHaveBeenCalledExactlyOnceWith(
      '/skills/chosen.skill'
    )

    await act(async () => {
      imported.resolve(undefined)
      await imported.promise
    })

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Imported skills')).toHaveTextContent(
      '/skills/chosen.skill'
    )
    expect(screen.getByLabelText('Imported skills')).not.toHaveTextContent(
      'drop.skill'
    )
    expect(mocks.importSkill).toHaveBeenCalledOnce()
    expect(mocks.error).not.toHaveBeenCalled()
  })

  it('keeps cancellation silent and allows another selection to import', async () => {
    mocks.pick
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce('/skills/retry.skill')
    render(<SkillImport />)

    await act(async () => {
      fireEvent.click(
        screen.getByRole('button', { name: 'common:dropSkillToUpload' })
      )
    })

    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'common:dropSkillToUpload' })
    ).toBeEnabled()
    expect(latestNativeDrop().enabled).toBe(true)
    expect(screen.getByLabelText('Imported skills')).toHaveTextContent(
      'No skills imported'
    )
    expect(mocks.importSkill).not.toHaveBeenCalled()
    expect(mocks.error).not.toHaveBeenCalled()

    await act(async () => {
      fireEvent.click(
        screen.getByRole('button', { name: 'common:dropSkillToUpload' })
      )
    })

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Imported skills')).toHaveTextContent(
      '/skills/retry.skill'
    )
    expect(mocks.importSkill).toHaveBeenCalledExactlyOnceWith(
      '/skills/retry.skill'
    )
    expect(mocks.error).not.toHaveBeenCalled()
  })

  it('reports a rejected picker, preserves the dialog, and allows retry', async () => {
    mocks.pick
      .mockRejectedValueOnce(new Error('Picker permission denied'))
      .mockResolvedValueOnce('/skills/selected.skill')
    render(<SkillImport />)

    await act(async () => {
      fireEvent.click(
        screen.getByRole('button', { name: 'common:dropSkillToUpload' })
      )
    })

    expect(mocks.error).toHaveBeenCalledWith('common:chooseSkillFailed')
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'common:dropSkillToUpload' })
    ).toBeEnabled()
    expect(latestNativeDrop().enabled).toBe(true)
    expect(screen.getByLabelText('Imported skills')).toHaveTextContent(
      'No skills imported'
    )
    expect(mocks.importSkill).not.toHaveBeenCalled()

    await act(async () => {
      fireEvent.click(
        screen.getByRole('button', { name: 'common:dropSkillToUpload' })
      )
    })

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Imported skills')).toHaveTextContent(
      '/skills/selected.skill'
    )
    expect(mocks.importSkill).toHaveBeenCalledExactlyOnceWith(
      '/skills/selected.skill'
    )
    expect(mocks.error).toHaveBeenCalledOnce()
  })

  it('keeps a failed import open without adding a skill and permits a successful retry', async () => {
    mocks.pick
      .mockResolvedValueOnce('/skills/invalid.skill')
      .mockResolvedValueOnce('/skills/replacement.skill')
    mocks.importSkill.mockRejectedValueOnce(new Error('Invalid skill archive'))
    render(<SkillImport />)

    await act(async () => {
      fireEvent.click(
        screen.getByRole('button', { name: 'common:dropSkillToUpload' })
      )
    })

    expect(mocks.error).toHaveBeenCalledWith(
      expect.stringContaining('Invalid skill archive')
    )
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'common:dropSkillToUpload' })
    ).toBeEnabled()
    expect(latestNativeDrop().enabled).toBe(true)
    expect(screen.getByLabelText('Imported skills')).toHaveTextContent(
      'No skills imported'
    )

    await act(async () => {
      fireEvent.click(
        screen.getByRole('button', { name: 'common:dropSkillToUpload' })
      )
    })

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Imported skills')).toHaveTextContent(
      '/skills/replacement.skill'
    )
    expect(screen.getByLabelText('Imported skills')).not.toHaveTextContent(
      '/skills/invalid.skill'
    )
    expect(mocks.importSkill).toHaveBeenCalledTimes(2)
    expect(mocks.error).toHaveBeenCalledOnce()
  })
})

import type { ReactNode } from 'react'
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { toast } from 'sonner'
import type { AgentSkillDetail } from '@/services/agent/skills'
import type { DialogService } from '@/services/dialog/types'
import { seedServiceHub } from '@/test/service-hub'
import { SkillsPage } from './index'

const hookState = vi.hoisted(() => ({
  value: {} as {
    skills: AgentSkillDetail[]
    selected: AgentSkillDetail | null
    loading: boolean
    error: string | null
    load: ReturnType<typeof vi.fn>
    select: ReturnType<typeof vi.fn>
    setEnabled: ReturnType<typeof vi.fn>
    addCreated: ReturnType<typeof vi.fn>
    addImported: ReturnType<typeof vi.fn>
    remove: ReturnType<typeof vi.fn>
    update: ReturnType<typeof vi.fn>
    exportSkill: ReturnType<typeof vi.fn>
  },
}))
const dialogOpen = vi.hoisted(() => vi.fn())
const navigate = vi.hoisted(() => vi.fn())

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (config: object) => config,
  useNavigate: () => navigate,
}))

vi.mock('@/containers/HeaderPage', () => ({
  default: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}))

vi.mock('@/hooks/useAgentSkills', () => ({
  useAgentSkills: () => hookState.value,
}))



vi.mock('@/i18n/react-i18next-compat', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { name?: string; defaultValue?: string }) =>
      key === 'common:enablingSkill' ||
      key === 'common:disablingSkill' ||
      key === 'common:savingSkill'
        ? (options?.defaultValue ?? key).replace('{{name}}', options?.name ?? '')
        : key,
  }),
}))

vi.mock('@/components/ui/dropdown-menu', () => ({
  DropdownMenu: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  DropdownMenuContent: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  DropdownMenuItem: ({
    children,
    onSelect,
    disabled,
  }: {
    children: ReactNode
    onSelect: () => void
    disabled?: boolean
  }) => (
    <button disabled={disabled} onClick={onSelect}>
      {children}
    </button>
  ),
  DropdownMenuSeparator: () => <hr />,
  DropdownMenuTrigger: ({ children }: { children: ReactNode }) => children,
}))

vi.mock('@/containers/RenderMarkdown', () => ({
  RenderMarkdown: ({ content }: { content: string }) => <div>{content}</div>,
}))

const customSkill: AgentSkillDetail = {
  name: 'custom-skill',
  description: 'Custom skill',
  version: '1.0.0',
  requiresTools: [],
  requiresScripts: ['inspect.sh'],
  dangerous: true,
  platforms: null,
  enabled: true,
  compatible: true,
  reserved: false,
  unavailableReasons: [],
  error: null,
  body: '# Instructions',
}

const otherSkill: AgentSkillDetail = {
  ...customSkill,
  name: 'other-skill',
  description: 'Other skill',
  body: '# Other instructions',
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

function clickMenuEdit(skill: AgentSkillDetail) {
  const row = screen.getByRole('button', {
    name: `${skill.name} ${skill.description}`,
  }).parentElement as HTMLElement
  fireEvent.click(
    within(row).getByRole('button', { name: 'common:editSkill' })
  )
}

function openDeleteConfirmation(skill: AgentSkillDetail) {
  const row = screen.getByRole('button', {
    name: `${skill.name} ${skill.description}`,
  }).parentElement as HTMLElement
  fireEvent.click(
    within(row).getByRole('button', { name: 'common:uninstallSkill' })
  )
  return screen.getByRole('dialog', { name: 'common:deleteSkill' })
}

function getDownloadAction(skill: AgentSkillDetail) {
  const row = screen.getByRole('button', {
    name: `${skill.name} ${skill.description}`,
  }).parentElement as HTMLElement
  return within(row).getByRole('button', { name: 'common:downloadSkill' })
}

describe('SkillsPage', () => {
  beforeEach(() => {
    dialogOpen.mockReset()
    navigate.mockReset()
    seedServiceHub({
      dialog: {
        open: dialogOpen,
      } as unknown as DialogService,
    })
    hookState.value = {
      skills: [customSkill],
      selected: customSkill,
      loading: false,
      error: null,
      load: vi.fn(),
      select: vi.fn().mockResolvedValue(customSkill),
      setEnabled: vi.fn(),
      addCreated: vi.fn().mockResolvedValue(undefined),
      addImported: vi.fn().mockResolvedValue(undefined),
      remove: vi.fn().mockResolvedValue(undefined),
      update: vi.fn().mockResolvedValue(undefined),
      exportSkill: vi.fn().mockResolvedValue(true),
    }
  })

  it('offers skill upload and in-app skill creation', async () => {
    dialogOpen.mockResolvedValue('/tmp/imported.skill')
    render(<SkillsPage />)

    expect(
      screen.getByRole('button', { name: 'common:createNewSkill' })
    ).toBeInTheDocument()
    fireEvent.click(screen.getByText('common:uploadASkill'))
    fireEvent.click(
      screen.getByRole('button', { name: 'common:dropSkillToUpload' })
    )

    await waitFor(() =>
      expect(hookState.value.addImported).toHaveBeenCalledWith(
        '/tmp/imported.skill'
      )
    )
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())

    fireEvent.click(screen.getByText('common:writeSkillInstructions'))
    expect(screen.getAllByText('common:writeSkillInstructions')).toHaveLength(2)
  })

  it('keeps skill actions immediately left of the shared Studio navigation', () => {
    render(<SkillsPage />)

    const navigation = screen.getByRole('navigation', {
      name: 'Agent Studio sections',
    })
    expect(
      within(navigation).getByRole('button', { name: 'Agents & flows' })
    ).toBeInTheDocument()
    expect(
      within(navigation).getByRole('button', { name: 'Templates' })
    ).toBeInTheDocument()
    expect(
      within(navigation).getByRole('button', { name: 'Skills' })
    ).toBeInTheDocument()
    expect(within(navigation).getByRole('button', { name: 'Runs' })).toBeInTheDocument()

    const create = screen.getByRole('button', { name: 'common:createNewSkill' })
    expect(
      create.compareDocumentPosition(navigation) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()

    fireEvent.click(within(navigation).getByRole('button', { name: 'Templates' }))
    expect(navigate).toHaveBeenCalledWith({
      to: '/agents/',
      search: { view: 'templates' },
    })
  })

  it('shows modular skill details without badges and confirms uninstall', async () => {
    render(<SkillsPage />)

    expect(
      screen.getByRole('heading', { name: 'common:skillInstructions' })
    ).toBeInTheDocument()
    expect(screen.queryByText('common:dangerous')).not.toBeInTheDocument()
    expect(screen.queryByText('common:skillEnabled')).not.toBeInTheDocument()
    expect(screen.getAllByText('common:downloadSkill')).toHaveLength(1)
    expect(screen.getAllByText('common:editSkill')).toHaveLength(1)
    fireEvent.click(screen.getAllByText('common:uninstallSkill')[0])

    const dialog = screen.getByRole('dialog')
    fireEvent.click(within(dialog).getByText('common:delete'))
    expect(hookState.value.remove).toHaveBeenCalledWith('custom-skill')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('focuses Cancel when confirming deletion so Enter does not delete a skill', async () => {
    const user = userEvent.setup()
    render(<SkillsPage />)
    const dialog = openDeleteConfirmation(customSkill)

    await waitFor(() =>
      expect(within(dialog).getByRole('button', { name: 'common:cancel' })).toHaveFocus()
    )
    await user.keyboard('{Enter}')

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(hookState.value.remove).not.toHaveBeenCalled()
  })

  it('submits one skill deletion when Delete is activated twice in the same turn', async () => {
    const deletion = deferred<void>()
    hookState.value.remove.mockReturnValue(deletion.promise)
    render(<SkillsPage />)
    const dialog = openDeleteConfirmation(customSkill)
    const deleteButton = within(dialog).getByRole('button', { name: 'common:delete' })

    act(() => {
      deleteButton.click()
      deleteButton.click()
    })

    expect(hookState.value.remove).toHaveBeenCalledExactlyOnceWith(customSkill.name)
    expect(within(dialog).getByRole('button', { name: 'common:loading' })).toBeDisabled()
    expect(screen.getByRole('dialog')).toBeInTheDocument()

    await act(async () => deletion.resolve(undefined))

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(hookState.value.remove).toHaveBeenCalledOnce()
  })

  it('keeps the delete confirmation open through Escape and Cancel until deletion succeeds', async () => {
    const deletion = deferred<void>()
    hookState.value.remove.mockReturnValue(deletion.promise)
    render(<SkillsPage />)
    const dialog = openDeleteConfirmation(customSkill)
    fireEvent.click(within(dialog).getByRole('button', { name: 'common:delete' }))

    const cancel = within(dialog).getByRole('button', { name: 'common:cancel' })
    expect(cancel).toBeDisabled()
    expect(within(dialog).getByRole('button', { name: 'common:loading' })).toBeDisabled()
    expect(within(dialog).queryByRole('button', { name: 'Close' })).not.toBeInTheDocument()
    fireEvent.keyDown(dialog, { key: 'Escape', code: 'Escape' })
    fireEvent.click(cancel)

    expect(screen.getByRole('dialog', { name: 'common:deleteSkill' })).toBeInTheDocument()
    expect(hookState.value.remove).toHaveBeenCalledExactlyOnceWith(customSkill.name)

    await act(async () => deletion.resolve(undefined))

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('keeps a failed delete confirmation and retries its original skill after selection changes', async () => {
    const failed = deferred<void>()
    const retry = deferred<void>()
    hookState.value.skills = [customSkill, otherSkill]
    hookState.value.selected = otherSkill
    hookState.value.remove.mockReturnValueOnce(failed.promise).mockReturnValueOnce(retry.promise)
    const view = render(<SkillsPage />)
    const dialog = openDeleteConfirmation(otherSkill)
    fireEvent.click(within(dialog).getByRole('button', { name: 'common:delete' }))
    hookState.value.selected = customSkill
    view.rerender(<SkillsPage />)

    await act(async () => failed.reject(new Error('Could not remove other-skill')))

    expect(screen.getByRole('dialog', { name: 'common:deleteSkill' })).toBeInTheDocument()
    expect(within(dialog).getByRole('alert')).toHaveTextContent('Could not remove other-skill')
    expect(within(dialog).getByRole('button', { name: 'common:cancel' })).toBeEnabled()
    expect(within(dialog).getByRole('button', { name: 'Close' })).toBeEnabled()
    const retryButton = within(dialog).getByRole('button', { name: 'common:delete' })
    expect(retryButton).toBeEnabled()
    fireEvent.click(retryButton)
    expect(hookState.value.remove.mock.calls).toEqual([[otherSkill.name], [otherSkill.name]])

    await act(async () => retry.resolve(undefined))

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('keeps malformed bundled skills visible and hides custom actions', () => {
    const malformed: AgentSkillDetail = {
      ...customSkill,
      name: 'bundled-skill',
      reserved: true,
      enabled: false,
      compatible: false,
      error: 'Invalid SKILL.md',
      body: '',
    }
    hookState.value = {
      ...hookState.value,
      skills: [malformed],
      selected: malformed,
    }

    render(<SkillsPage />)

    expect(screen.getAllByText('Invalid SKILL.md')).toHaveLength(2)
    expect(screen.queryByText('common:bundled')).not.toBeInTheDocument()
    expect(screen.queryByText('common:editSkill')).not.toBeInTheDocument()
    expect(screen.queryByText('common:uninstallSkill')).not.toBeInTheDocument()
    for (const button of screen.getAllByText('common:tryInChat')) {
      expect(button.closest('button')).toBeDisabled()
    }
  })

  it('updates the selected skill from its switch', async () => {
    hookState.value.setEnabled.mockResolvedValue(undefined)
    render(<SkillsPage />)

    fireEvent.click(
      screen.getByRole('switch', { name: 'common:enableSkill: custom-skill' })
    )

    await waitFor(() =>
      expect(hookState.value.setEnabled).toHaveBeenCalledWith(
        'custom-skill',
        false
      )
    )
  })

  it('shows a pending skill toggle and submits rapid duplicate activation only once', async () => {
    const change = deferred<void>()
    hookState.value.setEnabled.mockReturnValue(change.promise)
    render(<SkillsPage />)
    const toggle = screen.getByRole('switch', {
      name: 'common:enableSkill: custom-skill',
    })

    act(() => {
      toggle.click()
      toggle.click()
    })

    expect(hookState.value.setEnabled).toHaveBeenCalledExactlyOnceWith(
      customSkill.name,
      false
    )
    expect(toggle).toBeDisabled()
    expect(toggle).toHaveAttribute('aria-busy', 'true')
    expect(screen.getByRole('status')).toHaveTextContent(
      'Disabling custom-skill…'
    )

    await act(async () => change.resolve(undefined))

    expect(toggle).toBeEnabled()
    expect(toggle).not.toHaveAttribute('aria-busy', 'true')
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(hookState.value.setEnabled).toHaveBeenCalledOnce()
  })

  it('lets another skill finish its toggle while the first skill is still pending', async () => {
    const first = deferred<void>()
    const second = deferred<void>()
    hookState.value.skills = [customSkill, { ...otherSkill, enabled: false }]
    hookState.value.setEnabled
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise)
    render(<SkillsPage />)
    const firstToggle = screen.getByRole('switch', {
      name: 'common:enableSkill: custom-skill',
    })
    const secondToggle = screen.getByRole('switch', {
      name: 'common:enableSkill: other-skill',
    })

    fireEvent.click(firstToggle)

    expect(firstToggle).toBeDisabled()
    expect(secondToggle).toBeEnabled()
    fireEvent.click(secondToggle)
    expect(hookState.value.setEnabled.mock.calls).toEqual([
      [customSkill.name, false],
      [otherSkill.name, true],
    ])
    expect(secondToggle).toBeDisabled()
    expect(screen.getAllByRole('status').map((status) => status.textContent)).toEqual(
      ['Disabling custom-skill…', 'Enabling other-skill…']
    )

    await act(async () => second.resolve(undefined))

    expect(secondToggle).toBeEnabled()
    expect(firstToggle).toBeDisabled()
    expect(screen.getByRole('status')).toHaveTextContent('Disabling custom-skill…')

    await act(async () => first.resolve(undefined))

    expect(firstToggle).toBeEnabled()
    expect(secondToggle).toBeEnabled()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('keeps the persisted skill state after a toggle fails and allows the same change to be retried', async () => {
    const failed = deferred<void>()
    const retry = deferred<void>()
    hookState.value.setEnabled
      .mockReturnValueOnce(failed.promise)
      .mockReturnValueOnce(retry.promise)
    const errorToast = vi.spyOn(toast, 'error').mockReturnValue('skill-toggle-error')

    try {
      render(<SkillsPage />)
      const toggle = screen.getByRole('switch', {
        name: 'common:enableSkill: custom-skill',
      })

      expect(toggle).toBeChecked()
      fireEvent.click(toggle)
      expect(toggle).toBeChecked()
      expect(toggle).toBeDisabled()

      await act(async () => failed.reject(new Error('Could not disable custom-skill')))

      expect(toggle).toBeChecked()
      expect(toggle).toBeEnabled()
      expect(toggle).not.toHaveAttribute('aria-busy', 'true')
      expect(screen.queryByRole('status')).not.toBeInTheDocument()
      expect(errorToast).toHaveBeenCalledExactlyOnceWith(
        'Error: Could not disable custom-skill'
      )
      fireEvent.click(toggle)
      expect(hookState.value.setEnabled.mock.calls).toEqual([
        [customSkill.name, false],
        [customSkill.name, false],
      ])
      expect(toggle).toBeDisabled()

      await act(async () => retry.resolve(undefined))

      expect(toggle).toBeEnabled()
      expect(screen.queryByRole('status')).not.toBeInTheDocument()
    } finally {
      errorToast.mockRestore()
    }
  })

  it('saves one skill at a time and blocks rapid repeated or competing Download actions', async () => {
    const saving = deferred<boolean>()
    hookState.value.skills = [customSkill, otherSkill]
    hookState.value.exportSkill.mockReturnValue(saving.promise)
    const successToast = vi.spyOn(toast, 'success').mockReturnValue('skill-save-success')

    try {
      render(<SkillsPage />)
      const download = getDownloadAction(customSkill)
      const otherDownload = getDownloadAction(otherSkill)

      act(() => {
        download.click()
        download.click()
        otherDownload.click()
      })

      expect(hookState.value.exportSkill).toHaveBeenCalledExactlyOnceWith(customSkill.name)
      for (const action of screen.getAllByRole('button', { name: 'common:downloadSkill' })) {
        expect(action).toBeDisabled()
      }
      expect(screen.getByRole('status')).toHaveTextContent('Saving custom-skill…')
      expect(successToast).not.toHaveBeenCalled()

      await act(async () => saving.resolve(true))

      expect(download).toBeEnabled()
      expect(otherDownload).toBeEnabled()
      expect(screen.queryByRole('status')).not.toBeInTheDocument()
      expect(successToast).toHaveBeenCalledExactlyOnceWith('common:skillExported')
      expect(hookState.value.exportSkill).toHaveBeenCalledOnce()
    } finally {
      successToast.mockRestore()
    }
  })

  it('clears a cancelled native Save without a toast and permits another skill download', async () => {
    const cancelled = deferred<boolean>()
    const next = deferred<boolean>()
    hookState.value.skills = [customSkill, otherSkill]
    hookState.value.exportSkill
      .mockReturnValueOnce(cancelled.promise)
      .mockReturnValueOnce(next.promise)
    const successToast = vi.spyOn(toast, 'success').mockReturnValue('skill-save-success')
    const errorToast = vi.spyOn(toast, 'error').mockReturnValue('skill-save-error')

    try {
      render(<SkillsPage />)
      const download = getDownloadAction(customSkill)
      const otherDownload = getDownloadAction(otherSkill)
      fireEvent.click(download)
      expect(download).toBeDisabled()

      await act(async () => cancelled.resolve(false))

      expect(download).toBeEnabled()
      expect(otherDownload).toBeEnabled()
      expect(screen.queryByRole('status')).not.toBeInTheDocument()
      expect(successToast).not.toHaveBeenCalled()
      expect(errorToast).not.toHaveBeenCalled()
      fireEvent.click(otherDownload)
      expect(hookState.value.exportSkill.mock.calls).toEqual([
        [customSkill.name],
        [otherSkill.name],
      ])
      expect(screen.getByRole('status')).toHaveTextContent('Saving other-skill…')

      await act(async () => next.resolve(false))

      expect(download).toBeEnabled()
      expect(otherDownload).toBeEnabled()
      expect(screen.queryByRole('status')).not.toBeInTheDocument()
      expect(successToast).not.toHaveBeenCalled()
      expect(errorToast).not.toHaveBeenCalled()
    } finally {
      successToast.mockRestore()
      errorToast.mockRestore()
    }
  })

  it('reports a failed skill download and unlocks Download for a successful retry', async () => {
    const failed = deferred<boolean>()
    const retry = deferred<boolean>()
    hookState.value.exportSkill
      .mockReturnValueOnce(failed.promise)
      .mockReturnValueOnce(retry.promise)
    const successToast = vi.spyOn(toast, 'success').mockReturnValue('skill-save-success')
    const errorToast = vi.spyOn(toast, 'error').mockReturnValue('skill-save-error')

    try {
      render(<SkillsPage />)
      const download = getDownloadAction(customSkill)
      fireEvent.click(download)

      await act(async () => failed.reject(new Error('Could not save custom-skill')))

      expect(download).toBeEnabled()
      expect(screen.queryByRole('status')).not.toBeInTheDocument()
      expect(errorToast).toHaveBeenCalledExactlyOnceWith('Error: Could not save custom-skill')
      expect(successToast).not.toHaveBeenCalled()
      fireEvent.click(download)
      expect(hookState.value.exportSkill.mock.calls).toEqual([
        [customSkill.name],
        [customSkill.name],
      ])
      expect(download).toBeDisabled()

      await act(async () => retry.resolve(true))

      expect(download).toBeEnabled()
      expect(screen.queryByRole('status')).not.toBeInTheDocument()
      expect(successToast).toHaveBeenCalledExactlyOnceWith('common:skillExported')
      expect(errorToast).toHaveBeenCalledOnce()
    } finally {
      successToast.mockRestore()
      errorToast.mockRestore()
    }
  })

  it('opens a new Agent chat with the selected skill', () => {
    render(<SkillsPage />)

    fireEvent.click(screen.getAllByText('common:tryInChat')[0])

    expect(navigate).toHaveBeenCalledWith({
      to: '/',
      search: { agentSkill: 'custom-skill' },
    })
  })

  it('opens Edit only for a custom skill', async () => {
    render(<SkillsPage />)

    fireEvent.click(screen.getAllByText('common:editSkill')[0])

    expect(await screen.findByDisplayValue('custom-skill')).toBeDisabled()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('opens Edit from the instructions card', () => {
    render(<SkillsPage />)

    const editButtons = screen.getAllByRole('button', {
      name: 'common:editSkill',
    })
    fireEvent.click(editButtons[editButtons.length - 1])

    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByDisplayValue('custom-skill')).toBeDisabled()
    expect(hookState.value.select).not.toHaveBeenCalled()
  })

  it('waits for the requested skill and saves that editor snapshot', async () => {
    const detail = deferred<AgentSkillDetail | undefined>()
    hookState.value.skills = [customSkill, otherSkill]
    hookState.value.select.mockReturnValue(detail.promise)
    const view = render(<SkillsPage />)

    clickMenuEdit(otherSkill)

    expect(hookState.value.select).toHaveBeenCalledWith('other-skill')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    await act(async () => {
      detail.resolve(otherSkill)
      await detail.promise
    })

    const editor = screen.getByRole('dialog')
    expect(within(editor).getByDisplayValue('other-skill')).toBeDisabled()
    expect(within(editor).getByDisplayValue('Other skill')).toBeInTheDocument()
    expect(
      within(editor).getByDisplayValue('# Other instructions')
    ).toBeInTheDocument()

    hookState.value.selected = {
      ...customSkill,
      description: 'Refreshed custom skill',
    }
    view.rerender(<SkillsPage />)
    fireEvent.change(within(editor).getByLabelText('common:description'), {
      target: { value: 'Updated other skill' },
    })
    fireEvent.click(within(editor).getByRole('button', { name: 'common:save' }))

    await waitFor(() =>
      expect(hookState.value.update).toHaveBeenCalledWith({
        name: 'other-skill',
        description: 'Updated other skill',
        instructions: '# Other instructions',
      })
    )
  })

  it('shows the load error instead of claiming no skills are installed', () => {
    hookState.value.skills = []
    hookState.value.error = 'Gbot service exited before becoming ready'
    render(<SkillsPage />)

    expect(
      screen.getByText('Gbot service exited before becoming ready')
    ).toBeInTheDocument()
    expect(screen.queryByText('common:skillsEmpty')).not.toBeInTheDocument()
  })

  it('says no skills are installed only when loading succeeded with none', () => {
    hookState.value.skills = []
    render(<SkillsPage />)

    expect(screen.getByText('common:skillsEmpty')).toBeInTheDocument()
  })

  it('keeps Edit closed when detail loading fails and leaves the hook error visible', async () => {
    const detail = deferred<AgentSkillDetail | undefined>()
    hookState.value.skills = [customSkill, otherSkill]
    hookState.value.select.mockReturnValue(detail.promise)
    const view = render(<SkillsPage />)

    clickMenuEdit(otherSkill)
    hookState.value.error = 'Could not read other-skill'
    view.rerender(<SkillsPage />)

    await act(async () => {
      detail.resolve(undefined)
      await detail.promise
    })

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByText('Could not read other-skill')).toBeInTheDocument()
    expect(hookState.value.update).not.toHaveBeenCalled()
  })

  it('keeps the latest Edit target when an earlier detail request finishes last', async () => {
    const first = deferred<AgentSkillDetail | undefined>()
    const second = deferred<AgentSkillDetail | undefined>()
    hookState.value.skills = [customSkill, otherSkill]
    hookState.value.select
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise)
    render(<SkillsPage />)

    clickMenuEdit(customSkill)
    clickMenuEdit(otherSkill)

    await act(async () => {
      second.resolve(otherSkill)
      await second.promise
    })
    expect(screen.getByDisplayValue('other-skill')).toBeDisabled()

    await act(async () => {
      first.resolve(customSkill)
      await first.promise
    })

    expect(screen.getAllByRole('dialog')).toHaveLength(1)
    expect(screen.getByDisplayValue('other-skill')).toBeDisabled()
    expect(screen.queryByDisplayValue('custom-skill')).not.toBeInTheDocument()
  })

  it.each(['select', 'create', 'upload', 'refresh'] as const)(
    'cancels a pending Edit after the user chooses %s',
    async (action) => {
      const detail = deferred<AgentSkillDetail | undefined>()
      hookState.value.skills = [customSkill, otherSkill]
      hookState.value.select.mockReturnValueOnce(detail.promise)
      render(<SkillsPage />)

      clickMenuEdit(otherSkill)

      if (action === 'select') {
        fireEvent.click(
          screen.getByRole('button', {
            name: `${customSkill.name} ${customSkill.description}`,
          })
        )
      } else if (action === 'create') {
        fireEvent.click(screen.getByText('common:writeSkillInstructions'))
      } else if (action === 'upload') {
        fireEvent.click(screen.getByText('common:uploadASkill'))
      } else {
        fireEvent.click(screen.getByTitle('common:refresh'))
        expect(hookState.value.load).toHaveBeenCalledWith(true)
      }

      await act(async () => {
        detail.resolve(otherSkill)
        await detail.promise
      })

      expect(
        screen.queryByText('common:editSkillDescription')
      ).not.toBeInTheDocument()
      expect(screen.queryByDisplayValue('other-skill')).not.toBeInTheDocument()
      if (action === 'create') {
        expect(
          within(screen.getByRole('dialog')).getByText(
            'common:createSkillDescription'
          )
        ).toBeInTheDocument()
      } else if (action === 'upload') {
        expect(
          within(screen.getByRole('dialog')).getByText(
            'common:uploadSkillDescription'
          )
        ).toBeInTheDocument()
      } else {
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      }
    }
  )
})

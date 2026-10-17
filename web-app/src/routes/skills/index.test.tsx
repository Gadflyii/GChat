import type { ReactNode } from 'react'
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
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
  useTranslation: () => ({ t: (key: string) => key }),
}))

vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ children, open }: { children: ReactNode; open: boolean }) =>
    open ? <div role="dialog">{children}</div> : null,
  DialogContent: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  DialogDescription: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  DialogFooter: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  DialogHeader: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  DialogTitle: ({ children }: { children: ReactNode }) => <div>{children}</div>,
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
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

function clickMenuEdit(skill: AgentSkillDetail) {
  const row = screen.getByRole('button', {
    name: `${skill.name} ${skill.description}`,
  }).parentElement as HTMLElement
  fireEvent.click(
    within(row).getByRole('button', { name: 'common:editSkill' })
  )
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

  it('shows modular skill details without badges and confirms uninstall', () => {
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

    fireEvent.click(screen.getByRole('switch', { name: 'common:enableSkill' }))

    await waitFor(() =>
      expect(hookState.value.setEnabled).toHaveBeenCalledWith(
        'custom-skill',
        false
      )
    )
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

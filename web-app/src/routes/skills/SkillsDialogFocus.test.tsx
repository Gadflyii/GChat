import type { ReactNode } from 'react'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentSkillDetail } from '@/services/agent/skills'
import type { DialogService } from '@/services/dialog/types'
import { resetServiceHubStore, seedServiceHub } from '@/test/service-hub'
import { SkillsPage } from './index'

const mocks = vi.hoisted(() => ({
  select: vi.fn(),
  create: vi.fn(),
  upload: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
  navigate: vi.fn(),
  chooseFile: vi.fn(),
  setEnabled: vi.fn(),
  load: vi.fn(),
  exportSkill: vi.fn(),
}))

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (config: object) => config,
  useNavigate: () => mocks.navigate,
}))
vi.mock('@/containers/HeaderPage', () => ({
  default: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}))
vi.mock('@/containers/RenderMarkdown', () => ({
  RenderMarkdown: ({ content }: { content: string }) => <div>{content}</div>,
}))
vi.mock('@/i18n/react-i18next-compat', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))
vi.mock('@/hooks/useAgentSkills', () => ({
  useAgentSkills: () => ({
    skills: [firstSkill, secondSkill],
    selected: firstSkill,
    loading: false,
    error: null,
    load: mocks.load,
    select: mocks.select,
    setEnabled: mocks.setEnabled,
    addCreated: mocks.create,
    addImported: mocks.upload,
    remove: mocks.remove,
    update: mocks.update,
    exportSkill: mocks.exportSkill,
  }),
}))

const firstSkill: AgentSkillDetail = {
  name: 'first-skill',
  description: 'First skill',
  version: '1.0.0',
  requiresTools: [],
  requiresScripts: [],
  dangerous: false,
  platforms: null,
  enabled: true,
  compatible: true,
  reserved: false,
  unavailableReasons: [],
  error: null,
  body: 'Saved first instructions',
}
const secondSkill: AgentSkillDetail = {
  ...firstSkill,
  name: 'second-skill',
  description: 'Second skill',
  body: 'Saved second instructions',
}

const callers = ['create', 'upload', 'edit card', 'edit menu', 'uninstall'] as const
type Caller = (typeof callers)[number]

async function openDialog(
  user: ReturnType<typeof userEvent.setup>,
  caller: Caller
) {
  let trigger: HTMLElement
  if (caller === 'create' || caller === 'upload') {
    trigger = screen.getByRole('button', { name: 'common:createNewSkill' })
    trigger.focus()
    await user.keyboard('{Enter}')
    await user.click(
      await screen.findByRole('menuitem', {
        name:
          caller === 'create'
            ? 'common:writeSkillInstructions'
            : 'common:uploadASkill',
      })
    )
  } else if (caller === 'edit card') {
    trigger = screen.getByRole('button', { name: 'common:editSkill' })
    trigger.focus()
    await user.keyboard('{Enter}')
  } else {
    const row = screen.getByRole('button', {
      name: 'second-skill Second skill',
    }).parentElement!
    trigger = within(row).getByRole('button', { name: 'common:skillActions' })
    trigger.focus()
    await user.keyboard('{Enter}')
    await user.click(
      await screen.findByRole('menuitem', {
        name:
          caller === 'edit menu' ? 'common:editSkill' : 'common:uninstallSkill',
      })
    )
  }
  await screen.findByRole('dialog')
  expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  return trigger
}

function expectNoMutation() {
  expect(mocks.create).not.toHaveBeenCalled()
  expect(mocks.upload).not.toHaveBeenCalled()
  expect(mocks.update).not.toHaveBeenCalled()
  expect(mocks.remove).not.toHaveBeenCalled()
  expect(mocks.setEnabled).not.toHaveBeenCalled()
  expect(mocks.chooseFile).not.toHaveBeenCalled()
  expect(mocks.navigate).not.toHaveBeenCalled()
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.select.mockImplementation(async (name: string) =>
    name === secondSkill.name ? secondSkill : firstSkill
  )
  seedServiceHub({
    dialog: { open: mocks.chooseFile } as unknown as DialogService,
  })
})

afterEach(() => {
  cleanup()
  resetServiceHubStore()
})

describe('Skills dialog caller focus', () => {
  // Keep real Radix menus and dialogs: menu items disappear on selection, so
  // focus must return to the persistent button for the same skill or header.
  for (const caller of callers) {
    const dismissals =
      caller === 'upload'
        ? ['Close', 'Escape']
        : caller === 'uninstall'
          ? ['Cancel', 'Enter', 'Escape']
          : ['Cancel', 'Escape']
    it.each(dismissals)(
      `${caller} %s restores its opener without saving`,
      async (dismissal) => {
        const user = userEvent.setup()
        render(
          <>
            <button>Downloads</button>
            <SkillsPage />
          </>
        )
        const trigger = await openDialog(user, caller)

        if (caller === 'uninstall') {
          await waitFor(() =>
            expect(
              screen.getByRole('button', { name: 'common:cancel' })
            ).toHaveFocus()
          )
        } else if (caller !== 'upload') {
          const input = screen.getByRole('textbox', {
            name: caller === 'create' ? 'common:skillName' : 'common:description',
          })
          await user.clear(input)
          await user.type(input, 'Discarded draft')
        }

        if (dismissal === 'Cancel' || dismissal === 'Close') {
          await user.click(
            screen.getByRole('button', {
              name: dismissal === 'Cancel' ? 'common:cancel' : 'Close',
            })
          )
        } else {
          await user.keyboard(`{${dismissal}}`)
        }
        await waitFor(() => expect(trigger).toHaveFocus())
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
        expectNoMutation()

        // Keyboard activation resumes at the same control, and cancelled drafts
        // do not replace the saved skill when that dialog is opened again.
        const reopenedTrigger = await openDialog(user, caller)
        expect(reopenedTrigger).toBe(trigger)
        if (caller === 'create') {
          expect(
            screen.getByRole('textbox', { name: 'common:skillName' })
          ).toHaveValue('')
        } else if (caller === 'edit card' || caller === 'edit menu') {
          expect(
            screen.getByRole('textbox', { name: 'common:description' })
          ).toHaveValue(
            caller === 'edit card' ? firstSkill.description : secondSkill.description
          )
        }
        await user.keyboard('{Escape}')
        await waitFor(() => expect(trigger).toHaveFocus())
        expectNoMutation()
      }
    )
  }

  it('uses the card opener after editing another skill through its menu', async () => {
    const user = userEvent.setup()
    render(<SkillsPage />)
    const menuTrigger = await openDialog(user, 'edit menu')
    await user.keyboard('{Escape}')
    await waitFor(() => expect(menuTrigger).toHaveFocus())
    const cardTrigger = await openDialog(user, 'edit card')
    expect(
      screen.getByRole('textbox', { name: 'common:description' })
    ).toHaveValue(firstSkill.description)
    await user.keyboard('{Escape}')
    await waitFor(() => expect(cardTrigger).toHaveFocus())
    expect(menuTrigger).not.toHaveFocus()
    expectNoMutation()
  })
})

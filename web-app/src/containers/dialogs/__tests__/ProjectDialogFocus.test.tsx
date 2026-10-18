import type { ComponentType, PropsWithChildren } from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SidebarProvider } from '@/components/ui/sidebar'
import { NavProjects } from '@/components/left-sidebar/NavProjects'
import { Route } from '@/routes/project/$projectId'

const mocks = vi.hoisted(() => ({
  folders: [
    { id: 'project-1', name: 'First project', updated_at: 1 },
    { id: 'project-2', name: 'ProjectMembershipProbe', updated_at: 2 },
  ],
  updateFolder: vi.fn(),
  deleteFolderWithThreads: vi.fn(),
  reorderFolders: vi.fn(),
  navigate: vi.fn(),
  threads: {},
}))

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: unknown) => ({ options }),
  useParams: () => ({ projectId: 'project-2' }),
  useNavigate: () => mocks.navigate,
  Link: ({ children }: PropsWithChildren) => <a href="#project">{children}</a>,
}))
vi.mock('@/hooks/useThreadManagement', () => ({
  useThreadManagement: () => ({
    folders: mocks.folders,
    getFolderById: (id: string) => mocks.folders.find((folder) => folder.id === id),
    updateFolder: mocks.updateFolder,
    deleteFolderWithThreads: mocks.deleteFolderWithThreads,
    reorderFolders: mocks.reorderFolders,
  }),
}))
vi.mock('@/hooks/useThreads', () => ({
  useThreads: (selector: (state: { threads: Record<string, never> }) => unknown) =>
    selector({ threads: mocks.threads }),
}))
vi.mock('@/hooks/useLeftPanel', () => ({
  useLeftPanel: (selector: (state: object) => unknown) =>
    selector({ projectExpanded: {}, setProjectExpanded: vi.fn() }),
}))
vi.mock('@/hooks/useAssistant', () => ({
  useAssistant: () => ({ assistants: [], addAssistant: vi.fn() }),
}))
vi.mock('@/i18n/react-i18next-compat', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }),
}))
vi.mock('@/containers/dialogs/AddEditAssistant', () => ({ default: () => null }))
vi.mock('@/containers/ChatInput', () => ({ default: () => null }))
vi.mock('@/containers/ThreadList', () => ({ default: () => null }))
vi.mock('@/containers/ProjectFiles', () => ({ default: () => null }))
vi.mock('@/containers/DropdownModelProvider', () => ({ default: () => null }))
vi.mock('@/containers/HeaderPage', () => ({
  default: ({ children }: PropsWithChildren) => <header>{children}</header>,
}))
vi.mock('@/components/animated-icon/folders', () => ({ FoldersIcon: () => null }))

const ProjectPage = Route.options.component as ComponentType
const nameLabel = 'projects.addProjectDialog.nameLabel'
const updateLabel = 'projects.addProjectDialog.updateButton'
const dismissals = [
  { action: 'edit', dismissal: 'Escape' },
  { action: 'edit', dismissal: 'Cancel' },
  { action: 'delete', dismissal: 'Escape' },
  { action: 'delete', dismissal: 'Enter' },
] as const

beforeEach(() => {
  vi.clearAllMocks()
})

describe('project dialog caller focus', () => {
  // Keep the real Radix menus, dialogs and sidebar buttons: the dismissed menu
  // item is removed before the dialog closes, but its owning button remains.
  describe.each(['sidebar', 'project page'] as const)('%s menu', (caller) => {
    it.each(dismissals)(
      'returns focus after $action is dismissed with $dismissal',
      async ({ action, dismissal }) => {
        const user = userEvent.setup()
        render(
          <SidebarProvider>
            <button>Downloads</button>
            {caller === 'sidebar' ? <NavProjects /> : <ProjectPage />}
          </SidebarProvider>
        )
        const trigger =
          caller === 'sidebar'
            ? screen.getAllByRole('button', { name: 'More', exact: true })[1]
            : screen.getByRole('button', { name: 'More options', exact: true })
        const menuLabels = caller === 'sidebar'
          ? { edit: 'Edit Project', delete: 'Delete Project' }
          : { edit: 'projects.editProject', delete: 'projects.deleteProject' }
        trigger.focus()
        await user.keyboard('{Enter}')
        await user.click(
          await screen.findByRole('menuitem', { name: menuLabels[action] })
        )

        await screen.findByRole('dialog')
        expect(screen.queryByRole('menu')).not.toBeInTheDocument()
        if (action === 'edit') {
          const name = screen.getByRole('textbox', { name: nameLabel })
          expect(name).toHaveValue('ProjectMembershipProbe')
          await user.type(name, ' draft')
        } else {
          await waitFor(() =>
            expect(screen.getByRole('button', { name: 'cancel' })).toHaveFocus()
          )
        }

        if (dismissal === 'Cancel') {
          await user.click(screen.getByRole('button', { name: 'cancel' }))
        } else {
          await user.keyboard(`{${dismissal}}`)
        }

        await waitFor(() => expect(trigger).toHaveFocus())
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
        expect(mocks.updateFolder).not.toHaveBeenCalled()
        expect(mocks.deleteFolderWithThreads).not.toHaveBeenCalled()

        // Keyboard use continues from the same project's menu, not the start
        // of the page, and another edit starts from the saved name.
        await user.keyboard('{Enter}')
        await user.click(
          await screen.findByRole('menuitem', { name: menuLabels.edit })
        )
        expect(
          await screen.findByRole('textbox', { name: nameLabel })
        ).toHaveValue('ProjectMembershipProbe')
        expect(screen.getByRole('button', { name: updateLabel })).toBeDisabled()
      }
    )
  })

  it.each(['Escape', 'Cancel'] as const)(
    'returns to the direct Edit button after %s, even after a menu-opened dialog',
    async (dismissal) => {
      const user = userEvent.setup()
      render(<ProjectPage />)
      await user.click(screen.getByRole('button', { name: 'More options' }))
      await user.click(
        await screen.findByRole('menuitem', { name: 'projects.editProject' })
      )
      await screen.findByRole('dialog')
      await user.keyboard('{Escape}')
      await waitFor(() =>
        expect(screen.getByRole('button', { name: 'More options' })).toHaveFocus()
      )

      const edit = screen.getByRole('button', { name: 'common:edit' })
      edit.focus()
      await user.keyboard(' ')
      await user.type(
        await screen.findByRole('textbox', { name: nameLabel }),
        ' draft'
      )
      if (dismissal === 'Cancel') {
        await user.click(screen.getByRole('button', { name: 'cancel' }))
      } else {
        await user.keyboard('{Escape}')
      }

      await waitFor(() => expect(edit).toHaveFocus())
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      expect(mocks.updateFolder).not.toHaveBeenCalled()
      expect(mocks.deleteFolderWithThreads).not.toHaveBeenCalled()
    }
  )
})

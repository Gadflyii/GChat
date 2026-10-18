import type { ComponentPropsWithoutRef } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarProvider,
} from '@/components/ui/sidebar'
import type { MessagesService } from '@/services/messages/types'
import { resetServiceHubStore, seedServiceHub } from '@/test/service-hub'
import ThreadList from '../ThreadList'

const mocks = vi.hoisted(() => ({
  threads: {
    deleteThread: vi.fn(),
    renameThread: vi.fn(),
    updateThread: vi.fn(),
    toggleFavorite: vi.fn(),
  },
  messages: {
    getMessages: vi.fn(() => []),
    setMessages: vi.fn(),
  },
  projects: { getFolderById: vi.fn(), folders: [] },
  sessions: { sessions: {} },
  readStatus: { unreadThreads: {} },
  codeTerminal: { selectedThreadId: undefined },
  conversationPolicy: { legacyAgentThreads: {} },
  fetchMessages: vi.fn(),
  navigate: vi.fn(),
  t: (key: string, options?: { title?: string }) =>
    key === 'common:threadActionsFor'
      ? `More actions for ${options?.title}`
      : key,
}))

type TestLinkProps = ComponentPropsWithoutRef<'a'> & {
  to?: string
  params?: { threadId?: string }
  search?: unknown
}

vi.mock('@tanstack/react-router', async () => {
  const { forwardRef } = await import('react')
  return {
    Link: forwardRef<HTMLAnchorElement, TestLinkProps>(function TestLink(
      { children, to, params, search: _search, ...props },
      ref
    ) {
      return (
        <a
          {...props}
          ref={ref}
          href={to?.replace('$threadId', params?.threadId ?? '') ?? '#'}
        >
          {children}
        </a>
      )
    }),
    useParams: () => ({ threadId: 'thread-2' }),
    useLocation: () => '/threads/thread-2',
    useNavigate: () => mocks.navigate,
  }
})

// Load the actual two dialogs without importing the unrelated dialog catalog.
vi.mock('@/containers/dialogs', async () => ({
  RenameThreadDialog: (
    await import('@/containers/dialogs/RenameThreadDialog')
  ).RenameThreadDialog,
  DeleteThreadDialog: (
    await import('@/containers/dialogs/DeleteThreadDialog')
  ).DeleteThreadDialog,
}))

vi.mock('@/hooks/useThreads', () => ({
  useThreads: (selector: (state: typeof mocks.threads) => unknown) =>
    selector(mocks.threads),
}))
vi.mock('@/hooks/useMessages', () => ({
  useMessages: (selector: (state: typeof mocks.messages) => unknown) =>
    selector(mocks.messages),
}))
vi.mock('@/hooks/useThreadManagement', () => ({
  useThreadManagementStore: (
    selector: (state: typeof mocks.projects) => unknown
  ) => selector(mocks.projects),
}))
vi.mock('@/stores/chat-session-store', () => ({
  useChatSessions: (selector: (state: typeof mocks.sessions) => unknown) =>
    selector(mocks.sessions),
  isSessionBusy: () => false,
}))
vi.mock('@/stores/thread-read-store', () => ({
  useThreadReadStatus: (selector: (state: typeof mocks.readStatus) => unknown) =>
    selector(mocks.readStatus),
}))
vi.mock('@/stores/code-terminal-store', () => ({
  useCodeTerminalStore: (
    selector: (state: typeof mocks.codeTerminal) => unknown
  ) => selector(mocks.codeTerminal),
}))
vi.mock('@/hooks/useConversationPolicy', () => ({
  useConversationPolicy: (
    selector: (state: typeof mocks.conversationPolicy) => unknown
  ) => selector(mocks.conversationPolicy),
}))
vi.mock('@/i18n/react-i18next-compat', () => ({
  useTranslation: () => ({ t: mocks.t }),
}))
vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}))

const threads: Thread[] = [
  { id: 'thread-1', title: 'First chat', updated: 2 },
  { id: 'thread-2', title: 'Second chat', updated: 1 },
]

const callers = ['sidebar', 'project sub-item', 'project card'] as const
const dismissals = [
  { label: 'Rename Cancel', action: 'rename', dismissal: 'Cancel' },
  { label: 'Rename Escape', action: 'rename', dismissal: 'Escape' },
  { label: 'Delete Cancel', action: 'delete', dismissal: 'Cancel' },
  { label: 'Delete Enter', action: 'delete', dismissal: 'Enter' },
  { label: 'Delete Escape', action: 'delete', dismissal: 'Escape' },
] as const

function renderCaller(caller: (typeof callers)[number]) {
  const list = (
    <ThreadList
      threads={threads}
      subItem={caller === 'project sub-item'}
      currentProjectId={caller === 'project card' ? 'project-1' : undefined}
    />
  )
  render(
    <SidebarProvider>
      <button>Downloads</button>
      <SidebarMenu>
        {caller === 'project sub-item' ? (
          <SidebarMenuItem>
            <SidebarMenuSub>{list}</SidebarMenuSub>
          </SidebarMenuItem>
        ) : (
          list
        )}
      </SidebarMenu>
    </SidebarProvider>
  )
}

async function waitForRenameInput() {
  const input = await screen.findByRole<HTMLInputElement>('textbox', {
    name: 'common:threadTitle',
  })
  // Wait for the saved title to be focused and selected. Radix can select it
  // before the production dialog's delayed selection callback also runs.
  await waitFor(() => {
    expect(input).toHaveFocus()
    expect(input.selectionStart).toBe(0)
    expect(input.selectionEnd).toBe('Second chat'.length)
  })
  return input
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.fetchMessages.mockResolvedValue([])
  seedServiceHub({
    messages: { fetchMessages: mocks.fetchMessages } as unknown as MessagesService,
  })
})

afterEach(() => {
  cleanup()
  resetServiceHubStore()
})

describe('ThreadList dialog caller focus', () => {
  it('preserves typed rename text and caret when the opening menu finishes its exit animation', async () => {
    const originalGetComputedStyle = window.getComputedStyle
    const computedStyle = vi
      .spyOn(window, 'getComputedStyle')
      .mockImplementation((element, pseudoElement) => {
        const styles = originalGetComputedStyle.call(
          window,
          element,
          pseudoElement
        )
        if (element.getAttribute('role') === 'menu') {
          // JSDOM does not animate or expose live computed styles. Let real
          // Radix Presence retain this closing menu until animationend below.
          Object.defineProperty(styles, 'animationName', {
            get: () =>
              element.getAttribute('data-state') === 'closed'
                ? 'thread-menu-exit'
                : 'thread-menu-enter',
          })
        }
        return styles
      })
    const needsCssEscape = !globalThis.CSS?.escape
    if (needsCssEscape) {
      // Both test animation names are already valid CSS identifiers.
      vi.stubGlobal('CSS', {
        ...globalThis.CSS,
        escape: (identifier: string) => identifier,
      })
    }

    try {
      const user = userEvent.setup()
      renderCaller('sidebar')
      const trigger = screen.getByRole('button', {
        name: 'More actions for Second chat',
      })
      trigger.focus()
      await user.keyboard('{Enter}')
      const menu = await screen.findByRole('menu')
      await user.click(screen.getByRole('menuitem', { name: 'common:rename' }))
      const input = await waitForRenameInput()
      expect(menu).toBeInTheDocument()
      expect(menu).toHaveAttribute('data-state', 'closed')

      await user.keyboard('Ty')
      expect(input).toHaveValue('Ty')
      expect(input.selectionStart).toBe(2)
      expect(input.selectionEnd).toBe(2)

      const menuAutoFocus = vi.fn()
      menu.addEventListener('focusScope.autoFocusOnUnmount', menuAutoFocus, {
        once: true,
      })
      fireEvent(
        menu,
        Object.assign(new Event('animationend', { bubbles: true }), {
          animationName: 'thread-menu-exit',
        })
      )
      await waitFor(() => expect(menu).not.toBeInTheDocument())
      // Wait for Radix's real deferred focus restoration, not just removal.
      await waitFor(() =>
        expect(menuAutoFocus).toHaveBeenCalledExactlyOnceWith(expect.any(Event))
      )
      expect(input).toHaveFocus()
      expect(input.selectionStart).toBe(2)
      expect(input.selectionEnd).toBe(2)

      await user.keyboard('pingPreservesPrefix')
      expect(input).toHaveValue('TypingPreservesPrefix')
      await user.click(screen.getByRole('button', { name: 'common:cancel' }))
      await waitFor(() => expect(trigger).toHaveFocus())
      expect(mocks.threads.renameThread).not.toHaveBeenCalled()
      expect(mocks.threads.deleteThread).not.toHaveBeenCalled()
      expect(mocks.threads.updateThread).not.toHaveBeenCalled()
    } finally {
      cleanup()
      computedStyle.mockRestore()
      if (needsCssEscape) vi.unstubAllGlobals()
    }
  })

  // Exercise real Radix menus/dialogs and sidebar buttons. The selected menu
  // item unmounts before dismissal; the second row's actions button persists.
  for (const caller of callers) {
    describe(caller, () => {
      it.each(dismissals)(
        '$label returns to the same row without changing the chat',
        async ({ action, dismissal }) => {
          const user = userEvent.setup()
          renderCaller(caller)
          const trigger = screen.getByRole('button', {
            name: 'More actions for Second chat',
          })
          trigger.focus()
          await user.keyboard('{Enter}')
          await user.click(
            await screen.findByRole('menuitem', { name: `common:${action}` })
          )

          await screen.findByRole('dialog')
          expect(screen.queryByRole('menu')).not.toBeInTheDocument()
          if (action === 'rename') {
            const input = await waitForRenameInput()
            expect(input).toHaveValue('Second chat')
            await user.clear(input)
            await user.paste('Discarded chat draft')
            expect(input).toHaveValue('Discarded chat draft')
          } else {
            await waitFor(() =>
              expect(
                screen.getByRole('button', { name: 'common:cancel' })
              ).toHaveFocus()
            )
            expect(
              screen.getByRole('button', { name: 'common:delete Second chat' })
            ).toBeEnabled()
          }

          if (dismissal === 'Cancel') {
            await user.click(
              screen.getByRole('button', { name: 'common:cancel' })
            )
          } else {
            await user.keyboard(`{${dismissal}}`)
          }

          await waitFor(() => expect(trigger).toHaveFocus())
          expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
          expect(mocks.threads.renameThread).not.toHaveBeenCalled()
          expect(mocks.threads.deleteThread).not.toHaveBeenCalled()
          expect(mocks.threads.updateThread).not.toHaveBeenCalled()
          expect(mocks.threads.toggleFavorite).not.toHaveBeenCalled()
          expect(mocks.navigate).not.toHaveBeenCalled()

          // Continue with the keyboard from that exact row. Rename starts from
          // the saved title again, rather than the cancelled draft or first row.
          await user.keyboard('{Enter}')
          await user.click(
            await screen.findByRole('menuitem', { name: 'common:rename' })
          )
          const input = await waitForRenameInput()
          expect(input).toHaveValue('Second chat')
          expect(
            screen.getByRole('button', { name: 'common:rename' })
          ).toBeDisabled()
          await user.keyboard('{Escape}')
          await waitFor(() => expect(trigger).toHaveFocus())
        }
      )
    })
  }
})

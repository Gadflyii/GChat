import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useLocation } from '@tanstack/react-router'
import { NavMain } from '../NavMain'
import { useConversationPolicy } from '@/hooks/useConversationPolicy'
import { useAgentRun } from '@/hooks/useAgentRun'
import { TEMPORARY_CHAT_ID } from '@/constants/chat'

const codeState = vi.hoisted(() => ({ enabled: true }))
const hermesState = vi.hoisted(() => ({ enabled: true }))
const actions = vi.hoisted(() => ({ navigate: vi.fn(), resetAgentSession: vi.fn() }))

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => (
    <a href={to}>{children}</a>
  ),
  useLocation: vi.fn(),
  useNavigate: () => actions.navigate,
}))

vi.mock('@/components/ui/sidebar', () => ({
  SidebarMenu: ({ children }: { children: React.ReactNode }) => (
    <ul>{children}</ul>
  ),
  SidebarMenuItem: ({ children }: { children: React.ReactNode }) => (
    <li>{children}</li>
  ),
  SidebarMenuButton: ({
    children,
    isActive,
    onClick,
  }: {
    children: React.ReactNode
    isActive: boolean
    onClick?: () => void
  }) => <div data-active={String(isActive)} onClick={onClick}>{children}</div>,
}))

vi.mock('@/components/animated-icon/plug', () => ({
  PlugIcon: () => null,
}))

vi.mock('@/containers/dialogs/SearchDialog', () => ({
  SearchDialog: () => <div data-testid="history-search" />,
}))

vi.mock('@/services/agent/tauri', () => ({
  resetAgentSession: actions.resetAgentSession,
  cancelAgentTurn: vi.fn(),
}))

vi.mock('@/containers/dialogs/AddProjectDialog', () => ({
  default: () => null,
}))

vi.mock('@/i18n/react-i18next-compat', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

vi.mock('@/hooks/useGeneralSetting', () => ({
  useGeneralSetting: () => true,
}))

vi.mock('@/hooks/useSearchDialog', () => ({
  useSearchDialog: () => ({ open: false, setOpen: vi.fn() }),
}))

vi.mock('@/hooks/useProjectDialog', () => ({
  useProjectDialog: (
    selector: (state: { open: boolean; setOpen: () => void }) => unknown
  ) => selector({ open: false, setOpen: vi.fn() }),
}))

vi.mock('@/hooks/useThreadManagement', () => ({
  useThreadManagement: () => ({ addFolder: vi.fn() }),
}))

vi.mock('@/stores/hermes-agent-store', () => ({
  useHermesAgentStore: (selector: (state: typeof hermesState) => unknown) =>
    selector(hermesState),
}))

vi.mock('@/stores/code-terminal-store', () => ({
  useCodeTerminalStore: (selector: (state: typeof codeState) => unknown) =>
    selector(codeState),
}))

describe('NavMain', () => {
  beforeEach(() => {
    codeState.enabled = true
    hermesState.enabled = true
    useConversationPolicy.getState().clearAll()
    useAgentRun.getState().clearAll()
    actions.navigate.mockReset()
    actions.resetAgentSession.mockReset()
    vi.mocked(useLocation).mockReturnValue({ pathname: '/' } as never)
  })

  it('shows one New Chat action with projects, integrations and history search', () => {
    render(<NavMain />)
    expect(screen.getByText('common:newChat')).toBeInTheDocument()
    expect(screen.getByText('common:launch')).toBeInTheDocument()
    expect(screen.getByText('common:projects.new')).toBeInTheDocument()
    expect(screen.getByText('common:models')).toBeInTheDocument()
    expect(screen.getByTestId('history-search')).toBeInTheDocument()
  })

  it('starts ordinary Chat and resets selections without requiring a native task reset', async () => {
    useConversationPolicy.getState().setActiveSkill(TEMPORARY_CHAT_ID, 'agent-builder')
    render(<NavMain />)
    fireEvent.click(screen.getByText('common:newChat'))
    await waitFor(() => expect(actions.navigate).toHaveBeenCalledWith({ to: '/', search: {} }))
    expect(useConversationPolicy.getState().activeSkills[TEMPORARY_CHAT_ID]).toBeUndefined()
    expect(actions.resetAgentSession).not.toHaveBeenCalled()
  })

  it('highlights the benchmark route', () => {
    vi.mocked(useLocation).mockReturnValue({ pathname: '/benchmark/' } as never)
    render(<NavMain />)
    expect(screen.getByText('Benchmark').closest('[data-active]')).toHaveAttribute('data-active', 'true')
  })

  it('hides Code when its integration is disabled', () => {
    codeState.enabled = false
    render(<NavMain />)
    expect(screen.queryByText('common:code')).not.toBeInTheDocument()
  })

  it('highlights Code on the code route', () => {
    vi.mocked(useLocation).mockReturnValue({ pathname: '/code/' } as never)
    render(<NavMain />)
    expect(screen.getByText('common:code').closest('[data-active]')).toHaveAttribute('data-active', 'true')
  })

  it('shows Agent Studio directly after Code', () => {
    render(<NavMain />)
    const codeLink = screen.getByText('common:code').closest('li')
    const studioLink = screen.getByText('Agent Studio').closest('li')
    expect(studioLink).toBeInTheDocument()
    expect(codeLink?.nextElementSibling).toBe(studioLink)
  })

  it('hides Hermes only after its integration is disabled', () => {
    const { rerender } = render(<NavMain />)
    expect(screen.getByText('Hermes')).toBeInTheDocument()
    hermesState.enabled = false
    rerender(<NavMain />)
    expect(screen.queryByText('Hermes')).not.toBeInTheDocument()
  })

  it('highlights Integrations on the launch route', () => {
    vi.mocked(useLocation).mockReturnValue({ pathname: '/launch/' } as never)
    render(<NavMain />)
    expect(screen.getByText('common:launch').closest('[data-active]')).toHaveAttribute('data-active', 'true')
  })
})

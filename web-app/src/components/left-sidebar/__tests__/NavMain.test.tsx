import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useLocation } from '@tanstack/react-router'
import { NavMain } from '../NavMain'
import { useConversationPolicy } from '@/hooks/useConversationPolicy'
import { useAgentRun } from '@/hooks/useAgentRun'
import { TEMPORARY_CHAT_ID } from '@/constants/chat'
import { useGbotCompanion } from '@/stores/gbot-companion-store'
import { useLocalModelDownloads } from '@/stores/local-model-downloads-store'
import { useEngineHosts } from '@/stores/engine-hosts-store'
import type { EngineHost, EngineSnapshot } from '@/services/engines'
import type { ModelDownload } from '@/lib/model-release'

const codeState = vi.hoisted(() => ({ enabled: true }))
const hermesState = vi.hoisted(() => ({ enabled: true }))
const generalState = vi.hoisted(() => ({ integrationsBadgeSeen: true, gbotEnabled: false }))
const actions = vi.hoisted(() => ({ navigate: vi.fn(), resetAgentSession: vi.fn() }))

const localHost: EngineHost = {
  host_id: 'local-host', local: true, name: 'This computer',
  base_url: 'https://127.0.0.1:7443', certificate_sha256: 'a'.repeat(64), client_id: 'local-client',
}
const verifyingDownload: ModelDownload = {
  id: 'qwen-download', status: 'verifying', received: 1024, bytes_per_second: 0, error: null, path: null,
  release: {
    name: 'Qwen3.8-27B', identity: { model_id: 'qwen3.8-27b', weights_id: 'groupwise-int-dflash2-q4' },
    url: `https://huggingface.co/SectileLabs/Qwen3.8-27B/resolve/${'a'.repeat(40)}/model.ginfer`,
    sha256: 'a'.repeat(64), bytes: 1024, tp: 1, qualified_sm: ['12.0'],
    min_vram_mib_per_gpu: 16384, capabilities: ['text'],
  },
}
const downloadSnapshot = (hostId: string, downloads: ModelDownload[]): EngineSnapshot => ({
  host_id: hostId, display_name: hostId, revision: 1, gpus: [], models: [], instances: [],
  model_management: { version: 1, managed_root: '/models', engine_presets_available: false, downloads },
})

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
  useGeneralSetting: (selector: (state: typeof generalState) => unknown) => selector(generalState),
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
    generalState.gbotEnabled = false
    useGbotCompanion.getState().reset()
    useConversationPolicy.getState().clearAll()
    useAgentRun.getState().clearAll()
    useLocalModelDownloads.setState({ jobs: [], error: null })
    useEngineHosts.setState({ hosts: [localHost], snapshots: {}, errors: {} })
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

  it('counts a local verifying download once when the local Host snapshot mirrors it', () => {
    useLocalModelDownloads.setState({ jobs: [verifyingDownload] })
    useEngineHosts.setState({ snapshots: {
      [localHost.host_id]: downloadSnapshot(localHost.host_id, [verifyingDownload]),
    } })

    render(<NavMain />)

    expect(screen.getByTitle('Active or incomplete model transfers')).toHaveTextContent(/^1 transfers$/)
  })

  it('counts an additional remote download of the same model separately', () => {
    const remoteHost = { ...localHost, host_id: 'remote-host', local: false, name: 'Remote computer' }
    const remoteDownload = { ...verifyingDownload, id: 'remote-qwen-download' }
    useLocalModelDownloads.setState({ jobs: [verifyingDownload] })
    useEngineHosts.setState({
      hosts: [localHost, remoteHost],
      snapshots: {
        [localHost.host_id]: downloadSnapshot(localHost.host_id, [verifyingDownload]),
        [remoteHost.host_id]: downloadSnapshot(remoteHost.host_id, [
          remoteDownload, { ...remoteDownload, id: 'installed-remote-download', status: 'installed' },
        ]),
      },
    })

    render(<NavMain />)

    expect(screen.getByTitle('Active or incomplete model transfers')).toHaveTextContent(/^2 transfers$/)
  })

  it('removes an installed local transfer while its local Host snapshot remains stale', () => {
    useLocalModelDownloads.setState({ jobs: [verifyingDownload] })
    useEngineHosts.setState({ snapshots: {
      [localHost.host_id]: downloadSnapshot(localHost.host_id, [verifyingDownload]),
    } })
    render(<NavMain />)
    expect(screen.getByTitle('Active or incomplete model transfers')).toHaveTextContent(/^1 transfers$/)

    act(() => useLocalModelDownloads.setState({ jobs: [{ ...verifyingDownload, status: 'installed' }] }))

    expect(screen.queryByTitle('Active or incomplete model transfers')).not.toBeInTheDocument()
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

  it('shows Gbot only while its integration is enabled', () => {
    const { rerender } = render(<NavMain />)
    expect(screen.queryByText('Gbot')).not.toBeInTheDocument()
    generalState.gbotEnabled = true
    rerender(<NavMain />)
    expect(screen.getByText('Gbot')).toBeInTheDocument()
    generalState.gbotEnabled = false
    rerender(<NavMain />)
    expect(screen.queryByText('Gbot')).not.toBeInTheDocument()
  })

  it('highlights Code on the code route', () => {
    vi.mocked(useLocation).mockReturnValue({ pathname: '/code/' } as never)
    render(<NavMain />)
    expect(screen.getByText('common:code').closest('[data-active]')).toHaveAttribute('data-active', 'true')
  })

  it('opens the avatar above Work without navigating away from Code and retains the Gbot settings link', () => {
    generalState.gbotEnabled = true
    useGbotCompanion.setState({ available: true, snapshot: {
      workspaces: [{ id: 'atlas', name: 'Atlas' }], live_sessions: [], controls: [], assignments: [],
    } })
    vi.mocked(useLocation).mockReturnValue({ pathname: '/code/' } as never)
    render(<NavMain />)
    const avatar = screen.getByRole('button', { name: 'Open Atlas · Resting' })
    expect(avatar.compareDocumentPosition(screen.getByText('Work')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    fireEvent.click(avatar)
    expect(useGbotCompanion.getState()).toMatchObject({ mode: 'compact', selected: 'atlas' })
    expect(actions.navigate).not.toHaveBeenCalled()
    expect(screen.getByText('Gbot').closest('a')).toHaveAttribute('href', '/gbot/')
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

import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  servers: {
    exa: { command: '', args: [], env: {}, type: 'http', url: 'https://mcp.example/mcp', active: true },
    fetch: { command: 'uvx', args: ['mcp-server-fetch'], env: {}, active: false },
  } as Record<string, unknown>,
  statuses: [{ name: 'exa', status: 'connected' }],
}))

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: { component: unknown }) => ({ options }),
}))
vi.mock('@/containers/HeaderPage', () => ({ default: ({ children }: { children: React.ReactNode }) => <header>{children}</header> }))
vi.mock('@/containers/SettingsMenu', () => ({ default: () => null }))
vi.mock('@/containers/dialogs/AddEditMCPServer', () => ({ default: () => null }))
vi.mock('@/containers/dialogs/DeleteMCPServerConfirm', () => ({ default: () => null }))
vi.mock('@/containers/dialogs/EditJsonMCPserver', () => ({ default: () => null }))
vi.mock('@/components/MCPLogViewer', () => ({ MCPLogViewer: () => null }))
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn().mockResolvedValue(() => {}) }))
vi.mock('@/hooks/useAppState', () => ({ useAppState: (selector: (s: unknown) => unknown) => selector({ setErrorMessage: vi.fn() }) }))
vi.mock('@/hooks/useServiceHub', () => ({
  useServiceHub: () => ({ mcp: () => ({ getMCPServerStatuses: async () => state.statuses }) }),
}))
vi.mock('@/i18n/react-i18next-compat', () => ({
  useTranslation: () => ({ t: (key: string) => key.split(':').pop() }),
}))
vi.mock('@/hooks/useMCPServers', () => {
  const store = {
    mcpServers: state.servers, settings: { toolCallTimeoutSeconds: 30 }, editServer: vi.fn(), syncServers: vi.fn(),
    saveServers: vi.fn(), getServerConfig: vi.fn(), updateSettings: vi.fn(),
  }
  const hook = () => store
  hook.getState = () => store
  return { useMCPServers: hook, DEFAULT_MCP_SETTINGS: { toolCallTimeoutSeconds: 30 } }
})

import { Route } from '../mcp-servers'

describe('MCP server list', () => {
  it('names every switch and icon button after its server and says when a server is connected', async () => {
    const Page = (Route as unknown as { options: { component: () => JSX.Element } }).options.component
    render(<Page />)
    await screen.findByRole('heading', { name: 'exa' })
    expect(screen.getByRole('switch', { name: 'Use exa' })).toBeChecked()
    expect(screen.getByRole('switch', { name: 'Use fetch' })).not.toBeChecked()
    expect(screen.getByRole('button', { name: 'deleteServer.delete: fetch' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'editServer: exa' })).toBeInTheDocument()
    expect(await screen.findByRole('img', { name: 'MCP server connected' })).toBeInTheDocument()
    expect(screen.queryAllByRole('switch').every((s) => s.getAttribute('aria-label'))).toBe(true)
  })
})

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Route as ProviderRoute } from '../$providerName'
import { seedServiceHub } from '@/test/service-hub'

const state = vi.hoisted(() => ({
  provider: undefined as unknown,
}))

vi.mock('@/containers/SettingsMenu', () => ({ default: () => null }))
vi.mock('@/containers/HeaderPage', () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))
vi.mock('@/containers/Card', () => ({
  Card: ({ header, children }: { header?: React.ReactNode; children: React.ReactNode }) => (
    <section>
      {header}
      {children}
    </section>
  ),
  CardItem: ({ title, actions }: { title?: React.ReactNode; actions?: React.ReactNode }) => (
    <div>
      {title}
      {actions}
    </div>
  ),
}))
vi.mock('@/containers/Capabilities', () => ({ default: () => null }))
vi.mock('@/components/ModelSourceBadge', () => ({
  ModelSourceBadge: () => null,
  MissingModelBadge: () => null,
}))
vi.mock('@/containers/dynamicControllerSetting', () => ({ DynamicControllerSetting: () => null }))
vi.mock('@/containers/RenderMarkdown', () => ({ RenderMarkdown: () => null }))
vi.mock('@/containers/dialogs/EditModel', () => ({ DialogEditModel: () => null }))
vi.mock('@/containers/ModelSetting', () => ({ ModelSetting: () => null }))
vi.mock('@/containers/dialogs/DeleteModel', () => ({ DialogDeleteModel: () => null }))
vi.mock('@/containers/FavoriteModelAction', () => ({ FavoriteModelAction: () => null }))
vi.mock('@/containers/dialogs/DeleteProvider', () => ({ default: () => null }))
vi.mock('@/containers/dialogs/AddModel', () => ({ DialogAddModel: () => null }))
vi.mock('@/hooks/useModelLoad', () => ({ useModelLoad: () => ({ setModelLoadError: vi.fn() }) }))
vi.mock('@/hooks/useModelProvider', () => ({
  useModelProvider: () => ({
    getProviderByName: () => state.provider,
    setProviders: vi.fn(),
    updateProvider: vi.fn(),
  }),
}))
vi.mock('@/i18n/react-i18next-compat', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))
vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (config: Record<string, unknown>) => ({ ...config }),
  Link: ({ children }: { children: React.ReactNode }) => <a>{children}</a>,
  useNavigate: () => vi.fn(),
  useParams: () => ({ providerName: 'openai' }),
}))

describe('Provider detail route', () => {
  beforeEach(() => {
    seedServiceHub({
      models: { getActiveModels: vi.fn().mockResolvedValue([]) } as never,
    })
  })

  const renderProvider = (apiKey: string) => {
    state.provider = {
      provider: 'openai',
      active: true,
      api_key: apiKey,
      base_url: 'https://api.openai.com/v1',
      settings: [],
      models: [{ id: 'gpt-test', capabilities: [] }],
    }
    const Component = (ProviderRoute as unknown as { component: React.ComponentType }).component
    return render(<Component />)
  }

  it('explains in visible text why Start is disabled until an API key is saved', () => {
    renderProvider('')

    expect(screen.getByText('providers:addApiKeyFirstHint')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'providers:start' })).toBeDisabled()
  })

  it('does not show the hint once an API key is saved', () => {
    renderProvider('sk-test')

    expect(screen.queryByText('providers:addApiKeyFirstHint')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'providers:start' })).toBeEnabled()
  })
})

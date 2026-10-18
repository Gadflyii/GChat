import { describe, it, expect, beforeEach, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { Route as ProviderRoute } from '../$providerName'
import { seedServiceHub } from '@/test/service-hub'

const state = vi.hoisted(() => ({
  provider: undefined as unknown,
  name: 'openai',
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
  CardItem: ({ title, description, actions }: { title?: React.ReactNode; description?: React.ReactNode; actions?: React.ReactNode }) => (
    <div>
      {title}
      {description}
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
vi.mock('@/containers/RenderMarkdown', () => ({
  RenderMarkdown: ({ content }: { content: string }) => <p>{content}</p>,
}))
vi.mock('@/containers/dialogs/EditModel', () => ({ DialogEditModel: () => null }))
vi.mock('@/containers/ModelSetting', () => ({ ModelSetting: () => null }))
vi.mock('@/containers/dialogs/DeleteModel', () => ({ DialogDeleteModel: () => null }))
vi.mock('@/containers/FavoriteModelAction', () => ({ FavoriteModelAction: () => null }))
vi.mock('@/containers/dialogs/DeleteProvider', () => ({ default: () => null }))
vi.mock('@/containers/dialogs/AddModel', () => ({ DialogAddModel: () => null }))
vi.mock('@/hooks/useModelLoad', () => ({
  useModelLoad: Object.assign(() => ({ setModelLoadError: vi.fn() }), {
    getState: () => ({ modelLoadError: undefined, setModelLoadError: vi.fn() }),
  }),
}))
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
  useParams: () => ({ providerName: state.name }),
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

  it('keeps engine options behind Advanced with plain labels and has no second Start for GInfer', () => {
    state.name = 'ginfer'
    try {
      const setting = (key: string, title: string) => ({ key, title, description: '', controller_type: 'input', controller_props: { value: '' } })
      state.provider = {
        provider: 'ginfer', active: true, api_key: '', base_url: '',
        settings: [setting('vision', 'Vision'), setting('spec', 'Speculative Decoding'), setting('kv_arena_bytes', 'KV Arena Size'), setting('auto_unload', 'Auto Unload')],
        models: [{ id: 'model', capabilities: [] }],
      }
      const Component = (ProviderRoute as unknown as { component: React.ComponentType }).component
      render(<Component />)
      const advanced = screen.getByText('providers:ginferAdvanced').closest('details')!
      expect(advanced).not.toHaveAttribute('open')
      expect(advanced).toHaveTextContent('Speculative decoding')
      expect(advanced).toHaveTextContent('Conversation memory size')
      expect(advanced).not.toHaveTextContent('KV Arena Size')
      expect(advanced).not.toHaveTextContent('Vision')
      expect(screen.getByText('Vision').closest('details')).toBeNull()
      expect(screen.getByText('Auto Unload').closest('details')).toBeNull()
      expect(screen.queryByRole('button', { name: 'providers:start' })).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'providers:manageInModels' })).toBeInTheDocument()
    } finally { state.name = 'openai' }
  })

  it('explains draft and prompt processing sizes in tokens when Advanced is opened', () => {
    state.name = 'ginfer'
    try {
      state.provider = {
        provider: 'ginfer', active: true, api_key: '', base_url: '',
        settings: [
          { key: 'draft_tokens', title: 'Draft Tokens', description: '', controller_type: 'input', controller_props: { value: 0, placeholder: 'Auto', type: 'number', min: 0, max: 7, step: 1 } },
          { key: 'prefill_chunk', title: 'Prefill Chunk', description: '', controller_type: 'input', controller_props: { value: 0, placeholder: 'Auto', type: 'number', min: 0, step: 128 } },
        ],
        models: [],
      }
      const Component = (ProviderRoute as unknown as { component: React.ComponentType }).component
      render(<Component />)

      fireEvent.click(screen.getByText('providers:ginferAdvanced'))

      expect(screen.getByText('Helper draft length')).toBeVisible()
      expect(screen.getByText('How many tokens (pieces of text) the speculative helper guesses ahead (1 to 7). Auto uses the model’s own recommendation.')).toBeVisible()
      expect(screen.getByText('Prompt processing block size')).toBeVisible()
      expect(screen.getByText('How many prompt tokens (pieces of text) GInfer processes in each block. Auto is fine for most computers; explicit values must be positive multiples of 128.')).toBeVisible()
    } finally { state.name = 'openai' }
  })
})

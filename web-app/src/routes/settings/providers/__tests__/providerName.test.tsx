import { describe, it, expect, beforeEach, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { Route as ProviderRoute } from '../$providerName'
import { seedServiceHub } from '@/test/service-hub'

const state = vi.hoisted(() => ({
  provider: undefined as unknown,
  name: 'openai',
  navigate: vi.fn(),
  updateProvider: vi.fn(),
  updateSettings: vi.fn(),
  stopAllModels: vi.fn(),
  startModel: vi.fn(),
  stopModel: vi.fn(),
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
vi.mock('@/containers/dynamicControllerSetting', () => ({
  DynamicControllerSetting: ({ title, controllerProps, onChange }: {
    title: string
    controllerProps: { value: string | boolean | number }
    onChange: (value: string | boolean | number) => void
  }) => <button onClick={() => onChange(
    typeof controllerProps.value === 'boolean' ? !controllerProps.value
      : typeof controllerProps.value === 'number' ? controllerProps.value + 1
        : `${controllerProps.value}/changed`
  )}>Save {title}</button>,
}))
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
    updateProvider: state.updateProvider,
  }),
}))
vi.mock('@/i18n/react-i18next-compat', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))
vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (config: Record<string, unknown>) => ({ ...config }),
  Link: ({ children }: { children: React.ReactNode }) => <a>{children}</a>,
  useNavigate: () => state.navigate,
  useParams: () => ({ providerName: state.name }),
}))

describe('Provider detail route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    state.name = 'openai'
    state.updateSettings.mockResolvedValue(undefined)
    seedServiceHub({
      providers: { updateSettings: state.updateSettings } as never,
      models: {
        getActiveModels: vi.fn().mockResolvedValue(['custom-host-model']),
        stopAllModels: state.stopAllModels,
        startModel: state.startModel,
        stopModel: state.stopModel,
      } as never,
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

  const appSettings = () => [
    { key: 'model_path', title: 'Model Path', description: '', controller_type: 'input', controller_props: { value: '/private/models' } },
    { key: 'binary_path', title: 'Binary Path', description: '', controller_type: 'input', controller_props: { value: '/private/ginfer-serve' } },
    { key: 'timeout', title: 'Timeout', description: '', controller_type: 'input', controller_props: { value: 600, type: 'number' } },
    { key: 'auto_unload', title: 'Auto Unload', description: '', controller_type: 'switch', controller_props: { value: true } },
  ]

  const renderGinfer = () => {
    state.name = 'ginfer'
    state.provider = {
      provider: 'ginfer', active: true, api_key: '', base_url: '',
      settings: [
        ...appSettings(),
        ...['vision', 'spec', 'draft_tokens', 'draft_tp', 'kv_dtype', 'kv_arena_bytes', 'prefill_chunk', 'max_concurrency', 'no_cuda_graph'].map((key) => ({
          key, title: `Old ${key}`, description: '', controller_type: 'input', controller_props: { value: 'stale override' },
        })),
      ],
      models: [{ id: 'custom-host-model', capabilities: [] }],
    }
    const Component = (ProviderRoute as unknown as { component: React.ComponentType }).component
    return render(<Component />)
  }

  it('directs model actions and custom startup settings to their owners, even with stale saved overrides', () => {
    renderGinfer()

    expect(screen.getByText('Model folder')).toBeVisible()
    expect(screen.getByText('Engine program')).toBeVisible()
    expect(screen.getByText('Model startup time limit')).toBeVisible()
    expect(screen.getByText('Unload other models automatically')).toBeVisible()
    expect(screen.queryByText(/^Old /)).not.toBeInTheDocument()
    expect(screen.queryByText('providers:ginferAdvanced')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'providers:start' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'providers:reload' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'providers:stop' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Open Models' }))
    expect(state.navigate).toHaveBeenLastCalledWith({ to: '/hub/' })
    fireEvent.click(screen.getByRole('button', { name: 'Open GInfer Hosts' }))
    expect(state.navigate).toHaveBeenLastCalledWith({ to: '/engines/' })
    fireEvent.click(screen.getByRole('button', { name: 'providers:manageInModels' }))
    expect(state.navigate).toHaveBeenLastCalledWith({ to: '/hub/' })
  })

  it.each([
    ['Model folder', 'model_path', '/private/models/changed'],
    ['Engine program', 'binary_path', '/private/ginfer-serve/changed'],
    ['Model startup time limit', 'timeout', 601],
    ['Unload other models automatically', 'auto_unload', false],
  ])('saves %s without disturbing an attached custom Host session', async (label, key, value) => {
    renderGinfer()

    fireEvent.click(screen.getByRole('button', { name: `Save ${label}` }))

    await waitFor(() => expect(state.updateSettings).toHaveBeenCalledOnce())
    expect(state.updateSettings).toHaveBeenCalledWith('ginfer', expect.arrayContaining([
      expect.objectContaining({ key, controller_props: expect.objectContaining({ value }) }),
    ]))
    expect(state.updateProvider).toHaveBeenCalledOnce()
    expect(state.stopAllModels).not.toHaveBeenCalled()
    expect(state.stopModel).not.toHaveBeenCalled()
    expect(state.startModel).not.toHaveBeenCalled()
    expect(screen.queryByText('Restart the model?')).not.toBeInTheDocument()
  })
})

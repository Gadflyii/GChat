import type { ReactNode } from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import SettingsMenu from '../SettingsMenu'

const providerState = vi.hoisted(() => ({
  providers: [
    { provider: 'ginfer', active: true, models: [] },
    { provider: 'openai', active: true, models: [] },
    { provider: 'anthropic', active: false, models: [] },
  ],
  selectedProvider: 'openai',
  addProvider: vi.fn(),
}))

vi.mock('@/hooks/useModelProvider', () => ({
  useModelProvider: () => providerState,
}))

vi.mock('@/i18n/react-i18next-compat', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

vi.mock('@/containers/NativeIntegrationControls', () => ({
  NativeIntegrationControls: () => null,
}))

vi.mock('@/containers/dialogs', () => ({
  AddProviderDialog: ({ children }: { children: ReactNode }) => children,
}))

vi.mock('@/containers/ProvidersAvatar', () => ({
  default: ({ provider }: { provider: { provider: string } }) => (
    <span
      aria-hidden="true"
      data-testid={`provider-avatar-${provider.provider}`}
    />
  ),
}))

vi.mock('@/lib/utils', () => ({
  cn: (...values: unknown[]) => values.filter(Boolean).join(' '),
  getProviderTitle: (provider: string) => provider,
  LOCAL_GINFER_PROVIDER: 'ginfer',
}))

function renderMenu(initialEntry = '/settings/general') {
  const root = createRootRoute({
    validateSearch: (search: Record<string, unknown>): { step?: string } =>
      typeof search.step === 'string' ? { step: search.step } : {},
    component: () => (
      <>
        {/* JSDOM does not build Tailwind; apply its visibility utility so
            keyboard traversal follows the installed sidebar's hidden rows. */}
        <style>{'.hidden { display: none; }'}</style>
        <SettingsMenu />
        <Outlet />
      </>
    ),
  })
  const general = createRoute({
    getParentRoute: () => root,
    path: '/settings/general',
    component: () => <div>General settings page</div>,
  })
  const provider = createRoute({
    getParentRoute: () => root,
    path: '/settings/providers/$providerName',
    component: () => <div>Provider settings page</div>,
  })
  const router = createRouter({
    routeTree: root.addChildren([general, provider]),
    history: createMemoryHistory({ initialEntries: [initialEntry] }),
    defaultPendingMs: 0,
  })
  render(<RouterProvider router={router} />)
  return router
}

async function tabTo(
  user: ReturnType<typeof userEvent.setup>,
  target: HTMLElement
) {
  for (let attempt = 0; attempt < 25; attempt += 1) {
    await user.tab()
    if (document.activeElement === target) return
  }
  expect(target).toHaveFocus()
}

describe('Settings provider keyboard navigation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    providerState.providers = [
      { provider: 'ginfer', active: true, models: [] },
      { provider: 'openai', active: true, models: [] },
      { provider: 'anthropic', active: false, models: [] },
    ]
  })

  it('tabs to an active provider and opens its settings with Enter', async () => {
    const user = userEvent.setup()
    const router = renderMenu()
    const openai = await screen.findByRole('link', { name: 'openai' })

    expect(openai).toHaveAttribute('href', '/settings/providers/openai')
    expect(screen.getByTestId('provider-active-dot-openai')).toBeInTheDocument()
    await tabTo(user, openai)
    await user.keyboard('{Enter}')

    await waitFor(() =>
      expect(router.state.location.pathname).toBe('/settings/providers/openai')
    )
    expect(openai).toHaveClass('bg-foreground/20')
    expect(screen.getByText('Provider settings page')).toBeInTheDocument()
  })

  it('collapses and expands hidden providers by keyboard before opening one', async () => {
    const user = userEvent.setup()
    const router = renderMenu()
    const toggle = await screen.findByRole('button', {
      name: 'common:hiddenProviders',
    })
    expect(screen.getByRole('link', { name: 'anthropic' })).toBeInTheDocument()

    await tabTo(user, toggle)
    await user.keyboard('{Enter}')
    expect(
      screen.queryByRole('link', { name: 'anthropic' })
    ).not.toBeInTheDocument()
    expect(toggle).toHaveFocus()

    await user.keyboard('{Enter}')
    const anthropic = screen.getByRole('link', { name: 'anthropic' })
    await user.tab()
    expect(anthropic).toHaveFocus()
    await user.keyboard('{Enter}')

    await waitFor(() =>
      expect(router.state.location.pathname).toBe('/settings/providers/anthropic')
    )
    expect(anthropic).toHaveClass('bg-foreground/20')
  })

  it('skips local GInfer during remote setup and preserves the setup step on Enter', async () => {
    const user = userEvent.setup()
    const router = renderMenu('/settings/general?step=setup_remote_provider')
    const openai = await screen.findByRole('link', { name: 'openai' })
    const local = screen.getByTestId('provider-avatar-ginfer').closest('a')
    expect(local).not.toBeVisible()
    expect(screen.queryByRole('link', { name: 'ginfer' })).not.toBeInTheDocument()

    // The add-provider button immediately precedes the provider links. A
    // single Tab must reach the remote provider rather than the local row.
    const addProvider = screen.getAllByRole('button')[0]
    await tabTo(user, addProvider)
    await user.tab()
    expect(openai).toHaveFocus()
    expect(openai).toHaveAttribute(
      'href',
      '/settings/providers/openai?step=setup_remote_provider'
    )
    await user.keyboard('{Enter}')

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/settings/providers/openai')
      expect(router.state.location.search).toEqual({
        step: 'setup_remote_provider',
      })
    })
  })
})

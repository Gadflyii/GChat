import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { Route } from '../privacy'
vi.mock('@/containers/SettingsMenu', () => ({ default: () => <nav>Settings</nav> }))
vi.mock('@/containers/HeaderPage', () => ({ default: ({ children }: { children: React.ReactNode }) => <header>{children}</header> }))
vi.mock('@tanstack/react-router', () => ({ createFileRoute: () => (options: { component: React.ComponentType }) => options }))
describe('Privacy settings', () => {
  it('explains local diagnostics and configured network use without an analytics toggle', () => {
    const Page = Route.component as React.ComponentType
    render(<Page />)
    expect(screen.getByText('No external analytics or crash reporting')).toBeInTheDocument()
    expect(screen.getByText(/Configured model providers, tools, downloads, and updates/)).toBeInTheDocument()
    expect(screen.queryByRole('switch')).not.toBeInTheDocument()
  })
})

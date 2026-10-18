import { useState } from 'react'
import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'
import { AgentStudioHeader, type AgentStudioSection } from '../AgentStudioHeader'

vi.mock('@/containers/HeaderPage', () => ({
  default: ({ children }: { children: React.ReactNode }) => <header>{children}</header>,
}))

it('lists the sections in their own left-aligned row under the title, with page actions beside the title', () => {
  const onSelect = vi.fn()
  render(
    <AgentStudioHeader
      active="definitions"
      onSelect={onSelect}
      actions={<button>Create agent</button>}
    />
  )
  const nav = screen.getByRole('navigation', { name: 'Agent Studio sections' })
  const title = screen.getByText('Agent Studio')
  // The tabs are a sibling row of the title row, not a flex item beside it.
  expect(nav.parentElement).toContainElement(title)
  expect(nav.parentElement).not.toBe(nav)
  expect(nav).toHaveClass('w-fit')
  expect(screen.getByRole('button', { name: 'Create agent' }).closest('nav')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Runs' }))
  expect(onSelect).toHaveBeenCalledWith('runs')
})

it('exposes the current section as keyboard navigation changes the Studio view', async () => {
  const user = userEvent.setup()
  function StudioNavigation() {
    const [active, setActive] = useState<AgentStudioSection>('definitions')
    return <AgentStudioHeader active={active} onSelect={setActive} />
  }
  render(<StudioNavigation />)
  const nav = within(screen.getByRole('navigation', { name: 'Agent Studio sections' }))
  expect(nav.getByRole('button', { current: 'page' })).toHaveTextContent('Agents & flows')

  for (const name of ['Templates', 'Skills', 'Worker Pools', 'Runs', 'Agents & flows']) {
    const section = nav.getByRole('button', { name })
    section.focus()
    await user.keyboard('{Enter}')
    expect(nav.getAllByRole('button', { current: 'page' })).toEqual([section])
    expect(section).toHaveFocus()
  }
})

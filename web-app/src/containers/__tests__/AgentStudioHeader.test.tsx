import { fireEvent, render, screen } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { AgentStudioHeader } from '../AgentStudioHeader'

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

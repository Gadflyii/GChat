import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentSkill } from '@/services/agent/skills'
import { AgentSkillSlashMenu } from './AgentSkillSlashMenu'

const pdfSkill: AgentSkill = {
  name: 'pdf',
  description: 'Read PDF documents',
  version: '1.0.0',
  requiresTools: [],
  requiresScripts: [],
  dangerous: false,
  platforms: null,
  enabled: true,
  compatible: true,
  reserved: true,
  unavailableReasons: [],
  error: null,
}

describe('AgentSkillSlashMenu', () => {
  const originalScrollIntoView = Object.getOwnPropertyDescriptor(
    HTMLElement.prototype,
    'scrollIntoView'
  )
  const scrollIntoView = vi.fn()

  beforeEach(() => {
    scrollIntoView.mockReset()
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      writable: true,
      value: scrollIntoView,
    })
  })

  afterEach(() => {
    if (originalScrollIntoView) {
      Object.defineProperty(
        HTMLElement.prototype,
        'scrollIntoView',
        originalScrollIntoView
      )
    } else {
      Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView')
    }
  })

  it('renders the menu only when open', () => {
    const props = {
      skills: [pdfSkill],
      activeIndex: 0,
      loading: false,
      onSelect: vi.fn(),
      onActiveIndexChange: vi.fn(),
    }
    const { rerender } = render(<AgentSkillSlashMenu {...props} open={false} />)

    expect(screen.queryByTestId('agent-skill-slash-menu')).toBeNull()

    rerender(<AgentSkillSlashMenu {...props} open />)
    expect(screen.getByRole('option', { name: /pdf/i })).toBeInTheDocument()
  })

  it('selects a skill with the mouse', async () => {
    const onSelect = vi.fn()
    const user = userEvent.setup()
    render(
      <AgentSkillSlashMenu
        skills={[pdfSkill]}
        activeIndex={0}
        loading={false}
        open
        onSelect={onSelect}
        onActiveIndexChange={vi.fn()}
      />
    )

    await user.click(screen.getByRole('option', { name: /pdf/i }))

    expect(onSelect).toHaveBeenCalledWith(pdfSkill)
  })

  it('reveals the active option at the end of a long list and after wrapping', () => {
    const skills = Array.from({ length: 24 }, (_, index) => ({
      ...pdfSkill,
      name: `skill-${index}`,
    }))
    const props = {
      skills,
      loading: false,
      open: true,
      onSelect: vi.fn(),
      onActiveIndexChange: vi.fn(),
    }
    const { rerender } = render(
      <AgentSkillSlashMenu {...props} activeIndex={0} />
    )

    expect(scrollIntoView.mock.contexts.at(-1)).toBe(
      screen.getByRole('option', { name: 'skill-0', selected: true })
    )

    rerender(<AgentSkillSlashMenu {...props} activeIndex={23} />)

    expect(scrollIntoView.mock.contexts.at(-1)).toBe(
      screen.getByRole('option', { name: 'skill-23', selected: true })
    )

    rerender(<AgentSkillSlashMenu {...props} activeIndex={0} />)

    expect(scrollIntoView.mock.contexts.at(-1)).toBe(
      screen.getByRole('option', { name: 'skill-0', selected: true })
    )
    expect(scrollIntoView).toHaveBeenCalledTimes(3)
    expect(scrollIntoView).toHaveBeenLastCalledWith(
      expect.objectContaining({ block: 'nearest' })
    )
  })

  it('reveals the current option when opening or filtering without an index change', () => {
    const filteredSkill = { ...pdfSkill, name: 'sheets' }
    const skills = [pdfSkill]
    const props = {
      activeIndex: 0,
      loading: false,
      onSelect: vi.fn(),
      onActiveIndexChange: vi.fn(),
    }
    const { rerender } = render(
      <AgentSkillSlashMenu {...props} skills={skills} open={false} />
    )

    rerender(<AgentSkillSlashMenu {...props} skills={skills} open />)

    expect(scrollIntoView.mock.contexts.at(-1)).toBe(
      screen.getByRole('option', { name: 'pdf', selected: true })
    )

    rerender(<AgentSkillSlashMenu {...props} skills={[filteredSkill]} open />)

    expect(scrollIntoView.mock.contexts.at(-1)).toBe(
      screen.getByRole('option', { name: 'sheets', selected: true })
    )
    expect(scrollIntoView).toHaveBeenCalledTimes(2)
  })

  it('does not scroll closed, loading, or empty menus and reveals loaded matches', () => {
    const skills = [pdfSkill]
    const props = {
      activeIndex: 0,
      onSelect: vi.fn(),
      onActiveIndexChange: vi.fn(),
    }
    const { rerender } = render(
      <AgentSkillSlashMenu
        {...props}
        skills={skills}
        open={false}
        loading={false}
      />
    )

    expect(scrollIntoView).not.toHaveBeenCalled()

    rerender(
      <AgentSkillSlashMenu {...props} skills={skills} open loading />
    )

    expect(scrollIntoView).not.toHaveBeenCalled()

    rerender(
      <AgentSkillSlashMenu {...props} skills={[]} open loading={false} />
    )

    expect(scrollIntoView).not.toHaveBeenCalled()

    rerender(<AgentSkillSlashMenu {...props} skills={skills} open loading />)

    expect(scrollIntoView).not.toHaveBeenCalled()

    rerender(
      <AgentSkillSlashMenu
        {...props}
        skills={skills}
        open
        loading={false}
      />
    )

    expect(scrollIntoView).toHaveBeenCalledOnce()
    expect(scrollIntoView.mock.contexts[0]).toBe(
      screen.getByRole('option', { name: 'pdf', selected: true })
    )
  })
})

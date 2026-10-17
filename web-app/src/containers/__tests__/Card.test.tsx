import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { CardItem } from '@/containers/Card'
import { Switch } from '@/components/ui/switch'

describe('CardItem', () => {
  it('names a switch by its row title and describes it with the row description', () => {
    render(
      <CardItem
        title="Launch at startup"
        description="Start GChat when you log in."
        actions={<Switch />}
      />
    )

    const toggle = screen.getByRole('switch', { name: 'Launch at startup' })
    expect(toggle).toHaveAccessibleDescription('Start GChat when you log in.')
  })

  it('keeps an explicit label on a switch', () => {
    render(
      <CardItem
        title="Server"
        actions={<Switch aria-label="Turn server on" />}
      />
    )

    expect(screen.getByRole('switch', { name: 'Turn server on' })).toBeInTheDocument()
  })
})

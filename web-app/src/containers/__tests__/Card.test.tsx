import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Card, CardItem } from '@/containers/Card'
import { Switch } from '@/components/ui/switch'
import { DropdownControl } from '@/containers/dynamicControllerSetting/DropdownControl'

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

  it('names a dropdown by its row title followed by the current choice', () => {
    render(
      <CardItem
        title="Speculative Decoding"
        description="Choose how to draft tokens."
        actions={
          <DropdownControl
            value="auto"
            options={[{ value: 'auto', name: 'Auto (recommended)' }]}
            onChange={() => undefined}
          />
        }
      />
    )

    const trigger = screen.getByRole('button', {
      name: 'Speculative Decoding Auto (recommended)',
    })
    expect(trigger).toHaveAccessibleDescription('Choose how to draft tokens.')
  })

  it('uses heading levels that nest: card title h2, row title h3', () => {
    render(
      <Card title="General">
        <CardItem title="Language" actions={<Switch />} />
      </Card>
    )

    expect(screen.getByRole('heading', { level: 2, name: 'General' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 3, name: 'Language' })).toBeInTheDocument()
  })
})

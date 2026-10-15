import { act, render, screen } from '@testing-library/react'
import { expect, it } from 'vitest'
import GbotAvatar, { type AvatarState } from './index'
import { useTheme } from '@/hooks/useTheme'

it('renders every supplied activity state in both themes and keeps decorative avatars out of the accessibility tree', () => {
  const states: AvatarState[] = [
    'idle',
    'listening',
    'thinking',
    'thinking-hard',
    'speaking',
    'greeting',
    'sleeping',
  ]
  const { rerender } = render(<GbotAvatar />)
  for (const dark of [true, false]) {
    act(() => useTheme.setState({ isDark: dark }))
    for (const state of states) {
      rerender(<GbotAvatar state={state} />)
      expect(screen.getByRole('img', { name: `Gbot ${state}` })).toHaveClass(
        `gbot--${state}`,
        `gbot--${dark ? 'dark' : 'light'}`
      )
    }
  }
  rerender(<GbotAvatar state="greeting" decorative />)
  expect(screen.queryByRole('img')).not.toBeInTheDocument()
})

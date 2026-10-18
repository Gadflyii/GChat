import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { ParametersSection } from '../ParametersSection'

vi.mock('@/i18n/react-i18next-compat', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

beforeAll(() => {
  vi.stubGlobal('ResizeObserver', class {
    observe() {}
    unobserve() {}
    disconnect() {}
  })
})

afterAll(() => vi.unstubAllGlobals())

const names = [
  'Temperature',
  'Top P',
  'Top K',
  'Min P',
  'Frequency Penalty',
  'Presence Penalty',
  'Repeat Penalty',
]

describe('ParametersSection', () => {
  it('names every numeric input, slider thumb and Stream switch', () => {
    render(<ParametersSection parameters={{}} onChange={vi.fn()} />)

    for (const name of names) {
      expect(screen.getByRole('spinbutton', { name })).toBeInTheDocument()
      expect(screen.getByRole('slider', { name })).toBeInTheDocument()
    }
    expect(screen.getByRole('switch', { name: 'Stream' })).toBeChecked()
  })

  it('focuses each numeric input through its visible label without changing values', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<ParametersSection parameters={{}} onChange={onChange} />)

    for (const name of names) {
      await user.click(screen.getByText(name, { selector: 'label' }))
      expect(screen.getByRole('spinbutton', { name })).toHaveFocus()
    }
    expect(onChange).not.toHaveBeenCalled()
  })

  it('keeps labels scoped to their own section when two editors are mounted', async () => {
    const user = userEvent.setup()
    render(
      <>
        <section aria-label="First editor">
          <ParametersSection parameters={{ temperature: 0.2 }} onChange={vi.fn()} />
        </section>
        <section aria-label="Second editor">
          <ParametersSection parameters={{ temperature: 0.9 }} onChange={vi.fn()} />
        </section>
      </>
    )

    const first = within(screen.getByRole('region', { name: 'First editor' }))
    const second = within(screen.getByRole('region', { name: 'Second editor' }))
    const firstInput = first.getByRole('spinbutton', { name: 'Temperature' })
    const secondInput = second.getByRole('spinbutton', { name: 'Temperature' })
    expect(firstInput.id).not.toBe(secondInput.id)
    await user.click(second.getByText('Temperature', { selector: 'label' }))
    expect(secondInput).toHaveFocus()
    expect(firstInput).toHaveValue(0.2)
    expect(secondInput).toHaveValue(0.9)
  })

  it.each([
    ['Frequency Penalty', 'frequency_penalty'],
    ['Presence Penalty', 'presence_penalty'],
  ])(
    'types and immediately saves a negative %s after clearing',
    async (name, key) => {
      const user = userEvent.setup()
      const onChange = vi.fn()
      function Editor() {
        const [parameters, setParameters] = useState<Record<string, unknown>>({
          frequency_penalty: 0.7,
          presence_penalty: 0.7,
        })
        return (
          <ParametersSection
            parameters={parameters}
            paramKeys={['frequency_penalty', 'presence_penalty']}
            onChange={(changedKey, value) => {
              onChange(changedKey, value)
              setParameters((current) => ({ ...current, [changedKey]: value }))
            }}
          />
        )
      }
      render(<Editor />)
      const input = screen.getByRole('spinbutton', { name })

      await user.clear(input)
      expect(input).toHaveValue(null)
      expect(onChange).not.toHaveBeenCalled()
      await user.type(input, '-0.5')
      expect(input).toHaveFocus()
      expect(input).toHaveValue(-0.5)
      expect(onChange).toHaveBeenLastCalledWith(key, -0.5)
      expect(screen.getByRole('slider', { name })).toHaveAttribute(
        'aria-valuenow',
        '-0.5'
      )
      const otherName =
        name === 'Frequency Penalty' ? 'Presence Penalty' : 'Frequency Penalty'
      expect(screen.getByRole('spinbutton', { name: otherName })).toHaveValue(0.7)
      expect(onChange.mock.calls.every(([changedKey]) => changedKey === key)).toBe(
        true
      )
      await user.tab()
      expect(input).toHaveValue(-0.5)
    }
  )

  it('restores unfinished numeric drafts on blur and follows external changes', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    const { rerender } = render(
      <ParametersSection parameters={{ frequency_penalty: 0.7 }} onChange={onChange} />
    )
    const input = screen.getByRole('spinbutton', { name: 'Frequency Penalty' })
    await user.clear(input)
    await user.type(input, '-')
    expect(input).toHaveValue(null)
    expect(onChange).not.toHaveBeenCalled()
    await user.tab()
    expect(input).toHaveValue(0.7)

    await user.clear(input)
    expect(input).toHaveValue(null)
    rerender(
      <ParametersSection parameters={{ frequency_penalty: -0.4 }} onChange={onChange} />
    )
    expect(input).toHaveValue(-0.4)
    expect(onChange).not.toHaveBeenCalled()
  })

  it('preserves numeric clamping, keyboard slider updates and Stream toggling', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<ParametersSection parameters={{ temperature: 0.7 }} onChange={onChange} />)

    fireEvent.change(screen.getByRole('spinbutton', { name: 'Temperature' }), {
      target: { value: '3' },
    })
    expect(onChange).toHaveBeenLastCalledWith('temperature', 2)
    screen.getByRole('slider', { name: 'Temperature' }).focus()
    await user.keyboard('{ArrowRight}')
    expect(onChange).toHaveBeenLastCalledWith('temperature', 0.8)
    await user.click(screen.getByText('Stream', { selector: 'label' }))
    expect(onChange).toHaveBeenLastCalledWith('stream', false)
  })
})

import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
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

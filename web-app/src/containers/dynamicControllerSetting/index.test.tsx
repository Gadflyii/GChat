import { useState, type FormEvent } from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DynamicControllerSetting } from '.'

const originalClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard')

afterEach(() => {
  cleanup()
  vi.clearAllTimers()
  vi.useRealTimers()
  if (originalClipboard) {
    Object.defineProperty(navigator, 'clipboard', originalClipboard)
  } else {
    Reflect.deleteProperty(navigator, 'clipboard')
  }
})

describe('DynamicControllerSetting input labels', () => {
  it('names distinct provider fields and preserves masked input and edit values', () => {
    const updateKey = vi.fn()
    const updateUrl = vi.fn()
    render(
      <>
        <DynamicControllerSetting
          title="API Key"
          controllerType="input"
          controllerProps={{ type: 'password', value: 'sk-example' }}
          onChange={updateKey}
        />
        <DynamicControllerSetting
          title="Base URL"
          controllerType="input"
          controllerProps={{ value: 'https://example.test/v1' }}
          onChange={updateUrl}
        />
      </>
    )

    const apiKey = screen.getByLabelText('API Key')
    const baseUrl = screen.getByRole('textbox', { name: 'Base URL' })
    expect(apiKey).toHaveAttribute('type', 'password')
    expect(apiKey).toHaveValue('sk-example')
    expect(baseUrl).toHaveValue('https://example.test/v1')

    fireEvent.change(apiKey, { target: { value: ' sk-example+/= ' } })
    expect(updateKey).toHaveBeenCalledExactlyOnceWith(' sk-example+/= ')
    fireEvent.change(baseUrl, {
      target: { value: ' https://another.test/v1 ' },
    })
    expect(updateUrl).toHaveBeenCalledExactlyOnceWith(' https://another.test/v1 ')
  })

  it('names reveal and hide actions without submitting or changing the secret', () => {
    const submit = vi.fn((event: FormEvent) => event.preventDefault())
    const onChange = vi.fn()
    render(
      <form onSubmit={submit}>
        <DynamicControllerSetting
          title="API Key"
          controllerType="input"
          controllerProps={{
            type: 'password',
            value: 'sk-example',
            input_actions: ['unobscure'],
          }}
          onChange={onChange}
        />
      </form>
    )

    const input = screen.getByLabelText('API Key')
    const reveal = screen.getByRole('button', { name: 'Show API Key' })
    expect(reveal).toHaveAttribute('type', 'button')
    expect(reveal).toHaveAttribute('aria-pressed', 'false')
    fireEvent.click(reveal)
    expect(input).toHaveAttribute('type', 'text')
    expect(input).toHaveAccessibleName('API Key')
    expect(input).toHaveValue('sk-example')

    const hide = screen.getByRole('button', { name: 'Hide API Key' })
    expect(hide).toHaveAttribute('type', 'button')
    expect(hide).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(hide)
    expect(input).toHaveAttribute('type', 'password')
    expect(input).toHaveValue('sk-example')
    expect(screen.getByRole('button', { name: 'Show API Key' })).toHaveAttribute(
      'aria-pressed',
      'false'
    )
    expect(onChange).not.toHaveBeenCalled()
    expect(submit).not.toHaveBeenCalled()
  })

  it('names copy feedback while retaining the exact clipboard value and masking', () => {
    vi.useFakeTimers()
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    })
    const submit = vi.fn((event: FormEvent) => event.preventDefault())
    render(
      <form onSubmit={submit}>
        <DynamicControllerSetting
          title="API Key"
          controllerType="input"
          controllerProps={{
            type: 'password',
            value: 'sk-example+/=',
            input_actions: ['copy'],
          }}
          onChange={vi.fn()}
        />
      </form>
    )

    const copy = screen.getByRole('button', { name: 'Copy API Key' })
    expect(copy).toHaveAttribute('type', 'button')
    fireEvent.click(copy)
    expect(writeText).toHaveBeenCalledExactlyOnceWith('sk-example+/=')
    expect(screen.getByRole('button', { name: 'Copied API Key' })).toBe(copy)
    expect(screen.getByLabelText('API Key')).toHaveAttribute('type', 'password')
    act(() => vi.advanceTimersByTime(1000))
    expect(screen.getByRole('button', { name: 'Copy API Key' })).toBe(copy)
    expect(submit).not.toHaveBeenCalled()
  })

  it('names the existing text-backed number control and preserves bounded string edits', () => {
    const onChange = vi.fn()
    const submit = vi.fn((event: FormEvent) => event.preventDefault())
    function NumberSetting() {
      const [value, setValue] = useState<string | boolean | number>(0.9)
      return (
        <form onSubmit={submit}>
          <DynamicControllerSetting
            title="Temperature"
            controllerType="input"
            controllerProps={{ type: 'number', value, min: 0, max: 1, step: 0.1 }}
            onChange={(nextValue) => {
              onChange(nextValue)
              setValue(nextValue)
            }}
          />
        </form>
      )
    }
    render(<NumberSetting />)

    const input = screen.getByRole('textbox', { name: 'Temperature' })
    const increment = screen.getByRole('button', { name: 'Increment' })
    const decrement = screen.getByRole('button', { name: 'Decrement' })
    expect(input).toHaveProperty('type', 'text')
    expect(input).toHaveValue('0.9')
    expect(increment).toHaveAttribute('type', 'button')
    expect(decrement).toHaveAttribute('type', 'button')

    fireEvent.click(increment)
    expect(onChange).toHaveBeenLastCalledWith('1')
    expect(increment).toBeDisabled()
    fireEvent.click(decrement)
    expect(onChange).toHaveBeenLastCalledWith('0.9')
    fireEvent.change(input, { target: { value: '0' } })
    expect(onChange).toHaveBeenLastCalledWith('0')
    expect(decrement).toBeDisabled()
    fireEvent.click(increment)
    expect(onChange).toHaveBeenLastCalledWith('0.1')
    expect(input).toHaveValue('0.1')
    expect(submit).not.toHaveBeenCalled()
  })
})

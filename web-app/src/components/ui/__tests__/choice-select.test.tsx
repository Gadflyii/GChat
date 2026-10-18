import { useState } from 'react'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'
import { ChoiceSelect } from '../choice-select'

const options = [
  { value: '', label: 'Choose a computer' },
  { value: 'offline', label: 'Unavailable computer', disabled: true, group: 'Computers' },
  { value: 'one', label: 'First computer', group: 'Computers' },
  { value: 'two', label: 'Second computer with a long descriptive name', group: 'Computers' },
]
afterEach(() => { cleanup(); vi.restoreAllMocks() })

it('selects by keyboard, skips disabled choices and returns focus to the field', async () => {
  const user = userEvent.setup()
  const changed = vi.fn()
  function Field() {
    const [value, setValue] = useState('')
    return <ChoiceSelect aria-label="Computer" value={value} options={options}
      onValueChange={next => { changed(next); setValue(next) }} />
  }
  render(<Field />)
  const field = screen.getByRole('button', { name: 'Computer' })
  await user.tab()
  await user.keyboard('{ArrowDown}')
  await waitFor(() => expect(screen.getByRole('menuitemradio', { name: 'Choose a computer' })).toHaveFocus())
  expect(screen.getByRole('menuitemradio', { name: 'Unavailable computer' })).toHaveAttribute('aria-disabled', 'true')
  await user.keyboard('{ArrowDown}{Enter}')
  expect(changed).toHaveBeenCalledExactlyOnceWith('one')
  expect(field).toHaveTextContent('First computer')
  await waitFor(() => expect(field).toHaveFocus())
  await user.keyboard('{Enter}')
  await waitFor(() => expect(screen.getByRole('menuitemradio', { name: 'First computer' })).toHaveFocus())
  await user.keyboard('{End}{Enter}')
  expect(changed).toHaveBeenLastCalledWith('two')
  expect(field).toHaveTextContent('Second computer with a long descriptive name')
})

it('preserves selection on Escape and does not send a change for the checked choice', async () => {
  const user = userEvent.setup()
  const changed = vi.fn()
  render(<ChoiceSelect aria-label="Computer" value="one" options={options} onValueChange={changed} />)
  const field = screen.getByRole('button', { name: 'Computer' })
  await user.click(field)
  await waitFor(() => expect(screen.getByRole('menuitemradio', { name: 'First computer' })).toHaveFocus())
  await user.keyboard('{ArrowDown}{Escape}')
  expect(changed).not.toHaveBeenCalled()
  expect(field).toHaveTextContent('First computer')
  await waitFor(() => expect(field).toHaveFocus())
  await user.click(field)
  await user.click(screen.getByRole('menuitemradio', { name: 'First computer' }))
  expect(changed).not.toHaveBeenCalled()
  expect(screen.queryByRole('menu')).not.toBeInTheDocument()
})

it.each([false, true])('Tab closes the choices and moves to the adjacent field (shift=%s)', async shift => {
  // jsdom has no layout; supply visible rectangles for this focus-order check.
  vi.spyOn(HTMLElement.prototype, 'getClientRects').mockReturnValue([{ width: 10, height: 10 }] as unknown as DOMRectList)
  const user = userEvent.setup()
  const changed = vi.fn()
  render(<><button>Before</button><ChoiceSelect aria-label="Computer" value="one" options={options} onValueChange={changed} />
    <button disabled>Skipped</button><button>After</button></>)
  await user.click(screen.getByRole('button', { name: 'Computer' }))
  await waitFor(() => expect(screen.getByRole('menuitemradio', { name: 'First computer' })).toHaveFocus())
  await user.tab({ shift })
  await waitFor(() => expect(screen.getByRole('button', { name: shift ? 'Before' : 'After' })).toHaveFocus())
  expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  expect(changed).not.toHaveBeenCalled()
})

it('keeps a disabled field out of the tab order and does not open it', async () => {
  const user = userEvent.setup()
  const changed = vi.fn()
  render(<><button>Before</button><ChoiceSelect aria-label="Computer" value="" options={options} disabled onValueChange={changed} /><button>Next</button></>)
  await user.tab()
  expect(screen.getByRole('button', { name: 'Before' })).toHaveFocus()
  await user.tab()
  expect(screen.getByRole('button', { name: 'Next' })).toHaveFocus()
  await user.click(screen.getByRole('button', { name: 'Computer' }))
  expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  expect(changed).not.toHaveBeenCalled()
})

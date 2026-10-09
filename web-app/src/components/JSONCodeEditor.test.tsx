import { fireEvent, render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import JSONCodeEditor from './JSONCodeEditor'

describe('JSON editing', () => {
  it('preserves editor input and existing Prism JSON token classes', () => {
    const source = '{"active":true,"count":3,"value":null}'
    const onChange = vi.fn()
    const { container } = render(<JSONCodeEditor value={source} onChange={onChange} />)
    const textarea = container.querySelector('textarea')!
    expect(textarea.value).toBe(source)
    expect(container.querySelector('.token.property')?.textContent).toBe('"active"')
    expect(container.querySelector('.token.boolean')?.textContent).toBe('true')
    expect(container.querySelector('.token.number')?.textContent).toBe('3')
    fireEvent.change(textarea, { target: { value: '{"count":4}' } })
    expect(onChange).toHaveBeenCalledOnce()
    expect(textarea.value).toBe('{"count":4}')
  })
})

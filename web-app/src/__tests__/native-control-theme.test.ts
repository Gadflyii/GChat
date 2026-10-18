import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const css = readFileSync(resolve(__dirname, '../index.css'), 'utf8')

describe('native checkbox and radio theme', () => {
  it('uses the app accent and the dark colour scheme', () => {
    expect(css).toMatch(/input\[type='checkbox'\],\s*input\[type='radio'\]\s*\{[^}]*accent-color: var\(--primary\)/)
    expect(css).toMatch(/\.dark input\[type='checkbox'\],\s*\.dark input\[type='radio'\]\s*\{[^}]*color-scheme: dark/)
  })

  it('keeps radio focus visible when WebKit omits focus-visible after an arrow key', () => {
    expect(css).toMatch(/input\[type='checkbox'\]:focus-visible,\s*input\[type='radio'\]:focus\s*\{[^}]*outline-ring/)
  })

  it('themes native progress bars and animates an indeterminate one, honouring reduced motion', () => {
    expect(css).toMatch(/progress::-webkit-progress-value\s*\{[^}]*background-color: var\(--primary\)/)
    expect(css).toMatch(/progress:not\(\[value\]\)\s*\{[^}]*animation: native-progress-indeterminate/)
    expect(css).toMatch(/prefers-reduced-motion: reduce\)\s*\{\s*progress:not\(\[value\]\)\s*\{[^}]*animation: none/)
  })
})

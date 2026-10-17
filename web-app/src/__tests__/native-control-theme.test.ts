import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const css = readFileSync(resolve(__dirname, '../index.css'), 'utf8')

describe('native checkbox and radio theme', () => {
  it('uses the app accent and the dark colour scheme', () => {
    expect(css).toMatch(/input\[type='checkbox'\],\s*input\[type='radio'\]\s*\{[^}]*accent-color: var\(--primary\)/)
    expect(css).toMatch(/\.dark input\[type='checkbox'\],\s*\.dark input\[type='radio'\]\s*\{[^}]*color-scheme: dark/)
  })

  it('shows a keyboard focus ring on them', () => {
    expect(css).toMatch(/input\[type='checkbox'\]:focus-visible,\s*input\[type='radio'\]:focus-visible/)
  })
})

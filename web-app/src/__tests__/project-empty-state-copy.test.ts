import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('project empty state', () => {
  it('points to the message box above it, where the project page puts it', () => {
    const en = JSON.parse(
      readFileSync(resolve(__dirname, '../locales/en/common.json'), 'utf8')
    )
    expect(en.projects.startNewConversation).toBe(
      'Start a new conversation with {{projectName}} above'
    )
    const route = readFileSync(
      resolve(__dirname, '../routes/project/$projectId.tsx'),
      'utf8'
    )
    expect(route.indexOf('<ChatInput')).toBeGreaterThan(-1)
    expect(route.indexOf('<ChatInput')).toBeLessThan(
      route.indexOf("t('projects.startNewConversation'")
    )
  })
})

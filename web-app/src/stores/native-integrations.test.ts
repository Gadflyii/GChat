import { expect, it } from 'vitest'
import { useCodeTerminalStore } from './code-terminal-store'
import { useHermesAgentStore } from './hermes-agent-store'

it('defaults to OpenCode enabled and Hermes disabled on a fresh installation', () => {
  expect(useCodeTerminalStore.getInitialState().enabled).toBe(true)
  expect(useHermesAgentStore.getInitialState().enabled).toBe(false)
})

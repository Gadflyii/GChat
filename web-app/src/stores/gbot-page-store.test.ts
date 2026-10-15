import { beforeEach, expect, it, vi } from 'vitest'
import type { AgentDefinition } from '@/types/agent'
import { draftProposal, pageMessage, useGbotPage } from './gbot-page-store'

const draft: AgentDefinition = {
  schemaVersion: 3,
  id: '',
  name: 'Research',
  description: '',
  instructions: 'Use evidence',
  skills: [],
  maxSteps: 25,
  outputContract: '',
  modelInstanceId: null,
  reasoningEffort: null,
  kind: 'standard',
  builtIn: false,
}
const update = vi.fn()
beforeEach(() => {
  update.mockClear()
  useGbotPage.setState({ page: null, sharing: null, requests: {} })
  useGbotPage.getState().publish({ id: 'studio', draft, update })
})

function share() {
  const s = useGbotPage.getState()
  s.share('atlas', 'local')
  const request = s.capture('atlas', 'local', 'Help me write this agent')!
  s.remember('task', request)
  return request
}

it('shares only after opt-in, with the selected bot and service', () => {
  const s = useGbotPage.getState()
  expect(s.capture('atlas', 'local', 'Help')).toBeNull()
  const request = share()
  expect(request.prompt).toContain('Use evidence')
  expect(request.prompt).toContain('instructions, defaultGoal, outputContract')
  expect(pageMessage(request.prompt)).toEqual({
    text: 'Help me write this agent',
    shared: true,
  })
  expect(s.capture('bramble', 'local', 'Help')).toBeNull()
  expect(s.capture('atlas', 'paired', 'Help')).toBeNull()
  expect(
    s.canApply('task', 'bramble', 'local', { instructions: 'Changed' })
  ).toBe(false)
  expect(
    s.canApply('task', 'atlas', 'paired', { instructions: 'Changed' })
  ).toBe(false)
})

it('applies only allowed text to the existing form and consumes the old proposal', () => {
  share()
  const s = useGbotPage.getState()
  expect(
    s.apply('task', 'atlas', 'local', { instructions: 'Cite each source' })
  ).toBe(true)
  expect(update).toHaveBeenCalledExactlyOnceWith({
    ...draft,
    instructions: 'Cite each source',
  })
  expect(s.apply('task', 'atlas', 'local', { name: 'Again' })).toBe(false)
  expect(useGbotPage.getState().page?.draft.maxSteps).toBe(25)
})

it('blocks stale edits even if the user later restores the original draft', () => {
  share()
  const s = useGbotPage.getState()
  s.publish({ id: 'studio', draft: { ...draft, name: 'Newer work' }, update })
  s.publish({ id: 'studio', draft, update })
  expect(s.apply('task', 'atlas', 'local', { instructions: 'Old edit' })).toBe(
    false
  )
  expect(update).not.toHaveBeenCalled()
})

it.each(['stop', 'navigate', 'replace'] as const)(
  'revokes proposals on %s including late task creation',
  (event) => {
    const request = share()
    const s = useGbotPage.getState()
    if (event === 'stop') s.stop()
    if (event === 'navigate') s.clear('studio')
    if (event === 'replace') s.publish({ id: 'other', draft, update })
    s.remember('late-task', request)
    expect(s.apply('task', 'atlas', 'local', { name: 'Old edit' })).toBe(false)
    expect(s.apply('late-task', 'atlas', 'local', { name: 'Late edit' })).toBe(
      false
    )
    expect(update).not.toHaveBeenCalled()
  }
)

it.each([
  '{}',
  '{"permissions":{"shell":"allow"}}',
  '{"id":"other"}',
  '{"maxSteps":100}',
  '{"name":null}',
  '{"__proto__":"polluted"}',
  '[]',
  'null',
  '{"name":"' + 'a'.repeat(32769) + '"}',
])('leaves invalid or disallowed model output inert (case %#)', (value) => {
  expect(draftProposal('```gchat-agent-draft\n' + value + '\n```')).toBeNull()
})

it('accepts a single text proposal, rejects ambiguous blocks and fields for a different composition', () => {
  const block =
    '```gchat-agent-draft\n{"name":"Evidence assistant","defaultGoal":""}\n```'
  expect(draftProposal('My suggestion:\n' + block)).toEqual({
    name: 'Evidence assistant',
    defaultGoal: '',
  })
  expect(draftProposal(block + '\n' + block)).toBeNull()
  share()
  expect(
    useGbotPage
      .getState()
      .apply('task', 'atlas', 'local', { successCriteria: 'PASS' })
  ).toBe(false)
})

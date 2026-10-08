import { describe, expect, it } from 'vitest'
import { getCodeSessionReference, getSessionKind } from './sessions'

describe('shared history runtime and activity identity', () => {
  const chat: Thread = { id: 'chat-1', title: 'Chat', updated: 1 }
  it('distinguishes Code references from ordinary chats and actual delegated work', () => {
    expect(getSessionKind(chat)).toBe('chat')
    expect(getSessionKind({ ...chat, metadata: { has_agent_activity: true } })).toBe('agent')
    expect(getSessionKind({ ...chat, metadata: { is_agent_thread: true } })).toBe('agent')
    expect(getSessionKind(chat, { [chat.id]: true })).toBe('agent')
    const code = { ...chat, metadata: { runtime: 'code', code: { session_id: 'ses_saved', directory: '/project' }, has_agent_activity: true } }
    expect(getSessionKind(code)).toBe('code')
    expect(getCodeSessionReference(code)?.session_id).toBe('ses_saved')
  })
  it('does not turn ordinary filesystem capability use into an Agent session', () => {
    expect(getSessionKind({ ...chat, metadata: { tools: ['native::read_file'] } })).toBe('chat')
    expect(getCodeSessionReference({ ...chat, metadata: { runtime: 'code' } })).toBeUndefined()
  })
})

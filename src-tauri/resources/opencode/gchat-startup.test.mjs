import test from 'node:test'
import assert from 'node:assert/strict'
import plugin from './gchat-startup.mjs'

test('opens a real empty session in the full UI without generating a message', async () => {
  let route = { name: 'home' }
  const sessions = []
  const api = {
    route: { get current() { return route }, navigate(name, params) { route = { name, params } } },
    client: { session: { async create(input) { sessions.push(input); return { data: { id: 'ses_test' } } } } },
    state: { path: { directory: '/workspace' } },
    lifecycle: { signal: new AbortController().signal },
    ui: { toast() { assert.fail('Unexpected error') } },
  }
  await plugin.tui(api)
  assert.deepEqual(route, { name: 'session', params: { sessionID: 'ses_test' } })
  assert.deepEqual(sessions, [{ directory: '/workspace', title: 'GChat coding session' }])
  await plugin.tui(api)
  assert.equal(sessions.length, 1)
})

test('leaves the home UI usable and shows failure when creation fails', async () => {
  const notices = []
  await plugin.tui({
    route: { current: { name: 'home' }, navigate() { assert.fail('Must not navigate') } },
    client: { session: { async create() { throw new Error('Server unavailable') } } },
    state: { path: { directory: '/workspace' } },
    lifecycle: { signal: new AbortController().signal },
    ui: { toast(notice) { notices.push(notice) } },
  })
  assert.match(notices[0].message, /Server unavailable/)
})

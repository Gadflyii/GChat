import test, { afterEach, beforeEach, mock } from 'node:test'
import assert from 'node:assert/strict'
import plugin from './gchat-startup.mjs'

let reports, tick
const originalEnvironment = { bridge: process.env.GCHAT_BRIDGE_URL, token: process.env.GCHAT_BRIDGE_TOKEN, session: process.env.GCHAT_CODE_SESSION }
beforeEach(() => {
  reports = []
  process.env.GCHAT_BRIDGE_URL = 'http://127.0.0.1:1234/mcp/code-launch'
  process.env.GCHAT_BRIDGE_TOKEN = 'test-token'
  delete process.env.GCHAT_CODE_SESSION
  mock.method(globalThis, 'setInterval', callback => { tick = callback; return 1 })
  mock.method(globalThis, 'clearInterval', () => {})
  mock.method(globalThis, 'fetch', async (url, input) => {
    assert.equal(url, 'http://127.0.0.1:1234/mcp/code-launch/history')
    assert.equal(input.headers.Authorization, 'Bearer test-token')
    reports.push(JSON.parse(input.body))
    return { ok: true }
  })
})
afterEach(() => {
  mock.restoreAll()
  for (const [key, value] of Object.entries({ GCHAT_BRIDGE_URL: originalEnvironment.bridge, GCHAT_BRIDGE_TOKEN: originalEnvironment.token, GCHAT_CODE_SESSION: originalEnvironment.session })) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value
  }
})

function harness() {
  let route = { name: 'home' }
  const sessions = new Map()
  const events = new Map()
  const created = []
  const notices = []
  const disposers = []
  const api = {
    route: { get current() { return route }, navigate(name, params) { route = { name, params } } },
    client: { session: {
      async create(input) {
        created.push(input)
        const info = { id: 'ses_new', directory: '/workspace', title: input.title, time: { updated: 1000 } }
        sessions.set(info.id, info)
        return { data: info }
      },
      async get({ sessionID }) { return { data: sessions.get(sessionID) } },
      async list() { return { data: [...sessions.values()] } },
    } },
    event: { on(type, callback) { events.set(type, callback) } },
    state: { path: { directory: '/workspace' }, session: { get: id => sessions.get(id) } },
    lifecycle: { signal: new AbortController().signal, onDispose: callback => disposers.push(callback) },
    ui: { toast: notice => notices.push(notice) },
  }
  return { api, sessions, events, created, notices, disposers }
}

const drain = () => new Promise(resolve => setImmediate(resolve))

test('explicit first Code entry creates one empty full session and registers a reference', async () => {
  const h = harness()
  await plugin.tui(h.api)
  assert.deepEqual(h.api.route.current, { name: 'session', params: { sessionID: 'ses_new' } })
  assert.deepEqual(h.created, [{ directory: '/workspace', title: 'GChat coding session' }])
  assert.equal(reports[0].kind, 'selected')
  assert.equal(reports[0].info.id, 'ses_new')
  tick()
  await drain()
  assert.equal(h.created.length, 1)
  assert.equal(h.notices.length, 0)
  h.disposers.forEach(dispose => dispose())
})

test('saved startup resumes the existing session without a phantom replacement', async () => {
  process.env.GCHAT_CODE_SESSION = 'ses_saved'
  const h = harness()
  h.sessions.set('ses_saved', { id: 'ses_saved', directory: '/workspace', title: 'Saved task', time: { updated: 2000 } })
  await plugin.tui(h.api)
  assert.equal(h.created.length, 0)
  assert.equal(h.api.route.current.params.sessionID, 'ses_saved')
  assert.equal(reports.at(-1).kind, 'selected')
  assert.equal(reports.at(-1).info.id, 'ses_saved')
})

test('stock picker and new session changes update selection in the same workspace runtime', async () => {
  const h = harness()
  h.api.route.navigate('session', { sessionID: 'ses_saved' })
  h.sessions.set('ses_saved', { id: 'ses_saved', directory: '/workspace', title: 'Saved task', time: { updated: 2000 } })
  await plugin.tui(h.api)
  assert.equal(h.created.length, 0)
  const next = { id: 'ses_next', directory: '/workspace', title: 'Next task', time: { updated: 3000 } }
  h.sessions.set(next.id, next)
  h.events.get('session.created')({ properties: { info: next } })
  h.api.route.navigate('session', { sessionID: next.id })
  tick()
  await drain()
  assert.deepEqual(reports.at(-1), { kind: 'selected', info: next })
  h.events.get('session.updated')({ properties: { info: { ...next, title: 'Renamed upstream' } } })
  h.events.get('session.deleted')({ properties: { info: next } })
  await drain()
  assert.deepEqual(reports.slice(-2).map(report => report.kind), ['updated', 'deleted'])
})

test('does not index unrelated workspace sessions or child agent transcripts', async () => {
  const h = harness()
  h.sessions.set('ses_other', { id: 'ses_other', directory: '/other', title: 'Other workspace' })
  h.sessions.set('ses_child', { id: 'ses_child', directory: '/workspace', title: 'Child', parentID: 'ses_new' })
  await plugin.tui(h.api)
  assert.ok(reports.every(report => report.info.id === 'ses_new'))
})

test('missing saved session leaves home usable and reports failure without creating', async () => {
  process.env.GCHAT_CODE_SESSION = 'ses_missing'
  const h = harness()
  await plugin.tui(h.api)
  assert.equal(h.created.length, 0)
  assert.equal(h.api.route.current.name, 'home')
  assert.match(h.notices[0].message, /saved OpenCode session is unavailable/)
})

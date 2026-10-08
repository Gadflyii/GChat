import test, { afterEach, beforeEach, mock } from 'node:test'
import assert from 'node:assert/strict'
import plugin from './gchat-caller.mjs'

let requests
beforeEach(() => {
  process.env.GCHAT_BRIDGE_URL = 'http://127.0.0.1:1234/mcp/test'
  process.env.GCHAT_BRIDGE_TOKEN = 'test-token'
  requests = []
  mock.method(globalThis, 'fetch', async (_url, input) => {
    requests.push(JSON.parse(input.body))
    return { ok: true }
  })
})
afterEach(() => {
  delete process.env.GCHAT_BRIDGE_URL
  delete process.env.GCHAT_BRIDGE_TOKEN
  mock.restoreAll()
})

const hooks = () => plugin.server({ directory: '/workspace', client: { session: {
  get: async ({ path, query }) => {
    assert.equal(query.directory, '/workspace')
    return { data: { id: path.id, directory: '/workspace', title: 'Caller' } }
  },
} } })

test('tags concurrent GChat MCP calls with the real caller and replaces forged model metadata', async () => {
  const hook = (await hooks())['tool.execute.before']
  const first = { args: { path: '/one', _gchat_opencode_session_id: 'ses_forged' } }
  const second = { args: { path: '/two' } }
  await Promise.all([
    hook({ tool: 'gchat_gchat_native_read_file', sessionID: 'ses_first', callID: 'call-one' }, first),
    hook({ tool: 'gchat_gchat_native_read_file', sessionID: 'ses_second', callID: 'call-two' }, second),
  ])
  assert.equal(first.args._gchat_opencode_session_id, 'ses_first')
  assert.equal(second.args._gchat_opencode_session_id, 'ses_second')
  assert.deepEqual(requests.map(request => request.info.id).sort(), ['ses_first', 'ses_second'])
  assert.ok(requests.every(request => request.kind === 'caller'))
  assert.ok(requests.every(request => request.parents.length === 0))
})

test('reports the public parent chain while retaining the actual child caller', async () => {
  const sessions = {
    ses_child: { id: 'ses_child', parentID: 'ses_parent', directory: '/workspace' },
    ses_parent: { id: 'ses_parent', parentID: 'ses_root', directory: '/workspace' },
    ses_root: { id: 'ses_root', directory: '/workspace' },
  }
  const hook = (await plugin.server({ directory: '/workspace', client: { session: {
    get: async ({ path, query }) => {
      assert.equal(query.directory, '/workspace')
      return { data: sessions[path.id] }
    },
  } } }))['tool.execute.before']
  const output = { args: {} }
  await hook({ tool: 'gchat_gchat_native_read_file', sessionID: 'ses_child' }, output)
  assert.equal(output.args._gchat_opencode_session_id, 'ses_child')
  assert.deepEqual(requests[0].parents.map(info => info.id), ['ses_parent', 'ses_root'])
})

test('rejects missing and cyclic parent ancestry before dispatching', async () => {
  for (const parent of [undefined, { id: 'ses_child', parentID: 'ses_child' }]) {
    const hook = (await plugin.server({ directory: '/workspace', client: { session: {
      get: async ({ path }) => ({ data: path.id === 'ses_child'
        ? { id: 'ses_child', parentID: 'ses_parent' } : parent }),
    } } }))['tool.execute.before']
    await assert.rejects(hook({ tool: 'gchat_gchat_list_skills', sessionID: 'ses_child' }, { args: {} }), /parent|ancestry/)
  }
  assert.equal(requests.length, 0)
})

test('leaves stock tools and other configured MCP servers untouched', async () => {
  const hook = (await hooks())['tool.execute.before']
  const output = { args: { path: '/one' } }
  await hook({ tool: 'read', sessionID: 'ses_first' }, output)
  await hook({ tool: 'other_gchat_native_read_file', sessionID: 'ses_first' }, output)
  assert.deepEqual(output.args, { path: '/one' })
  assert.equal(requests.length, 0)
})

test('does not dispatch a GChat tool if caller policy admission fails', async () => {
  mock.method(globalThis, 'fetch', async () => ({ ok: false, status: 409 }))
  const hook = (await hooks())['tool.execute.before']
  const output = { args: {} }
  await assert.rejects(hook({ tool: 'gchat_gchat_list_skills', sessionID: 'ses_first' }, output), /policy/)
  assert.equal(output.args._gchat_opencode_session_id, undefined)
})

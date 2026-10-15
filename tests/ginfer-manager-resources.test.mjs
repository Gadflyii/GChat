import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import test from 'node:test'
import { JSDOM } from 'jsdom'

// The coordinator can run this same refresh against a retained baseline module.
// Counts describe JSDOM work, not native CPU/RAM or physical storage writes.
const source = process.env.GINFER_MANAGER_UI_MODULE
  ? pathToFileURL(process.env.GINFER_MANAGER_UI_MODULE)
  : new URL('../src-tauri/ginfer-manager/ui/manager.js', import.meta.url)
const { createManager } = await import(source.href)
const baseline = process.env.GINFER_MANAGER_RESOURCE_BASELINE === '1'
const hostId = 'local-host'
const clientId = 'paired-client'
const readyId = 'ready-instance'
const savedId = 'saved-instance'
const sessionId = 'ready-session'
const authority = { host_id: hostId, certificate_sha256: 'ab'.repeat(32), origins: ['https://localhost:7443'] }
const ref = (instance_id) => ({ host_id: hostId, instance_id })
const fixture = () => {
  const configuration = { model_id: 'muse', gpu_uuids: ['GPU-1'], max_context: 32768,
    concurrency: 4, vision: true, spec: 'none', draft_tokens: 0, kv_dtype: 'nvfp4' }
  return { hosts: [{ host_id: hostId, name: 'Local host', local: true, online: true,
    base_url: authority.origins[0], certificate_sha256: authority.certificate_sha256,
    snapshot: { revision: 1, display_name: 'Local host',
      models: [{ id: 'muse', path: '/models/muse.ginfer', metadata: { tp_size: 1, size_bytes: 123 } }],
      gpus: [{ uuid: 'GPU-1', name: 'GPU', memory_mib: 32768 }], launch_profiles: [],
      instances: [{ instance_id: readyId, session_id: sessionId, status: 'ready',
        profile: configuration, configuration, active_requests: 1 },
      { instance_id: savedId, session_id: null, status: 'stopped',
        profile: configuration, configuration, active_requests: 0 }],
      clients: [{ client_id: clientId, name: 'Laptop', local: false,
        active_requests: 1, last_seen_unix_ms: 1700000000000 }],
      local_administrator: { active_requests: 0 },
      lan_sharing: { managed: true, enabled: false, active: false },
      model_management: { managed_root: '/models', downloads: [] },
    } }], discovered: [], fleet: { connected: true, authority, client_id: clientId,
    host_issues: [], snapshot: { revision: 7, authority, members: [],
      pools: [{ id: 'pool', name: 'Workers', members: [{ instance: ref(readyId), worker_limit: 3 }] }],
      assignments: [{ client_id: clientId, pool_ids: ['pool'], preferred_hosts: [hostId],
        preferred_instances: [ref(savedId), ref(savedId)] }],
    } } }
}
const flush = () => new Promise((resolve) => setImmediate(resolve))
const findButton = (root, label) => {
  const node = [...root.querySelectorAll('button')].find((entry) => entry.textContent.trim() === label)
  assert.ok(node, `button ${label}`)
  return node
}
async function setup(t, { failWrites = 0 } = {}) {
  const dom = new JSDOM(readFileSync(new URL('../src-tauri/ginfer-manager/ui/index.html', import.meta.url), 'utf8'),
    { url: 'https://manager.local/', pretendToBeVisual: true })
  const { document } = dom.window
  const root = document.getElementById('manager')
  const listeners = new Map()
  const requests = []
  const preferences = new Map()
  const stats = { storageCalls: 0 }
  let view = fixture()
  const runtime = createManager(root, async (command, input) => {
    if (command === 'manager_snapshot') return structuredClone(view)
    if (input.request.operation === 'first_run' && !input.request.args?.action) return { result: { step: 'complete' } }
    requests.push(input.request)
    return { result: {}, view: structuredClone(view) }
  }, async (event, handler) => {
    listeners.set(event, handler)
    return () => listeners.delete(event)
  }, {
    getItem: (key) => preferences.get(key) ?? null,
    setItem: (key, value) => {
      stats.storageCalls++
      if (stats.storageCalls <= failWrites) throw new Error('Storage unavailable')
      preferences.set(key, value)
    },
  })
  t.after(() => { runtime.stop(); dom.window.close() })
  await runtime.start()
  return { dom, document, root, runtime, stats, preferences, requests, listeners,
    get view() { return view },
    publish(next) { view = next; runtime.apply(next) } }
}

function measure(app, action) {
  const stringify = JSON.stringify
  const createElement = app.document.createElement
  const createTextNode = app.document.createTextNode
  const flat = Array.prototype.flat
  const metrics = { elementsCreated: 0, textNodesCreated: 0, serializedObjectCharacters: 0,
    storageCalls: 0, rootReplacements: 0, elementsRemoved: 0, textNodesRemoved: 0, allocatingFlattenCalls: 0 }
  const observer = new app.dom.window.MutationObserver(() => {})
  observer.observe(app.root, { childList: true, subtree: true })
  const before = app.stats.storageCalls
  JSON.stringify = (value, ...args) => {
    const result = stringify(value, ...args)
    if (value !== null && typeof value === 'object' && result) metrics.serializedObjectCharacters += result.length
    return result
  }
  app.document.createElement = function (...args) { metrics.elementsCreated++; return createElement.apply(this, args) }
  app.document.createTextNode = function (...args) { metrics.textNodesCreated++; return createTextNode.apply(this, args) }
  Array.prototype.flat = function (...args) { metrics.allocatingFlattenCalls++; return flat.apply(this, args) }
  try {
    action()
    metrics.storageCalls = app.stats.storageCalls - before
    for (const record of observer.takeRecords()) {
      if (record.target === app.root && record.removedNodes.length) metrics.rootReplacements++
      for (const node of record.removedNodes) {
        if (node.nodeType === 1) metrics.elementsRemoved++
        if (node.nodeType === 3) metrics.textNodesRemoved++
      }
    }
    return metrics
  } finally {
    JSON.stringify = stringify
    app.document.createElement = createElement
    app.document.createTextNode = createTextNode
    Array.prototype.flat = flat
    observer.disconnect()
  }
}

test('one real paired-client activity refresh retains focused controls and exact visible text', async (t) => {
  const app = await setup(t)
  const clients = app.root.querySelector('[data-section="clients"]')
  clients.open = true
  const revoke = findButton(clients, 'Revoke')
  const stop = findButton(app.root.querySelector(`[data-instance="${readyId}"]`), 'Stop')
  revoke.focus()
  const next = structuredClone(app.view)
  next.hosts[0].snapshot.revision++
  next.hosts[0].snapshot.clients[0].last_seen_unix_ms += 4000
  next.hosts[0].snapshot.clients[0].active_requests = 2
  next.hosts[0].snapshot.local_administrator.active_requests = 3
  const metrics = measure(app, () => app.publish(next))
  console.log(JSON.stringify({ scope: 'JSDOM one paired-client refresh', baseline, source: source.href, metrics }))
  const visibleClients = app.root.querySelector('[data-section="clients"]')
  const visibleRevoke = findButton(visibleClients, 'Revoke')
  assert.match(visibleClients.textContent, /2 active request\(s\)/)
  assert.ok(visibleClients.textContent.includes(`Last seen ${new Date(next.hosts[0].snapshot.clients[0].last_seen_unix_ms).toLocaleString()}`))
  assert.match(visibleClients.textContent, /Local administrator · 3 active request\(s\)/)
  if (baseline) {
    assert.ok(metrics.rootReplacements > 0)
    assert.ok(metrics.elementsCreated > 0)
    assert.ok(metrics.allocatingFlattenCalls > 0)
    assert.ok(metrics.storageCalls > 0)
  } else {
    assert.equal(visibleRevoke, revoke)
    assert.equal(findButton(app.root.querySelector(`[data-instance="${readyId}"]`), 'Stop'), stop)
    assert.equal(app.document.activeElement, revoke)
    assert.equal(metrics.rootReplacements, 0)
    assert.equal(metrics.elementsCreated, 0)
    assert.equal(metrics.storageCalls, 0)
  }
  visibleRevoke.focus()
  visibleRevoke.click()
  assert.match(app.document.querySelector('[role="dialog"]').textContent, /Revoke Laptop on Local host/)
  findButton(app.document.querySelector('[role="dialog"]'), 'Cancel').click()
  assert.equal(app.document.activeElement, visibleRevoke)
  const active = structuredClone(next)
  active.hosts[0].snapshot.instances[0].active_requests = 5
  app.publish(active)
  if (!baseline) assert.equal(findButton(app.root.querySelector(`[data-instance="${readyId}"]`), 'Stop'), stop)
  assert.match(app.root.querySelector(`[data-instance="${readyId}"]`).textContent, /Active requests5/)
  findButton(app.root.querySelector(`[data-instance="${readyId}"]`), 'Reload').click()
  assert.match(app.document.querySelector('[role="dialog"]').textContent, /Interrupt 5 active request\(s\)/)
  findButton(app.document.querySelector('[role="dialog"]'), 'Cancel').click()
  const restarted = structuredClone(next)
  restarted.hosts[0].snapshot.instances[0].session_id = 'next-session'
  app.publish(restarted)
  findButton(app.root.querySelector(`[data-instance="${readyId}"]`), 'Stop').click()
  await flush()
  assert.equal(app.requests[0].args.expected_session_id, 'next-session')
})

test('hidden observations defer projection and render only latest activity; stop disposes visibility and events', { skip: baseline }, async (t) => {
  const app = await setup(t)
  let hidden = true
  Object.defineProperty(app.document, 'hidden', { configurable: true, get: () => hidden })
  const refresh = findButton(app.root, 'Refresh')
  const latest = structuredClone(app.view)
  latest.hosts[0].snapshot.clients[0].last_seen_unix_ms += 8000
  const metrics = measure(app, () => {
    app.publish(structuredClone(app.view))
    app.publish(latest)
  })
  assert.equal(metrics.serializedObjectCharacters, 0)
  assert.equal(metrics.elementsCreated, 0)
  hidden = false
  app.document.dispatchEvent(new app.dom.window.Event('visibilitychange'))
  assert.equal(findButton(app.root, 'Refresh'), refresh)
  assert.ok(app.root.textContent.includes(new Date(latest.hosts[0].snapshot.clients[0].last_seen_unix_ms).toLocaleString()))
  hidden = true
  const changed = structuredClone(latest)
  changed.hosts[0].snapshot.instances[0].status = 'failed'
  changed.hosts[0].snapshot.instances[0].last_error = 'New failure'
  app.publish(changed)
  app.runtime.stop()
  hidden = false
  app.document.dispatchEvent(new app.dom.window.Event('visibilitychange'))
  assert.equal(findButton(app.root, 'Refresh'), refresh)
  assert.ok(!app.root.textContent.includes('New failure'))
  assert.equal(app.listeners.size, 0)
})

test('unchanged selection skips only successful storage writes and retries failures', { skip: baseline }, async (t) => {
  const app = await setup(t, { failWrites: 2 })
  assert.equal(app.stats.storageCalls, 1)
  app.publish(structuredClone(app.view))
  assert.equal(app.stats.storageCalls, 2)
  assert.equal(app.preferences.size, 0)
  app.publish(structuredClone(app.view))
  assert.equal(app.stats.storageCalls, 3)
  assert.equal(app.preferences.get('ginfer-manager.host'), JSON.stringify(hostId))
  app.publish(structuredClone(app.view))
  assert.equal(app.stats.storageCalls, 3)
  const next = structuredClone(app.view)
  next.hosts[0].host_id = 'replacement-host'
  app.publish(next)
  assert.equal(app.preferences.get('ginfer-manager.host'), JSON.stringify('replacement-host'))
  assert.equal(app.stats.storageCalls, 4)
})

test('model and pool indexes preserve labels, first preferred-instance order, nested DOM and numeric zero', { skip: baseline }, async (t) => {
  const app = await setup(t)
  assert.match(app.root.querySelector(`[data-instance="${savedId}"]`).textContent, /Active requests0/)
  assert.match(app.root.querySelector('[data-section="fleet"]').textContent, /Workers.*Local host · muse · 3 worker\(s\)/s)
  findButton(app.root.querySelector('[data-section="fleet"]'), 'Edit').click()
  let pane = app.document.querySelector('[role="dialog"]')
  const memberInputs = [...pane.querySelectorAll('input[name="member"]')]
  assert.equal(memberInputs.length, 2)
  assert.equal(memberInputs[0].checked, true)
  assert.equal(pane.querySelector('input[name="limit_0"]').value, '3')
  findButton(pane, 'Cancel').click()
  findButton(app.root, 'Edit assignment').click()
  pane = app.document.querySelector('[role="dialog"]')
  assert.deepEqual([...pane.querySelectorAll('input[name="preferred_instance"]')].map((input) => input.value),
    [`${hostId}/${savedId}`, `${hostId}/${readyId}`])
  assert.equal(pane.querySelectorAll('input[name="preferred_instance"]:checked').length, 1)
  assert.match(pane.textContent, /Visible work poolsWorkersPreferred hostsLocal hostPreferred instancesLocal host · museLocal host · muse/)
  assert.ok(!app.root.textContent.includes('undefined'))
  assert.ok(!app.root.textContent.includes('null'))
})

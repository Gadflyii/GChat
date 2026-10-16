import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { JSDOM } from 'jsdom'
import { createManager } from '../src-tauri/ginfer-manager/ui/manager.js'

const localId = '10000000-0000-4000-8000-000000000001'
const pairedId = '10000000-0000-4000-8000-000000000002'
const readyId = '20000000-0000-4000-8000-000000000001'
const stoppedId = '20000000-0000-4000-8000-000000000002'
const sessionId = '30000000-0000-4000-8000-000000000001'
const clientId = '40000000-0000-4000-8000-000000000001'
const poolId = '50000000-0000-4000-8000-000000000001'

function fixture() {
  const authority = { host_id: localId, origins: ['https://localhost:7443'], certificate_sha256: 'ab'.repeat(32) }
  const configuration = {
    instance_id: readyId, model_id: 'installed-muse', gpu_uuids: ['GPU-local'],
    max_context: 32768, concurrency: 4, port: 1337, vision: true, spec: 'dflash',
    draft_tokens: 4, draft_tp: 1, kv_dtype: 'nvfp4', kv_arena_bytes: null,
    host_kv_cache_bytes: 0, prefill_chunk: 2048, no_cuda_graph: false,
  }
  const snapshot = {
    host_id: localId, display_name: 'This computer', revision: 7,
    lan_sharing: { managed: true, enabled: true, active: true, port: 7443, error: null },
    gpus: [{ uuid: 'GPU-local', name: 'RTX 5090', display_name: 'RTX 5090', memory_mib: 32768, compute_capability: '12.0' }],
    models: [{ id: 'installed-muse', path: '/models/muse.ginfer', artifact_set: false,
      metadata: { identity: { model_id: 'muse-glimmer-30b', weights_id: 'nvfp4' }, tp_size: 1, size_bytes: 12000000000 } }],
    instances: [
      { instance_id: readyId, session_id: sessionId, display_name: 'Muse ready', status: 'ready',
        configuration, profile: configuration, active_requests: 2, model_metadata: { max_model_len: 32768 } },
      { instance_id: stoppedId, session_id: null, display_name: 'Muse saved', status: 'stopped',
        configuration: { ...configuration, instance_id: stoppedId, port: 0 },
        profile: { ...configuration, instance_id: stoppedId }, active_requests: 0 },
    ],
    clients: [{ client_id: clientId, name: 'Paired laptop', local: false, active_requests: 2,
      active_instances: { [readyId]: 2 }, last_seen_unix_ms: 1700000000000 }],
    local_administrator: { active_requests: 1, last_seen_unix_ms: 1700000000000 },
    launch_profiles: [{ model_id: 'installed-muse', gpu_groups: [['GPU-local']], compatible_gpu_groups: [['GPU-local']],
      profile: { id: 'muse-qualified', name: 'Muse TP1 32K', tp: 1, max_context: 32768, concurrency: 4,
        options: configuration, qualification: { tier: 'full-context-tested', engine_revision: '922e5a879b9af12e52763d52b73362937f9dd148' } } }],
    model_management: { version: 1, managed_root: '/models', downloads: [], engine_presets_available: true },
  }
  return {
    hosts: [
      { host_id: localId, name: 'This computer', local: true, online: true, snapshot, error: null, certificate_sha256: authority.certificate_sha256 },
      { host_id: pairedId, name: 'GPU server', local: false, online: true, base_url: 'https://gpu-server:7443',
        certificate_sha256: 'cd'.repeat(32),
        snapshot: { ...structuredClone(snapshot), host_id: pairedId, display_name: 'GPU server', clients: [], instances: [] }, error: null },
    ], discovered: [], local_error: null,
    fleet: { connected: true, authority, client_id: clientId, error: null, host_issues: [], snapshot: {
      schema: 'ginfer-fleet-v1', authority, revision: 11,
      members: [{ host: authority, display_name: 'This computer' }],
      pools: [{ id: poolId, name: 'Shared workers', members: [{ instance: { host_id: localId, instance_id: readyId }, worker_limit: 2 }] }],
      assignments: [{ client_id: clientId, pool_ids: [poolId], preferred_hosts: [], preferred_instances: [] }],
    } },
  }
}

const flush = () => new Promise((resolve) => setImmediate(resolve))
async function waitFor(predicate, description) {
  for (let attempt = 0; attempt < 40; attempt++) {
    if (predicate()) return
    await flush()
  }
  assert.fail(description)
}

async function manager(t, view = fixture(), request = () => ({})) {
  const html = readFileSync(new URL('../src-tauri/ginfer-manager/ui/index.html', import.meta.url), 'utf8')
  const dom = new JSDOM(html, { url: 'https://manager.local/', runScripts: 'outside-only', pretendToBeVisual: true })
  const calls = []
  const listeners = new Map()
  const { window } = dom
  window.setInterval = () => 1
  window.confirm = () => true
  const bridge = {
    core: { invoke: async (command, input) => {
      calls.push({ command, input: structuredClone(input) })
      if (command === 'manager_snapshot') return structuredClone(view)
      assert.equal(command, 'manager_request')
      if (input.request.operation === 'first_run' && !input.request.args?.action) return { result: structuredClone(view.first_run ?? { step: 'complete' }) }
      const result = await request(input.request, view)
      return { result, view: structuredClone(view) }
    } },
    event: { listen: async (name, callback) => {
      listeners.set(name, callback)
      return () => listeners.delete(name)
    } },
  }
  const runtime = createManager(window.document.getElementById('manager'), bridge.core.invoke, bridge.event.listen, window.localStorage)
  t.after(() => { runtime.stop(); dom.window.close() })
  await runtime.start()
  return {
    window, document: window.document, calls, view,
    runtime,
    publish: async (next) => {
      view = next
      listeners.get('manager-snapshot')({ payload: structuredClone(next) })
      await flush()
    },
  }
}

function button(root, name) {
  const found = [...root.querySelectorAll('button')].find((item) => item.textContent.trim() === name)
  assert.ok(found, `missing visible button: ${name}`)
  return found
}

function requests(app) {
  return app.calls.filter(({ command, input }) => command === 'manager_request' && !(input.request.operation === 'first_run' && !input.request.args?.action)).map(({ input }) => input.request)
}

async function completed(app, predicate) {
  await waitFor(() => predicate(requests(app)) && !app.document.querySelector('header [role="status"]'), 'production action must settle')
}

function submit(app) {
  const form = app.document.querySelector('[role="dialog"] form')
  assert.ok(form, 'action must open a production form')
  form.dispatchEvent(new app.window.Event('submit', { bubbles: true, cancelable: true }))
  return form
}

test('Host Stop requires the local desktop capability and confirms the terminal action', async (t) => {
  const view = fixture()
  view.hosts[1].snapshot.can_stop_host = true
  const app = await manager(t, view, request => {
    assert.deepEqual(request, { action: 'host', host_id: localId, operation: 'stop_host', args: {} })
    return { stopping: true }
  })
  assert.equal([...app.document.querySelectorAll('button')].some(item => item.textContent === 'Stop Host and Quit'), false)
  const enabled = structuredClone(view)
  enabled.hosts[0].snapshot.can_stop_host = true
  await app.publish(enabled)
  button(app.document, 'Stop Host and Quit').click()
  assert.match(app.document.querySelector('[role="dialog"]').textContent, /wait for setup work to finish/)
  assert.deepEqual(requests(app), [], 'opening the confirmation must not stop anything')
  button(app.document.querySelector('[role="dialog"]'), 'Cancel').click()
  assert.deepEqual(requests(app), [], 'Cancel preserves the Host')
  button(app.document, 'Stop Host and Quit').click()
  submit(app)
  await completed(app, entries => entries.length === 1)
  const remote = [...app.document.querySelectorAll('.host-button')].find(item => item.textContent.includes('GPU server'))
  remote.click()
  assert.equal([...app.document.querySelectorAll('button')].some(item => item.textContent === 'Stop Host and Quit'), false,
    'a remote capability must never expose local Host shutdown')
})

test('busy Host Stop leaves Manager open and reports the refusal', async (t) => {
  const view = fixture()
  view.hosts[0].snapshot.can_stop_host = true
  const app = await manager(t, view, request => {
    assert.equal(request.operation, 'stop_host')
    throw new Error('409 Host is busy: stop models and wait for hardware profiling')
  })
  button(app.document, 'Stop Host and Quit').click()
  submit(app)
  await waitFor(() => app.document.querySelector('[role="dialog"] [role="alert"]')?.textContent.includes('Host is busy'),
    'the authoritative busy error must stay visible')
  assert.equal(requests(app).length, 1)
  assert.equal(button(app.document.querySelector('[role="dialog"]'), 'Stop Host and Quit').disabled, false,
    'busy is retryable after the user stops the models')
  assert.equal(app.calls.filter(call => call.command === 'manager_snapshot').length, 1,
    'a busy Stop must not trigger a fleet-conflict refresh')
  assert.ok(app.document.querySelector('main'), 'Manager remains open after refusal')
  assert.equal(view.hosts[0].snapshot.instances[0].status, 'ready', 'Stop Host must not unload a running model')
})

test('a saved remote host connects only after the explicit Connect action', async (t) => {
  const view = fixture()
  const remoteSnapshot = view.hosts[1].snapshot
  Object.assign(view.hosts[1], { online: false, snapshot: null,
    error: 'Connect this saved host to unlock its credential for this session' })
  const app = await manager(t, view, request => {
    assert.deepEqual(request, { action: 'host', host_id: pairedId, operation: 'snapshot', args: {} })
    Object.assign(view.hosts[1], { online: true, snapshot: remoteSnapshot, error: null })
    return remoteSnapshot
  })
  const remote = [...app.document.querySelectorAll('.host-button')].find(item => item.textContent.includes('GPU server'))
  assert.ok(remote)
  remote.click()
  assert.deepEqual(requests(app), [], 'passive startup must not send an explicit host connection')
  assert.ok(app.document.querySelector('main').textContent.includes('Connect this saved host'))
  assert.equal(button(app.document, 'Connect').disabled, false)
  button(app.document, 'Connect').click()
  await completed(app, requests => requests.some(request => request.operation === 'snapshot'))
  assert.ok(![...app.document.querySelectorAll('main button')].some(item => item.textContent.trim() === 'Connect'))
  assert.ok(!app.document.querySelector('main').textContent.includes('Connect this saved host'))
  assert.equal(button(app.document, 'Start a model…').disabled, false)
})

test('shared first-run flow selects GPUs, resumes work and approves Engine startup defaults', async (t) => {
  const view = fixture()
  const release = { name: 'Muse download', sha256: 'a'.repeat(64), bytes: 1024 ** 3 }
  const initial = { gpu_uuids: [], hardware_profile: {}, storage: { path: '/models', recommended_path: '/fast', available_bytes: 1024 ** 4 }, models: [], selected_downloads: [], startup_profiles: [] }
  const startup = { download_id: 'download', model_id: 'muse', gpu_uuids: ['GPU-local'], concurrency: 4, max_context: 32768, kv_arena_bytes: null, instance_count: 1, quote: null, error: null }
  view.first_run = { ...initial, step: 'gpu' }
  const app = await manager(t, view, (request) => {
    assert.equal(request.operation, 'first_run')
    const args = request.args
    if (args.action === 'profile') {
      assert.deepEqual(args.gpu_uuids, ['GPU-local'])
      view.first_run = { ...initial, step: 'profiling', gpu_uuids: args.gpu_uuids, hardware_profile: { status: 'interrupted', error: 'Restart interrupted profiling' } }
    } else if (args.action === 'resume' && view.first_run.step === 'profiling') {
      view.first_run = { ...view.first_run, step: 'storage', storage: { ...initial.storage, error: 'One disk could not be measured', candidates: [{ path: '/full', available_bytes: 0, eligible: false, reason: 'Insufficient capacity' }] } }
    } else if (args.action === 'storage') {
      assert.equal(args.path, '/chosen')
      view.first_run = { ...view.first_run, step: 'models', catalog_loaded: false }
    } else if (args.action === 'refresh_catalog') {
      view.first_run = { ...view.first_run, catalog_loaded: true, models: [{ release, recommended: true, reason: 'Fits measured memory' }] }
    } else if (args.action === 'models') {
      assert.deepEqual(args.release_ids, [release.sha256])
      view.first_run = { ...view.first_run, step: 'downloads', selected_downloads: [{ id: 'download', release, status: 'failed', received: 1024, bytes_per_second: 0, error: 'Network interrupted' }] }
    } else if (args.action === 'resume') {
      view.first_run = { ...view.first_run, step: 'startup', startup_profiles: [] }
    } else if (args.action === 'startup') {
      assert.deepEqual(args, { action: 'startup', download_id: 'download', concurrency: 2, max_context: 32768, instance_count: 1, kv_arena_bytes: null })
      view.first_run = { ...view.first_run, startup_profiles: [{ ...startup, concurrency: 2, quote: { fits: true } }] }
    } else if (args.action === 'complete') {
      view.first_run = { ...view.first_run, step: 'complete' }
    } else assert.fail(`unexpected first-run action ${args.action}`)
    return structuredClone(view.first_run)
  })
  await waitFor(() => app.document.querySelector('[aria-label="Set up local GInfer"] input[type="checkbox"]'), 'GPU selection must render')
  assert.equal(button(app.document, 'Use selected GPUs and profile').disabled, true)
  const gpu = app.document.querySelector('[aria-label="Set up local GInfer"] input[type="checkbox"]')
  gpu.click()
  button(app.document, 'Use selected GPUs and profile').click()
  await waitFor(() => app.document.body.textContent.includes('Restart interrupted profiling'), 'shared profiling error must render')
  button(app.document, 'Resume hardware profiling').click()
  await waitFor(() => app.document.body.textContent.includes('One disk could not be measured'), 'storage evidence must render')
  assert.equal(button(app.document, '/full · 0.0 GiB free').disabled, true)
  const folder = app.document.querySelector('[aria-label="Model download folder"]')
  folder.value = '/chosen'
  folder.dispatchEvent(new app.window.Event('input', { bubbles: true }))
  button(app.document, 'Use this folder').click()
  await waitFor(() => app.document.body.textContent.includes('Loading published model catalog…'), 'catalog load must be visible')
  button(app.document, 'Refresh model catalog').click()
  await waitFor(() => button(app.document, 'Download selected models').disabled === false, 'published recommendation must initialize selection')
  button(app.document, 'Download selected models').click()
  await waitFor(() => app.document.body.textContent.includes('Network interrupted'), 'download failure must render')
  button(app.document, 'Resume downloads').click()
  await waitFor(() => app.document.body.textContent.includes('Preparing startup settings and checking Engine memory…'), 'initial quote preparation must be visible')
  assert.equal(button(app.document, 'Finish local setup').disabled, true)
  view.first_run.startup_profiles = [startup]
  await app.publish(view)
  await waitFor(() => app.document.body.textContent.includes('Checking these settings with the Engine…'), 'pending quote must render')
  assert.equal(button(app.document, 'Finish local setup').disabled, true)
  button(app.document, 'Adjust startup settings…').click()
  const form = app.document.querySelector('[role="dialog"] form')
  form.elements.namedItem('concurrency').value = '2'
  submit(app)
  await waitFor(() => button(app.document, 'Finish local setup').disabled === false, 'successful quote must permit completion')
  button(app.document, 'Finish local setup').click()
  await waitFor(() => !app.document.querySelector('[aria-label="Set up local GInfer"]'), 'completed wizard must close')
  assert.ok(requests(app).every(request => request.operation === 'first_run'))
})

test('first-run storage preserves typed and candidate choices when the catalog arrives', async (t) => {
  for (const choice of ['typed', 'candidate']) {
    const view = fixture()
    view.first_run = { step: 'storage', gpu_uuids: ['GPU-local'], catalog_loaded: false,
      storage: { path: '/models', recommended_path: '/fast', candidates: [{ path: '/candidate', available_bytes: 1024 ** 4, eligible: true }] }, models: [] }
    const expected = choice === 'typed' ? '/my-selected-disk' : '/candidate'
    const app = await manager(t, view, request => {
      assert.deepEqual(request.args, { action: 'storage', path: expected })
      return { step: 'complete' }
    })
    await waitFor(() => app.document.querySelector('[aria-label="Model download folder"]'), 'storage must render')
    if (choice === 'typed') {
      const folder = app.document.querySelector('[aria-label="Model download folder"]')
      folder.value = expected
      folder.dispatchEvent(new app.window.Event('input', { bubbles: true }))
    } else button(app.document, '/candidate · 1024.0 GiB free').click()
    view.first_run.catalog_loaded = true
    view.first_run.storage.recommended_path = '/new-recommendation'
    await app.publish(view)
    await waitFor(() => app.document.body.textContent.includes('Recommended: /new-recommendation'), 'catalog poll must finish')
    assert.equal(app.document.querySelector('[aria-label="Model download folder"]').value, expected)
    button(app.document, 'Use this folder').click()
    await completed(app, calls => calls.length === 1)
    assert.equal(requests(app)[0].args.path, expected)
  }
})

test('secure storage results show neutral success and an error alert only on failure', async (t) => {
  let failure = null
  const app = await manager(t, fixture(), (request) => {
    assert.equal(request.action, 'secure_storage')
    if (failure) throw failure
    return { ready: true }
  })
  button(app.document, 'Pair a host…').click()
  const pane = app.document.querySelector('[role="dialog"]')
  const check = button(pane, 'Check secure storage')
  check.click()
  await waitFor(() => pane.querySelector('[role="status"]')?.textContent === 'Secure storage is ready', 'successful check must report readiness')
  const status = pane.querySelector('[role="status"]')
  assert.equal(status.className, 'muted')
  assert.equal(pane.querySelector('.section-error[role="status"]'), null)

  failure = new Error('Secure storage is unavailable')
  check.click()
  await waitFor(() => status.textContent === String(failure), 'failed check must report the actual error')
  assert.equal(status.className, 'section-error')
  assert.equal(status.getAttribute('role'), 'alert')

  failure = null
  check.click()
  await waitFor(() => status.textContent === 'Secure storage is ready', 'retry must replace the failed check with readiness')
  assert.equal(status.className, 'muted')
  assert.equal(status.getAttribute('role'), 'status')
  assert.deepEqual(requests(app).map((request) => request.action), ['secure_storage', 'secure_storage', 'secure_storage'])
})

test('secure storage pairing check rejects an unavailable resolved status', async (t) => {
  const app = await manager(t, fixture(), () => ({ ready: false, error: 'Unlock the selected store' }))
  button(app.document, 'Pair a host…').click()
  const pane = app.document.querySelector('[role="dialog"]')
  button(pane, 'Check secure storage').click()
  await waitFor(() => pane.querySelector('[role="alert"]')?.textContent.includes('Unlock the selected store'), 'unavailable store must remain an error')
  assert.equal(pane.querySelector('[role="status"]'), null)
})

test('passphrase vault clears rejected input, unlocks and locks from Manager', async (t) => {
  let ready = false
  const app = await manager(t, fixture(), (request) => {
    assert.equal(request.action, 'secure_storage')
    if (request.operation === 'unlock') {
      if (request.passphrase !== 'correct passphrase') throw new Error('Incorrect passphrase')
      ready = true
    } else if (request.operation === 'lock') ready = false
    return { ready, tier: 'passphrase', state: ready ? 'ready' : 'locked' }
  })
  button(app.document, 'Secure storage').click()
  await waitFor(() => app.document.querySelector('[role="dialog"] input[type="password"]'), 'locked store must ask for a passphrase')
  const pane = app.document.querySelector('[role="dialog"]')
  const input = pane.querySelector('input[type="password"]')
  input.value = 'incorrect'
  submit(app)
  await waitFor(() => pane.querySelector('[role="alert"]')?.textContent.includes('Incorrect passphrase'), 'rejected passphrase must be reported')
  assert.equal(input.value, '')
  input.value = 'correct passphrase'
  submit(app)
  await waitFor(() => !app.document.querySelector('[role="dialog"]'), 'successful unlock must close the prompt')
  assert.equal(input.value, '')
  assert.equal(ready, true)
  button(app.document, 'Secure storage').click()
  await waitFor(() => app.document.querySelector('[role="dialog"]'), 'unlocked store must offer lock')
  button(app.document.querySelector('[role="dialog"]'), 'Lock vault').click()
  await waitFor(() => !ready && !app.document.querySelector('[role="dialog"]'), 'lock must complete')
  assert.ok(requests(app).some((request) => request.operation === 'lock'))
})

test('Forget removes the host while its credential warning survives snapshots and refresh errors', async (t) => {
  const warning = 'Native credential deletion was denied'
  const app = await manager(t, fixture(), (request, view) => {
    assert.deepEqual(request, { action: 'forget', host_id: pairedId })
    view.hosts = view.hosts.filter((host) => host.host_id !== pairedId)
    view.refresh_error = 'Coordinator refresh unavailable'
    return { forgotten: pairedId, credential_cleanup_warning: warning }
  })
  app.document.querySelectorAll('.host-button')[1].click()
  button(app.document, 'Forget this host').click()
  button(app.document.querySelector('[role="dialog"]'), 'Forget host').click()
  await completed(app, (calls) => calls.length === 1)
  assert.equal(app.document.querySelector('[role="dialog"]'), null, 'successful Forget closes confirmation')
  assert.equal(app.document.querySelectorAll('.host-button').length, 1)
  assert.equal(app.document.querySelector('.notice[role="status"]').textContent, 'Host forgotten')
  const alerts = () => [...app.document.querySelectorAll('.notice[role="alert"]')].map((node) => node.textContent)
  assert.deepEqual(alerts(), ['The action completed. Refresh failed: Coordinator refresh unavailable',
    `OS credential cleanup needs attention: ${warning}`])

  const updated = structuredClone(app.view)
  updated.hosts[0].snapshot.instances[0].active_requests++
  delete updated.refresh_error
  await app.publish(updated)
  assert.equal(app.document.querySelectorAll('.host-button').length, 1)
  assert.equal(app.document.querySelector('.notice[role="status"]').textContent, 'Host forgotten')
  assert.ok(alerts().includes(`OS credential cleanup needs attention: ${warning}`))
  assert.equal(requests(app).length, 1, 'snapshot delivery must not retry Forget or vault deletion')
})

test('Forget with no credential warning shows ordinary successful removal', async (t) => {
  const app = await manager(t, fixture(), (request, view) => {
    assert.deepEqual(request, { action: 'forget', host_id: pairedId })
    view.hosts = view.hosts.filter((host) => host.host_id !== pairedId)
    return { forgotten: pairedId, credential_cleanup_warning: null }
  })
  app.document.querySelectorAll('.host-button')[1].click()
  button(app.document, 'Forget this host').click()
  button(app.document.querySelector('[role="dialog"]'), 'Forget host').click()
  await completed(app, (calls) => calls.length === 1)
  assert.equal(app.document.querySelector('[role="dialog"]'), null)
  assert.equal(app.document.querySelectorAll('.host-button').length, 1)
  assert.equal(app.document.querySelector('.notice[role="status"]').textContent, 'Host forgotten')
  assert.equal(app.document.querySelector('.notice[role="alert"]'), null)
})

test('heartbeat-only snapshots retain Manager controls and keyboard focus', async (t) => {
  const app = await manager(t)
  const refresh = button(app.document, 'Refresh')
  refresh.focus()
  await app.publish(structuredClone(app.view))
  assert.equal(button(app.document, 'Refresh'), refresh)
  assert.equal(app.document.activeElement, refresh)

  const heartbeat = structuredClone(app.view)
  for (const host of heartbeat.hosts) {
    host.snapshot.revision++
    host.snapshot.local_administrator.last_seen_unix_ms += 4000
    host.snapshot.local_administrator.active_instances = { [readyId]: 3 }
  }
  heartbeat.hosts[0].snapshot.clients[0].last_seen_unix_ms += 20
  heartbeat.hosts[0].snapshot.clients[0].active_instances = { [readyId]: 1, [stoppedId]: 1 }
  await app.publish(heartbeat)
  assert.equal(button(app.document, 'Refresh'), refresh)
  assert.equal(app.document.activeElement, refresh)

  const changed = structuredClone(app.view)
  changed.hosts[0].snapshot.instances[0].active_requests = 7
  await app.publish(changed)
  assert.match(app.document.querySelector(`[data-instance="${readyId}"]`).textContent, /Active requests7/)

  const timestamp = structuredClone(changed)
  timestamp.hosts[0].snapshot.clients[0].last_seen_unix_ms += 4000
  await app.publish(timestamp)
  assert.match(app.document.querySelector('[data-section="clients"]').textContent,
    new RegExp(new Date(timestamp.hosts[0].snapshot.clients[0].last_seen_unix_ms).toLocaleString().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))

  const newSession = '30000000-0000-4000-8000-000000000099'
  const restarted = structuredClone(timestamp)
  restarted.hosts[0].snapshot.instances[0].session_id = newSession
  await app.publish(restarted)
  button(app.document.querySelector(`[data-instance="${readyId}"]`), 'Stop').click()
  await completed(app, (calls) => calls.length === 1)
  assert.equal(requests(app)[0].args.expected_session_id, newSession)
})

test('hidden Manager retains latest data and renders it on return to visibility', async (t) => {
  const app = await manager(t)
  const refresh = button(app.document, 'Refresh')
  let hidden = true
  Object.defineProperty(app.document, 'hidden', { configurable: true, get: () => hidden })
  for (const count of [5, 9]) {
    const changed = structuredClone(app.view)
    changed.hosts[0].snapshot.instances[0].active_requests = count
    await app.publish(changed)
  }
  assert.equal(button(app.document, 'Refresh'), refresh)
  assert.match(app.document.querySelector(`[data-instance="${readyId}"]`).textContent, /Active requests2/)
  hidden = false
  app.document.dispatchEvent(new app.window.Event('visibilitychange'))
  assert.match(app.document.querySelector(`[data-instance="${readyId}"]`).textContent, /Active requests9/)

  hidden = true
  const changed = structuredClone(app.view)
  changed.hosts[0].snapshot.instances[0].active_requests = 11
  await app.publish(changed)
  app.runtime.stop()
  hidden = false
  app.document.dispatchEvent(new app.window.Event('visibilitychange'))
  assert.match(app.document.querySelector(`[data-instance="${readyId}"]`).textContent, /Active requests9/)
})

test('manager renders local and paired status, installed model, GPU, profile and client activity', async (t) => {
  const app = await manager(t)
  assert.match(app.document.body.textContent, /2 of 2 hosts online/)
  assert.match(app.document.querySelector('main').textContent, /muse\.ginfer/)
  assert.equal(app.document.querySelector(`[data-instance="${readyId}"] h3`).textContent, 'muse')
  assert.match(app.document.querySelector(`[data-instance="${readyId}"]`).textContent, /RTX 5090/)
  assert.match(app.document.querySelector(`[data-instance="${readyId}"]`).textContent, /1337/)
  assert.match(app.document.querySelector('[data-section="clients"]').textContent, /Paired laptop.*2 active request\(s\)/s)
  assert.match(app.document.querySelector('[data-section="clients"]').textContent, /Local administrator · 1 active/)
  button(app.document, 'Start a model…').click()
  const pane = app.document.querySelector('[role="dialog"]')
  assert.match(pane.textContent, /RTX 5090.*Recommended · Tested · C4 · 32K context · Vision \+ text/s)
  assert.match(pane.textContent, /Profile evidence applies to its recorded options, Engine 922e5a87/)
  assert.match(pane.textContent, /A changed option or Engine needs separate validation/)
  assert.equal(pane.querySelector('input[name="structured_outputs"]').checked, true)
  const changedNote = [...pane.querySelectorAll('p')].find(node => /this launch custom and unqualified/.test(node.textContent))
  assert.ok(changedNote)
  assert.equal(changedNote.hidden, false, 'fresh ON differs from the recorded omitted/OFF catalog setting')
  pane.querySelector('input[name="structured_outputs"]').click()
  assert.equal(changedNote.hidden, true, 'matching the recorded OFF setting retains its evidence')
  assert.equal(requests(app).length, 0, 'rendering and selecting a profile never start a model')
  button(pane, 'Cancel').click()
  app.document.querySelectorAll('.host-button')[1].click()
  assert.equal(app.document.querySelector('h1').textContent, 'GPU server')
  assert.match(app.document.querySelector('main').textContent, /No instances/)
})

test('profile presentation keeps the original default and an expanded alternate launch unchanged', async (t) => {
  const view = fixture()
  const profiles = view.hosts[0].snapshot.launch_profiles
  const tested = structuredClone(profiles[0])
  profiles[0].profile.id = 'estimated'
  profiles[0].profile.name = 'Estimated C4'
  profiles[0].profile.qualification.tier = 'calculated-startup-smoke'
  const untested = structuredClone(tested)
  untested.profile.id = 'untested'
  untested.profile.name = 'Untested C8'
  untested.profile.concurrency = 8
  untested.profile.qualification.engine_revision = '12345678alternate'
  untested.profile.qualification.tier = 'calculated-pending-validation'
  profiles.push(tested, untested)
  const app = await manager(t, view)
  button(app.document, 'Start a model…').click()
  const pane = app.document.querySelector('[role="dialog"]')
  const profile = () => pane.querySelector('select[name="profile_choice"]')
  assert.equal(profile().value, '0', 'presentation preserves the existing initial profile')
  assert.equal(profile().options.length, 2, 'recommendation and current selection remain visible')
  assert.equal(profile().options[0].text, 'Estimated · C4 · 32K context · Vision + text')
  assert.equal(profile().options[1].text, 'Recommended · Tested · C4 · 32K context · Vision + text')
  assert.doesNotMatch(pane.textContent, /Untested · C8/)
  button(pane, 'Show all').click()
  assert.equal(profile().options[2].text, 'Untested · C8 · 32K context · Vision + text')
  profile().value = '2'
  profile().dispatchEvent(new app.window.Event('change', { bubbles: true }))
  button(pane, 'Show less').click()
  assert.equal(profile().value, '2')
  assert.match(pane.textContent, /recorded options, Engine 12345678 and workload/)
  assert.equal(profile().options.length, 2)
  assert.doesNotMatch(profile().textContent, /Estimated · C4/)
  assert.equal(requests(app).length, 0)
  submit(app)
  await completed(app, calls => calls.length === 1)
  assert.deepEqual(requests(app)[0], { action: 'host', host_id: localId, operation: 'profile_launch', args: {
    profile_id: 'untested', model_id: 'installed-muse', gpu_uuids: ['GPU-local'], structured_outputs: true,
  } })
})

test('saved profiles are grouped by model then GPU with one recommendation per selected card', async (t) => {
  const view = fixture()
  const snapshot = view.hosts[0].snapshot
  snapshot.gpus.push({ ...snapshot.gpus[0], uuid: 'GPU-second', name: 'RTX 4090', display_name: 'RTX 4090' })
  snapshot.models.push({ ...snapshot.models[0], id: 'installed-qwen', path: '/models/qwen.ginfer' })
  const qwen = structuredClone(snapshot.launch_profiles[0])
  qwen.model_id = 'installed-qwen'
  qwen.profile.id = 'qwen-first'
  qwen.profile.name = 'Qwen first GPU'
  const other = structuredClone(qwen)
  other.profile.id = 'qwen-second'
  other.profile.name = 'Qwen second GPU'
  other.gpu_groups = [['GPU-second']]
  snapshot.launch_profiles.push(qwen, other)
  const app = await manager(t, view)
  button(app.document, 'Start a model…').click()
  const pane = app.document.querySelector('[role="dialog"]')
  const change = (name, value) => {
    const field = pane.querySelector(`select[name="${name}"]`)
    field.value = value
    field.dispatchEvent(new app.window.Event('change', { bubbles: true }))
  }
  assert.equal(pane.querySelector('select[name="profile_model"]').options.length, 2)
  assert.deepEqual([...pane.querySelector('select[name="profile_choice"]').options].map(option => option.value), ['0'])
  change('profile_model', 'installed-qwen')
  assert.equal(pane.querySelector('select[name="profile_gpu_group"]').options.length, 2)
  assert.deepEqual([...pane.querySelector('select[name="profile_choice"]').options].map(option => option.value), ['1'])
  change('profile_gpu_group', JSON.stringify(['GPU-second']))
  assert.deepEqual([...pane.querySelector('select[name="profile_choice"]').options].map(option => option.value), ['2'])
  assert.equal(pane.querySelector('select[name="profile_choice"]').selectedOptions[0].text, 'Recommended · Tested · C4 · 32K context · Vision + text')
  assert.equal(requests(app).length, 0)
  submit(app)
  await completed(app, calls => calls.length === 1)
  assert.equal(requests(app)[0].args.profile_id, 'qwen-second')
  assert.equal(requests(app)[0].args.model_id, 'installed-qwen')
  assert.deepEqual(requests(app)[0].args.gpu_uuids, ['GPU-second'])
})

test('batch placement preserves automatic sizing, serializes instances and reports partial failure', async (t) => {
  for (const kvBudget of ['', '8589934592']) {
    let release
    let fail = false
    const app = await manager(t, fixture(), async (request) => {
      if (request.operation !== 'profile_launch') return {}
      await new Promise(resolve => { release = resolve })
      if (fail) throw new Error('Engine quote: insufficient memory')
      return { instance_id: `placed-${requests(app).length}`, kv_arena_bytes: 4294967296 }
    })
    button(app.document, 'Start a model…').click()
    const pane = app.document.querySelector('[role="dialog"]')
    assert.match(pane.querySelector('select[name="profile_gpu_group"]').textContent, /5090/)
    pane.querySelector('input[name="instance_count"]').value = '4'
    pane.querySelector('input[name="kv_arena_bytes"]').value = kvBudget
    submit(app)
    await waitFor(() => requests(app).length === 1, 'first placement must start')
    await flush()
    assert.equal(requests(app).length, 1, 'the next placement waits for the first Ready response')
    for (let index = 0; index < 4; index++) {
      const request = requests(app)[index]
      assert.equal(request.operation, 'profile_launch')
      assert.deepEqual(request.args.gpu_uuids, ['GPU-local'])
      assert.equal(request.args.remaining_instances, index < 3 ? 4 - index : undefined)
      assert.equal(request.args.kv_arena_bytes, kvBudget ? Number(kvBudget) : undefined,
        'each request preserves the chosen budget instead of copying an earlier live allocation')
      if (kvBudget && index === 2) fail = true
      release()
      if (fail) break
      if (index < 3) await waitFor(() => requests(app).length === index + 2, 'each Ready response permits the next placement')
    }
    if (fail) {
      await waitFor(() => pane.textContent.includes('2 of 4 instances started.'), 'partial failure must retain the completed count')
      assert.match(pane.textContent, /Engine quote: insufficient memory/)
      assert.equal(requests(app).length, 3, 'failure stops further placement')
    } else {
      await completed(app, calls => calls.length === 4)
      assert.match(app.document.querySelector('[role="status"]').textContent, /4 of 4 instances ready/)
    }
    app.runtime.stop()
    app.window.close()
  }
})

test('Start, draining Stop and forced Reload use host session guards and exact saved profile', async (t) => {
  const app = await manager(t)
  button(app.document.querySelector(`[data-instance="${stoppedId}"]`), 'Start').click()
  await completed(app, (calls) => calls.length === 1)
  assert.deepEqual(requests(app)[0], { action: 'host', host_id: localId, operation: 'instance',
    args: { instance_id: stoppedId, operation: 'start', expected_session_id: null, force: false } })

  button(app.document.querySelector(`[data-instance="${readyId}"]`), 'Stop').click()
  await completed(app, (calls) => calls.length === 2)
  assert.deepEqual(requests(app)[1], { action: 'host', host_id: localId, operation: 'instance',
    args: { instance_id: readyId, operation: 'stop', expected_session_id: sessionId, force: false } })

  button(app.document.querySelector(`[data-instance="${readyId}"]`), 'Reload').click()
  app.document.querySelector('[role="dialog"] input[name="force"]').checked = true
  submit(app)
  await completed(app, (calls) => calls.length === 3)
  assert.deepEqual(requests(app)[2], { action: 'host', host_id: localId, operation: 'profile_launch', args: {
    instance_id: readyId, expected_session_id: sessionId, force: true,
    profile_id: 'muse-qualified', model_id: 'installed-muse', gpu_uuids: ['GPU-local'], structured_outputs: true,
  } })
  assert.match(app.document.querySelector('[role="status"]').textContent, /Instance reloaded/)
})

test('offline hosts preserve inventory and disable host mutations while a stale fleet stays read only', async (t) => {
  const view = fixture()
  view.hosts[0].online = false
  view.hosts[0].offline = true
  view.hosts[0].error = 'Host unreachable'
  view.fleet.connected = false
  view.fleet.host_issues = [{ host_id: localId, phase: 'coordinator', offline: true, message: 'Coordinator unreachable' }]
  const app = await manager(t, view)
  const main = app.document.querySelector('main')
  assert.match(main.textContent, /GInfer offline.*Last-known inventory/s)
  assert.match(main.textContent, /muse\.ginfer/)
  for (const label of ['Start a model…', 'Start', 'Stop', 'Reload', 'Scan', 'Remove', 'Revoke', 'New work pool', 'Assign client…', 'Edit assignment']) {
    const control = button(main, label)
    assert.equal(control.disabled, true, `${label} must be disabled offline`)
    control.click()
  }
  assert.match(main.textContent, /Stale · read only/)
  assert.equal(main.querySelector('input[aria-label="Share this host"]').disabled, true)
  assert.equal(requests(app).length, 0)
})

test('stopped instances retain their full previous startup diagnostic without a current failure alert', async (t) => {
  const view = fixture()
  const instance = view.hosts[0].snapshot.instances[1]
  const diagnostic = 'engine exited unexpectedly: exit code 1\nKV arena rejected\n' + 'Usage: ginfer-serve --model <artifact>\n'.repeat(200)
  instance.last_error = diagnostic
  const savedProfile = structuredClone(instance.profile)
  const app = await manager(t, view)
  const card = app.document.querySelector(`[data-instance="${stoppedId}"]`)
  assert.equal(card.querySelector('[role="alert"]'), null)
  const details = card.querySelector('details')
  assert.equal(details.querySelector('summary').textContent, 'Previous startup error')
  assert.equal(details.open, false)
  details.querySelector('summary').click()
  assert.equal(details.open, true)
  assert.equal(details.querySelector('pre').textContent, diagnostic)
  assert.equal(instance.last_error, diagnostic)
  assert.deepEqual(instance.profile, savedProfile)
  const offline = structuredClone(view)
  offline.hosts[0].online = false
  offline.hosts[0].offline = true
  offline.hosts[0].snapshot.instances[1].status = 'failed'
  await app.publish(offline)
  const cached = app.document.querySelector(`[data-instance="${stoppedId}"]`)
  assert.equal(cached.querySelector('[role="alert"]'), null)
  assert.equal(cached.querySelector('summary').textContent, 'Previous startup error')
  assert.equal(cached.querySelector('details').open, true)
  assert.equal(cached.querySelector('pre').textContent, diagnostic)
  assert.deepEqual(requests(app), [])
})

test('current failures show a short alert and retain collapsed diagnostics after stopping', async (t) => {
  const view = fixture()
  const instance = view.hosts[0].snapshot.instances[0]
  const diagnostic = 'engine startup timed out\nfull retained stdout\nUsage: ginfer-serve --model <artifact>'
  instance.status = 'failed'
  instance.active_requests = 0
  instance.last_error = diagnostic
  const app = await manager(t, view)
  let card = app.document.querySelector(`[data-instance="${readyId}"]`)
  assert.equal(card.querySelector('[role="alert"]').textContent, 'Engine failed. Open error details for the diagnostic.')
  let details = card.querySelector('details')
  assert.equal(details.querySelector('summary').textContent, 'Startup or runtime error details')
  assert.equal(details.open, false)
  details.querySelector('summary').click()
  assert.equal(details.open, true)
  assert.equal(details.querySelector('pre').textContent, diagnostic)
  const stopped = structuredClone(view)
  stopped.hosts[0].snapshot.instances[0].status = 'stopped'
  await app.publish(stopped)
  card = app.document.querySelector(`[data-instance="${readyId}"]`)
  assert.equal(card.querySelector('[role="alert"]'), null)
  details = card.querySelector('details')
  assert.equal(details.querySelector('summary').textContent, 'Previous startup error')
  assert.equal(details.open, false)
  assert.equal(details.querySelector('pre').textContent, diagnostic)
  assert.equal(stopped.hosts[0].snapshot.instances[0].last_error, diagnostic)
  assert.deepEqual(requests(app), [])
})

test('instance diagnostics retain their reading state across unrelated snapshots and collapse on phase changes', async (t) => {
  const view = fixture()
  const diagnostic = 'retained startup error\nfull diagnostic\nUsage: ginfer-serve --model <artifact>'
  view.hosts[0].snapshot.instances[1].last_error = diagnostic
  const app = await manager(t, view)
  const details = () => app.document.querySelector(`[data-instance="${stoppedId}"] details`)
  details().querySelector('summary').click()
  assert.equal(details().open, true)
  const unrelated = structuredClone(view)
  unrelated.hosts[0].snapshot.instances[0].active_requests += 1
  await app.publish(unrelated)
  assert.equal(details().open, true)
  assert.equal(details().querySelector('pre').textContent, diagnostic)
  const failed = structuredClone(unrelated)
  failed.hosts[0].snapshot.instances[1].status = 'failed'
  await app.publish(failed)
  assert.equal(details().querySelector('summary').textContent, 'Startup or runtime error details')
  assert.equal(details().open, false)
  details().querySelector('summary').click()
  assert.equal(details().open, true)
  await app.publish(unrelated)
  assert.equal(details().querySelector('summary').textContent, 'Previous startup error')
  assert.equal(details().open, false)
  assert.equal(details().querySelector('pre').textContent, diagnostic)
  assert.deepEqual(requests(app), [])
})

test('custom reload can clear a failed profile\'s fixed KV pool without changing its workload or headroom', async (t) => {
  const view = fixture()
  const instance = view.hosts[0].snapshot.instances[0]
  instance.status = 'failed'
  instance.active_requests = 0
  instance.profile = { ...instance.profile, max_context: 131072, concurrency: 1,
    qualified_profile_id: 'muse-qualified', kv_arena_bytes: 12467568640, kv_arena_headroom_bytes: 314572800 }
  const saved = structuredClone(instance.profile)
  const app = await manager(t, view)
  button(app.document.querySelector(`[data-instance="${readyId}"]`), 'Reload').click()
  const pane = app.document.querySelector('[role="dialog"]')
  pane.querySelector('input[name="launch_mode"][value="custom"]').click()
  const budget = pane.querySelector('input[name="kv_arena_bytes"]')
  assert.equal(budget.value, '12467568640')
  assert.equal(requests(app).length, 0)
  budget.value = ''
  submit(app)
  await completed(app, (calls) => calls.length === 1)
  assert.deepEqual(requests(app)[0], { action: 'host', host_id: localId, operation: 'instance', args: {
    instance_id: readyId, expected_session_id: sessionId, force: false, operation: 'reload',
    configuration: { ...saved, qualified_profile_id: null, draft_policy: 'auto', kv_arena_bytes: null, vram_budget_bytes: null, structured_outputs: true },
  } })
  assert.deepEqual(instance.profile, saved, 'editing a custom copy must not rewrite the saved qualification')
})

test('new custom launches default structured outputs ON and preserve Host KV AUTO, zero and exact sizes', async (t) => {
  const view = fixture()
  view.hosts[0].snapshot.launch_profiles = []
  const app = await manager(t, view)
  for (const [index, [value, cacheValue, enabled]] of [['', '', true], ['4294967296', '0', false], ['', '4096', false]].entries()) {
    button(app.document, 'Start a model…').click()
    const pane = app.document.querySelector('[role="dialog"]')
    pane.querySelector('input[name="gpu"]').checked = true
    pane.querySelector('input[name="max_context"]').value = '131072'
    const budget = pane.querySelector('input[name="kv_arena_bytes"]')
    assert.equal(budget.value, '')
    budget.value = value
    const structured = pane.querySelector('input[name="structured_outputs"]')
    assert.equal(structured.checked, true)
    structured.checked = enabled
    const cache = pane.querySelector('input[name="host_kv_cache_bytes"]')
    assert.equal(cache.value, '')
    cache.value = cacheValue
    submit(app)
    await completed(app, (calls) => calls.length === index + 1)
    const configuration = requests(app).at(-1).args
    assert.equal(configuration.kv_arena_bytes, value === '' ? null : Number(value))
    assert.equal(configuration.host_kv_cache_bytes, cacheValue === '' ? null : Number(cacheValue))
    assert.equal(configuration.structured_outputs, enabled)
    assert.equal(configuration.max_context, 131072)
    assert.equal(configuration.concurrency, 1)
    assert.equal(configuration.qualified_profile_id, null)
  }
})

test('installed local models can quote exact custom settings with an empty release catalog without starting or saving', async (t) => {
  const view = fixture()
  view.hosts[0].snapshot.launch_profiles = []
  view.first_run = { step: 'models', catalog_loaded: true, models: [], selected_downloads: [], startup_profiles: [] }
  const app = await manager(t, view, request => request.operation === 'quote'
    ? { model_identity: { model_id: 'muse-glimmer-30b', weights_id: 'nvfp4' }, instance_count: 2, kv_arena_bytes: 4294967296, quote: {} }
    : {})
  const saved = structuredClone(view.hosts[0].snapshot)
  button(app.document, 'Start a model…').click()
  const pane = app.document.querySelector('[role="dialog"]')
  pane.querySelector('input[name="gpu"]').checked = true
  pane.querySelector('input[name="max_context"]').value = '131072'
  pane.querySelector('input[name="concurrency"]').value = '2'
  pane.querySelector('input[name="instance_count"]').value = '2'
  pane.querySelector('input[name="structured_outputs"]').checked = false
  pane.querySelector('input[name="host_kv_cache_bytes"]').value = '0'
  pane.querySelector('input[name="kv_arena_bytes"]').value = '4294967296'
  button(pane, 'Check startup settings').click()
  await waitFor(() => pane.textContent.includes('Verified artifact:'), 'a local artifact quote must render without a published release')
  const expected = {
    instance_id: null, qualified_profile_id: null, model_id: 'installed-muse', gpu_uuids: ['GPU-local'],
    max_context: 131072, concurrency: 2, vision: true, structured_outputs: false,
    spec: 'auto', draft_policy: 'auto', draft_tokens: 0, kv_dtype: 'auto',
    kv_arena_bytes: 4294967296, vram_budget_bytes: null, host_kv_cache_bytes: 0, remaining_instances: 2,
  }
  assert.deepEqual(requests(app), [{ action: 'host', host_id: localId, operation: 'quote', args: expected }])
  assert.match(pane.textContent, /Verified artifact: muse-glimmer-30b \/ nvfp4/)
  assert.match(pane.textContent, /GPU KV per instance: 4\.0 GiB \(4,294,967,296 bytes\) · 2 instance\(s\)/)
  assert.match(pane.textContent, /No instance has been started or saved/)
  assert.deepEqual(view.hosts[0].snapshot, saved, 'quote must not manufacture a download, profile or instance')
  submit(app)
  await completed(app, calls => calls.length === 3)
  assert.deepEqual(requests(app)[1], { action: 'host', host_id: localId, operation: 'launch', args: expected },
    'ordinary Start must use the same settings and obtain its own fresh quote')
  assert.equal(requests(app)[2].operation, 'launch')
  assert.equal(requests(app)[2].args.remaining_instances, undefined)
})

test('local startup quotes discard late responses and clear success on settings or Host changes', async (t) => {
  const view = fixture()
  view.hosts[0].snapshot.launch_profiles = []
  let release
  const app = await manager(t, view, async request => {
    assert.equal(request.operation, 'quote')
    if (requests(app).length === 1) await new Promise(resolve => { release = resolve })
    return { model_identity: { model_id: 'muse-glimmer-30b', weights_id: 'nvfp4' }, instance_count: 1, kv_arena_bytes: 4294967296, quote: {} }
  })
  button(app.document, 'Start a model…').click()
  const pane = app.document.querySelector('[role="dialog"]')
  pane.querySelector('input[name="gpu"]').checked = true
  const context = pane.querySelector('input[name="max_context"]')
  context.value = '131072'
  button(pane, 'Check startup settings').click()
  await waitFor(() => typeof release === 'function', 'quote request must remain in flight')
  context.value = '65536'
  context.dispatchEvent(new app.window.Event('input', { bubbles: true }))
  release()
  await waitFor(() => !button(pane, 'Check startup settings').disabled, 'stale quote must settle')
  assert.ok(!pane.textContent.includes('Verified artifact:'), 'a quote for old settings must never render success')
  button(pane, 'Check startup settings').click()
  await waitFor(() => pane.textContent.includes('Verified artifact:'), 'current settings can be checked again')
  assert.equal(requests(app)[1].args.max_context, 65536)
  const structured = pane.querySelector('input[name="structured_outputs"]')
  structured.checked = false
  structured.dispatchEvent(new app.window.Event('change', { bubbles: true }))
  assert.ok(!pane.textContent.includes('Verified artifact:'))
  button(pane, 'Check startup settings').click()
  await waitFor(() => pane.textContent.includes('Verified artifact:'), 'changed options can be checked again')
  const next = structuredClone(view)
  next.hosts[0].snapshot.boot_id = 'new-host-process'
  await app.publish(next)
  assert.ok(!pane.textContent.includes('Verified artifact:'), 'a restarted Host invalidates the estimate')
  assert.ok(requests(app).every(request => request.operation === 'quote'))
})

test('local startup checks show Engine failures and validate the shared launch settings before sending', async (t) => {
  const view = fixture()
  view.hosts[0].snapshot.launch_profiles = []
  const app = await manager(t, view, request => {
    assert.equal(request.operation, 'quote')
    throw new Error('Engine quote: insufficient memory for selected context')
  })
  button(app.document, 'Start a model…').click()
  const pane = app.document.querySelector('[role="dialog"]')
  pane.querySelector('input[name="gpu"]').checked = true
  pane.querySelector('input[name="max_context"]').value = '131072'
  const budget = pane.querySelector('input[name="kv_arena_bytes"]')
  budget.value = '0'
  button(pane, 'Check startup settings').click()
  await waitFor(() => pane.textContent.includes('GPU KV budget must be a positive whole number'), 'invalid explicit allocation must fail before the request')
  assert.equal(requests(app).length, 0)
  budget.value = ''
  budget.dispatchEvent(new app.window.Event('input', { bubbles: true }))
  button(pane, 'Check startup settings').click()
  await waitFor(() => pane.textContent.includes('Engine quote: insufficient memory for selected context'), 'Engine rejection must stay visible in the form')
  assert.equal(requests(app).length, 1)
  assert.ok(!pane.textContent.includes('Verified artifact:'))
  assert.ok(pane.isConnected, 'failed checking must preserve the editable form')
})

test('reload preserves saved structured-output OFF and Host KV zero or cleared AUTO', async (t) => {
  const view = fixture()
  view.hosts[0].snapshot.instances[0].profile.structured_outputs = false
  const app = await manager(t, view)
  for (const [index, cacheValue] of ['0', ''].entries()) {
    button(app.document.querySelector(`[data-instance="${readyId}"]`), 'Reload').click()
    const pane = app.document.querySelector('[role="dialog"]')
    assert.equal(pane.querySelector('input[name="structured_outputs"]').checked, false)
    pane.querySelector('input[name="launch_mode"][value="custom"]').click()
    assert.equal(pane.querySelector('input[name="structured_outputs"]').checked, false)
    const cache = pane.querySelector('input[name="host_kv_cache_bytes"]')
    assert.equal(cache.value, '0')
    cache.value = cacheValue
    submit(app)
    await completed(app, (calls) => calls.length === index + 1)
    assert.equal(requests(app).at(-1).args.configuration.structured_outputs, false)
    assert.equal(requests(app).at(-1).args.configuration.host_kv_cache_bytes, cacheValue === '' ? null : 0)
  }
})

test('qualified profile controls preserve structured-output OFF without another custom setting', async (t) => {
  const view = fixture()
  view.hosts[0].snapshot.instances[0].profile.structured_outputs = false
  const app = await manager(t, view)
  button(app.document.querySelector(`[data-instance="${readyId}"]`), 'Reload').click()
  const pane = app.document.querySelector('[role="dialog"]')
  assert.equal(pane.querySelector('input[name="structured_outputs"]').checked, false)
  submit(app)
  await completed(app, (calls) => calls.length === 1)
  assert.equal(requests(app)[0].operation, 'profile_launch')
  assert.equal(requests(app)[0].args.structured_outputs, false)
  assert.equal(Object.hasOwn(requests(app)[0].args, 'host_kv_cache_bytes'), false)
})

test('custom KV budgets reject zero, fractional and unsafe byte counts before contacting the host', async (t) => {
  const view = fixture()
  view.hosts[0].snapshot.launch_profiles = []
  const app = await manager(t, view)
  button(app.document, 'Start a model…').click()
  const pane = app.document.querySelector('[role="dialog"]')
  pane.querySelector('input[name="gpu"]').checked = true
  pane.querySelector('input[name="max_context"]').value = '131072'
  for (const value of ['0', '-1', '1.5', '9007199254740992']) {
    pane.querySelector('input[name="kv_arena_bytes"]').value = value
    submit(app)
    await waitFor(() => /GPU KV budget must be a positive whole number/.test(pane.querySelector('[role="alert"]').textContent), 'invalid budgets must explain the accepted input')
    assert.equal(requests(app).length, 0)
  }
  pane.querySelector('input[name="kv_arena_bytes"]').value = ''
  for (const value of ['0', '-1', '1.5', '9007199254740992']) {
    pane.querySelector('input[name="vram_budget_bytes"]').value = value
    submit(app)
    await waitFor(() => /Flash weight residency budget must be a positive whole number/.test(pane.querySelector('[role="alert"]').textContent), 'invalid Flash budgets must explain the accepted input')
    assert.equal(requests(app).length, 0)
  }
  pane.querySelector('input[name="vram_budget_bytes"]').value = ''
  for (const value of ['-1', '1.5', '9007199254740992']) {
    pane.querySelector('input[name="host_kv_cache_bytes"]').value = value
    submit(app)
    await waitFor(() => /Host KV cache must be a nonnegative whole number/.test(pane.querySelector('[role="alert"]').textContent), 'invalid Host cache budgets must explain the accepted input')
    assert.equal(requests(app).length, 0)
  }
})

test('an offline paired host has a neutral fleet status before coordinator selection and after reconnecting', async (t) => {
  const view = fixture()
  const failure = 'error sending request for url (https://192.168.1.111:7444/host/v1/fleet): tcp connect error: actively refused (os error 10061)'
  view.hosts[1].online = false
  view.hosts[1].offline = true
  view.hosts[1].error = failure
  view.fleet = { connected: false, authority: null, snapshot: null, error: null,
    host_issues: [{ host_id: pairedId, phase: 'discovery', offline: true, message: failure }] }
  const app = await manager(t, view)
  const row = () => app.document.querySelector(`[data-fleet-host="${pairedId}"]`)
  assert.equal(row().querySelector('[role="status"]').textContent, 'Offline')
  assert.match(row().textContent, /GPU server/)
  assert.equal(app.document.querySelector('[data-section="fleet"] .section-error'), null)
  assert.doesNotMatch(app.document.body.textContent, /tcp connect error|os error 10061|error sending request/)
  assert.equal(button(app.document, 'Set coordinator…').disabled, false)
  app.document.querySelectorAll('.host-button')[1].click()
  assert.match(app.document.querySelector('main').textContent, /GInfer offline/)
  assert.doesNotMatch(app.document.querySelector('main').textContent, /tcp connect error|os error 10061/)
  assert.equal(button(app.document, 'Start a model…').disabled, true)
  const next = structuredClone(view)
  next.hosts[1].online = true
  next.hosts[1].offline = false
  next.hosts[1].error = null
  next.fleet.host_issues = []
  await app.publish(next)
  assert.equal(row().querySelector('[role="status"]').textContent, 'Online')
  assert.equal(requests(app).length, 0)
})

test('offline coordinator preserves read-only pools while offline members leave a reachable coordinator editable', async (t) => {
  const view = fixture()
  view.hosts[0].online = false
  view.hosts[0].offline = true
  view.fleet.connected = false
  view.fleet.host_issues = [{ host_id: localId, phase: 'coordinator', offline: true, message: 'Connection refused' }]
  const app = await manager(t, view)
  let section = app.document.querySelector('[data-section="fleet"]')
  assert.match(section.textContent, /Shared workers/)
  assert.match(section.textContent, /Stale · read only/)
  assert.equal(section.querySelector(`[data-fleet-host="${localId}"] [role="status"]`).textContent, 'Offline')
  assert.equal(button(section, 'Edit').disabled, true)
  assert.equal(button(section, 'Assign client…').disabled, true)
  const next = structuredClone(view)
  next.hosts[0].online = true
  next.hosts[0].offline = false
  next.hosts[1].online = false
  next.hosts[1].offline = true
  next.fleet.connected = true
  next.fleet.host_issues = [{ host_id: pairedId, phase: 'membership', offline: true, message: 'Connection refused' }]
  await app.publish(next)
  section = app.document.querySelector('[data-section="fleet"]')
  assert.equal(button(section, 'Edit').disabled, false)
  assert.equal(button(section, 'Assign client…').disabled, false)
  assert.equal(section.querySelector(`[data-fleet-host="${pairedId}"] [role="status"]`).textContent, 'Offline')
  assert.equal(section.querySelector('.section-error'), null)
})

test('authentication, certificate and schema problems stay visible alongside another offline host', async (t) => {
  const view = fixture()
  view.hosts[1].online = false
  view.hosts[1].offline = true
  const app = await manager(t, view)
  for (const problem of ['host returned 401: revoked grant', 'certificate pin mismatch', 'Invalid fleet response: missing revision']) {
    const next = structuredClone(view)
    next.fleet.connected = false
    next.fleet.host_issues = [{ host_id: localId, phase: 'coordinator', offline: false, message: problem },
      { host_id: pairedId, phase: 'discovery', offline: true, message: 'Connection refused' }]
    await app.publish(next)
    const row = app.document.querySelector(`[data-fleet-host="${localId}"]`)
    assert.equal(row.querySelector('[role="status"]').textContent, 'Needs attention')
    assert.equal(row.querySelector('.section-error').textContent, problem)
    assert.equal(app.document.querySelector(`[data-fleet-host="${pairedId}"] .section-error`), null)
  }
  const conflict = structuredClone(view)
  conflict.fleet.error = 'Paired hosts publish different fleet coordinators.'
  await app.publish(conflict)
  assert.match(app.document.querySelector('[data-section="fleet"] .section-error').textContent, /different fleet coordinators/)
})

test('local sharing and client revoke invoke the same manager host authority', async (t) => {
  const app = await manager(t, fixture(), (request, view) => {
    if (request.operation === 'share') view.hosts[0].snapshot.lan_sharing.enabled = request.args.enabled
    if (request.operation === 'revoke') view.hosts[0].snapshot.clients = []
    return { ok: true }
  })
  const share = app.document.querySelector('input[aria-label="Share this host"]')
  assert.equal(share.checked, true)
  share.checked = false
  share.dispatchEvent(new app.window.Event('change', { bubbles: true }))
  await completed(app, (calls) => calls.length === 1)
  assert.deepEqual(requests(app)[0], { action: 'host', host_id: localId, operation: 'share', args: { enabled: false } })
  assert.equal(app.document.querySelector('input[aria-label="Share this host"]').checked, false)
  button(app.document.querySelector('[data-section="clients"]'), 'Revoke').click()
  submit(app)
  await completed(app, (calls) => calls.length === 2)
  assert.deepEqual(requests(app)[1], { action: 'host', host_id: localId, operation: 'revoke', args: { client_id: clientId } })
  assert.match(app.document.querySelector('[data-section="clients"]').textContent, /No paired clients/)
})

test('fleet pool and assignment edits retain coordinator revision and canonical instance identity', async (t) => {
  const app = await manager(t)
  const fleet = app.document.querySelector('[data-section="fleet"]')
  button(fleet, 'Edit').click()
  app.document.querySelector('[role="dialog"] input[name="name"]').value = 'Shared research'
  app.document.querySelector('[role="dialog"] input[name="limit_0"]').value = '3'
  submit(app)
  await completed(app, (calls) => calls.length === 1)
  assert.deepEqual(requests(app)[0], { action: 'fleet_update', update: { expected_revision: 11, operation: 'save_pool', pool: {
    id: poolId, name: 'Shared research', members: [{ instance: { host_id: localId, instance_id: readyId }, worker_limit: 3 }],
  } } })
  button(app.document.querySelector('[data-section="fleet"]'), 'Edit assignment').click()
  const localPreference = app.document.querySelectorAll(`[role="dialog"] input[name="preferred_host"][value="${localId}"]`)
  assert.equal(localPreference.length, 1, 'coordinator membership must not create duplicate preferred-host choices')
  localPreference[0].checked = true
  app.document.querySelector(`[role="dialog"] input[name="preferred_instance"][value="${localId}/${readyId}"]`).checked = true
  submit(app)
  await completed(app, (calls) => calls.length === 2)
  assert.deepEqual(requests(app)[1], { action: 'fleet_update', update: { expected_revision: 11, operation: 'set_client_assignment', assignment: {
    client_id: clientId, pool_ids: [poolId], preferred_hosts: [localId], preferred_instances: [{ host_id: localId, instance_id: readyId }],
  } } })
})

test('an explicit coordinator change retains the selected paired identity and certificate', async (t) => {
  const app = await manager(t)
  button(app.document.querySelector('[data-section="fleet"]'), 'Set coordinator…').click()
  const pane = app.document.querySelector('[role="dialog"]')
  const coordinator = pane.querySelector('select[name="coordinator"]')
  coordinator.value = pairedId
  coordinator.dispatchEvent(new app.window.Event('change', { bubbles: true }))
  assert.equal(pane.querySelector('textarea[name="origins"]').value, 'https://gpu-server:7443')
  submit(app)
  await completed(app, (calls) => calls.length === 1)
  assert.deepEqual(requests(app)[0], { action: 'fleet_configure', member_host_id: localId, authority: {
    host_id: pairedId, certificate_sha256: 'cd'.repeat(32), origins: ['https://gpu-server:7443'],
  } })
})

test('configured coordinator origins are read only on a member and editable on their owning host or during bootstrap', async (t) => {
  const view = fixture()
  const authority = { host_id: pairedId, certificate_sha256: 'cd'.repeat(32),
    origins: ['https://gpu-server.lan:7443', 'https://10.0.0.2:7443'] }
  view.fleet.authority = authority
  view.fleet.snapshot.authority = authority
  view.fleet.snapshot.members.push({ host: authority, display_name: 'GPU server' })
  view.hosts[0].snapshot.fleet = { kind: 'member', authority }
  view.hosts[1].snapshot.fleet = { kind: 'coordinator', fleet: structuredClone(view.fleet.snapshot) }
  const app = await manager(t, view)

  button(app.document.querySelector('[data-section="fleet"]'), 'Set coordinator…').click()
  let pane = app.document.querySelector('[role="dialog"]')
  let origins = pane.querySelector('textarea[name="origins"]')
  assert.equal(origins.value, authority.origins.join('\n'), 'a member uses the coordinator’s published addresses')
  assert.equal(origins.readOnly, true)
  assert.match(pane.textContent, /Select that host in Manager to edit them/)
  submit(app)
  await completed(app, (calls) => calls.length === 1)
  assert.deepEqual(requests(app)[0], { action: 'fleet_configure', member_host_id: localId, authority })

  app.document.querySelectorAll('.host-button')[1].click()
  button(app.document.querySelector('[data-section="fleet"]'), 'Set coordinator…').click()
  pane = app.document.querySelector('[role="dialog"]')
  origins = pane.querySelector('textarea[name="origins"]')
  assert.equal(origins.readOnly, false)
  origins.value = 'https://renamed-gpu-server:7443\nhttps://10.0.0.2:7443'
  submit(app)
  await completed(app, (calls) => calls.length === 2)
  assert.deepEqual(requests(app)[1], { action: 'fleet_configure', member_host_id: pairedId,
    authority: { ...authority, origins: ['https://renamed-gpu-server:7443', 'https://10.0.0.2:7443'] } })

  const bootstrap = structuredClone(view)
  bootstrap.hosts[0].snapshot.fleet = { kind: 'unconfigured' }
  bootstrap.hosts[1].snapshot.fleet = { kind: 'unconfigured' }
  bootstrap.fleet = { connected: false, authority: null, snapshot: null, client_id: null, error: null }
  await app.publish(bootstrap)
  app.document.querySelectorAll('.host-button')[0].click()
  button(app.document.querySelector('[data-section="fleet"]'), 'Set coordinator…').click()
  pane = app.document.querySelector('[role="dialog"]')
  origins = pane.querySelector('textarea[name="origins"]')
  assert.equal(pane.querySelector('select[name="coordinator"]').value, pairedId)
  assert.equal(origins.readOnly, false, 'initial coordinator addresses remain editable before publication')
  origins.value = 'https://new-coordinator:7443'
  submit(app)
  await completed(app, (calls) => calls.length === 3)
  assert.deepEqual(requests(app)[2], { action: 'fleet_configure', member_host_id: localId,
    authority: { ...authority, origins: ['https://new-coordinator:7443'] } })
})

test('a stale fleet draft is rejected without retry and preserves the user edit for review', async (t) => {
  const app = await manager(t, fixture(), () => { throw new Error('409: expected revision is stale') })
  button(app.document.querySelector('[data-section="fleet"]'), 'Edit').click()
  const pane = app.document.querySelector('[role="dialog"]')
  pane.querySelector('input[name="name"]').value = 'My pending edit'
  const next = structuredClone(app.view)
  next.fleet.snapshot.revision = 12
  await app.publish(next)
  submit(app)
  await completed(app, (calls) => calls.length === 1)
  await waitFor(() => pane.querySelector('[role="alert"]').textContent.includes('fleet changed'), 'conflict must remain actionable in the draft')
  assert.equal(requests(app)[0].update.expected_revision, 11)
  assert.equal(pane.querySelector('input[name="name"]').value, 'My pending edit')
  assert.equal(button(pane, 'Save pool').disabled, true)
  assert.equal(button(pane, 'Cancel').disabled, false)
  assert.equal(requests(app).length, 1, 'CAS conflict must not silently retry the mutation')
  assert.match(app.document.querySelector('[data-section="fleet"]').textContent, /Revision 12/)
})

test('manager snapshot events update active requests, download progress and completion without launching', async (t) => {
  const view = fixture()
  view.hosts[0].snapshot.model_management.downloads = [{ id: 'download-1', status: 'downloading', received: 50, bytes_per_second: 10,
    release: { name: 'Muse release', bytes: 100 } }]
  const app = await manager(t, view)
  assert.equal(app.document.querySelector('progress').value, 50)
  const next = structuredClone(view)
  next.hosts[0].snapshot.instances[0].active_requests = 0
  next.hosts[0].snapshot.instances[0].status = 'stopped'
  next.hosts[0].snapshot.instances[0].session_id = null
  next.hosts[0].snapshot.clients[0].active_requests = 0
  next.hosts[0].snapshot.model_management.downloads[0].status = 'complete'
  next.hosts[0].snapshot.model_management.downloads[0].received = 100
  await app.publish(next)
  assert.equal(app.document.querySelector('progress').value, 100)
  assert.match(app.document.querySelector('[data-section="models"]').textContent, /complete/)
  assert.match(app.document.querySelector('[data-section="clients"]').textContent, /0 active request/)
  assert.equal(button(app.document.querySelector(`[data-instance="${readyId}"]`), 'Start').disabled, false)
  assert.equal(button(app.document.querySelector(`[data-instance="${readyId}"]`), 'Stop').disabled, true)
  assert.equal(button(app.document.querySelector('[data-section="models"]'), 'Pause').disabled, true)
  assert.equal(button(app.document.querySelector('[data-section="models"]'), 'Resume').disabled, true)
  assert.equal(requests(app).length, 0)
})

test('Nearby Pair submits the discovered host once without a dialog', async (t) => {
  const view = fixture()
  const nearbyId = '10000000-0000-4000-8000-000000000003'
  view.discovered = [{ host_id: nearbyId, name: 'Nearby workstation', urls: ['https://workstation:7443'] }]
  const app = await manager(t, view)
  button(app.document.querySelector('.nearby'), 'Pair').click()
  await completed(app, (calls) => calls.length === 1)
  assert.equal(app.document.querySelector('[role="dialog"]'), null)
  assert.deepEqual(requests(app)[0], {
    action: 'pair', host_id: nearbyId, base_url: 'https://workstation:7443', client_name: null,
  })
})

for (const [spec, target, error] of [
  ['dflash', 'muse-glimmer-30b', /DFlash2 requires a draft width from 1/],
  ['mtp', 'qwen3.8-flash-next', /MTP requires a positive draft width/],
]) {
  test(`explicit ${spec} rejects width 0 while Automatic keeps the Engine default`, async (t) => {
    const view = fixture()
    view.hosts[0].snapshot.launch_profiles = []
    view.hosts[0].snapshot.models[0].metadata.identity.model_id = target
    const app = await manager(t, view)
    button(app.document, 'Start a model…').click()
    const pane = app.document.querySelector('[role="dialog"]')
    pane.querySelector('input[name="gpu"]').checked = true
    pane.querySelector('input[name="max_context"]').value = '32768'
    const selection = pane.querySelector('select[name="spec"]')
    selection.value = spec
    selection.dispatchEvent(new app.window.Event('change', { bubbles: true }))
    assert.equal(selection.selectedOptions[0].disabled, false, 'explicit speculation must be valid for the selected target')
    const width = pane.querySelector('input[name="draft_tokens"]')
    width.value = '0'
    assert.equal(width.validity.rangeUnderflow, true)
    submit(app)
    await waitFor(() => error.test(pane.querySelector('[role="alert"]').textContent), 'explicit width zero must produce an actionable error')
    assert.equal(requests(app).length, 0, 'invalid explicit draft width must not reach host launch')

    selection.value = 'auto'
    selection.dispatchEvent(new app.window.Event('change', { bubbles: true }))
    assert.equal(width.value, '0')
    assert.equal(width.validity.valid, true)
    submit(app)
    await completed(app, (calls) => calls.length === 1)
    assert.equal(requests(app)[0].action, 'host')
    assert.equal(requests(app)[0].host_id, localId)
    assert.equal(requests(app)[0].operation, 'launch')
    assert.equal(requests(app)[0].args.model_id, 'installed-muse')
    assert.equal(requests(app)[0].args.spec, 'auto')
    assert.equal(requests(app)[0].args.draft_tokens, 0)
    assert.deepEqual(requests(app)[0].args.gpu_uuids, ['GPU-local'])
  })
}

test('host membership reports Current only when its confirmed authority revision is current', async (t) => {
  const view = fixture()
  const pool = { id: poolId, name: 'Shared workers', members: [{ instance: { host_id: pairedId, instance_id: readyId }, worker_limit: 2 }] }
  view.fleet.snapshot.members.push({ host: { host_id: pairedId, origins: ['https://gpu-server:7443'], certificate_sha256: 'cd'.repeat(32) }, display_name: 'GPU server' })
  view.fleet.snapshot.pools[0].members.push(pool.members[0])
  view.hosts[1].snapshot.instances = [structuredClone(view.hosts[0].snapshot.instances[0])]
  view.hosts[1].snapshot.fleet_membership = { coordinator: false, authority: view.fleet.authority, membership: {
    schema: 'ginfer-fleet-membership-v1', host_id: pairedId, authority: view.fleet.authority,
    revision: 11, pools: [pool], assignments: [],
  } }
  const app = await manager(t, view)
  app.document.querySelectorAll('.host-button')[1].click()
  const membershipStatus = () => [...app.document.querySelectorAll('[data-section="fleet"] p')]
    .find((paragraph) => /^(Current|Last known) revision/.test(paragraph.textContent))?.textContent
  assert.match(membershipStatus(), /^Current revision 11/)
  assert.match(app.document.querySelector('[data-section="fleet"]').textContent, /This host’s pool memberships.*Shared workers.*2 worker\(s\)/s)

  const next = structuredClone(view)
  next.fleet.snapshot.revision = 12
  await app.publish(next)
  assert.match(membershipStatus(), /^Last known revision 11/)
  next.hosts[1].snapshot.fleet_membership.membership.revision = 12
  await app.publish(next)
  assert.match(membershipStatus(), /^Current revision 12/)
  next.fleet.connected = false
  await app.publish(next)
  assert.match(membershipStatus(), /^Last known revision 12/)
  next.fleet.connected = true
  next.hosts[1].online = false
  await app.publish(next)
  assert.match(membershipStatus(), /^Last known revision 12/)
  assert.equal(requests(app).length, 0, 'viewing membership never changes the host authority')
})

test('hardware profiling updates through shared snapshots, blocks launch and keeps Stop available', async (t) => {
  const view = fixture()
  const hardware = { status: 'running', pending_gpu_groups: [], stale_groups: [], gpu_uuids: ['GPU-local'], engine_path: '/bin/ginfer', job_id: 'profile-job', pid: 42, reprofile: false,
    started_unix_ms: 1000, finished_unix_ms: null, profile_path: '/hardware.json',
    checkpoint_available: false, diagnostic_tail: 'Measuring CPU groups', error: null, available: true }
  view.hosts[0].snapshot.hardware_profile = hardware
  const app = await manager(t, view)
  assert.equal(button(app.document, 'Start a model…').disabled, true)
  assert.equal(button(app.document.querySelector(`[data-instance="${stoppedId}"]`), 'Start').disabled, true)
  assert.equal(button(app.document.querySelector(`[data-instance="${readyId}"]`), 'Reload').disabled, true)
  assert.equal(button(app.document.querySelector(`[data-instance="${readyId}"]`), 'Stop').disabled, false)
  assert.equal(app.document.querySelector('progress').hasAttribute('value'), false)
  assert.match(app.document.body.textContent, /Measuring CPU groups/)
  button(app.document, 'Cancel profiling').click()
  await waitFor(() => app.calls.some(({ input }) => input?.request?.operation === 'hardware_profile'), 'cancel reaches the shared Host command')
  assert.deepEqual(app.calls.find(({ input }) => input?.request?.operation === 'hardware_profile').input.request,
    { action: 'host', host_id: localId, operation: 'hardware_profile', args: { action: 'cancel' } })
  await flush()
  const next = structuredClone(app.view)
  next.hosts[0].snapshot.hardware_profile = { ...hardware, status: 'interrupted', checkpoint_available: true,
    diagnostic_tail: 'CPU group saved', error: 'Producer interrupted', finished_unix_ms: 62000 }
  await app.publish(next)
  assert.match(app.document.body.textContent, /checkpoint presence alone does not prove compatibility/)
  assert.match(app.document.body.textContent, /CPU group saved/)
  assert.match(app.document.body.textContent, /61 seconds elapsed/)
  button(app.document, 'Resume profiling').click()
  await waitFor(() => app.calls.some(({ input }) => input?.request?.args?.action === 'resume'), 'resume is explicit')
  await flush()
  const offline = structuredClone(next)
  offline.hosts[0].online = false
  await app.publish(offline)
  assert.equal(button(app.document, 'Resume profiling').disabled, true)
  assert.equal(button(app.document, 'Refresh hardware profile').disabled, true)
  const calls = app.calls.length
  app.runtime.stop()
  assert.equal(app.calls.length, calls, 'closing the UI does not cancel the Host job')
})

test('draft-width calibration remains visible without blocking model start and reports offline snapshots', async (t) => {
  const view = fixture()
  view.hosts[0].snapshot.hardware_profile = { status: 'completed', pending_gpu_groups: [], stale_groups: [], gpu_uuids: ['GPU-local'],
    engine_path: '/bin/ginfer', job_id: 'hardware-job', pid: null, reprofile: false, available: true,
    started_unix_ms: null, finished_unix_ms: null, profile_path: '/hardware.json',
    checkpoint_available: false, diagnostic_tail: '', error: null }
  view.hosts[0].snapshot.draft_width_calibrations = [{ key: 'recipe', model_id: 'Qwen', gpu_uuids: ['GPU-local'],
    max_context: 131072, concurrency: 4, status: 'running', pid: 42, error: null, diagnostic_tail: '' }]
  const app = await manager(t, view)
  assert.equal(button(app.document, 'Start a model…').disabled, false)
  assert.match(app.document.querySelector('[aria-label="Draft-width calibration"]').textContent, /Qwen · C4 · 131,072 tokens · running/)
  const next = structuredClone(app.view)
  next.hosts[0].snapshot.draft_width_calibrations[0] = { ...next.hosts[0].snapshot.draft_width_calibrations[0],
    status: 'failed', pid: null, error: 'Calibration rejected', diagnostic_tail: 'Native capacity error' }
  await app.publish(next)
  const region = app.document.querySelector('[aria-label="Draft-width calibration"]')
  assert.equal(region.querySelector('[role="alert"]').textContent, 'Calibration rejected')
  assert.match(region.textContent, /Native capacity error/)
  next.hosts[0].online = false
  await app.publish(next)
  assert.match(app.document.querySelector('[aria-label="Draft-width calibration"]').textContent, /last reported, host offline/)
  assert.equal(requests(app).length, 0)
})

test('a launch dialog opened before profiling starts cannot submit a model launch', async (t) => {
  const app = await manager(t)
  button(app.document, 'Start a model…').click()
  const next = structuredClone(app.view)
  next.hosts[0].snapshot.hardware_profile = { status: 'running', pending_gpu_groups: [], stale_groups: [], gpu_uuids: ['GPU-local'], engine_path: '/bin/ginfer', available: true, checkpoint_available: false,
    started_unix_ms: null, finished_unix_ms: null, diagnostic_tail: '', error: null }
  await app.publish(next)
  submit(app)
  await flush()
  assert.equal(requests(app).length, 0)
  assert.match(app.document.body.textContent, /hardware profiling has stopped/)
})


test('first hardware installation requires explicit ordered homogeneous selection, including a singleton', async (t) => {
  const view = fixture()
  view.hosts[0].snapshot.hardware_profile = { status: 'idle', pending_gpu_groups: [], stale_groups: [], gpu_uuids: [], engine_path: null,
    available: false, checkpoint_available: false, started_unix_ms: null, finished_unix_ms: null,
    diagnostic_tail: '', error: null }
  const app = await manager(t, view)
  const selected = uuid => app.document.querySelector(`input[aria-label*="(${uuid})"]`)
  assert.equal(selected('GPU-local').checked, false)
  assert.equal(button(app.document, 'Prepare hardware profile').disabled, true)
  assert.match(app.document.body.textContent, /Choose GPU group/)
  selected('GPU-local').click()
  button(app.document, 'Prepare hardware profile').click()
  await waitFor(() => app.calls.some(({ input }) => input?.request?.args?.action === 'ensure'), 'singleton starts only after selection')
  assert.deepEqual(app.calls.find(({ input }) => input?.request?.args?.action === 'ensure').input.request.args,
    { action: 'ensure', gpu_uuids: ['GPU-local'] })
  await flush()
  const next = structuredClone(app.view)
  const gpu = next.hosts[0].snapshot.gpus[0]
  next.hosts[0].snapshot.gpus.push({ ...gpu, uuid: 'GPU-two' },
    { ...gpu, uuid: 'GPU-ada', name: 'RTX 4090', compute_capability: '8.9' },
    { ...gpu, uuid: 'GPU-pro', name: 'RTX PRO 6000' })
  await app.publish(next)
  button(app.document, 'Clear GPU selection').click()
  selected('GPU-two').click()
  assert.equal(selected('GPU-ada').disabled, true)
  assert.equal(selected('GPU-pro').disabled, true)
  selected('GPU-local').click()
  button(app.document, 'Prepare hardware profile').click()
  await waitFor(() => app.calls.filter(({ input }) => input?.request?.args?.action === 'ensure').length === 2, 'explicit two-GPU group starts')
  assert.deepEqual(app.calls.filter(({ input }) => input?.request?.args?.action === 'ensure').at(-1).input.request.args,
    { action: 'ensure', gpu_uuids: ['GPU-two', 'GPU-local'] })
  await flush()
  button(app.document, 'Clear GPU selection').click()
  assert.equal(selected('GPU-ada').disabled, false)
  assert.equal(button(app.document, 'Prepare hardware profile').disabled, true)
})

test('pending and exact stale profile groups update in shared snapshots and require explicit start', async (t) => {
  const view = fixture()
  const gpu = view.hosts[0].snapshot.gpus[0]
  view.hosts[0].snapshot.gpus.push({ ...gpu, uuid: 'GPU-two' })
  const profile = { status: 'failed', job_id: 'job', gpu_uuids: ['GPU-local'], engine_path: '/bin/ginfer',
    pending_gpu_groups: [], stale_groups: [], available: true, checkpoint_available: false,
    started_unix_ms: null, finished_unix_ms: null, diagnostic_tail: '', error: 'Unrelated startup failure' }
  view.hosts[0].snapshot.hardware_profile = profile
  const app = await manager(t, view)
  assert.doesNotMatch(app.document.body.textContent, /Hardware changed — re-profile/)
  const next = structuredClone(app.view)
  next.hosts[0].snapshot.hardware_profile = { ...profile, status: 'interrupted', checkpoint_available: false,
    pending_gpu_groups: [['GPU-two']], stale_groups: [
      { gpu_uuids: ['GPU-local'], profile_path: '/group-one/hardware.json', expected_duration_ms: 120000 },
      { gpu_uuids: ['GPU-two'], profile_path: '/group-two/hardware.json', expected_duration_ms: null },
    ] }
  await app.publish(next)
  assert.match(app.document.body.textContent, /Pending saved deployment groups/)
  assert.equal(button(app.document, 'Resume profiling').disabled, false)
  assert.match(app.document.body.textContent, /Resume retries the saved job inputs/)
  assert.match(app.document.body.textContent, /Hardware changed — re-profile · ~2 minutes/)
  assert.match(app.document.body.textContent, /Hardware changed — re-profile · recent full installs took 22–73 minutes/)
  const stale = app.document.querySelector('section[aria-label*="Stale GPU group"][aria-label*="GPU-two"]')
  assert.match(stale.textContent, /group-two\/hardware.json/)
  button(stale, 'Select group to re-profile').click()
  assert.equal(requests(app).length, 0)
  button(app.document, 'Refresh hardware profile').click()
  await waitFor(() => app.calls.some(({ input }) => input?.request?.args?.action === 'refresh'), 'explicit refresh reaches the selected stale group')
  assert.deepEqual(app.calls.find(({ input }) => input?.request?.args?.action === 'refresh').input.request.args,
    { action: 'refresh', gpu_uuids: ['GPU-two'] })
  await flush()
  const active = structuredClone(next)
  active.hosts[0].snapshot.hardware_profile.status = 'running'
  await app.publish(active)
  button(app.document, 'Cancel profiling and queue').click()
  await waitFor(() => app.calls.some(({ input }) => input?.request?.args?.action === 'cancel'), 'queue cancellation uses the original job')
  assert.deepEqual(app.calls.find(({ input }) => input?.request?.args?.action === 'cancel').input.request.args, { action: 'cancel' })
})

test('screened startup profiles remain selectable with the full-context warning and witnessed cap', async (t) => {
  const view = fixture()
  const profile = view.hosts[0].snapshot.launch_profiles[0].profile
  profile.qualification.tier = 'screened-startup'
  profile.max_context = 131072
  profile.concurrency = 8
  const app = await manager(t, view)
  button(app.document, 'Start a model…').click()
  const pane = app.document.querySelector('[role="dialog"]')
  const options = pane.querySelector('select[name="profile_choice"]').options
  assert.match(options[0].text, /Screened, not full-context qualified · C8 · 128K context/)
  assert.doesNotMatch(options[0].text, /Recommended|256K/)
  assert.match(pane.textContent, /Startup and short requests were checked; full-context capacity is unverified/)
  assert.equal(requests(app).length, 0)
  submit(app)
  await completed(app, calls => calls.length === 1)
  assert.equal(requests(app)[0].args.profile_id, profile.id)
})

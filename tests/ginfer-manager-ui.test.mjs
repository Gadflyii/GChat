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
        options: configuration, qualification: { tier: 'full-context-tested' } } }],
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
  const dom = new JSDOM(html, { url: 'https://manager.local/', runScripts: 'outside-only' })
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
  return app.calls.filter(({ command }) => command === 'manager_request').map(({ input }) => input.request)
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
  assert.match(pane.textContent, /Muse TP1 32K.*RTX 5090.*full-context-tested/s)
  assert.equal(requests(app).length, 0, 'rendering and selecting a profile never start a model')
  button(pane, 'Cancel').click()
  app.document.querySelectorAll('.host-button')[1].click()
  assert.equal(app.document.querySelector('h1').textContent, 'GPU server')
  assert.match(app.document.querySelector('main').textContent, /No instances/)
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
    profile_id: 'muse-qualified', model_id: 'installed-muse', gpu_uuids: ['GPU-local'],
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
    configuration: { ...saved, qualified_profile_id: null, draft_policy: 'auto', kv_arena_bytes: null },
  } })
  assert.deepEqual(instance.profile, saved, 'editing a custom copy must not rewrite the saved qualification')
})

test('new custom launches choose automatic KV sizing unless an exact positive budget is entered', async (t) => {
  const view = fixture()
  view.hosts[0].snapshot.launch_profiles = []
  const app = await manager(t, view)
  for (const value of ['', '4294967296']) {
    button(app.document, 'Start a model…').click()
    const pane = app.document.querySelector('[role="dialog"]')
    pane.querySelector('input[name="gpu"]').checked = true
    pane.querySelector('input[name="max_context"]').value = '131072'
    const budget = pane.querySelector('input[name="kv_arena_bytes"]')
    assert.equal(budget.value, '')
    budget.value = value
    submit(app)
    await completed(app, (calls) => calls.length === (value ? 2 : 1))
    const configuration = requests(app).at(-1).args
    assert.equal(configuration.kv_arena_bytes, value ? 4294967296 : null)
    assert.equal(configuration.max_context, 131072)
    assert.equal(configuration.concurrency, 1)
    assert.equal(configuration.qualified_profile_id, null)
  }
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

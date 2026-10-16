import { profileOptionLabel, profilePresentation } from './profile-presentation.js'

const array = (value) => Array.isArray(value) ? value : []
const text = (value, fallback = '—') => value == null || value === '' ? fallback : String(value)
const modelLabel = (model) => {
  if (model?.name) return model.name
  if (model?.path) return String(model.path).split(/[/\\]/).pop().replace(/\.ginfer$/i, '')
  const identity = model?.metadata?.identity || model?.identity
  return identity ? `${identity.model_id} / ${identity.weights_id}` : text(model?.name, 'Model')
}
const size = (bytes) => Number.isFinite(Number(bytes)) ? `${(Number(bytes) / 2 ** 30).toFixed(1)} GiB` : '—'
const instanceKey = (ref) => `${ref.host_id}/${ref.instance_id}`
const parseOrigins = (value) => value.split(/\r?\n/).map((origin) => origin.trim()).filter(Boolean)
const lastSeen = (client) => client.last_seen_unix_ms ? `Last seen ${new Date(client.last_seen_unix_ms).toLocaleString()}` : 'No requests yet'
// These are the values used by the view and its action closures. Activity text
// has its own nodes, so a paired client's poll need not replace its controls.
const renderKey = (view) => JSON.stringify([
  view.client_name, view.local_error, view.fleet,
  array(view.discovered).map((host) => [host.host_id, host.name, host.urls]),
  array(view.hosts).map((host) => {
    const snapshot = host.snapshot
    return [host.host_id, host.name, host.local, host.online, host.offline, host.error,
      host.base_url, host.certificate_sha256, snapshot && [
        snapshot.display_name, snapshot.gpus, snapshot.models, snapshot.launch_profiles,
        snapshot.lan_sharing, snapshot.model_management, snapshot.hardware_profile, snapshot.draft_width_calibrations,
        host.online && ['running', 'cancelling'].includes(snapshot.hardware_profile?.status) && snapshot.hardware_profile.started_unix_ms != null
          ? Math.floor((Date.now() - snapshot.hardware_profile.started_unix_ms) / 1000) : null,
        snapshot.inventory_errors,
        snapshot.profile_error, snapshot.fleet, snapshot.fleet_membership,
        array(snapshot.instances).map((instance) => [instance.instance_id, instance.session_id,
          instance.display_name, instance.status, instance.configuration, instance.profile,
          instance.upstream_model_id, instance.last_error]),
        array(snapshot.clients).map((client) => [client.client_id, client.name, client.local]),
        !!snapshot.local_administrator, !!snapshot.can_stop_host,
      ]]
  }),
])
const firstMap = (entries, key) => {
  const result = new Map()
  for (const entry of entries) {
    const id = key(entry)
    if (!result.has(id)) result.set(id, entry)
  }
  return result
}

export function createManager(root, invoke, listen, storage = globalThis.localStorage) {
  const document = root.ownerDocument
  const preferences = new Map()
  const readPreference = (key, fallback) => {
    try {
      const saved = storage.getItem(`ginfer-manager.${key}`)
      if (saved == null) return fallback
      const value = JSON.parse(saved)
      preferences.set(key, JSON.stringify(value))
      return value ?? fallback
    } catch { return fallback }
  }
  const savePreference = (key, value) => {
    const serialized = JSON.stringify(value)
    if (preferences.get(key) === serialized) return
    try {
      storage.setItem(`ginfer-manager.${key}`, serialized)
      preferences.set(key, serialized)
    } catch { /* Only successful writes are cached; the next observation retries. */ }
  }
  const state = { view: { hosts: [], discovered: [], fleet: null }, selected: readPreference('host', null),
    ignored: new Set(readPreference('ignored', [])), sections: new Map(), catalogs: new Map(), profileGroups: new Map(),
    busy: false, notice: '', warning: '', error: '', errorSource: null, dialog: null, stopped: false,
    firstRuns: new Map(), firstRunDrafts: new Map(), firstRunPending: new Set(), firstRunRevisions: new Map() }
  const subscriptions = []
  let snapshotKey
  let presentationKey
  let pendingRender = false
  let indexedView
  let indexes
  const clientActivity = new Map()
  const instanceActivity = new Map()
  let administratorActivity

  function appendChildren(node, children) {
    for (const child of children) {
      if (Array.isArray(child)) appendChildren(node, child)
      else if (child != null) node.append(child.nodeType ? child : document.createTextNode(String(child)))
    }
  }
  const append = (node, ...children) => appendChildren(node, children)
  function h(tag, properties = {}, ...children) {
    const node = document.createElement(tag)
    for (const [key, value] of Object.entries(properties)) {
      if (key.startsWith('on')) node.addEventListener(key.slice(2).toLowerCase(), value)
      else if (key === 'class') node.className = value
      else if (key === 'checked' || key === 'disabled' || key === 'open') node[key] = !!value
      else if (key === 'value') node.value = value
      else if (value != null) node.setAttribute(key, value)
    }
    appendChildren(node, children)
    return node
  }
  const button = (label, action, disabled = false, className = '') => h('button', {
    type: 'button', class: className, disabled: state.busy || disabled, onclick: action }, label)
  const note = (content) => h('p', { class: 'muted' }, content)
  const badge = (status) => h('span', { class: `badge ${status}` }, text(status, 'unknown'))
  const online = (host) => host?.online === true
  const profiling = (host) => ['running', 'cancelling'].includes(host?.snapshot?.hardware_profile?.status)
  function observation() {
    if (indexedView === state.view) return indexes
    const hosts = array(state.view.hosts)
    indexes = { hosts: firstMap(hosts, (host) => host.host_id),
      discovered: firstMap(array(state.view.discovered), (host) => host.host_id),
      models: new Map(), gpus: new Map(), instances: new Map(), instanceRows: [],
      pools: firstMap(array(state.view.fleet?.snapshot?.pools), (pool) => pool.id),
      members: firstMap(array(state.view.fleet?.snapshot?.members), (member) => member.host.host_id),
      issues: new Map() }
    for (const host of hosts) {
      indexes.models.set(host.host_id, firstMap(array(host.snapshot?.models), (model) => model.id))
      indexes.gpus.set(host.host_id, firstMap(array(host.snapshot?.gpus).map((gpu, index) => ({ gpu, index })), (entry) => entry.gpu.uuid))
      for (const instance of array(host.snapshot?.instances)) {
        const row = { host, instance }
        const key = instanceKey({ host_id: host.host_id, instance_id: instance.instance_id })
        if (!indexes.instances.has(key)) indexes.instances.set(key, row)
        indexes.instanceRows.push(row)
      }
    }
    for (const issue of array(state.view.fleet?.host_issues)) {
      if (!indexes.issues.has(issue.host_id)) indexes.issues.set(issue.host_id, [])
      indexes.issues.get(issue.host_id).push(issue)
    }
    indexedView = state.view
    return indexes
  }
  const selectedHost = () => observation().hosts.get(state.selected)
  const hostName = (id) => text(observation().hosts.get(id)?.name, id)
  const instances = () => observation().instanceRows
  const displayedInstance = (host, instance) => {
    const model = observation().models.get(host.host_id)?.get(instance.profile?.model_id)
    return model ? modelLabel(model) : instance.configuration?.artifact ? modelLabel({ path: instance.configuration.artifact })
      : text(instance.upstream_model_id || instance.display_name)
  }
  const instanceLabel = (ref) => {
    const row = observation().instances.get(instanceKey(ref))
    return row ? `${row.host.name} · ${displayedInstance(row.host, row.instance)}` : `${hostName(ref.host_id)} · ${ref.instance_id}`
  }
  const hostRequest = (host, operation, args = {}) => ({ action: 'host', host_id: host.host_id, operation, args })

  function apply(view) {
    if (state.stopped || !view) return
    state.view = view
    indexedView = null
    indexes = null
    if (state.errorSource === 'runtime') state.error = ''
    if (!array(view.hosts).some((host) => host.host_id === state.selected)) {
      state.selected = array(view.hosts).find((host) => host.local)?.host_id || array(view.hosts)[0]?.host_id || null
    }
    savePreference('host', state.selected)
    state.dialog?.observe?.()
    for (const host of array(view.hosts)) {
      if (host.local && online(host) && state.firstRuns.get(host.host_id)?.step !== 'complete' && !state.firstRunPending.has(host.host_id)) void readFirstRun(host)
    }
    render(false)
  }

  async function readFirstRun(host) {
    state.firstRunPending.add(host.host_id)
    const revision = state.firstRunRevisions.get(host.host_id)
    try {
      const response = await invoke('manager_request', { request: hostRequest(host, 'first_run') })
      if (!state.stopped && revision === state.firstRunRevisions.get(host.host_id)) { state.firstRuns.set(host.host_id, response.result); render(false) }
    } catch (error) {
      if (!state.stopped && revision === state.firstRunRevisions.get(host.host_id)) { state.firstRuns.set(host.host_id, { load_error: String(error) }); render(false) }
    } finally { state.firstRunPending.delete(host.host_id) }
  }

  async function firstRunAction(host, args) {
    state.firstRunRevisions.set(host.host_id, (state.firstRunRevisions.get(host.host_id) || 0) + 1)
    state.firstRunPending.add(host.host_id)
    try {
      const result = await run(hostRequest(host, 'first_run', args), 'Setup progress saved')
      state.firstRuns.set(host.host_id, result)
      state.firstRunDrafts.delete(host.host_id)
      render()
    } finally { state.firstRunPending.delete(host.host_id) }
  }

  function firstRunSection(host) {
    if (!host.local) return null
    const flow = state.firstRuns.get(host.host_id)
    if (flow?.step === 'complete') return null
    const action = args => firstRunAction(host, args).catch(() => {})
    const heading = h('h2', {}, 'Set up local GInfer')
    if (!online(host)) return h('section', { class: 'card' }, heading, note('Reconnect this host to continue saved setup.'))
    if (!flow || flow.load_error) return h('section', { class: 'card' }, heading,
      flow?.load_error ? h('p', { class: 'section-error', role: 'alert' }, flow.load_error) : note('Reading saved setup…'),
      flow?.load_error ? button('Retry local setup', () => readFirstRun(host)) : null)
    let draft = state.firstRunDrafts.get(host.host_id)
    if (!draft || draft.step !== flow.step) {
      draft = { step: flow.step, catalogLoaded: flow.catalog_loaded, gpus: [...array(flow.gpu_uuids)],
        path: flow.storage?.recommended_path || flow.storage?.path || '',
        releases: array(flow.models).filter(model => model.recommended).map(model => model.release_id || model.release.sha256) }
      state.firstRunDrafts.set(host.host_id, draft)
    } else if (draft.catalogLoaded !== flow.catalog_loaded) {
      draft.catalogLoaded = flow.catalog_loaded
      if (!draft.pathEdited) draft.path = flow.storage?.recommended_path || flow.storage?.path || ''
      draft.releases = array(flow.models).filter(model => model.recommended).map(model => model.release_id || model.release.sha256)
    }
    const content = []
    const choose = (values, value, checked) => checked ? [...values, value] : values.filter(entry => entry !== value)
    if (flow.step === 'gpu') {
      const known = array(host.snapshot?.gpus).filter(gpu => ['8.0', '8.6', '8.9', '12.0'].includes(gpu.compute_capability))
      const selected = known.filter(gpu => draft.gpus.includes(gpu.uuid))
      const valid = [1, 2, 4].includes(selected.length) && selected.length === draft.gpus.length && selected.every(gpu => gpu.name === selected[0].name && gpu.compute_capability === selected[0].compute_capability)
      content.push(h('h3', {}, 'Choose GPU group'), note('Select 1, 2 or 4 matching GPUs. Hardware profiling starts after this selection.'),
        known.map(gpu => h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: draft.gpus.includes(gpu.uuid),
          onchange: event => { draft.gpus = choose(draft.gpus, gpu.uuid, event.target.checked); render() } }), `${gpu.display_name || gpu.name} · ${size(gpu.memory_mib * 1024 ** 2)} · ${gpu.uuid}`)),
        !known.length ? h('p', { class: 'section-error', role: 'alert' }, 'No supported NVIDIA GPU detected. Check your GPU and CUDA 13.1 driver, or pair a network host.') : null,
        button('Use selected GPUs and profile', () => action({ action: 'profile', gpu_uuids: draft.gpus }), !valid))
    } else if (flow.step === 'profiling') {
      content.push(h('h3', {}, 'Prepare hardware'), h('p', { role: 'status' }, `Hardware profiling: ${text(flow.hardware_profile?.status)}`),
        flow.hardware_profile?.status === 'running' ? h('progress', { 'aria-label': 'Hardware profiling' }) : null,
        note('Recent full installs took 22–73 minutes. Closing Manager leaves the shared Host job running.'),
        flow.hardware_profile?.error ? h('p', { class: 'section-error', role: 'alert' }, flow.hardware_profile.error) : null,
        ['failed', 'interrupted', 'cancelled'].includes(flow.hardware_profile?.status) ? button('Resume hardware profiling', () => action({ action: 'resume' })) : null,
        flow.hardware_profile?.diagnostic_tail ? h('details', {}, h('summary', {}, 'Profiling log'), h('pre', { class: 'mono' }, flow.hardware_profile.diagnostic_tail)) : null)
    } else if (flow.step === 'storage') {
      const input = h('input', { value: draft.path, 'aria-label': 'Model download folder', oninput: event => { draft.pathEdited = true; draft.path = event.target.value } })
      content.push(h('h3', {}, 'Choose model storage'), note(flow.storage?.available_bytes == null ? 'Free space is unavailable for the current folder.' : `${size(flow.storage.available_bytes)} available in the current folder.`),
        flow.storage?.error ? h('p', { class: 'section-error', role: 'alert' }, flow.storage.error) : null,
        flow.storage?.recommended_path ? note(`Recommended: ${flow.storage.recommended_path}`) : null,
        h('label', {}, 'Model download folder', input), array(flow.storage?.candidates).map(candidate => h('div', {}, button(`${candidate.path} · ${candidate.available_bytes == null ? 'free space unavailable' : `${size(candidate.available_bytes)} free`}`, () => { draft.pathEdited = true; draft.path = candidate.path; render() }, candidate.eligible === false), candidate.reason ? note(candidate.reason) : null, candidate.measured_read_bytes_per_second != null ? note(`Measured read: ${(candidate.measured_read_bytes_per_second / 1024 ** 2).toFixed(1)} MiB/s`) : null)),
        button('Use this folder', () => action({ action: 'storage', path: draft.path })))
    } else if (flow.step === 'models') {
      content.push(h('h3', {}, 'Choose models to download'), array(flow.models).map(model => {
        const id = model.release_id || model.release.sha256
        return h('label', { class: 'card' }, h('span', { class: 'check' }, h('input', { type: 'checkbox', checked: draft.releases.includes(id),
          onchange: event => { draft.releases = choose(draft.releases, id, event.target.checked); render() } }), `${model.release.name} · ${size(model.release.bytes)}${model.recommended ? ' · Recommended' : ''}`), note(model.reason))
      }), !array(flow.models).length ? note(flow.catalog_loaded === false && !flow.error ? 'Loading published model catalog…' : 'No compatible published models are available. Check the model catalog and selected GPU group.') : null,
      array(host.snapshot?.model_management?.downloads).filter(job => job.status === 'installed' && job.path && !job.path.startsWith(`${flow.storage?.path}/`) && !job.path.startsWith(`${flow.storage?.path}\\`)).map(job => h('div', { class: 'card' },
        note(`${job.release.name} is stored at ${job.path}. Keep it there or move it to ${flow.storage?.path}.`),
        button(`Move ${job.release.name} to selected storage`, () => action({ action: 'move', download_id: job.id })))),
      button('Download selected models', () => action({ action: 'models', release_ids: draft.releases }), !draft.releases.length),
      button('Refresh model catalog', () => action({ action: 'refresh_catalog' })))
    } else if (flow.step === 'downloads') {
      content.push(h('h3', {}, 'Downloading models'), array(flow.selected_downloads).map(job => h('div', {},
        h('p', {}, `${job.release.name} · ${job.status} · ${(100 * job.received / Math.max(1, job.release.bytes)).toFixed(1)}% · ${(job.bytes_per_second / 1024 ** 2).toFixed(1)} MiB/s`),
        h('progress', { 'aria-label': `${job.release.name} download`, max: job.release.bytes, value: job.received }),
        job.error ? h('p', { class: 'section-error', role: 'alert' }, job.error) : null)),
      note('Downloads continue when Manager closes.'), button('Resume downloads', () => action({ action: 'resume' })))
    } else if (flow.step === 'startup') {
      content.push(h('h3', {}, 'Review startup defaults'), !array(flow.startup_profiles).length ? h('p', { role: 'status' }, 'Preparing startup settings and checking Engine memory…') : null, array(flow.startup_profiles).map(profile => h('div', { class: 'card' },
        h('strong', {}, profile.model_id), h('p', {}, `${profile.instance_count} instance(s) · ${profile.concurrency} concurrent requests · ${profile.max_context.toLocaleString()} tokens · ${profile.kv_arena_bytes == null ? 'Automatic GPU KV cache' : `${size(profile.kv_arena_bytes)} GPU KV cache`}`),
        !profile.quote && !profile.error ? h('p', { role: 'status' }, 'Checking these settings with the Engine…') : null,
        profile.error ? h('p', { class: 'section-error', role: 'alert' }, profile.error) : null,
        button('Adjust startup settings…', () => dialog('Startup settings', 'The Engine checks memory requirements. Saving these settings does not start a model.',
          [['concurrency', 'Concurrent requests', profile.concurrency], ['max_context', 'Context tokens', profile.max_context], ['instance_count', 'Instances', profile.instance_count], ['kv_arena_bytes', 'GPU KV cache bytes (blank for automatic)', profile.kv_arena_bytes ?? '']].map(([name, label, value]) => h('label', {}, label, h('input', { name, type: 'number', min: '1', ...(name === 'kv_arena_bytes' ? {} : { required: '' }), value }))),
          'Check startup settings', form => firstRunAction(host, { action: 'startup', download_id: profile.download_id, concurrency: Number(fieldValue(form, 'concurrency')), max_context: Number(fieldValue(form, 'max_context')), instance_count: Number(fieldValue(form, 'instance_count')), kv_arena_bytes: fieldValue(form, 'kv_arena_bytes') ? Number(fieldValue(form, 'kv_arena_bytes')) : null }))))), note('The Engine checks memory requirements. Models stay stopped until you launch them.'),
      button('Finish local setup', () => action({ action: 'complete' }), !array(flow.startup_profiles).length || array(flow.startup_profiles).some(profile => profile.error || !profile.quote)))
    }
    return h('section', { class: 'card', 'aria-label': 'Set up local GInfer' }, heading,
      note('Progress is shared with GChat and the installer.'), flow.error ? h('p', { class: 'section-error', role: 'alert' }, flow.error) : null, content)
  }

  async function refresh() {
    state.busy = true
    state.error = ''
    render()
    try { apply(await invoke('manager_snapshot')) }
    catch (error) { state.error = String(error); state.errorSource = 'runtime' }
    finally { state.busy = false; render() }
  }

  async function run(request, success = 'Saved') {
    state.busy = true
    state.error = ''
    state.errorSource = 'action'
    state.notice = ''
    state.warning = ''
    render()
    try {
      const response = await invoke('manager_request', { request })
      apply(response.view)
      state.notice = success
      const cleanupWarning = response.result?.credential_cleanup_warning
      if (typeof cleanupWarning === 'string' && cleanupWarning.trim()) {
        state.warning = `OS credential cleanup needs attention: ${cleanupWarning}`
      }
      if (response.view?.refresh_error) state.error = `The action completed. Refresh failed: ${response.view.refresh_error}`
      return response.result
    } catch (error) {
      state.error = String(error)
      // Keep the draft's expected_revision fixed while refreshing a conflict.
      if (request.operation !== 'stop_host' && state.error.includes('409')) {
        try { apply(await invoke('manager_snapshot')) } catch { /* Keep the reported edit conflict. */ }
      }
      throw error
    } finally { state.busy = false; render() }
  }

  function dialog(title, description, fields, submitLabel, submit, afterSave = null, revisionConflicts = true) {
    if (state.dialog) state.dialog.close()
    const previousFocus = document.activeElement
    root.inert = true
    const error = h('p', { class: 'section-error', role: 'alert' })
    const accept = h('button', { type: 'submit', class: 'primary' }, submitLabel)
    const cancel = h('button', { type: 'button' }, 'Cancel')
    const form = h('form', {}, fields, error, h('div', { class: 'actions' }, cancel, accept))
    const pane = h('section', { class: 'dialog', role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
      h('h2', {}, title), h('p', { class: 'description' }, description), form)
    const backdrop = h('div', { class: 'dialog-backdrop' }, pane)
    const key = (event) => { if (event.key === 'Escape' && !accept.disabled) close() }
    const close = () => {
      backdrop.remove(); document.removeEventListener('keydown', key); state.dialog = null; root.inert = false
      if (previousFocus?.isConnected) previousFocus.focus()
      else root.querySelector('button')?.focus()
    }
    cancel.addEventListener('click', close)
    form.addEventListener('submit', async (event) => {
      event.preventDefault()
      if (accept.disabled) return
      accept.disabled = true
      cancel.disabled = true
      error.textContent = ''
      try { await submit(form); close(); afterSave?.() }
      catch (failure) {
        const conflict = revisionConflicts && String(failure).includes('409')
        error.textContent = conflict ? 'The fleet changed while this form was open. Cancel and review the current revision before editing again.' : String(failure)
        accept.disabled = conflict
        cancel.disabled = false
      }
    })
    document.addEventListener('keydown', key)
    document.body.append(backdrop)
    state.dialog = { close }
    pane.querySelector('input,select,textarea,button')?.focus()
  }

  function field(label, name, value = '', type = 'text', properties = {}) {
    return h('label', {}, label, h('input', { name, type, value, ...properties }))
  }
  const fieldValue = (form, name) => form.elements.namedItem(name)?.value ?? ''
  const checked = (form, name) => form.elements.namedItem(name)?.checked === true
  const select = (label, name, options, value) => h('label', {}, label,
    h('select', { name }, options.map(([id, labelText]) => h('option', { value: id, selected: id === value ? '' : null }, labelText))))
  const checks = (label, name, options, selected = []) => h('label', {}, label,
    h('div', { class: 'choice-list' }, options.map(([id, nameText]) => h('label', { class: 'check' },
      h('input', { type: 'checkbox', name, value: id, checked: selected.includes(id) }), nameText))))
  const checkedValues = (form, name) => [...form.querySelectorAll(`input[name="${name}"]:checked`)].map((input) => input.value)

  function confirm(title, description, request, success) {
    dialog(title, description, [], title, () => run(request, success), null, request.operation !== 'stop_host')
  }

  async function secureStorage() {
    const status = await run({ action: 'secure_storage' }, '')
    if (status.tier === 'passphrase' && !status.ready) {
      dialog('Unlock secure storage', 'Unlock Manager’s passphrase vault. Each app unlocks separately; your passphrase is never saved.',
        [field('Passphrase', 'passphrase', '', 'password', { required: '', autocomplete: 'current-password' })], 'Unlock', async (form) => {
          const passphrase = fieldValue(form, 'passphrase')
          form.elements.namedItem('passphrase').value = ''
          const result = await run({ action: 'secure_storage', operation: 'unlock', passphrase }, 'Secure storage is ready')
          if (!result.ready) throw new Error(result.error || 'Secure storage is unavailable')
        })
    } else if (status.tier === 'passphrase') {
      dialog('Secure storage', 'Lock the vault in Manager. Other apps keep their own unlock state.', [], 'Lock vault',
        () => run({ action: 'secure_storage', operation: 'lock' }, 'Manager’s vault is locked'))
    } else {
      dialog('Secure storage', status.ready ? 'Your desktop keyring is ready. To create or migrate to a passphrase vault, open secure storage setup in GChat.' :
        `${status.error || 'Secure storage is unavailable'}. Unlock your keyring, or create a passphrase vault in GChat.`, [], 'Check again', async () => {
          const result = await run({ action: 'secure_storage' }, '')
          if (!result.ready) throw new Error(result.error || 'Secure storage is unavailable')
        })
    }
  }

  function pair(discovered = null) {
    if (discovered) {
      run({ action: 'pair', host_id: discovered.host_id, base_url: discovered.urls?.[0] || null, client_name: null }, 'Host paired')
        .catch(() => { /* Shared enrollment errors remain visible. */ })
      return
    }
    const name = field('Client name', 'client_name', state.view.client_name || '', 'text', { required: '', maxlength: 80 })
    const address = field('Host address', 'base_url', '', 'url', { required: '', placeholder: 'https://192.168.1.10:7444' })
    const secureStatus = h('p', { class: 'muted', role: 'status' })
    dialog('Pair a host',
      'Pairing saves the verified host certificate and this client’s grant in shared native storage. Secure storage must be available.',
      [name, address, button('Check secure storage', async () => {
        secureStatus.textContent = ''
        secureStatus.className = 'muted'
        secureStatus.setAttribute('role', 'status')
        try {
          const result = await run({ action: 'secure_storage' }, '')
          if (!result.ready) throw new Error(result.error || 'Secure storage is unavailable')
          secureStatus.textContent = 'Secure storage is ready'
        }
        catch (error) {
          secureStatus.className = 'section-error'
          secureStatus.setAttribute('role', 'alert')
          secureStatus.textContent = String(error)
        }
      }), secureStatus], 'Pair', (form) => run({ action: 'pair', host_id: null,
        base_url: fieldValue(form, 'base_url'), client_name: fieldValue(form, 'client_name') }, 'Host paired'))
  }

  function section(key, title, children) {
    const node = h('details', { class: 'section', 'data-section': key, open: state.sections.get(key) ?? false },
      h('summary', {}, title), h('div', { class: 'section-content' }, children))
    node.addEventListener('toggle', () => state.sections.set(key, node.open))
    return node
  }

  function launchDialog(host, instance = null) {
    if (profiling(host)) return
    const snapshot = host.snapshot || {}
    const models = array(snapshot.models)
    const modelById = firstMap(models, (entry) => entry.id)
    const gpuById = firstMap(array(snapshot.gpus).map((gpu, index) => ({ gpu, index })), (entry) => entry.gpu.uuid)
    const profiles = array(snapshot.launch_profiles).flatMap((entry) =>
      array(instance ? entry.compatible_gpu_groups : entry.gpu_groups).map((group) => ({ entry, group })))
    const previous = instance?.profile || {}
    const model = previous.model_id || models[0]?.id
    let mode = profiles.length ? 'profile' : 'custom'
    let profileChoice = 0
    let showAllProfiles = false
    let updateStructuredEvidence = () => {}
    const structuredInput = h('input', { type: 'checkbox', name: 'structured_outputs',
      checked: previous.structured_outputs ?? true, onchange: () => updateStructuredEvidence() })
    const structuredField = h('label', { class: 'check' }, structuredInput, 'Structured outputs')
    const content = h('div')
    let quoteRevision = 0
    let quotePending = false
    const quoteResult = h('div', { 'aria-live': 'polite' })
    const quoteButton = h('button', { type: 'button', onclick: async () => {
      const form = quoteButton.closest('form')
      if (!form || quotePending) return
      invalidateQuote()
      const revision = quoteRevision
      try {
        const { count, kvBytes } = placementSettings(form)
        requireOnlineHost()
        const configuration = customConfiguration(form, kvBytes)
        quotePending = true
        quoteButton.disabled = true
        quoteResult.replaceChildren(h('p', { role: 'status' }, 'Checking these settings with the Engine…'))
        const response = await invoke('manager_request', { request: hostRequest(host, 'quote', {
          ...configuration, remaining_instances: count,
        }) })
        apply(response.view)
        if (!form.isConnected || revision !== quoteRevision) return
        const result = response.result
        const identity = result?.model_identity
        if (!identity?.model_id || !identity?.weights_id) throw new Error('The Engine quote did not identify the model artifact')
        quoteResult.replaceChildren(
          h('p', { role: 'status' }, `Verified artifact: ${identity.model_id} / ${identity.weights_id}`),
          h('p', {}, result.kv_arena_bytes == null
            ? 'Automatic GPU KV memory needs a successful startup to measure graph memory.'
            : `GPU KV per instance: ${size(result.kv_arena_bytes)} (${result.kv_arena_bytes.toLocaleString()} bytes) · ${result.instance_count} instance(s)`),
          note('This is a current Engine estimate. Starting obtains a fresh quote. No instance has been started or saved.'))
      } catch (error) {
        if (form.isConnected && revision === quoteRevision) quoteResult.replaceChildren(h('p', { class: 'section-error', role: 'alert' }, String(error)))
      } finally {
        quotePending = false
        updateQuoteAvailability()
      }
    } }, 'Check startup settings')
    const quoteControls = h('div', {}, quoteButton, quoteResult)
    function invalidateQuote() {
      quoteRevision++
      quoteResult.replaceChildren()
    }
    function updateQuoteAvailability() {
      const latest = observation().hosts.get(host.host_id)
      quoteButton.disabled = quotePending || !online(latest) || profiling(latest)
      quoteControls.hidden = !!instance || mode !== 'custom'
    }
    function requireOnlineHost() {
      const latest = observation().hosts.get(host.host_id)
      if (!online(latest) || profiling(latest)) throw new Error('Wait until the Host is online and hardware profiling has stopped before checking or launching a model.')
    }
    function placementSettings(form) {
      const count = instance ? 1 : Number(fieldValue(form, 'instance_count'))
      if (!Number.isInteger(count) || count < 1 || count > 4294967295) throw new Error('Instances must be a positive whole number below 4294967296')
      const kvBytes = fieldValue(form, 'kv_arena_bytes') === '' ? null : Number(fieldValue(form, 'kv_arena_bytes'))
      if (kvBytes !== null && (!Number.isSafeInteger(kvBytes) || kvBytes < 1)) {
        throw new Error('GPU KV budget must be a positive whole number of bytes, or blank for automatic sizing')
      }
      return { count, kvBytes }
    }
    function customConfiguration(form, kvBytes) {
      const configuration = { ...previous, instance_id: instance?.instance_id || null, qualified_profile_id: null,
        model_id: fieldValue(form, 'model_id'), gpu_uuids: checkedValues(form, 'gpu'),
        max_context: Number(fieldValue(form, 'max_context')), concurrency: Number(fieldValue(form, 'concurrency')),
        vision: checked(form, 'vision'), structured_outputs: checked(form, 'structured_outputs'), spec: fieldValue(form, 'spec'), draft_policy: fieldValue(form, 'draft_policy'),
        draft_tokens: Number(fieldValue(form, 'draft_tokens')), kv_dtype: fieldValue(form, 'kv_dtype'),
        kv_arena_bytes: kvBytes,
        vram_budget_bytes: fieldValue(form, 'vram_budget_bytes') === '' ? null : Number(fieldValue(form, 'vram_budget_bytes')),
        host_kv_cache_bytes: fieldValue(form, 'host_kv_cache_bytes') === '' ? null : Number(fieldValue(form, 'host_kv_cache_bytes')) }
      if (!configuration.gpu_uuids.length) throw new Error('Choose the exact GPU group')
      if (configuration.vram_budget_bytes !== null && (!Number.isSafeInteger(configuration.vram_budget_bytes) || configuration.vram_budget_bytes < 1)) {
        throw new Error('Flash weight residency budget must be a positive whole number of bytes, or blank for automatic sizing')
      }
      if (configuration.host_kv_cache_bytes !== null && (!Number.isSafeInteger(configuration.host_kv_cache_bytes) || configuration.host_kv_cache_bytes < 0)) {
        throw new Error('Host KV cache must be a nonnegative whole number of bytes, or blank for automatic sizing')
      }
      const width = configuration.draft_tokens
      if (!Number.isInteger(width) || width < 0) throw new Error('Draft width must be a whole number')
      if (configuration.spec === 'dflash' && (width < 1 || width > 15)) throw new Error('DFlash2 requires a draft width from 1 to 15; the host checks the exact model limit')
      if (configuration.spec === 'mtp' && (width < 1 || width >= 4294967295)) throw new Error('MTP requires a positive draft width below 4294967295')
      if (['auto', 'none'].includes(configuration.spec) && width !== 0) throw new Error('Automatic or disabled speculation uses draft width 0')
      return configuration
    }
    const radios = h('div', { class: 'radio-tabs' }, ['profile', 'custom'].map((kind) => h('label', {},
      h('input', { type: 'radio', name: 'launch_mode', value: kind, checked: mode === kind,
        disabled: kind === 'profile' && !profiles.length, onchange: () => { mode = kind; fill() } }),
      kind === 'profile' ? 'Saved profile' : 'Custom settings')))
    const gpuNames = (group) => group.map((id) => {
      const entry = gpuById.get(id)
      return `GPU ${entry?.index ?? -1} · ${text(entry?.gpu.display_name || entry?.gpu.name, id)}`
    }).join(' + ')
    function fill() {
      invalidateQuote()
      updateQuoteAvailability()
      if (mode === 'profile') {
        const selected = profiles[profileChoice]
        const groupKey = (group) => JSON.stringify([...group].sort())
        const modelProfiles = profiles.map((item, index) => ({ ...item, index }))
          .filter(({ entry }) => entry.model_id === selected.entry.model_id)
        const grouped = modelProfiles.filter(({ group }) => groupKey(group) === groupKey(selected.group))
        const { recommendedIndex, visibleIndices } = profilePresentation(
          grouped.map(({ entry }) => entry.profile), grouped.findIndex(({ index }) => index === profileChoice), showAllProfiles)
        const modelField = select('Model', 'profile_model', [...new Set(profiles.map(({ entry }) => entry.model_id))]
          .map(id => [id, modelLabel(modelById.get(id) || { name: id })]), selected.entry.model_id)
        const groups = firstMap(modelProfiles, ({ group }) => groupKey(group))
        const gpuField = select('GPU / GPU group', 'profile_gpu_group', [...groups]
          .map(([key, { group }]) => [key, gpuNames(group)]), groupKey(selected.group))
        modelField.addEventListener('change', () => {
          profileChoice = profiles.findIndex(({ entry }) => entry.model_id === modelField.querySelector('select').value)
          showAllProfiles = false
          fill()
        })
        gpuField.addEventListener('change', () => {
          profileChoice = modelProfiles.find(({ group }) => groupKey(group) === gpuField.querySelector('select').value).index
          showAllProfiles = false
          fill()
        })
        const profileField = select('Hardware profile', 'profile_choice', visibleIndices.map(index => {
          const { entry, index: originalIndex } = grouped[index]
          return [String(originalIndex), profileOptionLabel(entry.profile, index === recommendedIndex)]
        }), String(profileChoice))
        const changedNote = note('Changing the recorded structured output setting makes this launch custom and unqualified.')
        const evidenceNote = h('p', { class: 'muted' })
        updateStructuredEvidence = () => {
          const profile = profiles[Number(profileField.querySelector('select').value)].entry.profile
          const recorded = profile.options.structured_outputs ?? false
          changedNote.hidden = structuredInput.checked === recorded
          evidenceNote.textContent = `Profile evidence applies to its recorded options, Engine ${profile.qualification.engine_revision.slice(0, 8)} and workload. A changed option or Engine needs separate validation.`
        }
        profileField.addEventListener('change', () => {
          profileChoice = Number(profileField.querySelector('select').value)
          updateStructuredEvidence()
        })
        updateStructuredEvidence()
        const expand = grouped.length > visibleIndices.length || showAllProfiles
          ? h('button', { type: 'button', 'aria-expanded': showAllProfiles, onclick: () => { showAllProfiles = !showAllProfiles; fill() } }, showAllProfiles ? 'Show less' : 'Show all') : null
        content.replaceChildren(...[modelField, gpuField, profileField, expand,
        recommendedIndex < 0 ? note('No tested profile is available for this GPU group.') : null, changedNote,
        evidenceNote].filter(Boolean))
        return
      }
      updateStructuredEvidence = () => {}
      const modelField = select('Installed model', 'model_id', models.map((entry) => [entry.id, `${modelLabel(entry)} · TP${entry.metadata?.tp_size}`]), model)
      const specField = select('Speculative decoding', 'spec', [['auto', 'Automatic'], ['none', 'None'], ['dflash', 'DFlash2'], ['mtp', 'MTP']], previous.spec || 'auto')
      const draftPolicy = select('Draft width policy', 'draft_policy', [['auto', 'Automatic'], ['fixed', 'Fixed'], ['adaptive', 'Adaptive']], previous.draft_policy || 'auto')
      const widthField = field('Draft width', 'draft_tokens', previous.draft_tokens || 0, 'number', { min: 0 })
      content.replaceChildren(modelField,
        checks('GPU group', 'gpu', array(snapshot.gpus).map((gpu, index) => [gpu.uuid,
          `GPU ${index} · ${gpu.display_name || gpu.name} · ${Math.round(gpu.memory_mib / 1024)} GiB`]), previous.gpu_uuids || []),
        h('div', { class: 'grid' }, field('Context window', 'max_context', previous.max_context || '', 'number', { required: '', min: 1, placeholder: 'Tokens' }),
          field('Concurrent requests', 'concurrency', previous.concurrency || 1, 'number', { required: '', min: 1, max: 8 })),
        h('label', { class: 'check' }, h('input', { type: 'checkbox', name: 'vision', checked: previous.vision ?? true }), 'Enable Vision'),
        h('div', { class: 'grid' }, specField, draftPolicy),
        h('div', { class: 'grid' }, widthField,
          select('KV cache', 'kv_dtype', [['auto', 'Automatic'], ['bf16', 'BF16'], ['int8', 'INT8'], ['nvfp4', 'NVFP4']], previous.kv_dtype || 'auto')),
        field('Host KV cache (bytes, blank = automatic, 0 = disabled)', 'host_kv_cache_bytes', previous.host_kv_cache_bytes ?? '', 'number', { min: 0, max: Number.MAX_SAFE_INTEGER }),
        field('Flash per-rank weight residency budget (bytes, blank = automatic)', 'vram_budget_bytes', previous.vram_budget_bytes ?? '', 'number', { min: 1, max: Number.MAX_SAFE_INTEGER }),
        note('Flash sharing needs an explicit weight residency budget and one successful startup with those settings to measure graph memory. KV and startup state use additional memory.'),
        note('Host KV cache is automatic when blank; zero disables it and a positive value sets its exact size.'),
        note('Context and concurrent request settings stay as entered. Each instance owns its weights, state and KV cache.'),
        note('Automatic speculation uses width 0. DFlash2 and MTP require a positive width. The host validates the exact model, GPU group and settings before starting or replacing an instance.'))
      const updateWidth = () => {
        const spec = specField.querySelector('select').value
        const width = widthField.querySelector('input')
        width.min = ['dflash', 'mtp'].includes(spec) ? '1' : '0'
        width.max = spec === 'dflash' ? '15' : spec === 'mtp' ? '4294967294' : '0'
      }
      specField.addEventListener('change', updateWidth)
      updateWidth()
      const updateTarget = () => {
        const target = modelById.get(modelField.querySelector('select').value)?.metadata?.identity?.model_id
        for (const option of specField.querySelectorAll('option')) {
          option.disabled = option.value === 'mtp' ? target !== 'qwen3.8-flash-next' : option.value === 'dflash' && target === 'qwen3.8-flash-next'
        }
        for (const option of draftPolicy.querySelectorAll('option')) option.disabled = option.value === 'adaptive' && target === 'qwen3.8-flash-next'
      }
      modelField.addEventListener('change', updateTarget)
      updateTarget()
    }
    fill()
    dialog(instance ? 'Reload instance' : 'Start a model',
      instance ? 'The host validates the replacement first. Current requests drain unless you explicitly choose to interrupt them.' : 'Choose an installed model and exact GPU group. No model starts until you submit this form.',
      [radios, structuredField, content,
        ...(!instance ? [field('Instances', 'instance_count', 1, 'number', { required: '', min: 1, max: 4294967295 })] : []),
        field('GPU KV budget per instance (bytes, blank = automatic)', 'kv_arena_bytes', previous.kv_arena_bytes ?? '', 'number', { min: 1, max: Number.MAX_SAFE_INTEGER }),
        note('When sharing a GPU, the Host uses the Engine startup quote and splits the remaining KV memory equally across the new instances. Enter a byte budget to choose their share. Instances start one at a time with separate ports; existing instances keep their allocations.'),
        ...(!instance ? [quoteControls] : []),
        ...(instance?.active_requests > 0 ? [h('label', { class: 'check' },
        h('input', { type: 'checkbox', name: 'force' }), `Interrupt ${instance.active_requests} active request(s)`)] : [])],
      instance ? 'Reload' : 'Start', async (form) => {
        requireOnlineHost()
        const guard = instance ? { instance_id: instance.instance_id, expected_session_id: instance.session_id ?? null, force: checked(form, 'force') } : {}
        const { count, kvBytes } = placementSettings(form)
        const place = async (operation, args) => {
          let result
          let started = 0
          try {
            for (let remaining = count; remaining > 0; remaining--) {
              result = await run(hostRequest(host, operation, { ...args,
                ...(remaining > 1 ? { remaining_instances: remaining } : {}) }),
              count > 1 ? `${started + 1} of ${count} instances ready` : instance ? 'Instance reloaded' : 'Model starting')
              started++
            }
          } catch (error) {
            // A successful earlier launch remains independently manageable.
            if (count > 1) throw new Error(`${started} of ${count} instances started. ${error}`)
            throw error
          }
          return result
        }
        if (mode === 'profile') {
          const choice = profiles[Number(fieldValue(form, 'profile_choice'))]
          if (!choice) throw new Error('Choose a saved profile')
          return place('profile_launch', { ...guard, profile_id: choice.entry.profile.id,
            model_id: choice.entry.model_id, gpu_uuids: choice.group, structured_outputs: checked(form, 'structured_outputs'),
            ...(kvBytes !== null ? { kv_arena_bytes: kvBytes } : {}) })
        }
        const configuration = customConfiguration(form, kvBytes)
        return place(instance ? 'instance' : 'launch', instance ? { ...guard, operation: 'reload', configuration } : configuration)
      })
    const form = content.closest('form')
    form.addEventListener('input', invalidateQuote)
    form.addEventListener('change', invalidateQuote)
    const quoteContext = () => {
      const latest = observation().hosts.get(host.host_id)
      return JSON.stringify([latest?.online, latest?.certificate_sha256, latest?.snapshot?.boot_id,
        latest?.snapshot?.models, latest?.snapshot?.gpus, latest?.snapshot?.hardware_profile,
        array(latest?.snapshot?.instances).map(entry => [entry.instance_id, entry.status, entry.configuration])])
    }
    let previousContext = quoteContext()
    state.dialog.observe = () => {
      const current = quoteContext()
      if (current !== previousContext) { previousContext = current; invalidateQuote() }
      updateQuoteAvailability()
    }
  }

  function instanceCard(host, instance) {
    const configuration = instance.profile || instance.configuration || {}
    const running = ['ready', 'starting', 'stopping'].includes(instance.status)
    const currentFailure = online(host) && instance.status === 'failed'
    const diagnosticSection = `instance-diagnostic:${host.host_id}:${instance.instance_id}:`
    const diagnosticKey = `${diagnosticSection}${currentFailure ? 'current' : 'previous'}`
    state.sections.delete(`${diagnosticSection}${currentFailure ? 'previous' : 'current'}`)
    const gpuLabels = array(configuration.gpu_uuids).map((uuid) => {
      const entry = observation().gpus.get(host.host_id)?.get(uuid)
      return `GPU ${entry?.index ?? '?'} · ${text(entry?.gpu.display_name || entry?.gpu.name, uuid)}`
    })
    const installed = observation().models.get(host.host_id)?.get(configuration.model_id)
    const name = installed ? modelLabel(installed) : displayedInstance(host, instance)
    const facts = [['GPU group', gpuLabels.join(' + ') || '—'], ['Engine port', text(instance.configuration?.port, 'Allocated when started')],
      ['Active requests', instance.active_requests ?? 0], ['Context / requests', `${text(configuration.max_context)} / ${text(configuration.concurrency)}`]]
    const factNodes = facts.map(([label, value]) => {
      const content = h('strong', {}, value)
      if (label === 'Active requests') instanceActivity.set(instance.instance_id, content)
      return h('div', {}, label, content)
    })
    const execute = async (operation) => {
      if (operation === 'start' && profiling(observation().hosts.get(host.host_id))) return
      try { await run(hostRequest(host, 'instance', { instance_id: instance.instance_id, operation,
        expected_session_id: instance.session_id ?? null, force: false }), operation === 'start' ? 'Model starting' : 'Instance stopped') }
      catch { /* The native error remains visible. */ }
    }
    return h('article', { class: 'card', 'data-instance': instance.instance_id },
      h('div', { class: 'card-title' }, h('h3', {}, name), badge(online(host) ? instance.status : 'offline')),
      h('div', { class: 'facts' }, factNodes),
      instance.last_error ? h('div', {},
        currentFailure ? h('p', { class: 'section-error', role: 'alert' }, 'Engine failed. Open error details for the diagnostic.') : null,
        h('details', { class: 'instance-diagnostic', 'data-section': diagnosticKey, open: state.sections.get(diagnosticKey) ?? false },
          h('summary', {}, currentFailure ? 'Startup or runtime error details' : 'Previous startup error'),
          h('pre', { class: 'mono' }, instance.last_error))) : null,
      h('div', { class: 'actions' }, button('Start', () => execute('start'), !online(host) || profiling(host) || running),
        button('Stop', () => execute('stop'), !online(host) || !running || instance.status === 'stopping'),
        button('Reload', () => {
          const latest = observation().instances.get(instanceKey({ host_id: host.host_id, instance_id: instance.instance_id }))
          launchDialog(latest?.host || host, latest?.instance || instance)
        }, !online(host) || profiling(host) || instance.status === 'stopping' || !array(host.snapshot?.models).length)))
  }

  function hardwareProfileSection(host) {
    const profile = host.snapshot?.hardware_profile
    if (!profile) return null
    const running = profiling(host)
    const resumable = profile.job_id != null && array(profile.gpu_uuids).length > 0 && ['interrupted', 'cancelled', 'failed'].includes(profile.status)
    const end = profile.finished_unix_ms ?? (running && online(host) ? Date.now() : null)
    const elapsed = profile.started_unix_ms == null || end == null ? null
      : Math.max(0, Math.floor((end - profile.started_unix_ms) / 1000))
    const blocked = !online(host)
    const gpus = array(host.snapshot?.gpus)
    const known = gpus.filter(gpu => gpu.name && gpu.compute_capability)
    const selected = state.profileGroups.get(host.host_id) || []
    const selectedGpus = selected.map(uuid => known.find(gpu => gpu.uuid === uuid))
    const validGroup = [1, 2, 4].includes(selected.length) && selectedGpus.every(gpu => gpu &&
      gpu.name === selectedGpus[0]?.name && gpu.compute_capability === selectedGpus[0]?.compute_capability)
    const groupLabel = (group) => group.map(uuid => {
      const index = gpus.findIndex(gpu => gpu.uuid === uuid)
      return index < 0 ? uuid : `GPU ${index + 1}: ${gpus[index].display_name || gpus[index].name} (${uuid})`
    }).join(' + ')
    const choose = (uuid, checked) => {
      state.profileGroups.set(host.host_id, checked ? [...selected, uuid] : selected.filter(value => value !== uuid))
      render()
    }
    const execute = async (action) => {
      const args = { action, ...(['ensure', 'refresh'].includes(action) ? { gpu_uuids: selected } : {}) }
      try { await run(hostRequest(host, 'hardware_profile', args), action === 'cancel' ? 'Profiling cancellation requested' : 'Hardware profile job accepted') }
      catch { /* Shared action errors remain visible. */ }
    }
    return h('section', { class: 'card', 'aria-label': 'Hardware profile' },
      h('h2', {}, 'Hardware profile'),
      h('p', { role: 'status' }, `${profile.status}${elapsed == null ? '' : ` · ${elapsed.toLocaleString()} seconds elapsed`}${online(host) ? '' : ' · last reported, host offline'}`),
      array(profile.gpu_uuids).length ? note(`Job GPU group: ${groupLabel(profile.gpu_uuids)}`) : null,
      profile.engine_path ? note(`Job Engine: ${profile.engine_path}`) : null,
      array(profile.pending_gpu_groups).length ? h('div', {}, note('Pending saved deployment groups'),
        h('ul', {}, profile.pending_gpu_groups.map(group => h('li', {}, `TP${group.length}: ${groupLabel(group)}`))),
        note('Cancel stops the current job and queue. Resume continues the retained work.')) : null,
      array(profile.stale_groups).map(group => h('section', { class: 'card', 'aria-label': `Stale GPU group ${groupLabel(group.gpu_uuids)}` },
        h('p', {}, `Hardware changed — re-profile · ${group.expected_duration_ms == null
          ? 'recent full installs took 22–73 minutes; time varies by hardware'
          : `~${Math.ceil(group.expected_duration_ms / 60000)} minutes`}`),
        note(`TP${group.gpu_uuids.length}: ${groupLabel(group.gpu_uuids)}`),
        h('p', { class: 'muted mono' }, group.profile_path),
        button('Select group to re-profile', () => { state.profileGroups.set(host.host_id, [...group.gpu_uuids]); render() }, blocked || running))),
      running ? h('progress', { 'aria-label': 'Hardware profiling in progress' }) : null,
      note('Recent full installs took 22–73 minutes; time varies by hardware. Closing this window leaves the Host job running. Model launches wait until profiling stops.'),
      profile.status === 'completed' ? note('Hardware profiling completed. This does not qualify a model or its full-context capacity.') : null,
      array(host.snapshot?.draft_width_calibrations).length ? h('section', { 'aria-label': 'Draft-width calibration' },
        h('h3', {}, 'Draft-width calibration'),
        note('Runs when models are stopped. Starting a model cancels calibration; the engine uses its default policy until calibration completes.'),
        array(host.snapshot.draft_width_calibrations).map(job => h('div', {},
          h('p', { role: 'status' }, `${job.model_id} · C${job.concurrency} · ${job.max_context.toLocaleString()} tokens · ${job.status}${online(host) ? '' : ' · last reported, host offline'}`),
          note(groupLabel(job.gpu_uuids)),
          job.error ? h('p', { class: 'section-error', role: 'alert' }, job.error) : null,
          job.diagnostic_tail ? h('details', {}, h('summary', {}, 'Calibration log'), h('pre', { class: 'mono' }, job.diagnostic_tail)) : null))) : null,
      resumable ? note(profile.checkpoint_available
        ? 'A saved checkpoint is available. Resume validates its inputs before continuing; checkpoint presence alone does not prove compatibility.'
        : 'Resume retries the saved job inputs. The producer validates any retained progress before continuing.') : null,
      !profile.available && !running ? note('Choose a GPU group; the Host checks that a compatible hardware profiler is installed.') : null,
      profile.error ? h('p', { class: 'section-error', role: 'alert' }, profile.error) : null,
      profile.diagnostic_tail ? h('details', { class: 'instance-diagnostic', 'data-section': `hardware-profile-log:${host.host_id}`, open: state.sections.get(`hardware-profile-log:${host.host_id}`) ?? false },
        h('summary', {}, 'Profiling log'), h('pre', { class: 'mono' }, profile.diagnostic_tail)) : null,
      !running ? h('fieldset', { disabled: state.busy || blocked }, h('legend', {}, 'Choose GPU group'),
        note("Select 1, 2 or 4 GPUs of the same model and compute capability. The Host binds the profile to the selected GPU set and TP degree."),
        [...new Set(known.map(gpu => gpu.compute_capability))].map(sm => h('div', {}, note(`SM ${sm}`),
          known.filter(gpu => gpu.compute_capability === sm).map(gpu => h('label', { class: 'check' },
            h('input', { type: 'checkbox', checked: selected.includes(gpu.uuid), 'aria-label': groupLabel([gpu.uuid]),
              disabled: !selected.includes(gpu.uuid) && selectedGpus[0] &&
                (gpu.name !== selectedGpus[0].name || gpu.compute_capability !== selectedGpus[0].compute_capability),
              onchange: event => choose(gpu.uuid, event.target.checked) }), groupLabel([gpu.uuid]))))),
        selected.length ? [note(`Selected group: ${groupLabel(selected)}`), button('Clear GPU selection', () => { state.profileGroups.set(host.host_id, []); render() }, blocked)] : null,
        !validGroup ? note('Choose an explicit homogeneous GPU group before preparing or refreshing.') : null) : null,
      h('div', { class: 'actions' },
        profile.status === 'idle' ? button('Prepare hardware profile', () => execute('ensure'), blocked || !validGroup) : null,
        profile.status !== 'idle' && !running ? button('Refresh hardware profile', () => execute('refresh'), blocked || !validGroup) : null,
        resumable ? button('Resume profiling', () => execute('resume'), blocked) : null,
        running ? button(profile.status === 'cancelling' ? 'Cancelling profiling…' : array(profile.pending_gpu_groups).length ? 'Cancel profiling and queue' : 'Cancel profiling', () => execute('cancel'), !online(host) || profile.status === 'cancelling') : null))
  }

  function modelsSection(host) {
    const snapshot = host.snapshot || {}
    const rows = array(snapshot.models).map((model) => h('div', { class: 'list-row row' },
      h('div', {}, h('div', { class: 'title' }, modelLabel(model)), h('p', {}, `TP${model.metadata?.tp_size} · ${size(model.metadata?.size_bytes)}`), h('div', { class: 'mono' }, model.path)),
      button('Remove', () => confirm('Remove model', `Delete ${modelLabel(model)} from ${host.name}? The host refuses removal while an instance uses it.`,
        hostRequest(host, 'remove_model', { model_id: model.id }), 'Model removed'), !online(host), 'danger')))
    const downloads = array(snapshot.model_management?.downloads).map((download) => h('div', { class: 'list-row' },
      h('div', { class: 'row' }, h('div', {}, h('div', { class: 'title' }, download.release.name),
        h('p', {}, `${download.status} · ${size(download.received)} / ${size(download.release.bytes)} · ${size(download.bytes_per_second)}/s`)),
        h('div', { class: 'actions' }, ['pause', 'resume'].map((action) => button(action === 'pause' ? 'Pause' : 'Resume', async () => {
          try { await run(hostRequest(host, 'download_action', { id: download.id, action }), `Download ${action === 'pause' ? 'paused' : 'resumed'}`) } catch { /* Displayed in status. */ }
        }, !online(host) || (action === 'pause' ? !['queued', 'downloading'].includes(download.status) : !['paused', 'failed'].includes(download.status)))))),
      h('progress', { value: download.received, max: download.release.bytes || 1, 'aria-label': `${download.release.name} download progress` }),
      download.error ? h('p', { class: 'section-error' }, download.error) : null))
    const catalog = state.catalogs.get(host.host_id)
    const releases = array(catalog).map((release) => h('div', { class: 'list-row row' },
      h('div', {}, h('div', { class: 'title' }, release.name), h('p', {}, `${modelLabel(release)} · TP${release.tp} · ${size(release.bytes)}`)),
      button('Download', async () => { try { await run(hostRequest(host, 'download', release), 'Download queued') } catch { /* Displayed in status. */ } }, !online(host))))
    const editStorage = () => dialog('Model storage', 'This directory belongs to the selected host. Existing model files stay in their current locations.',
      [field('Absolute directory on this host', 'path', snapshot.model_management?.managed_root || '', 'text', { required: '' })], 'Save',
      (form) => run(hostRequest(host, 'set_storage', { path: fieldValue(form, 'path') }), 'Model storage updated'))
    const addArtifact = () => dialog('Add local model', 'Register an existing producer-final .ginfer file on this computer.',
      [field('Absolute .ginfer file', 'path', '', 'text', { required: '' })], 'Add',
      (form) => run(hostRequest(host, 'local_artifact', { path: fieldValue(form, 'path') }), 'Model added'))
    return section('models', `Models · ${rows.length} installed`, [
      h('div', { class: 'actions' }, button('Scan', async () => { try { await run(hostRequest(host, 'scan'), 'Inventory refreshed') } catch { /* Displayed in status. */ } }, !online(host)),
        button('Storage…', editStorage, !online(host)), host.local ? button('Add local model…', addArtifact, !online(host)) : null),
      note(`Storage: ${text(snapshot.model_management?.managed_root)}`),
      rows.length ? rows : note('No installed models found.'),
      array(snapshot.inventory_errors).map((entry) => h('p', { class: 'section-error' }, `${entry.path}: ${entry.error}`)),
      snapshot.profile_error ? h('p', { class: 'section-error' }, snapshot.profile_error) : null,
      downloads.length ? [h('h3', {}, 'Downloads'), downloads] : null,
      button('Show available downloads', async () => {
        try { const result = await run(hostRequest(host, 'catalog'), 'Model catalog refreshed'); state.catalogs.set(host.host_id, result); render() } catch { /* Displayed in status. */ }
      }, !online(host)), catalog ? releases.length ? releases : note('No published packages match this host’s GPU group.') : null])
  }

  function clientsSection(host) {
    const clients = array(host.snapshot?.clients)
    const rows = clients.map((client) => {
      const activity = h('p', {}, `${client.active_requests || 0} active request(s) · ${lastSeen(client)}`)
      clientActivity.set(client.client_id, activity)
      return h('div', { class: 'list-row row', 'data-client': client.client_id }, h('div', {}, h('div', { class: 'title' }, client.name),
        activity, h('div', { class: 'mono' }, client.client_id)), client.local ? badge('local') : button('Revoke', () => confirm('Revoke client',
          `Revoke ${client.name} on ${host.name}? This removes its grant to this host.`, hostRequest(host, 'revoke', { client_id: client.client_id }), 'Client revoked'), !online(host), 'danger'))
    })
    const administrator = host.snapshot?.local_administrator
    administratorActivity = administrator ? note(`Local administrator · ${administrator.active_requests || 0} active request(s)`) : null
    return section('clients', `Paired clients · ${clients.length}`, [rows.length ? rows : note('No paired clients.'),
      administratorActivity])
  }

  function updateActivity() {
    // Activity-only observations do not need the model/pool indexes.
    const host = array(state.view.hosts).find((entry) => entry.host_id === state.selected)
    for (const client of array(host?.snapshot?.clients)) {
      const node = clientActivity.get(client.client_id)
      const value = `${client.active_requests || 0} active request(s) · ${lastSeen(client)}`
      if (node && node.textContent !== value) node.textContent = value
    }
    if (administratorActivity) {
      const value = `Local administrator · ${host?.snapshot?.local_administrator?.active_requests || 0} active request(s)`
      if (administratorActivity.textContent !== value) administratorActivity.textContent = value
    }
    for (const instance of array(host?.snapshot?.instances)) {
      const node = instanceActivity.get(instance.instance_id)
      const value = String(instance.active_requests ?? 0)
      if (node && node.textContent !== value) node.textContent = value
    }
  }

  function sharingSection(host) {
    const sharing = host.snapshot?.lan_sharing || {}
    const editable = host.local && sharing.managed && online(host)
    const rename = () => dialog('Host name', 'This name is shown to nearby computers and paired clients.',
      [field('Name', 'name', host.snapshot?.display_name || host.name, 'text', { required: '', maxlength: 80 })], 'Save',
      (form) => run(hostRequest(host, 'rename', { name: fieldValue(form, 'name') }), 'Host renamed'))
    return section('sharing', 'Sharing and host settings', [
      h('div', { class: 'row' }, h('div', {}, h('h3', {}, 'Share this host'), note(sharing.active ? `Available on the LAN · port ${sharing.port}` : 'LAN sharing is off')),
        h('label', { class: 'check' }, h('input', { type: 'checkbox', 'aria-label': 'Share this host', checked: sharing.enabled,
          disabled: state.busy || !editable, onchange: async (event) => {
            try { await run(hostRequest(host, 'share', { enabled: event.target.checked }), 'Sharing updated') } catch { /* Displayed in status. */ }
          } }), 'Enabled')),
      sharing.error ? h('p', { class: 'section-error' }, sharing.error) : null,
      host.local ? button('Rename this computer…', rename, !editable) : note('Sharing and hostname are managed on the host computer.'),
      !host.local ? button('Forget this host', () => confirm('Forget host', `Remove the saved connection to ${host.name}? Existing models and running instances stay on that host.`,
        { action: 'forget', host_id: host.host_id }, 'Host forgotten'), false, 'danger') : null])
  }

  function coordinatorDialog(host, afterSave = null) {
    const hosts = array(state.view.hosts)
    const current = state.view.fleet?.authority
    const chosen = current?.host_id || hosts.find((entry) => !entry.local && online(entry) && array(entry.snapshot?.instances).length)?.host_id
      || hosts.find((entry) => !entry.local)?.host_id || host.host_id
    const authorityChoice = select('Fleet coordinator', 'coordinator', hosts.map((entry) => [entry.host_id, entry.name]), chosen)
    const addressNote = h('span', { class: 'field-note' })
    const addresses = h('label', {}, 'Coordinator addresses reachable by fleet clients', h('textarea', { name: 'origins', required: '' }), addressNote)
    const fill = () => {
      const id = authorityChoice.querySelector('select').value
      const registration = hosts.find((entry) => entry.host_id === id)
      const published = registration?.snapshot?.fleet
      const locator = published?.kind === 'coordinator' ? published.fleet.authority : current?.host_id === id ? current : null
      const discovered = observation().discovered.get(id)
      const input = addresses.querySelector('textarea')
      input.value = array(locator?.origins).length ? locator.origins.join('\n') : array(discovered?.urls).length ? discovered.urls.join('\n') : text(registration?.base_url, '')
      input.readOnly = id !== host.host_id && published?.kind === 'coordinator'
      addressNote.textContent = input.readOnly ? 'These addresses belong to the configured coordinator. Select that host in Manager to edit them.'
        : 'Enter one HTTPS address per line. Other computers need a reachable LAN address.'
    }
    authorityChoice.addEventListener('change', fill)
    fill()
    dialog('Set fleet coordinator', `Apply this coordinator to ${host.name}. A coordinator change is explicit; unavailable hosts never elect a replacement.`,
      [authorityChoice, addresses, note('Enter one HTTPS address per line. Use a LAN address for other computers; a loopback address is only reachable on this computer.')], 'Set coordinator',
      (form) => {
        const registration = hosts.find((entry) => entry.host_id === fieldValue(form, 'coordinator'))
        if (!registration) throw new Error('Choose a paired coordinator')
        return run({ action: 'fleet_configure', member_host_id: host.host_id, authority: { host_id: registration.host_id,
          certificate_sha256: registration.certificate_sha256, origins: parseOrigins(fieldValue(form, 'origins')) } }, 'Fleet coordinator updated')
      }, afterSave)
  }

  function poolDialog(pool = null) {
    const fleet = state.view.fleet.snapshot
    const eligible = new Set([fleet.authority.host_id, ...array(fleet.members).map((member) => member.host.host_id)])
    const all = instances().map(({ host, instance }) => ({ host_id: host.host_id, instance_id: instance.instance_id }))
    const oldMembers = firstMap(array(pool?.members), (member) => instanceKey(member.instance))
    const ordered = [...array(pool?.members).map((member) => member.instance), ...all.filter((ref) => !oldMembers.has(instanceKey(ref)))]
    const choices = ordered.map((ref, index) => {
      const old = oldMembers.get(instanceKey(ref))
      return h('div', { class: 'pool-choice', 'data-ref': instanceKey(ref) }, h('label', { class: 'check' },
        h('input', { type: 'checkbox', name: 'member', value: String(index), checked: !!old }),
        `${instanceLabel(ref)}${eligible.has(ref.host_id) ? '' : ' · joins this fleet'}`),
        h('input', { type: 'number', name: `limit_${index}`, value: old?.worker_limit || 1, min: 1, 'aria-label': `Worker limit for ${instanceLabel(ref)}` }),
        h('input', { type: 'number', name: `priority_${index}`, value: index + 1, min: 1, 'aria-label': `Priority for ${instanceLabel(ref)}` }))
    })
    dialog(pool ? 'Edit work pool' : 'New work pool', `Edits use coordinator revision ${fleet.revision}. Selected hosts outside this fleet join when you save. Limits apply per client; order is the allocator’s tie breaker.`,
      [field('Pool name', 'name', pool?.name || '', 'text', { required: '' }),
        h('div', { class: 'pool-labels' }, 'Instance', 'Workers', 'Priority'), h('div', { class: 'choice-list' }, choices)], 'Save pool',
      (form) => {
        const members = checkedValues(form, 'member').map((index) => ({ instance: ordered[Number(index)],
          worker_limit: Number(fieldValue(form, `limit_${index}`)), priority: Number(fieldValue(form, `priority_${index}`)) }))
          .sort((a, b) => a.priority - b.priority).map(({ instance, worker_limit }) => ({ instance, worker_limit }))
        if (!members.length) throw new Error('Choose at least one instance')
        return run({ action: 'fleet_update', update: { expected_revision: fleet.revision, operation: 'save_pool',
          pool: { id: pool?.id || globalThis.crypto.randomUUID(), name: fieldValue(form, 'name'), members } } }, 'Work pool saved')
      })
  }

  function assignmentDialog(assignment = null) {
    const report = state.view.fleet
    const fleet = report.snapshot
    const coordinator = observation().hosts.get(fleet.authority.host_id)
    const clients = array(coordinator?.snapshot?.clients)
    const existingId = assignment?.client_id || report.client_id || clients[0]?.client_id
    const clientChoices = clients.map((client) => [client.client_id, `${client.name}${client.client_id === report.client_id ? ' · this client' : ''}`])
    if (existingId && !clientChoices.some(([id]) => id === existingId)) clientChoices.push([existingId, existingId])
    const hostChoices = [...new Map([[fleet.authority.host_id, hostName(fleet.authority.host_id)],
      ...array(fleet.members).map((member) => [member.host.host_id, member.display_name])]).entries()]
    const eligible = new Set(hostChoices.map(([id]) => id))
    const refByKey = firstMap([...array(assignment?.preferred_instances), ...instances().filter(({ host }) => eligible.has(host.host_id))
      .map(({ host, instance }) => ({ host_id: host.host_id, instance_id: instance.instance_id }))], instanceKey)
    const refs = [...refByKey.values()]
    const assignments = firstMap(array(fleet.assignments), (entry) => entry.client_id)
    const clientField = select('Client', 'client', clientChoices, existingId)
    clientField.querySelector('select').disabled = !!assignment
    const preferences = h('div')
    const fill = () => {
      const saved = assignments.get(clientField.querySelector('select').value)
      preferences.replaceChildren(
        checks('Visible work pools', 'pool', array(fleet.pools).map((pool) => [pool.id, pool.name]), saved?.pool_ids || []),
        checks('Preferred hosts', 'preferred_host', hostChoices, saved?.preferred_hosts || []),
        checks('Preferred instances', 'preferred_instance', refs.map((ref) => [instanceKey(ref), instanceLabel(ref)]), array(saved?.preferred_instances).map(instanceKey)))
    }
    clientField.addEventListener('change', fill)
    fill()
    dialog('Client assignment', `Choose visible work pools and preferred targets for this coordinator-issued client grant. Revision ${fleet.revision}.`,
      [clientField, preferences],
      'Save assignment', (form) => {
        const client_id = fieldValue(form, 'client')
        if (!client_id) throw new Error('Choose a coordinator client')
        return run({ action: 'fleet_update', update: { expected_revision: fleet.revision, operation: 'set_client_assignment',
          assignment: { client_id, pool_ids: checkedValues(form, 'pool'), preferred_hosts: checkedValues(form, 'preferred_host'),
            preferred_instances: checkedValues(form, 'preferred_instance').map((key) => refByKey.get(key)) } } }, 'Client assignment saved')
      })
  }

  function fleetSection(host) {
    const report = state.view.fleet || {}
    const fleet = report.snapshot
    const writable = report.connected === true && !!fleet
    const update = (operation) => run({ action: 'fleet_update', update: { expected_revision: fleet.revision, ...operation } }, 'Fleet updated')
    const coordinatorName = hostName(report.authority?.host_id)
    const index = observation()
    const coordinator = index.hosts.get(report.authority?.host_id)
    const hostIssues = array(report.host_issues)
    const hostIds = new Set([...array(state.view.hosts).map((entry) => entry.host_id), ...hostIssues.map((issue) => issue.host_id)])
    const hostStatuses = [...hostIds].map((id) => {
      const entry = index.hosts.get(id)
      const issues = index.issues.get(id) || []
      const problems = issues.filter((issue) => !issue.offline).map((issue) => issue.message)
      if (entry?.error && !entry.offline) problems.push(entry.error)
      const offline = entry?.offline || issues.some((issue) => issue.offline)
      const status = problems.length ? 'Needs attention' : offline ? 'Offline' : online(entry) ? 'Online' : 'Unavailable'
      const name = entry?.name || index.members.get(id)?.display_name || hostName(id)
      return h('div', { class: 'list-row fleet-host', 'data-fleet-host': id },
        h('div', { class: 'row' }, h('div', { class: 'title' }, name),
          h('span', { class: `badge ${problems.length ? 'failed' : status === 'Online' ? 'ready' : 'offline'}`, role: 'status' }, status)),
        [...new Set(problems)].map((problem) => h('p', { class: 'section-error' }, problem)))
    })
    const clients = firstMap(array(coordinator?.snapshot?.clients), (client) => client.client_id)
    const clientName = (id) => clients.get(id)?.name || id
    const membership = host.snapshot?.fleet_membership?.membership
    const sameAuthority = membership?.authority?.host_id === report.authority?.host_id
      && membership?.authority?.certificate_sha256 === report.authority?.certificate_sha256
    const currentMembership = writable && online(host) && sameAuthority && membership?.revision === fleet?.revision
    const ownPools = array(membership?.pools).map((pool) => h('div', { class: 'list-row' },
      h('div', { class: 'title' }, pool.name), h('p', {}, array(pool.members).map((member) =>
        `${instanceLabel(member.instance)} · ${member.worker_limit} worker(s)`).join('; '))))
    const pools = array(fleet?.pools).map((pool) => h('div', { class: 'list-row' }, h('div', { class: 'row' },
      h('div', {}, h('div', { class: 'title' }, pool.name), h('p', {}, array(pool.members).map((member) => `${instanceLabel(member.instance)} · ${member.worker_limit} worker(s)`).join('; '))),
      h('div', { class: 'actions' }, button('Edit', () => poolDialog(pool), !writable), button('Delete', () => confirm('Delete pool',
        `Delete ${pool.name} from the shared fleet? Assignments that use it must be updated first.`,
        { action: 'fleet_update', update: { expected_revision: fleet.revision, operation: 'delete_pool', pool_id: pool.id } }, 'Work pool deleted'), !writable, 'danger')))))
    const assignments = array(fleet?.assignments).map((assignment) => h('div', { class: 'list-row row' }, h('div', {},
      h('div', { class: 'title' }, clientName(assignment.client_id)),
      h('p', {}, `Pools: ${array(assignment.pool_ids).map((id) => index.pools.get(id)?.name || id).join(', ') || 'None'}`),
      h('p', {}, `Preferred hosts: ${array(assignment.preferred_hosts).map(hostName).join(', ') || 'None'}`),
      h('p', {}, `Preferred instances: ${array(assignment.preferred_instances).map(instanceLabel).join(', ') || 'None'}`)),
      button('Edit assignment', () => assignmentDialog(assignment), !writable)))
    const memberRows = array(fleet?.members).map((member) => h('div', { class: 'list-row row' }, h('div', {},
      h('div', { class: 'title' }, member.display_name), h('div', { class: 'mono' }, member.host.origins.join(', '))),
      button('Remove member', () => confirm('Remove member', `Remove ${member.display_name} from this fleet? Pool and assignment references must be updated first.`,
        { action: 'fleet_update', update: { expected_revision: fleet.revision, operation: 'remove_member', host_id: member.host.host_id } }, 'Fleet member removed'), !writable, 'danger')))
    const enroll = () => {
      const published = host.snapshot?.fleet
      const locator = published?.kind === 'coordinator' ? published.fleet.authority : null
      const origins = locator?.origins || observation().discovered.get(host.host_id)?.urls || [host.base_url]
      dialog('Enroll fleet member', `Add ${host.name} to the coordinator’s catalog. This does not replace its own pairing grant.`,
        [h('label', {}, 'Addresses reachable by fleet clients', h('textarea', { name: 'origins', required: '' }, origins.join('\n')))], 'Enroll',
        (form) => update({ operation: 'enroll_member', member: { display_name: host.name, host: { host_id: host.host_id,
          certificate_sha256: host.certificate_sha256, origins: parseOrigins(fieldValue(form, 'origins')) } } }))
    }
    return section('fleet', 'Work pools and client assignments', [
      h('div', { class: 'row' }, h('div', {}, h('h3', {}, report.authority ? `Coordinator: ${coordinatorName}` : 'No fleet coordinator selected'),
        note(fleet ? `Revision ${fleet.revision} · ${writable ? 'Connected' : 'Stale · read only'}` : 'Choose the host that owns shared work pools.')),
        button('Set coordinator…', () => coordinatorDialog(host), !online(host))),
      report.error ? h('p', { class: 'section-error' }, report.error) : null,
      h('div', { class: 'fleet-host-statuses', 'aria-label': 'Fleet host status' }, hostStatuses),
      report.authority ? h('p', { class: 'mono' }, array(report.authority.origins).join(', ')) : null,
      h('h3', {}, 'This host’s pool memberships'),
      membership ? [note(`${currentMembership ? 'Current' : 'Last known'} revision ${membership.revision} · ${hostName(membership.authority.host_id)}`),
        ownPools.length ? ownPools : note('No assigned pool instances on this host.')] : note('No confirmed membership report from this host yet.'),
      h('div', { class: 'actions' }, button('New work pool', () => {
        if (writable) poolDialog()
        else coordinatorDialog(host, () => {
          if (state.view.fleet?.connected && state.view.fleet?.snapshot) poolDialog()
          else { state.error = 'Connect to the selected coordinator before creating a work pool.'; render() }
        })
      }, (!writable && (report.authority || !online(host))) || !instances().length),
        button('Assign client…', () => assignmentDialog(), !writable),
        button('Enroll selected host…', enroll, !writable || !online(host) || host.host_id === report.authority?.host_id || array(fleet?.members).some((member) => member.host.host_id === host.host_id))),
      pools.length ? pools : note('No shared work pools.'),
      h('h3', {}, 'Client assignments'), assignments.length ? assignments : note('No explicit client assignments.'),
      h('h3', {}, 'Member hosts'), memberRows.length ? memberRows : note('No additional fleet members.')])
  }

  function render(force = true) {
    if (state.stopped) return
    if (document.hidden) { pendingRender = true; return }
    pendingRender = false
    const key = renderKey(state.view)
    const presentation = JSON.stringify([state.selected, state.busy, state.error, state.notice, state.warning, [...state.ignored], [...state.firstRuns]])
    if (!force && key === snapshotKey && presentation === presentationKey) {
      updateActivity()
      return
    }
    snapshotKey = key
    presentationKey = presentation
    clientActivity.clear()
    instanceActivity.clear()
    administratorActivity = null
    for (const details of root.querySelectorAll('details[data-section]')) state.sections.set(details.dataset.section, details.open)
    const hosts = array(state.view.hosts)
    const host = selectedHost()
    const nearby = array(state.view.discovered).filter((entry) => !observation().hosts.has(entry.host_id) && !state.ignored.has(entry.host_id))
    const header = h('header', {}, h('div', { class: 'brand' }, h('img', { src: 'icon.png', alt: '' }),
      h('div', {}, h('strong', {}, 'GInfer Server Manager'), h('small', {}, `${hosts.filter(online).length} of ${hosts.length} hosts online`))),
      h('div', { class: 'actions' }, state.busy ? h('span', { class: 'muted', role: 'status' }, 'Working…') : null,
        button('Secure storage', () => secureStorage().catch(() => {})), button('Refresh', refresh)))
    const sidebar = h('aside', {}, h('div', { class: 'eyebrow' }, 'Hosts'), hosts.map((entry) => h('button', {
      type: 'button', class: `host-button ${state.selected === entry.host_id ? 'selected' : ''}`, onclick: () => {
        state.selected = entry.host_id; savePreference('host', state.selected); render()
      } }, h('span', { class: 'name' }, entry.local ? 'This computer' : entry.name), h('small', {}, `${entry.local ? `${entry.name} · ` : ''}${online(entry) ? 'Online' : entry.offline ? 'GInfer offline' : 'GInfer unavailable'}`))),
      h('div', { class: 'eyebrow sidebar-section' }, 'Nearby'), nearby.length ? nearby.map((entry) => h('div', { class: 'nearby' }, entry.name,
        h('div', { class: 'actions' }, button('Pair', () => pair(entry)), button('Ignore', () => {
          state.ignored.add(entry.host_id); savePreference('ignored', [...state.ignored]); render()
        })))) : h('p', { class: 'nearby muted' }, 'No new hosts found.'),
      h('div', { class: 'sidebar-footer' }, button('Pair a host…', () => pair()),
        state.ignored.size ? button('Show ignored hosts', () => { state.ignored.clear(); savePreference('ignored', []); render() }) : null,
        h('p', { class: 'muted' }, hosts.some(entry => entry.local && entry.snapshot?.can_stop_host)
          ? 'Exiting Manager stops an idle desktop Host. Models and setup work keep a busy Host running.'
          : 'Exiting Manager leaves GInfer hosts and models running.')))
    const main = h('main')
    if (!host) {
      append(main, h('h1', {}, 'Your GInfer hosts'), h('div', { class: 'empty' }, h('strong', {}, 'No registered hosts'),
        'Register this computer with the GInfer launch menu, or pair a host from the sidebar. Manager reconnects independently of GChat.'),
      state.view.local_error ? h('p', { class: 'section-error' }, state.view.local_error) : null)
    } else {
      append(main, h('div', { class: 'heading' }, h('div', {}, h('h1', {}, host.snapshot?.display_name || host.name),
        h('div', { class: 'muted mono' }, host.base_url)), h('div', { class: 'actions' }, badge(online(host) ? 'ready' : host.offline ? 'offline' : 'failed'),
        !host.local && !online(host) ? button('Connect', () => run(hostRequest(host, 'snapshot'), 'Host connected').catch(() => {})) : null,
        host.local && host.snapshot?.can_stop_host ? button('Stop Host and Quit', () => confirm(
          'Stop Host and Quit', 'Stop this computer’s idle desktop Host and quit Manager. Stop loaded models and wait for setup work to finish first.',
          hostRequest(host, 'stop_host'), 'Host stopping'), !online(host)) : null,
        button('Start a model…', () => launchDialog(host), !online(host) || profiling(host) || !array(host.snapshot?.models).length, 'primary'))),
      !online(host) ? h('div', { class: 'empty' }, h('strong', {}, host.offline ? 'GInfer offline' : 'GInfer unavailable'), 'Last-known inventory is shown. Controls are disabled until the host reconnects.',
        host.error && !host.offline ? h('p', { class: 'section-error' }, host.error) : null) : null,
      firstRunSection(host), hardwareProfileSection(host),
      array(host.snapshot?.instances).length ? array(host.snapshot.instances).map((instance) => instanceCard(host, instance))
        : h('div', { class: 'empty' }, h('strong', {}, 'No instances'), 'Choose an installed model to start one. Models never start automatically.'),
      modelsSection(host), sharingSection(host), clientsSection(host), fleetSection(host))
    }
    root.replaceChildren(...[header,
      state.error ? h('div', { class: 'notice error', role: 'alert' }, state.error) : null,
      state.notice ? h('div', { class: 'notice', role: 'status' }, state.notice) : null,
      state.warning ? h('div', { class: 'notice', role: 'alert' }, state.warning) : null,
      h('div', { class: 'layout' }, sidebar, main)].filter(Boolean))
  }

  async function start() {
    document.addEventListener('visibilitychange', showLatest)
    render()
    for (const [event, handler] of [['manager-snapshot', (event) => apply(event.payload)], ['manager-error', (event) => { state.error = String(event.payload); state.errorSource = 'runtime'; render() }]]) {
      try { const unsubscribe = await listen(event, handler); subscriptions.push(unsubscribe) }
      catch (error) { state.error = String(error); render() }
    }
    await refresh()
  }
  function stop() {
    state.stopped = true
    document.removeEventListener('visibilitychange', showLatest)
    state.dialog?.close()
    subscriptions.forEach((unsubscribe) => unsubscribe())
  }
  function showLatest() {
    if (!document.hidden && pendingRender) render(false)
  }
  return { start, stop, apply, refresh }
}

if (globalThis.window?.__TAURI__) {
  const app = createManager(document.getElementById('manager'), window.__TAURI__.core.invoke, window.__TAURI__.event.listen)
  app.start()
  window.addEventListener('pagehide', () => app.stop())
}

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

export function createManager(root, invoke, listen, storage = globalThis.localStorage) {
  const document = root.ownerDocument
  const readPreference = (key, fallback) => {
    try { return JSON.parse(storage.getItem(`ginfer-manager.${key}`)) ?? fallback } catch { return fallback }
  }
  const savePreference = (key, value) => {
    try { storage.setItem(`ginfer-manager.${key}`, JSON.stringify(value)) } catch { /* Display preferences are optional. */ }
  }
  const state = { view: { hosts: [], discovered: [], fleet: null }, selected: readPreference('host', null),
    ignored: new Set(readPreference('ignored', [])), sections: new Map(), catalogs: new Map(),
    busy: false, notice: '', error: '', errorSource: null, dialog: null, stopped: false }
  const subscriptions = []

  function append(node, ...children) {
    for (const child of children.flat(Infinity)) if (child != null) node.append(child.nodeType ? child : document.createTextNode(String(child)))
  }
  function h(tag, properties = {}, ...children) {
    const node = document.createElement(tag)
    for (const [key, value] of Object.entries(properties)) {
      if (key.startsWith('on')) node.addEventListener(key.slice(2).toLowerCase(), value)
      else if (key === 'class') node.className = value
      else if (key === 'text') node.textContent = text(value, '')
      else if (key === 'checked' || key === 'disabled' || key === 'open') node[key] = !!value
      else if (key === 'value') node.value = value
      else if (value != null) node.setAttribute(key, value)
    }
    append(node, children)
    return node
  }
  const button = (label, action, disabled = false, className = '') => h('button', {
    type: 'button', class: className, disabled: state.busy || disabled, onclick: action }, label)
  const note = (content) => h('p', { class: 'muted' }, content)
  const badge = (status) => h('span', { class: `badge ${status}` }, text(status, 'unknown'))
  const online = (host) => host?.online === true
  const selectedHost = () => array(state.view.hosts).find((host) => host.host_id === state.selected)
  const hostName = (id) => text(array(state.view.hosts).find((host) => host.host_id === id)?.name, id)
  const instances = () => array(state.view.hosts).flatMap((host) => array(host.snapshot?.instances).map((instance) => ({ host, instance })))
  const displayedInstance = (host, instance) => {
    const model = array(host.snapshot?.models).find((model) => model.id === instance.profile?.model_id)
    return model ? modelLabel(model) : instance.configuration?.artifact ? modelLabel({ path: instance.configuration.artifact })
      : text(instance.upstream_model_id || instance.display_name)
  }
  const instanceLabel = (ref) => {
    const row = instances().find(({ host, instance }) => host.host_id === ref.host_id && instance.instance_id === ref.instance_id)
    return row ? `${row.host.name} · ${displayedInstance(row.host, row.instance)}` : `${hostName(ref.host_id)} · ${ref.instance_id}`
  }
  const hostRequest = (host, operation, args = {}) => ({ action: 'host', host_id: host.host_id, operation, args })

  function apply(view) {
    if (state.stopped || !view) return
    state.view = view
    if (state.errorSource === 'runtime') state.error = ''
    if (!array(view.hosts).some((host) => host.host_id === state.selected)) {
      state.selected = array(view.hosts).find((host) => host.local)?.host_id || array(view.hosts)[0]?.host_id || null
    }
    savePreference('host', state.selected)
    render()
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
    render()
    try {
      const response = await invoke('manager_request', { request })
      apply(response.view)
      state.notice = success
      if (response.view?.refresh_error) state.error = `The action completed. Refresh failed: ${response.view.refresh_error}`
      return response.result
    } catch (error) {
      state.error = String(error)
      // A conflict never retries the edit. Refresh the account behind the open
      // draft so its old expected_revision stays fixed for explicit review.
      if (state.error.includes('409')) {
        try { apply(await invoke('manager_snapshot')) } catch { /* Keep the reported edit conflict. */ }
      }
      throw error
    } finally { state.busy = false; render() }
  }

  function dialog(title, description, fields, submitLabel, submit, afterSave = null) {
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
        const conflict = String(failure).includes('409')
        error.textContent = conflict ? 'The fleet changed while this form was open. Cancel and review the current revision before editing again.' : String(failure)
        accept.disabled = conflict
        cancel.disabled = false
      }
    })
    document.addEventListener('keydown', key)
    document.body.append(backdrop)
    state.dialog = { close }
    pane.querySelector('input,select,textarea,button')?.focus()
    return form
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
    dialog(title, description, [], title, () => run(request, success))
  }

  function pair(discovered = null) {
    if (discovered) {
      run({ action: 'pair', host_id: discovered.host_id, base_url: discovered.urls?.[0] || null, client_name: null }, 'Host paired')
        .catch(() => { /* Shared enrollment errors remain visible; no second pairing step. */ })
      return
    }
    const name = field('Client name', 'client_name', state.view.client_name || '', 'text', { required: '', maxlength: 80 })
    const address = field('Host address', 'base_url', discovered?.urls?.[0] || '', 'url', { required: '', placeholder: 'https://192.168.1.10:7444' })
    const secureStatus = h('p', { class: 'section-error', role: 'status' })
    dialog('Pair a host',
      'Pairing saves the verified host certificate and this client’s grant in shared native storage. Secure storage must be available.',
      [name, address, button('Check secure storage', async () => {
        try { await run({ action: 'secure_storage' }, 'Secure storage is ready'); secureStatus.textContent = 'Secure storage is ready' }
        catch (error) { secureStatus.textContent = String(error) }
      }), secureStatus], 'Pair', (form) => run({ action: 'pair', host_id: discovered?.host_id || null,
        base_url: fieldValue(form, 'base_url'), client_name: fieldValue(form, 'client_name') }, 'Host paired'))
  }

  function section(key, title, children, initiallyOpen = false) {
    const node = h('details', { class: 'section', 'data-section': key, open: state.sections.get(key) ?? initiallyOpen },
      h('summary', {}, title), h('div', { class: 'section-content' }, children))
    node.addEventListener('toggle', () => state.sections.set(key, node.open))
    return node
  }

  function launchDialog(host, instance = null) {
    const snapshot = host.snapshot || {}
    const models = array(snapshot.models)
    const profiles = array(snapshot.launch_profiles).flatMap((entry) =>
      array(instance ? entry.compatible_gpu_groups : entry.gpu_groups).map((group) => ({ entry, group })))
    const previous = instance?.profile || {}
    const model = previous.model_id || models[0]?.id
    let mode = profiles.length ? 'profile' : 'custom'
    const content = h('div')
    const radios = h('div', { class: 'radio-tabs' }, ['profile', 'custom'].map((kind) => h('label', {},
      h('input', { type: 'radio', name: 'launch_mode', value: kind, checked: mode === kind,
        disabled: kind === 'profile' && !profiles.length, onchange: () => { mode = kind; fill() } }),
      kind === 'profile' ? 'Saved profile' : 'Custom settings')))
    const gpuNames = (group) => group.map((id) => {
      const index = array(snapshot.gpus).findIndex((gpu) => gpu.uuid === id)
      return `GPU ${index} · ${text(snapshot.gpus[index]?.display_name || snapshot.gpus[index]?.name, id)}`
    }).join(' + ')
    function fill() {
      if (mode === 'profile') {
        content.replaceChildren(select('Profile and GPU group', 'profile_choice', profiles.map(({ entry, group }, index) => [String(index),
          `${entry.profile.name} · ${gpuNames(group)} · ${entry.profile.qualification.tier} · Engine ${entry.profile.qualification.engine_revision.slice(0, 8)}`]), '0'),
        h('p', { class: 'muted' }, 'Profile evidence applies to its recorded Engine and workload. A changed Engine needs separate validation.'))
        return
      }
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
        field('GPU KV budget (bytes, blank = automatic)', 'kv_arena_bytes', previous.kv_arena_bytes ?? '', 'number', { min: 1, max: Number.MAX_SAFE_INTEGER }),
        note('Automatic sizing uses available GPU memory after startup. Context and concurrent request settings stay as entered.'),
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
        const target = models.find((entry) => entry.id === modelField.querySelector('select').value)?.metadata?.identity?.model_id
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
      [radios, content, ...(instance?.active_requests > 0 ? [h('label', { class: 'check' },
        h('input', { type: 'checkbox', name: 'force' }), `Interrupt ${instance.active_requests} active request(s)`)] : [])],
      instance ? 'Reload' : 'Start', (form) => {
        const guard = instance ? { instance_id: instance.instance_id, expected_session_id: instance.session_id ?? null, force: checked(form, 'force') } : {}
        if (mode === 'profile') {
          const choice = profiles[Number(fieldValue(form, 'profile_choice'))]
          if (!choice) throw new Error('Choose a saved profile')
          return run(hostRequest(host, 'profile_launch', { ...guard, profile_id: choice.entry.profile.id,
            model_id: choice.entry.model_id, gpu_uuids: choice.group }), instance ? 'Instance reloaded' : 'Model starting')
        }
        const configuration = { ...previous, instance_id: instance?.instance_id || null, qualified_profile_id: null,
          model_id: fieldValue(form, 'model_id'), gpu_uuids: checkedValues(form, 'gpu'),
          max_context: Number(fieldValue(form, 'max_context')), concurrency: Number(fieldValue(form, 'concurrency')),
          vision: checked(form, 'vision'), spec: fieldValue(form, 'spec'), draft_policy: fieldValue(form, 'draft_policy'),
          draft_tokens: Number(fieldValue(form, 'draft_tokens')), kv_dtype: fieldValue(form, 'kv_dtype'),
          kv_arena_bytes: fieldValue(form, 'kv_arena_bytes') === '' ? null : Number(fieldValue(form, 'kv_arena_bytes')) }
        if (!configuration.gpu_uuids.length) throw new Error('Choose the exact GPU group')
        if (configuration.kv_arena_bytes !== null && (!Number.isSafeInteger(configuration.kv_arena_bytes) || configuration.kv_arena_bytes < 1)) {
          throw new Error('GPU KV budget must be a positive whole number of bytes, or blank for automatic sizing')
        }
        const width = configuration.draft_tokens
        if (!Number.isInteger(width) || width < 0) throw new Error('Draft width must be a whole number')
        if (configuration.spec === 'dflash' && (width < 1 || width > 15)) throw new Error('DFlash2 requires a draft width from 1 to 15; the host checks the exact model limit')
        if (configuration.spec === 'mtp' && (width < 1 || width >= 4294967295)) throw new Error('MTP requires a positive draft width below 4294967295')
        if (['auto', 'none'].includes(configuration.spec) && width !== 0) throw new Error('Automatic or disabled speculation uses draft width 0')
        return run(hostRequest(host, instance ? 'instance' : 'launch', instance ? { ...guard, operation: 'reload', configuration } : configuration),
          instance ? 'Instance reloaded' : 'Model starting')
      })
  }

  function instanceCard(host, instance) {
    const configuration = instance.profile || instance.configuration || {}
    const running = ['ready', 'starting', 'stopping'].includes(instance.status)
    const gpuLabels = array(configuration.gpu_uuids).map((uuid) => {
      const index = array(host.snapshot?.gpus).findIndex((gpu) => gpu.uuid === uuid)
      return `GPU ${index >= 0 ? index : '?'} · ${text(host.snapshot?.gpus?.[index]?.display_name || host.snapshot?.gpus?.[index]?.name, uuid)}`
    })
    const installed = array(host.snapshot?.models).find((model) => model.id === configuration.model_id)
    const name = installed ? modelLabel(installed) : displayedInstance(host, instance)
    const facts = [['GPU group', gpuLabels.join(' + ') || '—'], ['Engine port', text(instance.configuration?.port, 'Allocated when started')],
      ['Active requests', instance.active_requests ?? 0], ['Context / requests', `${text(configuration.max_context)} / ${text(configuration.concurrency)}`]]
    const execute = async (operation) => {
      try { await run(hostRequest(host, 'instance', { instance_id: instance.instance_id, operation,
        expected_session_id: instance.session_id ?? null, force: false }), operation === 'start' ? 'Model starting' : 'Instance stopped') }
      catch { /* The native error remains visible. */ }
    }
    return h('article', { class: 'card', 'data-instance': instance.instance_id },
      h('div', { class: 'card-title' }, h('h3', {}, name), badge(online(host) ? instance.status : 'offline')),
      h('div', { class: 'facts' }, facts.map(([label, value]) => h('div', {}, label, h('strong', {}, value)))),
      instance.last_error ? h('p', { class: 'section-error' }, instance.last_error) : null,
      h('div', { class: 'actions' }, button('Start', () => execute('start'), !online(host) || running),
        button('Stop', () => execute('stop'), !online(host) || !running || instance.status === 'stopping'),
        button('Reload', () => launchDialog(host, instance), !online(host) || instance.status === 'stopping' || !array(host.snapshot?.models).length)))
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
    const rows = clients.map((client) => h('div', { class: 'list-row row' }, h('div', {}, h('div', { class: 'title' }, client.name),
      h('p', {}, `${client.active_requests || 0} active request(s) · ${client.last_seen_unix_ms ? `Last seen ${new Date(client.last_seen_unix_ms).toLocaleString()}` : 'No requests yet'}`),
      h('div', { class: 'mono' }, client.client_id)), client.local ? badge('local') : button('Revoke', () => confirm('Revoke client',
        `Revoke ${client.name} on ${host.name}? This removes its grant to this host.`, hostRequest(host, 'revoke', { client_id: client.client_id }), 'Client revoked'), !online(host), 'danger')))
    const administrator = host.snapshot?.local_administrator
    return section('clients', `Paired clients · ${clients.length}`, [rows.length ? rows : note('No paired clients.'),
      administrator ? note(`Local administrator · ${administrator.active_requests || 0} active request(s)`) : null])
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
      const discovered = array(state.view.discovered).find((entry) => entry.host_id === id)
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
          certificate_sha256: registration.certificate_sha256, origins: fieldValue(form, 'origins').split(/\r?\n/).map((origin) => origin.trim()).filter(Boolean) } }, 'Fleet coordinator updated')
      }, afterSave)
  }

  function poolDialog(pool = null) {
    const fleet = state.view.fleet.snapshot
    const eligible = new Set([fleet.authority.host_id, ...array(fleet.members).map((member) => member.host.host_id)])
    const all = instances().map(({ host, instance }) => ({ host_id: host.host_id, instance_id: instance.instance_id }))
    const ordered = [...array(pool?.members).map((member) => member.instance), ...all.filter((ref) => !array(pool?.members).some((member) => instanceKey(member.instance) === instanceKey(ref)))]
    const choices = ordered.map((ref, index) => {
      const old = array(pool?.members).find((member) => instanceKey(member.instance) === instanceKey(ref))
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
    const coordinator = array(state.view.hosts).find((host) => host.host_id === fleet.authority.host_id)
    const clients = array(coordinator?.snapshot?.clients)
    const existingId = assignment?.client_id || report.client_id || clients[0]?.client_id
    const clientChoices = clients.map((client) => [client.client_id, `${client.name}${client.client_id === report.client_id ? ' · this client' : ''}`])
    if (existingId && !clientChoices.some(([id]) => id === existingId)) clientChoices.push([existingId, existingId])
    const hostChoices = [...new Map([[fleet.authority.host_id, hostName(fleet.authority.host_id)],
      ...array(fleet.members).map((member) => [member.host.host_id, member.display_name])]).entries()]
    const eligible = new Set(hostChoices.map(([id]) => id))
    const refs = [...array(assignment?.preferred_instances), ...instances().filter(({ host }) => eligible.has(host.host_id))
      .map(({ host, instance }) => ({ host_id: host.host_id, instance_id: instance.instance_id }))]
      .filter((ref, index, source) => source.findIndex((entry) => instanceKey(entry) === instanceKey(ref)) === index)
    const clientField = select('Client', 'client', clientChoices, existingId)
    clientField.querySelector('select').disabled = !!assignment
    const preferences = h('div')
    const fill = () => {
      const saved = array(fleet.assignments).find((entry) => entry.client_id === clientField.querySelector('select').value)
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
            preferred_instances: checkedValues(form, 'preferred_instance').map((key) => refs.find((ref) => instanceKey(ref) === key)) } } }, 'Client assignment saved')
      })
  }

  function fleetSection(host) {
    const report = state.view.fleet || {}
    const fleet = report.snapshot
    const writable = report.connected === true && !!fleet
    const update = (operation) => run({ action: 'fleet_update', update: { expected_revision: fleet.revision, ...operation } }, 'Fleet updated')
    const coordinatorName = hostName(report.authority?.host_id)
    const coordinator = array(state.view.hosts).find((entry) => entry.host_id === report.authority?.host_id)
    const hostIssues = array(report.host_issues)
    const hostIds = new Set([...array(state.view.hosts).map((entry) => entry.host_id), ...hostIssues.map((issue) => issue.host_id)])
    const hostStatuses = [...hostIds].map((id) => {
      const entry = array(state.view.hosts).find((entry) => entry.host_id === id)
      const issues = hostIssues.filter((issue) => issue.host_id === id)
      const problems = issues.filter((issue) => !issue.offline).map((issue) => issue.message)
      if (entry?.error && !entry.offline) problems.push(entry.error)
      const offline = entry?.offline || issues.some((issue) => issue.offline)
      const status = problems.length ? 'Needs attention' : offline ? 'Offline' : online(entry) ? 'Online' : 'Unavailable'
      const name = entry?.name || array(fleet?.members).find((member) => member.host.host_id === id)?.display_name || hostName(id)
      return h('div', { class: 'list-row fleet-host', 'data-fleet-host': id },
        h('div', { class: 'row' }, h('div', { class: 'title' }, name),
          h('span', { class: `badge ${problems.length ? 'failed' : status === 'Online' ? 'ready' : 'offline'}`, role: 'status' }, status)),
        [...new Set(problems)].map((problem) => h('p', { class: 'section-error' }, problem)))
    })
    const clientName = (id) => array(coordinator?.snapshot?.clients).find((client) => client.client_id === id)?.name || id
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
      h('p', {}, `Pools: ${array(assignment.pool_ids).map((id) => fleet.pools.find((pool) => pool.id === id)?.name || id).join(', ') || 'None'}`),
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
      const origins = locator?.origins || array(state.view.discovered).find((entry) => entry.host_id === host.host_id)?.urls || [host.base_url]
      dialog('Enroll fleet member', `Add ${host.name} to the coordinator’s catalog. This does not replace its own pairing grant.`,
        [h('label', {}, 'Addresses reachable by fleet clients', h('textarea', { name: 'origins', required: '' }, origins.join('\n')))], 'Enroll',
        (form) => update({ operation: 'enroll_member', member: { display_name: host.name, host: { host_id: host.host_id,
          certificate_sha256: host.certificate_sha256, origins: fieldValue(form, 'origins').split(/\r?\n/).map((origin) => origin.trim()).filter(Boolean) } } }))
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

  function render() {
    if (state.stopped) return
    for (const details of root.querySelectorAll('details[data-section]')) state.sections.set(details.dataset.section, details.open)
    const hosts = array(state.view.hosts)
    const host = selectedHost()
    const nearby = array(state.view.discovered).filter((entry) => !hosts.some((host) => host.host_id === entry.host_id) && !state.ignored.has(entry.host_id))
    const header = h('header', {}, h('div', { class: 'brand' }, h('img', { src: 'icon.png', alt: '' }),
      h('div', {}, h('strong', {}, 'GInfer Server Manager'), h('small', {}, `${hosts.filter(online).length} of ${hosts.length} hosts online`))),
      h('div', { class: 'actions' }, state.busy ? h('span', { class: 'muted', role: 'status' }, 'Working…') : null, button('Refresh', refresh)))
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
        h('p', { class: 'muted' }, 'Exiting Manager leaves GInfer hosts and models running.')))
    const main = h('main')
    if (!host) {
      append(main, h('h1', {}, 'Your GInfer hosts'), h('div', { class: 'empty' }, h('strong', {}, 'No registered hosts'),
        'Register this computer with the GInfer launch menu, or pair a host from the sidebar. Manager reconnects independently of GChat.'),
      state.view.local_error ? h('p', { class: 'section-error' }, state.view.local_error) : null)
    } else {
      append(main, h('div', { class: 'heading' }, h('div', {}, h('h1', {}, host.snapshot?.display_name || host.name),
        h('div', { class: 'muted mono' }, host.base_url)), h('div', { class: 'actions' }, badge(online(host) ? 'ready' : host.offline ? 'offline' : 'failed'),
        button('Start a model…', () => launchDialog(host), !online(host) || !array(host.snapshot?.models).length, 'primary'))),
      !online(host) ? h('div', { class: 'empty' }, h('strong', {}, host.offline ? 'GInfer offline' : 'GInfer unavailable'), 'Last-known inventory is shown. Controls are disabled until the host reconnects.',
        host.error && !host.offline ? h('p', { class: 'section-error' }, host.error) : null) : null,
      array(host.snapshot?.instances).length ? array(host.snapshot.instances).map((instance) => instanceCard(host, instance))
        : h('div', { class: 'empty' }, h('strong', {}, 'No instances'), 'Choose an installed model to start one. Models never start automatically.'),
      modelsSection(host), sharingSection(host), clientsSection(host), fleetSection(host))
    }
    root.replaceChildren(...[header, state.error ? h('div', { class: 'notice error', role: 'alert' }, state.error) :
      state.notice ? h('div', { class: 'notice', role: 'status' }, state.notice) : null, h('div', { class: 'layout' }, sidebar, main)].filter(Boolean))
  }

  async function start() {
    render()
    for (const [event, handler] of [['manager-snapshot', (event) => apply(event.payload)], ['manager-error', (event) => { state.error = String(event.payload); state.errorSource = 'runtime'; render() }]]) {
      try { const unsubscribe = await listen(event, handler); subscriptions.push(unsubscribe) }
      catch (error) { state.error = String(error); render() }
    }
    await refresh()
  }
  function stop() {
    state.stopped = true
    state.dialog?.close()
    subscriptions.forEach((unsubscribe) => unsubscribe())
  }
  return { start, stop, apply, refresh }
}

if (globalThis.window?.__TAURI__) {
  const app = createManager(document.getElementById('manager'), window.__TAURI__.core.invoke, window.__TAURI__.event.listen)
  app.start()
  window.addEventListener('pagehide', () => app.stop())
}

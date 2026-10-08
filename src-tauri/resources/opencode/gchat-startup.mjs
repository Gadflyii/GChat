// This adapter uses only OpenCode's public TUI plugin and SDK surfaces.
// OpenCode remains the owner of sessions, messages, permissions and compaction.
export default {
  id: 'gchat.session-startup',
  async tui(api) {
    const bridge = process.env.GCHAT_BRIDGE_URL
    const token = process.env.GCHAT_BRIDGE_TOKEN
    const restored = process.env.GCHAT_CODE_SESSION
    let tail = Promise.resolve()
    let selected
    let selectedVersion
    const report = (kind, info) => {
      if (!bridge || !token || !info?.id || info.parentID) return Promise.resolve()
      if (info.directory && info.directory !== api.state.path.directory) return Promise.resolve()
      // Serialize reports so a delayed update cannot recreate a deleted row.
      tail = tail.catch(() => {}).then(async () => {
        if (api.lifecycle.signal.aborted) return
        const response = await fetch(`${bridge}/history`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ kind, info }),
          signal: api.lifecycle.signal,
        })
        if (!response.ok) throw new Error(`GChat history returned ${response.status}`)
      })
      return tail
    }
    const showError = error => {
      if (!api.lifecycle.signal.aborted) api.ui.toast({
        variant: 'error', message: `Could not save coding session: ${error.message ?? error}`,
      })
    }
    for (const [type, kind] of [['session.created', 'updated'], ['session.updated', 'updated'], ['session.deleted', 'deleted']]) {
      api.event.on(type, event => { void report(kind, event.properties.info).catch(showError) })
    }
    const publishSelected = async () => {
      const route = api.route.current
      if (route.name !== 'session') return
      const id = route.params.sessionID
      const info = api.state.session.get(id)
      const version = info?.time?.updated
      if (!info || (selected === id && selectedVersion === version)) return
      const kind = selected === id ? 'updated' : 'selected'
      await report(kind, info)
      selected = id
      selectedVersion = version
    }
    // The public route API is a live getter, with no route-change subscription.
    // A bounded timer observes selection without terminal-output parsing.
    const timer = setInterval(() => { void publishSelected().catch(showError) }, 750)
    api.lifecycle.onDispose(() => clearInterval(timer))
    try {
      if (api.route.current.name === 'home') {
        if (restored) {
          const result = await api.client.session.get({ directory: api.state.path.directory, sessionID: restored })
          if (!result.data?.id) throw new Error('The saved OpenCode session is unavailable')
          if (!api.lifecycle.signal.aborted && api.route.current.name === 'home') {
            api.route.navigate('session', { sessionID: result.data.id })
          }
        } else {
          const result = await api.client.session.create({
            directory: api.state.path.directory,
            title: 'GChat coding session',
          })
          if (!result.data?.id) throw new Error('OpenCode did not create a session')
          await report('selected', result.data)
          selected = result.data.id
          selectedVersion = result.data.time?.updated
          if (!api.lifecycle.signal.aborted && api.route.current.name === 'home') {
            api.route.navigate('session', { sessionID: result.data.id })
          }
        }
      }
      // Include previously saved stock sessions from this workspace, without
      // importing messages or creating a replacement transcript.
      const result = await api.client.session.list({ directory: api.state.path.directory })
      for (const info of result.data ?? []) await report('updated', info)
      await publishSelected()
    } catch (error) {
      if (!api.lifecycle.signal.aborted) api.ui.toast({
        variant: 'error', message: `Could not open coding session: ${error.message ?? error}`,
      })
    }
  },
}

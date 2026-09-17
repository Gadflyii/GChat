export default {
  id: 'gchat.session-startup',
  async tui(api) {
    if (api.route.current.name !== 'home') return
    try {
      const result = await api.client.session.create({
        directory: api.state.path.directory,
        title: 'GChat coding session',
      })
      if (!result.data?.id) throw new Error('OpenCode did not create a session')
      if (api.lifecycle.signal.aborted || api.route.current.name !== 'home') return
      api.route.navigate('session', { sessionID: result.data.id })
    } catch (error) {
      if (!api.lifecycle.signal.aborted) {
        api.ui.toast({ variant: 'error', message: `Could not open coding session: ${error.message ?? error}` })
      }
    }
  },
}

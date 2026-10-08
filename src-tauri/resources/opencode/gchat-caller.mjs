// Stock OpenCode supplies the actual originating session to this public hook.
// Inject it after model argument validation, immediately before MCP transport.
export default {
  id: 'gchat.session-caller',
  async server({ client, directory }) {
    return {
      async 'tool.execute.before'(input, output) {
        if (!input.tool.startsWith('gchat_')) return
        const bridge = process.env.GCHAT_BRIDGE_URL
        const token = process.env.GCHAT_BRIDGE_TOKEN
        if (!bridge || !token) throw new Error('GChat session bridge is unavailable')
        if (!/^ses[a-zA-Z0-9_]+$/.test(input.sessionID)) throw new Error('Invalid OpenCode caller session')
        const result = await client.session.get({ path: { id: input.sessionID }, query: { directory } })
        if (result.data?.id !== input.sessionID) throw new Error('OpenCode caller session is unavailable')
        const parents = []
        const seen = new Set([input.sessionID])
        let current = result.data
        while (current.parentID) {
          if (seen.has(current.parentID)) throw new Error('Cyclic OpenCode caller ancestry')
          seen.add(current.parentID)
          const parent = await client.session.get({ path: { id: current.parentID }, query: { directory } })
          if (parent.data?.id !== current.parentID) throw new Error('OpenCode caller parent is unavailable')
          parents.push(parent.data)
          current = parent.data
        }
        const response = await fetch(`${bridge}/history`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ kind: 'caller', info: result.data, parents }),
        })
        if (!response.ok) throw new Error(`Could not prepare GChat caller policy (${response.status})`)
        // Replace any model-provided value. GChat strips this reserved field
        // before admitting arguments to its shared capability executor.
        output.args._gchat_opencode_session_id = input.sessionID
      },
    }
  },
}

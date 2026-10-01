import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Channel, type InvokeArgs } from '@tauri-apps/api/core'
import { mockIPC } from '@tauri-apps/api/mocks'
import { TauriCapabilitiesService } from '../capabilities/tauri'

describe('TauriCapabilitiesService', () => {
  const ipc = vi.fn()
  const service = new TauriCapabilitiesService()

  beforeEach(() => {
    ipc.mockReset()
    mockIPC((command: string, args?: InvokeArgs) => ipc(command, args))
  })

  it('returns the unified native and MCP catalog', async () => {
    const catalog = {
      tools: [
        { name: 'os_fs_read', identity: 'os.fs.read', description: 'Read a file', inputSchema: { type: 'object' }, server: 'gchat-native', origin: 'native' },
        { name: 'mcp_search', identity: 'search', description: 'Search', inputSchema: { type: 'object' }, server: 'research', origin: 'mcp' },
      ],
      skills: [],
      servers: [{ name: 'research', status: 'connected' }],
    }
    ipc.mockReturnValue(catalog)

    await expect(service.getCatalog()).resolves.toEqual(catalog)
    expect(ipc).toHaveBeenCalledExactlyOnceWith('capability_list', {})
  })

  it('sends scoped execution inputs with an event channel and cancels by run ID', async () => {
    ipc.mockReturnValue({ content: [{ type: 'text', text: 'done' }] })
    const request = {
      run_id: 'run-1',
      session_id: 'thread-1',
      model_id: 'model-1',
      tool_name: 'os_fs_read',
      arguments: { path: 'notes.txt' },
      working_dir: '/workspace',
      external_roots: [{ path: '/other', can_edit: false }],
      auto_approve: false,
      selected_skill: 'research',
      disabled_tools: ['mcp_search'],
    }

    await expect(service.execute(request, vi.fn())).resolves.toEqual({
      content: [{ type: 'text', text: 'done' }],
    })
    expect(ipc.mock.calls[0]?.[0]).toBe('capability_execute')
    expect(ipc.mock.calls[0]?.[1]).toEqual(expect.objectContaining({ request }))
    expect(ipc.mock.calls[0]?.[1]?.onEvent).toBeInstanceOf(Channel)

    await service.cancel('run-1')
    expect(ipc).toHaveBeenCalledWith('agent_cancel_turn', { runId: 'run-1' })
  })
})

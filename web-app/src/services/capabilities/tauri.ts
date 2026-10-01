import { Channel, invoke } from '@tauri-apps/api/core'
import type { AgentEvent } from '@/types/agent'
import type {
  CapabilitiesService,
  CapabilityCatalog,
  CapabilityExecuteRequest,
  CapabilityExecuteResult,
} from './types'

export class TauriCapabilitiesService implements CapabilitiesService {
  getCatalog(): Promise<CapabilityCatalog> {
    return invoke<CapabilityCatalog>('capability_list')
  }

  execute(
    request: CapabilityExecuteRequest,
    onEvent: (event: AgentEvent) => void
  ): Promise<CapabilityExecuteResult> {
    const channel = new Channel<AgentEvent>()
    channel.onmessage = onEvent
    return invoke<CapabilityExecuteResult>('capability_execute', {
      request,
      onEvent: channel,
    })
  }

  cancel(runId: string): Promise<void> {
    return invoke<void>('agent_cancel_turn', { runId })
  }
}

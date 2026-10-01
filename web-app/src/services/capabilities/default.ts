import type {
  CapabilitiesService,
  CapabilityCatalog,
  CapabilityExecuteResult,
} from './types'

export class DefaultCapabilitiesService implements CapabilitiesService {
  async getCatalog(): Promise<CapabilityCatalog> {
    return { tools: [], skills: [], servers: [] }
  }

  async execute(): Promise<CapabilityExecuteResult> {
    throw new Error('Capabilities require the desktop app.')
  }

  async cancel(): Promise<void> {
    throw new Error('Capabilities require the desktop app.')
  }
}

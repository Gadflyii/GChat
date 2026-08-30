import { useHermesAgentStore } from '@/stores/hermes-agent-store'

export function useHermesAgentModel() {
  const model = useHermesAgentStore((state) => state.model)
  const enabled = useHermesAgentStore((state) => state.enabled)
  const setModel = useHermesAgentStore((state) => state.setModel)
  const setEnabled = useHermesAgentStore((state) => state.setEnabled)
  const clearIntegration = useHermesAgentStore(
    (state) => state.clearIntegration
  )

  return {
    config: { model, enabled },
    setModel,
    setEnabled,
    clearModel: clearIntegration,
  }
}
